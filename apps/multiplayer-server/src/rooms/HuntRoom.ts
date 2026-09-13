/**
 * HuntRoom — the authoritative multiplayer room (PLAN.md P7).
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS ROOM OWNS, AND WHY IT OWNS IT
 *
 * Start time, route assignment, XP, hints, progress, the leaderboard and every
 * geofence check. A client can ask for things; it can never assert them. There
 * is no message in the protocol that carries xp, checkpointIndex, routeId or
 * finished, and the `*` handler at the bottom rejects anything not in
 * `CLIENT_MESSAGE_TYPES`, so a crafted `{type:'score_update', xp: 99999}` is
 * not "validated and rejected" — it is never wired to anything at all.
 *
 * TWO CHANNELS, AND THE RULE THAT SEPARATES THEM
 *
 *   Schema  -> everyone in the room. Progress, XP, names, grid-snapped regions.
 *   send()  -> one client. Clues, hints, instructions, verdicts, reveals.
 *
 * Colyseus broadcasts the whole schema to every client on every patch, so the
 * schema is the public channel whether or not you meant it to be. Everything a
 * player must not learn about an opponent — their route, their clue, their hint
 * text, their earned reveal, their actual coordinates — travels by targeted
 * `client.send()` and is never written to state. See `rooms/schema.ts`.
 *
 * SCORING
 *
 * Every XP number in this file comes from hunt-engine, via the
 * `SubmissionVerdict` that `verifySubmission` computed with `scoreCheckpoint`.
 * The room adds nothing and invents nothing; it copies `verdict.xpDelta` into
 * the state machine and mirrors the machine's total into the schema.
 * ---------------------------------------------------------------------------
 */

import { randomUUID } from 'node:crypto';
// `@colyseus/core` rather than the `colyseus` umbrella: the umbrella's CJS
// bundle re-exports core through a wrapper that Node's ESM named-export
// detection cannot see through, so `import { Room } from 'colyseus'` throws
// "does not provide an export named 'Room'" under tsx/node (it only survives
// bundlers). `Client` is an interface, so it is imported as a type.
import { Room } from '@colyseus/core';
import type { Client } from '@colyseus/core';
import {
  assignRoutes,
  assertSharedDestination,
  generateInstruction,
  transition,
  type HuntState,
} from '@ww/hunt-engine';
import { HINT_TRUE_COST_XP,
  XP_RULES,
  isWithinRadius,
  toApproximateRegion,
  toPublicCheckpoint,
  type ApproximateRegion,
  type Checkpoint,
  type GameMode,
  type Hunt,
  type LatLng,
  type LeaderboardEntry,
  type CompletedRun,
  type LocationSample,
  type Route,
  type ServerMessage,
} from '@ww/shared';
import { verifySubmission } from '@ww/verification';

import { huntStore } from '../hunt-store.js';
import { getRepository } from '../persistence/index.js';
import { ensureSeeded } from '../seed.js';
import { getVerificationProvider, allowPhotoless } from '../verification-provider.js';
import { assertSubmissionMatchesActiveCheckpoint } from './guards.js';
import { buildLeaderboard, type LeaderboardSource } from './leaderboard.js';
import { roomCodes } from './room-codes.js';
import { HuntRoomState, PlayerState, TeamState } from './schema.js';
import {
  activeCheckpointId,
  activeProgress,
  completedCount,
  createRun,
  hintsUsedCount,
  incorrectAttemptsTotal,
  isFinalCheckpointIndex,
  isRunFinished,
  type HuntRun,
} from './run.js';
import {
  sanitizePlayerName,
  sanitizeTeamName,
  validateCheckpointId,
  validateLocation,
  validateShareLocation,
  validateSubmission,
} from './validate.js';

/** Matches `toApproximateRegion`'s default and DECISIONS.md D9. */
export const OPPONENT_REGION_RADIUS_METERS = 150;

/**
 * Long enough to survive a lift, a tunnel or a browser tab reload while walking
 * Downtown; short enough that an abandoned run does not hold a lobby slot for
 * the rest of the demo.
 */
export const RECONNECTION_WINDOW_SECONDS = 60;

/** Floods of GPS fixes are dropped rather than processed. */
export const LOCATION_MIN_INTERVAL_MS = 400;

/** PLAN.md P9: sample the breadcrumb trail every 10-15s while active. */
export const PATH_SAMPLE_INTERVAL_MS = 10_000;

export const DEFAULT_MAX_PLAYERS = 8;

export interface HuntRoomOptions {
  playerName?: string;
  teamName?: string;
  mode?: GameMode;
  huntId?: string;
  maxPlayers?: number;
  hintsEnabled?: boolean;
}

/** Per-connection private data. None of this is ever published. */
interface Member {
  playerId: string;
  sessionId: string;
  /** Player id, or team id in `team-race`. Selects the shared run. */
  entityId: string;
  /** The RAW fix. Only ever read by this server, for geofencing and replay. */
  rawPosition: LatLng | null;
  shareLocation: boolean;
  lastLocationAt: number;
  lastSampleAt: number;
  path: LocationSample[];
}

const ROOM_MODES: readonly GameMode[] = ['individual-race', 'team-race'];

export class HuntRoom extends Room<HuntRoomState> {
  private hunt!: Hunt;
  private routes: Route[] = [];

  /** sessionId -> private per-connection data. */
  private readonly members = new Map<string, Member>();
  /** entityId -> the shared hunt-engine run. */
  private readonly runs = new Map<string, HuntRun>();

  private joinCounter = 0;

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  override onCreate(options: HuntRoomOptions = {}): void {
    ensureSeeded();

    const hunt = huntStore.getHunt(options.huntId);
    if (!hunt) throw new Error('No hunt content is loaded — run the seed script.');
    this.hunt = hunt;
    this.routes = huntStore.routesForHunt(hunt.id);
    if (this.routes.length === 0) throw new Error(`Hunt "${hunt.id}" has no routes.`);

    // Fail at room creation, not when two players finish on opposite sides of
    // Downtown. The shared finish line is the premise of the whole game.
    assertSharedDestination(this.routes);

    const state = new HuntRoomState();
    state.code = roomCodes.claim(this.roomId);
    state.settings.huntId = hunt.id;
    state.settings.mode = normalizeMode(options.mode);
    state.settings.duration = hunt.duration;
    state.settings.maxPlayers = clampInt(options.maxPlayers, 2, 16, DEFAULT_MAX_PLAYERS);
    state.settings.hintsEnabled = options.hintsEnabled !== false;
    this.setState(state);

    this.maxClients = state.settings.maxPlayers;
    this.setMetadata({ code: state.code, huntId: hunt.id, mode: state.settings.mode });

    this.registerHandlers();
  }

  override onDispose(): void {
    roomCodes.release(this.state.code);
  }

  override onJoin(client: Client, options: HuntRoomOptions = {}): void {
    // Late joins are refused rather than silently seated without a route: a
    // player who joins mid-hunt has no assignment, no start time and no way to
    // catch up, which looks like a bug rather than a rule.
    if (this.state.startedAt !== 0) {
      throw new Error('This hunt has already started. Ask the host for a new room.');
    }

    this.joinCounter += 1;
    const player = new PlayerState();
    player.id = `player_${randomUUID().slice(0, 8)}`;
    player.sessionId = client.sessionId;
    player.name = sanitizePlayerName(options.playerName, `Player ${this.joinCounter}`);
    player.connected = true;
    player.sharingLocation = true;

    const isFirst = this.state.players.size === 0;
    player.isHost = isFirst;
    if (isFirst) this.state.hostSessionId = client.sessionId;

    let entityId = player.id;
    if (this.state.settings.mode === 'team-race') {
      const team = this.resolveTeam(options.teamName, player);
      player.teamId = team.id;
      team.memberIds.push(player.id);
      entityId = team.id;
    }

    this.state.players.set(client.sessionId, player);
    this.members.set(client.sessionId, {
      playerId: player.id,
      sessionId: client.sessionId,
      entityId,
      rawPosition: null,
      shareLocation: true,
      lastLocationAt: 0,
      lastSampleAt: 0,
      path: [],
    });

    this.publishLeaderboard();
  }

  /**
   * A dropped player keeps their XP and their place in the route.
   *
   * Nothing is torn down on disconnect: the run lives in `this.runs`, keyed by
   * entity rather than by connection, so it is untouched by a socket closing.
   * All that changes is `connected: false`, which the leaderboard renders — an
   * opponent who has vanished is information the other players should have.
   */
  override async onLeave(client: Client, consented?: boolean): Promise<void> {
    const player = this.state.players.get(client.sessionId);
    if (player) player.connected = false;
    this.publishLeaderboard();

    // Before the hunt starts there is no progress worth holding a seat for.
    if (consented === true || this.state.startedAt === 0) {
      this.removeMember(client.sessionId);
      this.publishLeaderboard();
      return;
    }

    try {
      await this.allowReconnection(client, RECONNECTION_WINDOW_SECONDS);
      const restored = this.state.players.get(client.sessionId);
      if (restored) restored.connected = true;
      this.publishLeaderboard();
      this.resendActiveCheckpoint(client);
    } catch {
      this.removeMember(client.sessionId);
      this.publishLeaderboard();
    }
  }

  /**
   * Re-send the player's current clue after they reconnect.
   *
   * XP and progress live in replicated state and come back on their own, but
   * the active clue does NOT: it is sent once, targeted, over `client.send()`
   * precisely so opponents never see it. A returning player therefore has
   * their score and their place in the route, and nothing to walk towards —
   * a blank screen that looks like the game broke.
   *
   * This is the realistic failure: a phone locks mid-hunt, or a tab is
   * backgrounded long enough to drop the socket.
   */
  private resendActiveCheckpoint(client: Client): void {
    const run = this.runFor(client);
    if (!run || this.state.startedAt === 0) return;

    const activeId = activeCheckpointId(run);
    const checkpoint = activeId ? huntStore.getCheckpoint(activeId) : undefined;
    if (!checkpoint) return;

    this.sendTo(client.sessionId, {
      type: 'checkpoint_unlocked',
      index: run.state.activeIndex,
      checkpoint: toPublicCheckpoint(checkpoint),
    });
  }

  // -------------------------------------------------------------------------
  // Message registration
  // -------------------------------------------------------------------------

  private registerHandlers(): void {
    this.onMessage('start_hunt', (client) => this.handleStartHunt(client));
    this.onMessage('update_location', (client, payload) =>
      this.handleUpdateLocation(client, payload),
    );
    this.onMessage('set_share_location', (client, payload) =>
      this.handleSetShareLocation(client, payload),
    );
    this.onMessage('request_instruction', (client, payload) =>
      this.handleRequestInstruction(client, payload),
    );
    this.onMessage('request_hint', (client, payload) => this.handleRequestHint(client, payload));
    this.onMessage('submit_checkpoint', (client, payload) =>
      void this.handleSubmitCheckpoint(client, payload),
    );
    this.onMessage('finish_hunt', (client) => this.handleFinishHunt(client));

    /**
     * Everything else. This is the reason a crafted `score_update` with an xp
     * field does nothing: there is no handler for it, and this catch-all
     * answers with an error instead of leaving the client to guess.
     */
    this.onMessage('*', (client, type) => {
      this.sendError(client, `Unsupported message type: ${String(type)}`);
    });
  }

  // -------------------------------------------------------------------------
  // start_hunt
  // -------------------------------------------------------------------------

  private handleStartHunt(client: Client): void {
    if (client.sessionId !== this.state.hostSessionId) {
      this.sendError(client, 'Only the host can start the hunt.');
      return;
    }
    if (this.state.startedAt !== 0) {
      this.sendError(client, 'The hunt has already started.');
      return;
    }
    if (this.state.players.size === 0) {
      this.sendError(client, 'Nobody has joined yet.');
      return;
    }

    // The server clock, always. A client-supplied start time is a client-chosen
    // speed bonus, and the speed bonus is a quarter of a checkpoint's value.
    const now = this.now();

    const entities = this.entityList();
    const assignments = assignRoutes(
      entities.map((e) => e.entityId),
      this.routes,
      // Seeded from the room code so a demo is reproducible: the same code
      // always deals the same routes, on any machine, after any restart.
      this.state.code,
    );

    for (const assignment of assignments) {
      const entity = entities.find((e) => e.entityId === assignment.participantId);
      if (!entity) continue;
      const checkpointIds = huntStore
        .checkpointsForRoute(assignment.routeId)
        .map((cp) => cp.id);

      const run = createRun({
        entityId: entity.entityId,
        isTeam: entity.isTeam,
        displayName: entity.displayName,
        routeId: assignment.routeId,
        checkpointIds,
      });
      run.state = transition(run.state, { type: 'START_HUNT', now });
      this.runs.set(entity.entityId, run);
    }

    this.state.startedAt = now;

    for (const run of this.runs.values()) this.syncRun(run);

    // The first clue goes out privately, one client at a time. Broadcasting it
    // would tell every opponent where this player is headed.
    for (const [sessionId, member] of this.members) {
      const run = this.runs.get(member.entityId);
      const first = run ? huntStore.getCheckpoint(run.checkpointIds[0] ?? '') : undefined;
      if (!run || !first) continue;
      this.sendTo(sessionId, {
        type: 'hunt_started',
        startedAt: now,
        firstCheckpoint: toPublicCheckpoint(first),
      });
    }

    this.publishLeaderboard();
  }

  // -------------------------------------------------------------------------
  // update_location / set_share_location
  // -------------------------------------------------------------------------

  /**
   * The raw fix is stored server-side and nowhere else.
   *
   * What opponents receive is `toApproximateRegion(raw, 150)`: a grid-snapped
   * cell, never jitter. Jitter can be averaged away by an opponent sampling the
   * broadcast repeatedly while a target stands still; a snapped cell is stable
   * and reveals nothing finer than the cell (DECISIONS.md D9).
   */
  private handleUpdateLocation(client: Client, payload: unknown): void {
    const member = this.members.get(client.sessionId);
    const player = this.state.players.get(client.sessionId);
    if (!member || !player) return;

    const parsed = validateLocation(payload);
    if (!parsed.ok) {
      this.sendError(client, parsed.error);
      return;
    }

    const now = this.now();
    const raw: LatLng = { latitude: parsed.value.latitude, longitude: parsed.value.longitude };
    member.rawPosition = raw;

    // Arrival is checked on every fix, before the throttle. Throttling the
    // geofence would mean a player who walks into the radius and straight back
    // out never arrives — and arrival is what seeds the anti-cheat instruction.
    this.detectArrival(member, raw, now);

    // The throttle applies to the OUTBOUND traffic a flood would multiply
    // across the room, not to the server's own bookkeeping.
    if (now - member.lastLocationAt < LOCATION_MIN_INTERVAL_MS) return;
    member.lastLocationAt = now;

    if (this.state.startedAt !== 0 && now - member.lastSampleAt >= PATH_SAMPLE_INTERVAL_MS) {
      member.lastSampleAt = now;
      const sample: LocationSample = { ...raw, timestamp: now };
      if (parsed.value.accuracyMeters !== undefined) {
        sample.accuracyMeters = parsed.value.accuracyMeters;
      }
      member.path.push(sample);
    }

    this.publishRegion(client, member, player);

    // Progress keeps flowing whether or not the player shares a position.
    // Opting out of location sharing hides WHERE you are, not WHETHER you are
    // still in the race — otherwise opting out would also hide you from the
    // leaderboard, which nobody would accept.
    this.broadcastExcept(client, this.progressMessage(member.sessionId));
  }

  private handleSetShareLocation(client: Client, payload: unknown): void {
    const member = this.members.get(client.sessionId);
    const player = this.state.players.get(client.sessionId);
    if (!member || !player) return;

    const parsed = validateShareLocation(payload);
    if (!parsed.ok) {
      this.sendError(client, parsed.error);
      return;
    }

    member.shareLocation = parsed.value;
    player.sharingLocation = parsed.value;
    this.publishRegion(client, member, player);
  }

  /**
   * Write the sanitized region to state and announce it, or clear it outright.
   *
   * Note both paths go through `toApproximateRegion`; there is no branch in
   * this room that can write `member.rawPosition` into `player.region` or into
   * a broadcast payload.
   */
  private publishRegion(client: Client, member: Member, player: PlayerState): void {
    if (!member.shareLocation || member.rawPosition === null) {
      player.region.hasRegion = false;
      player.region.latitude = 0;
      player.region.longitude = 0;
      player.region.radiusMeters = 0;
      this.broadcastExcept(client, {
        type: 'player_region',
        playerId: member.playerId,
        region: null,
      });
      return;
    }

    const region: ApproximateRegion = toApproximateRegion(
      member.rawPosition,
      OPPONENT_REGION_RADIUS_METERS,
    );
    player.region.latitude = region.center.latitude;
    player.region.longitude = region.center.longitude;
    player.region.radiusMeters = region.radiusMeters;
    player.region.hasRegion = true;

    this.broadcastExcept(client, {
      type: 'player_region',
      playerId: member.playerId,
      region,
    });
  }

  /**
   * Arrival is detected by the SERVER against the raw fix, and it is what
   * seeds the anti-cheat instruction. That ordering is the point: the
   * instruction is derived from an arrival time the player cannot know in
   * advance, so it cannot be staged before setting out (ARCHITECTURE.md,
   * "Anti-cheat: honest limits").
   */
  private detectArrival(member: Member, raw: LatLng, now: number): void {
    const run = this.runs.get(member.entityId);
    if (!run) return;
    if (run.state.phase !== 'NAVIGATING' && run.state.phase !== 'NEXT_CHECKPOINT') return;

    const checkpointId = activeCheckpointId(run);
    if (!checkpointId) return;
    const checkpoint = huntStore.getCheckpoint(checkpointId);
    if (!checkpoint) return;

    if (!isWithinRadius(raw, checkpoint, checkpoint.radiusMeters)) return;

    run.state = transition(run.state, {
      type: 'ARRIVE',
      checkpointIndex: run.state.activeIndex,
      now,
    });
  }

  // -------------------------------------------------------------------------
  // request_instruction
  // -------------------------------------------------------------------------

  private handleRequestInstruction(client: Client, payload: unknown): void {
    const parsed = validateCheckpointId(payload, 'request_instruction');
    if (!parsed.ok) {
      this.sendError(client, parsed.error);
      return;
    }

    const run = this.runFor(client);
    if (!run) {
      this.sendError(client, 'The hunt is not running.');
      return;
    }

    // Same authority check as a submission: you may only act on YOUR active
    // checkpoint, and the server decides which one that is.
    const guard = assertSubmissionMatchesActiveCheckpoint(parsed.value, activeCheckpointId(run));
    if (!guard.ok) {
      this.sendError(client, guard.message);
      return;
    }

    const progress = activeProgress(run);
    if (!progress || progress.arrivedAt === null) {
      this.sendError(client, 'Reach the checkpoint before asking for your photo instruction.');
      return;
    }

    // Cached per checkpoint so a retry after a rejection shows the SAME
    // instruction. Re-deriving on every request would let a player resubmit
    // until they drew an easy one.
    let issued = run.instructions.get(guard.checkpointId);
    if (!issued) {
      issued = {
        checkpointId: guard.checkpointId,
        arrivalTime: progress.arrivedAt,
        instruction: generateInstruction({
          checkpointId: guard.checkpointId,
          playerId: run.entityId,
          arrivalTime: progress.arrivedAt,
        }),
      };
      run.instructions.set(guard.checkpointId, issued);
    }

    if (run.state.phase === 'ARRIVED') {
      run.state = transition(run.state, {
        type: 'OPEN_CHALLENGE',
        checkpointIndex: run.state.activeIndex,
        now: this.now(),
      });
    }

    this.sendToRun(run, {
      type: 'instruction_issued',
      checkpointId: guard.checkpointId,
      instruction: issued.instruction,
    });
  }

  // -------------------------------------------------------------------------
  // request_hint
  // -------------------------------------------------------------------------

  /**
   * Charged at most once per checkpoint, however many times it is asked for.
   *
   * hunt-engine already enforces that — `REQUEST_HINT` is idempotent and
   * answers a second request with `HINT_ALREADY_USED` — so this handler does
   * not re-implement the rule, it reads the engine's answer. A double-tapped
   * hint button must never double-charge.
   *
   * The XP cost itself is NOT deducted here. `scoreCheckpoint` applies
   * `hintPenalty` (and withholds `noHintBonus`) when the checkpoint is scored,
   * so deducting again at issue time would charge the player twice for one
   * hint. `xpDelta` on this message is the disclosed cost, and the single place
   * it is actually applied is the verdict's breakdown.
   */
  private handleRequestHint(client: Client, payload: unknown): void {
    const parsed = validateCheckpointId(payload, 'request_hint');
    if (!parsed.ok) {
      this.sendError(client, parsed.error);
      return;
    }
    if (!this.state.settings.hintsEnabled) {
      this.sendError(client, 'Hints are disabled in this room.');
      return;
    }

    const run = this.runFor(client);
    if (!run) {
      this.sendError(client, 'The hunt is not running.');
      return;
    }

    const guard = assertSubmissionMatchesActiveCheckpoint(parsed.value, activeCheckpointId(run));
    if (!guard.ok) {
      this.sendError(client, guard.message);
      return;
    }

    const checkpoint = huntStore.getCheckpoint(guard.checkpointId);
    if (!checkpoint) {
      this.sendError(client, 'That checkpoint is not available.');
      return;
    }

    const next = transition(run.state, {
      type: 'REQUEST_HINT',
      checkpointIndex: run.state.activeIndex,
      now: this.now(),
    });

    if (next.error?.code === 'HINT_ALREADY_USED') {
      // Already paid for. Resend the same text and charge nothing; the engine
      // state is left exactly as it was.
      this.sendToRun(run, {
        type: 'hint_issued',
        checkpointId: guard.checkpointId,
        hint: checkpoint.hint,
        xpDelta: 0,
      });
      return;
    }
    if (next.error) {
      this.sendError(client, next.error.message);
      return;
    }

    run.state = next;
    this.syncRun(run);

    this.sendToRun(run, {
      type: 'hint_issued',
      checkpointId: guard.checkpointId,
      hint: checkpoint.hint,
      /**
       * The TRUE cost, not HINT_PENALTY.
       *
       * Taking a hint applies the -20 penalty and forfeits the +25 no-hint
       * bonus, so the player is 45 XP worse off. The UI labels were corrected
       * for this; this message was not, and it is the number a client is most
       * likely to trust — it comes from the server, so it looks authoritative.
       * Anything rendering it would have understated the cost by more than
       * half, which is the bug this project keeps finding in new places.
       */
      xpDelta: -HINT_TRUE_COST_XP,
    });
    this.publishLeaderboard();
  }

  // -------------------------------------------------------------------------
  // submit_checkpoint  — DECISIONS.md D15
  // -------------------------------------------------------------------------

  private async handleSubmitCheckpoint(client: Client, payload: unknown): Promise<void> {
    const parsed = validateSubmission(payload);
    if (!parsed.ok) {
      this.sendError(client, parsed.error);
      return;
    }

    const run = this.runFor(client);
    if (!run) {
      this.sendError(client, 'The hunt is not running.');
      return;
    }

    // =======================================================================
    // D15. THE CHECK THAT MAKES EVERY OTHER CHECK MEAN SOMETHING.
    //
    // The client named a checkpoint. The server independently derives which
    // checkpoint this player is actually on, from ITS route assignment and ITS
    // checkpointIndex, and refuses unless they agree.
    //
    // It runs BEFORE `verifySubmission`, so a mismatch never reaches the
    // geofence and never reaches the verification provider. Without it, a
    // photo genuinely taken at checkpoint 1 can be submitted against
    // checkpoint 4 — the geofence would pass, because the player really is
    // standing inside checkpoint 1's radius, and the only thing the client
    // changed is which checkpoint's rules were applied.
    // =======================================================================
    const guard = assertSubmissionMatchesActiveCheckpoint(
      parsed.value.checkpointId,
      activeCheckpointId(run),
    );
    if (!guard.ok) {
      this.sendError(client, guard.message);
      return;
    }

    const checkpoint = huntStore.getCheckpoint(guard.checkpointId);
    if (!checkpoint) {
      this.sendError(client, 'That checkpoint is not available.');
      return;
    }

    const issued = run.instructions.get(guard.checkpointId);
    if (!issued) {
      this.sendError(client, 'Ask for your photo instruction at the checkpoint before submitting.');
      return;
    }

    const index = run.state.activeIndex;
    const opening = transition(run.state, { type: 'SUBMIT', checkpointIndex: index, now: this.now() });
    if (opening.error) {
      this.sendError(client, opening.error.message);
      return;
    }
    // Held so a `needs-review` verdict can restore it: the state machine has no
    // action for "unsure, try again", and counting an incorrect attempt would
    // penalise the player for OUR uncertainty.
    const beforeSubmit = run.state;
    run.state = opening;

    const progress = activeProgress(run);
    const now = this.now();

    const verdict = await verifySubmission(
      {
        ...parsed.value,
        checkpointId: guard.checkpointId,
        // The server's instruction, not the client's claim about it.
        randomizedInstruction: issued.instruction,
        // The server's clock. A client clock is a client-chosen speed bonus.
        submittedAt: now,
      },
      checkpoint,
      getVerificationProvider(),
      {
        ...(progress ? { activatedAt: progress.activatedAt } : {}),
        hintUsed: progress?.hintUsed === true,
        incorrectAttempts: progress?.incorrectAttempts ?? 0,
        isFinalCheckpoint: isFinalCheckpointIndex(run, index),
        allowPhotoless: allowPhotoless(),
      },
    );

    // The room may have been disposed, or the player removed, while awaiting
    // the model. Dropping the verdict is correct — there is nothing to award.
    if (!this.runs.has(run.entityId)) return;

    if (verdict.outcome === 'approved') {
      this.applyApproval(run, checkpoint, verdict.xpDelta, index, now);
      run.breakdowns.push(verdict.xpBreakdown);
    } else if (verdict.outcome === 'needs-review') {
      run.needsReviewCount += 1;
      run.state = beforeSubmit;
    } else {
      run.state = transition(run.state, {
        type: 'VERIFICATION_FAILED',
        checkpointIndex: index,
        now,
      });
    }

    this.syncRun(run);

    // Targeted: the verdict carries the reveal — the earned payload — plus the
    // distance and the model's reason. None of that is an opponent's business.
    this.sendToRun(run, { type: 'submission_result', verdict });

    if (verdict.outcome === 'approved') {
      this.broadcast('score_update', {
        type: 'score_update',
        playerId: run.entityId,
        xp: run.state.totalXp,
      } satisfies ServerMessage);
      this.broadcastProgressForRun(run);
      this.unlockNextOrFinish(run, now);
    }

    this.publishLeaderboard();
  }

  /**
   * Apply an approved verdict.
   *
   * `xpAwarded` is `verdict.xpDelta`, which is `scoreCheckpoint(...).total`.
   * The room does not add to it, round it, or scale it.
   */
  private applyApproval(
    run: HuntRun,
    checkpoint: Checkpoint,
    xpDelta: number,
    index: number,
    now: number,
  ): void {
    const progress = activeProgress(run);
    run.state = transition(run.state, {
      type: 'VERIFICATION_PASSED',
      checkpointIndex: index,
      now,
      xpAwarded: xpDelta,
      reveal: {
        checkpointId: checkpoint.id,
        name: checkpoint.name,
        historicalReveal: checkpoint.historicalReveal,
        sources: checkpoint.sources,
        ...(checkpoint.hiddenDetail ? { hiddenDetail: checkpoint.hiddenDetail } : {}),
      },
    });

    run.completed.push({
      checkpointId: checkpoint.id,
      completedAt: now,
      durationSeconds: progress ? Math.max(0, (now - progress.activatedAt) / 1000) : 0,
      xpAwarded: xpDelta,
      hintUsed: progress?.hintUsed === true,
      incorrectAttempts: progress?.incorrectAttempts ?? 0,
    });

    // `routeCompletionBonus: 0` on purpose. ROUTE_COMPLETION_BONUS is already
    // inside the final checkpoint's `scoreCheckpoint` result (via
    // `isFinalCheckpoint`), so paying it again here would double it.
    run.state = transition(run.state, { type: 'ADVANCE', now, routeCompletionBonus: 0 });
  }

  private unlockNextOrFinish(run: HuntRun, now: number): void {
    if (run.state.phase === 'FINISHED') {
      run.finishedAt = run.state.finishedAt ?? now;
      this.syncRun(run);
      this.maybeFinishRoom(now);
      return;
    }

    const nextId = activeCheckpointId(run);
    const next = nextId ? huntStore.getCheckpoint(nextId) : undefined;
    if (!next) return;

    // Targeted again: the next clue is this player's route, not the room's.
    this.sendToRun(run, {
      type: 'checkpoint_unlocked',
      index: run.state.activeIndex,
      checkpoint: toPublicCheckpoint(next),
    });
  }

  // -------------------------------------------------------------------------
  // finish_hunt
  // -------------------------------------------------------------------------

  /** An early finish is a forfeit, not a win: XP already earned is kept. */
  private handleFinishHunt(client: Client): void {
    if (this.state.startedAt === 0) {
      this.sendError(client, 'The hunt has not started.');
      return;
    }
    const run = this.runFor(client);
    if (!run) {
      this.sendError(client, 'The hunt is not running.');
      return;
    }
    if (run.finishedAt !== null) return;

    run.finishedAt = this.now();
    this.syncRun(run);
    this.publishLeaderboard();
    this.maybeFinishRoom(run.finishedAt);
  }

  private maybeFinishRoom(now: number): void {
    if (this.state.finishedAt !== 0) return;
    if (this.runs.size === 0) return;
    for (const run of this.runs.values()) {
      if (!isRunFinished(run)) return;
    }
    this.state.finishedAt = now;
    const entries = this.leaderboardEntries();
    this.applyRanks(entries);
    this.broadcast('hunt_finished', {
      type: 'hunt_finished',
      entries,
      finishedAt: now,
    } satisfies ServerMessage);

    // Persist AFTER broadcasting: players see their leaderboard immediately,
    // and a slow or failed write never delays the end of the hunt.
    void this.persistCompletedRuns(now);
  }

  /**
   * Write each finished run to durable storage.
   *
   * This is where the live breadcrumb trail stops being ephemeral. PLAN.md P8
   * is explicit that high-frequency locations are NOT persisted continuously —
   * they live in the room while the hunt runs, and only the completed path is
   * saved, once, here.
   *
   * Failure is logged and swallowed. A storage problem must never take down a
   * room full of players who have just finished; the leaderboard they are
   * looking at has already been broadcast from authoritative state.
   */
  private async persistCompletedRuns(finishedAt: number): Promise<void> {
    const repository = getRepository();
    if (!repository) return;

    const startedAt = this.state.startedAt;

    for (const run of this.runs.values()) {
      // Team runs have several members; stitch their trails together so the
      // replay shows the path the team actually walked.
      const members = [...this.members.values()].filter((m) => m.entityId === run.entityId);
      const path = members
        .flatMap((m) => m.path)
        .sort((a, b) => a.timestamp - b.timestamp);

      const primary = members[0];

      const completed: CompletedRun = {
        id: `${this.roomId}:${run.entityId}`,
        huntId: this.state.settings.huntId,
        routeId: run.routeId,
        playerId: run.entityId,
        playerName: run.displayName,
        ...(run.isTeam ? { teamId: run.entityId } : {}),
        // The schema stores this as a plain string; it was validated through
        // `normalizeMode` at room creation, so the narrowing is sound.
        mode: this.state.settings.mode as GameMode,
        startedAt,
        finishedAt: run.finishedAt ?? finishedAt,
        totalXp: run.state.totalXp,
        checkpoints: [...run.completed],
        path,
        achievements: deriveAchievements(run),
      };

      try {
        await repository.saveCompletedRun(completed);
      } catch (err) {
        console.error(
          `[room] could not persist run ${completed.id}:`,
          err instanceof Error ? err.message : err,
        );
      }

      void primary;
    }
  }

  // -------------------------------------------------------------------------
  // State projection
  // -------------------------------------------------------------------------

  /**
   * Mirror a run's authoritative numbers into the public schema.
   *
   * Only the four numbers opponents are meant to see cross over: XP, how far
   * along the route, hints used and incorrect attempts. The route id, the
   * checkpoint ids and the reveals stay in `this.runs`.
   */
  private syncRun(run: HuntRun): void {
    const finished = isRunFinished(run);
    const finishedAt = run.finishedAt ?? run.state.finishedAt ?? 0;

    for (const member of this.members.values()) {
      if (member.entityId !== run.entityId) continue;
      const player = this.state.players.get(member.sessionId);
      if (!player) continue;
      player.xp = run.state.totalXp;
      player.checkpointIndex = run.state.activeIndex;
      player.totalCheckpoints = run.checkpointIds.length;
      player.hintsUsed = hintsUsedCount(run);
      player.incorrectAttempts = incorrectAttemptsTotal(run);
      player.finished = finished;
      player.finishedAt = finished ? finishedAt : 0;
    }

    if (run.isTeam) {
      const team = this.state.teams.get(run.entityId);
      if (team) {
        // One route, one XP total, one entry — teammates are not scored apart.
        team.xp = run.state.totalXp;
        team.checkpointIndex = run.state.activeIndex;
        team.totalCheckpoints = run.checkpointIds.length;
        team.hintsUsed = hintsUsedCount(run);
        team.finished = finished;
        team.finishedAt = finished ? finishedAt : 0;
      }
    }
  }

  private leaderboardSources(): LeaderboardSource[] {
    const sources: LeaderboardSource[] = [];

    if (this.state.settings.mode === 'team-race') {
      for (const [teamId, team] of this.state.teams) {
        const run = this.runs.get(teamId);
        sources.push({
          entryId: teamId,
          displayName: team.name,
          isTeam: true,
          xp: run?.state.totalXp ?? team.xp,
          checkpointsCompleted: run ? completedCount(run) : 0,
          totalCheckpoints: run?.checkpointIds.length ?? 0,
          hintsUsed: run ? hintsUsedCount(run) : 0,
          finished: run ? isRunFinished(run) : false,
          finishedAt: run?.finishedAt ?? null,
        });
      }
      return sources;
    }

    for (const member of this.members.values()) {
      const player = this.state.players.get(member.sessionId);
      if (!player) continue;
      const run = this.runs.get(member.entityId);
      sources.push({
        entryId: member.playerId,
        displayName: player.name,
        isTeam: false,
        xp: run?.state.totalXp ?? 0,
        checkpointsCompleted: run ? completedCount(run) : 0,
        totalCheckpoints: run?.checkpointIds.length ?? 0,
        hintsUsed: run ? hintsUsedCount(run) : 0,
        finished: run ? isRunFinished(run) : false,
        finishedAt: run?.finishedAt ?? null,
      });
    }
    return sources;
  }

  private leaderboardEntries(): LeaderboardEntry[] {
    return buildLeaderboard(this.leaderboardSources());
  }

  private applyRanks(entries: readonly LeaderboardEntry[]): void {
    this.state.leaderboard.clear();
    for (const entry of entries) {
      this.state.leaderboard.push(entry.playerId);
      if (entry.isTeam) {
        const team = this.state.teams.get(entry.playerId);
        if (team) team.rank = entry.rank;
        continue;
      }
      for (const member of this.members.values()) {
        if (member.playerId !== entry.playerId) continue;
        const player = this.state.players.get(member.sessionId);
        if (player) player.rank = entry.rank;
      }
    }
  }

  private publishLeaderboard(): void {
    const entries = this.leaderboardEntries();
    this.applyRanks(entries);
    this.broadcast('leaderboard', { type: 'leaderboard', entries } satisfies ServerMessage);
  }

  private progressMessage(sessionId: string): ServerMessage {
    const member = this.members.get(sessionId);
    const run = member ? this.runs.get(member.entityId) : undefined;
    return {
      type: 'player_progress',
      playerId: member?.playerId ?? sessionId,
      checkpointIndex: run?.state.activeIndex ?? 0,
      totalCheckpoints: run?.checkpointIds.length ?? 0,
    };
  }

  private broadcastProgressForRun(run: HuntRun): void {
    for (const member of this.members.values()) {
      if (member.entityId !== run.entityId) continue;
      this.broadcast('player_progress', this.progressMessage(member.sessionId));
    }
  }

  // -------------------------------------------------------------------------
  // Membership helpers
  // -------------------------------------------------------------------------

  private resolveTeam(teamName: unknown, player: PlayerState): TeamState {
    const name = sanitizeTeamName(teamName);
    if (name) {
      for (const team of this.state.teams.values()) {
        if (team.name === name) return team;
      }
    }
    const team = new TeamState();
    team.id = `team_${randomUUID().slice(0, 8)}`;
    team.name = name ?? `${player.name}'s team`;
    this.state.teams.set(team.id, team);
    return team;
  }

  private removeMember(sessionId: string): void {
    const member = this.members.get(sessionId);
    this.state.players.delete(sessionId);
    this.members.delete(sessionId);
    if (!member) return;

    if (this.state.settings.mode === 'team-race') {
      const team = this.state.teams.get(member.entityId);
      if (team) {
        const at = team.memberIds.indexOf(member.playerId);
        if (at >= 0) team.memberIds.splice(at, 1);
        // The team's run survives while anyone is left on it.
        if (team.memberIds.length === 0) {
          this.state.teams.delete(team.id);
          this.runs.delete(team.id);
        }
      }
    } else {
      this.runs.delete(member.entityId);
    }

    if (this.state.hostSessionId === sessionId) this.promoteHost();
  }

  /** Without this a room whose host drops can never be started. */
  private promoteHost(): void {
    this.state.hostSessionId = '';
    for (const [sessionId, player] of this.state.players) {
      player.isHost = false;
      if (this.state.hostSessionId === '') {
        this.state.hostSessionId = sessionId;
        player.isHost = true;
      }
    }
  }

  private entityList(): Array<{ entityId: string; isTeam: boolean; displayName: string }> {
    if (this.state.settings.mode === 'team-race') {
      return [...this.state.teams.entries()].map(([id, team]) => ({
        entityId: id,
        isTeam: true,
        displayName: team.name,
      }));
    }
    return [...this.members.values()].map((member) => ({
      entityId: member.entityId,
      isTeam: false,
      displayName: this.state.players.get(member.sessionId)?.name ?? member.playerId,
    }));
  }

  private runFor(client: Client): HuntRun | undefined {
    const member = this.members.get(client.sessionId);
    if (!member) return undefined;
    return this.runs.get(member.entityId);
  }

  // -------------------------------------------------------------------------
  // Send helpers
  // -------------------------------------------------------------------------

  private sendError(client: Client, message: string): void {
    client.send('error', { type: 'error', message } satisfies ServerMessage);
  }

  private sendTo(sessionId: string, message: ServerMessage): void {
    const client = this.clients.find((c) => c.sessionId === sessionId);
    client?.send(message.type, message);
  }

  /**
   * Private fan-out to everyone sharing a run — one player in
   * `individual-race`, the whole team in `team-race`. Teammates share a route,
   * so they share its clues; nobody else may see them.
   */
  private sendToRun(run: HuntRun, message: ServerMessage): void {
    for (const member of this.members.values()) {
      if (member.entityId === run.entityId) this.sendTo(member.sessionId, message);
    }
  }

  private broadcastExcept(client: Client, message: ServerMessage): void {
    this.broadcast(message.type, message, { except: client });
  }

  /** Single clock source, so the whole room agrees and tests can stub it. */
  protected now(): number {
    return Date.now();
  }

  // -------------------------------------------------------------------------
  // Server-side inspection (tests and tooling; never reachable from a client)
  // -------------------------------------------------------------------------

  /** The private route assignment. Deliberately absent from the schema. */
  routeIdForSession(sessionId: string): string | undefined {
    const member = this.members.get(sessionId);
    return member ? this.runs.get(member.entityId)?.routeId : undefined;
  }

  checkpointIdsForSession(sessionId: string): readonly string[] | undefined {
    const member = this.members.get(sessionId);
    return member ? this.runs.get(member.entityId)?.checkpointIds : undefined;
  }

  huntStateForSession(sessionId: string): HuntState | undefined {
    const member = this.members.get(sessionId);
    return member ? this.runs.get(member.entityId)?.state : undefined;
  }

  /** The raw fix, for the replay writer in P9. Never leaves the server. */
  rawPositionForSession(sessionId: string): LatLng | null {
    return this.members.get(sessionId)?.rawPosition ?? null;
  }

  pathForSession(sessionId: string): readonly LocationSample[] {
    return this.members.get(sessionId)?.path ?? [];
  }
}

// ---------------------------------------------------------------------------
// Option coercion
// ---------------------------------------------------------------------------

/** `solo` is not a room mode — it needs no server at all. */
function normalizeMode(mode: unknown): GameMode {
  return ROOM_MODES.includes(mode as GameMode) ? (mode as GameMode) : 'individual-race';
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

/**
 * Badges earned by a finished run.
 *
 * Deliberately derived from the run rather than stored as it goes: the run is
 * the source of truth, so a badge can never disagree with the numbers on the
 * results screen.
 */
function deriveAchievements(run: HuntRun): string[] {
  const badges: string[] = [];
  const hintsUsed = run.completed.filter((c) => c.hintUsed).length;
  const wrong = run.completed.reduce((n, c) => n + c.incorrectAttempts, 0);

  if (run.completed.length > 0) badges.push('pittsburgh-beginner');
  if (hintsUsed === 0) badges.push('no-hints');
  if (wrong === 0) badges.push('flawless');
  if (run.isTeam) badges.push('team-player');
  if (run.needsReviewCount === 0 && wrong === 0 && hintsUsed === 0) {
    badges.push('hidden-historian');
  }
  return badges;
}
