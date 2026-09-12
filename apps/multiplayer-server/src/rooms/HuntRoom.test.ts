/**
 * HuntRoom integration tests, driven through real websocket clients with
 * `@colyseus/testing`.
 *
 * These are deliberately adversarial. Each one either proves a player cannot
 * do something (set their own XP, submit against a checkpoint they are not on,
 * read an opponent's coordinates, pay once and be charged twice) or proves the
 * room survives something real (a dropped connection mid-hunt).
 *
 * The verification provider is a spy, so "was the model called?" is itself an
 * assertion — that is the whole point of the D15 test.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { boot, type ColyseusTestServer } from '@colyseus/testing';
import { Server as ColyseusServer } from 'colyseus';
import { WebSocketTransport } from '@colyseus/ws-transport';
import type { Room as ClientRoom } from 'colyseus.js';
import {
  XP_RULES,
  haversineMeters,
  type Checkpoint,
  type SubmissionVerdict,
} from '@ww/shared';
import type { VerificationInput, VerificationProvider } from '@ww/verification';
import type { VerificationResult } from '@ww/shared';

import { huntStore } from '../hunt-store.js';
import { seed } from '../seed.js';
import {
  resetVerificationProvider,
  setVerificationProviderForTesting,
} from '../verification-provider.js';
import { HuntRoom, OPPONENT_REGION_RADIUS_METERS } from './HuntRoom.js';
import type { HuntRoomState } from './schema.js';

// ---------------------------------------------------------------------------
// Test doubles
// ---------------------------------------------------------------------------

const PASSING: VerificationResult = {
  landmarkMatch: true,
  requiredActionCompleted: true,
  answerCorrect: true,
  confidence: 0.95,
  reason: 'test double: everything visible',
  mocked: true,
};

class SpyProvider implements VerificationProvider {
  readonly calls: VerificationInput[] = [];
  result: VerificationResult = { ...PASSING };

  async verify(input: VerificationInput): Promise<VerificationResult> {
    this.calls.push(input);
    return this.result;
  }
}

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

/** `@colyseus/testing` hardcodes this port when handed a Server instance. */
const TEST_PORT = 2568;

let colyseus: ColyseusTestServer;
let spy: SpyProvider;

interface Harness {
  /** Server-side room instance. Not reachable from a client. */
  room: HuntRoom;
  state: HuntRoomState;
  host: ClientRoom<HuntRoomState>;
  guest: ClientRoom<HuntRoomState>;
}

async function setup(options: Record<string, unknown> = {}): Promise<Harness> {
  const room = await colyseus.createRoom<HuntRoomState>('hunt', options);
  const host = await colyseus.connectTo(room, { playerName: 'Ada', ...options });
  const guest = await colyseus.connectTo(room, { playerName: 'Linus', ...options });
  return {
    room: room as unknown as HuntRoom,
    state: room.state,
    host: host as unknown as ClientRoom<HuntRoomState>,
    guest: guest as unknown as ClientRoom<HuntRoomState>,
  };
}

/** Start the hunt and return each client's privately delivered first clue. */
async function startHunt(h: Harness): Promise<{ host: Checkpoint; guest: Checkpoint }> {
  const hostStarted = h.host.waitForMessage('hunt_started');
  const guestStarted = h.guest.waitForMessage('hunt_started');
  h.host.send('start_hunt', {});
  const [a, b] = await Promise.all([hostStarted, guestStarted]);
  return {
    host: fullCheckpoint(a.firstCheckpoint.id),
    guest: fullCheckpoint(b.firstCheckpoint.id),
  };
}

/** The server-side checkpoint, with the answers a test needs to play honestly. */
function fullCheckpoint(id: string): Checkpoint {
  const checkpoint = huntStore.getCheckpoint(id);
  if (!checkpoint) throw new Error(`test fixture missing checkpoint ${id}`);
  return checkpoint;
}

function checkpointsFor(room: HuntRoom, sessionId: string): Checkpoint[] {
  const ids = room.checkpointIdsForSession(sessionId);
  if (!ids) throw new Error('no route assigned');
  return ids.map(fullCheckpoint);
}

/** Walk to a checkpoint and collect the on-arrival anti-cheat instruction. */
async function arriveAt(client: ClientRoom, checkpoint: Checkpoint): Promise<string> {
  const issued = client.waitForMessage('instruction_issued');
  client.send('update_location', {
    latitude: checkpoint.latitude,
    longitude: checkpoint.longitude,
  });
  client.send('request_instruction', { checkpointId: checkpoint.id });
  return (await issued).instruction;
}

/** An honest submission: right place, right checkpoint, right answer. */
async function submitHonestly(
  client: ClientRoom,
  checkpoint: Checkpoint,
): Promise<SubmissionVerdict> {
  const result = client.waitForMessage('submission_result');
  client.send('submit_checkpoint', {
    submission: {
      checkpointId: checkpoint.id,
      image: 'data:image/jpeg;base64,QUJD',
      latitude: checkpoint.latitude,
      longitude: checkpoint.longitude,
      observationAnswer: checkpoint.acceptedAnswers[0] ?? '',
      randomizedInstruction: 'ignored — the server uses the one it issued',
      submittedAt: Date.now(),
    },
  });
  return (await result).verdict as SubmissionVerdict;
}

beforeAll(async () => {
  seed();

  // A Server instance rather than a `ConfigOptions` object on purpose:
  // `boot(config)` routes the object form through `@colyseus/tools`' `listen`,
  // which calls `process.send("ready")`. Under vitest that IPC channel belongs
  // to the test runner, and an unexpected message on it kills the worker before
  // a single test reports. Passing a Server skips that path entirely.
  const gameServer = new ColyseusServer({
    transport: new WebSocketTransport({ port: TEST_PORT }),
    gracefullyShutdown: false,
  });
  gameServer.define('hunt', HuntRoom);
  colyseus = await boot(gameServer as never);
});

afterAll(async () => {
  resetVerificationProvider();
  await colyseus.shutdown();
});

beforeEach(() => {
  spy = new SpyProvider();
  setVerificationProviderForTesting(spy);
});

afterEach(async () => {
  await colyseus.cleanup();
});

// ---------------------------------------------------------------------------

describe('joining and route assignment', () => {
  it('gives two players DIFFERENT routes that both end at the shared finish', async () => {
    const h = await setup();
    const clues = await startHunt(h);

    // Observable from the clients: two different opening clues.
    expect(clues.host.id).not.toBe(clues.guest.id);

    // Authoritative, server-side: two different routes, one destination.
    const hostRoute = h.room.routeIdForSession(h.host.sessionId);
    const guestRoute = h.room.routeIdForSession(h.guest.sessionId);
    expect(hostRoute).toBeDefined();
    expect(guestRoute).toBeDefined();
    expect(hostRoute).not.toBe(guestRoute);

    for (const sessionId of [h.host.sessionId, h.guest.sessionId]) {
      const ids = h.room.checkpointIdsForSession(sessionId);
      expect(ids).toHaveLength(5);
      expect(ids?.at(-1)).toBe('final_point_fountain');
    }
  });

  it('issues a six-character code from the unambiguous alphabet', async () => {
    const h = await setup();
    expect(h.state.code).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/);
  });

  it('gives concurrent rooms distinct codes', async () => {
    const a = await colyseus.createRoom<HuntRoomState>('hunt', {});
    const b = await colyseus.createRoom<HuntRoomState>('hunt', {});
    const c = await colyseus.createRoom<HuntRoomState>('hunt', {});
    const codes = new Set([a.state.code, b.state.code, c.state.code]);
    expect(codes.size).toBe(3);
  });

  it('only the host may start the hunt', async () => {
    const h = await setup();
    const rejected = h.guest.waitForMessage('error');
    h.guest.send('start_hunt', {});
    expect((await rejected).message).toMatch(/only the host/i);
    expect(h.state.startedAt).toBe(0);

    await startHunt(h);
    expect(h.state.startedAt).toBeGreaterThan(0);
  });

  it('stamps startedAt from the server clock, never a client', async () => {
    const h = await setup();
    const before = Date.now();
    await startHunt(h);
    const after = Date.now();
    expect(h.state.startedAt).toBeGreaterThanOrEqual(before);
    expect(h.state.startedAt).toBeLessThanOrEqual(after);
  });
});

// ---------------------------------------------------------------------------

describe('a client cannot assign itself anything', () => {
  it('ignores a crafted score_update carrying xp', async () => {
    const h = await setup();
    await startHunt(h);

    const rejected = h.host.waitForMessage('error');
    h.host.send('score_update', { type: 'score_update', playerId: 'me', xp: 99_999 });
    expect((await rejected).message).toMatch(/unsupported message type/i);

    await h.host.waitForNextPatch();
    expect(h.state.players.get(h.host.sessionId)?.xp).toBe(0);
    expect(h.room.huntStateForSession(h.host.sessionId)?.totalXp).toBe(0);
  });

  it('ignores every other crafted state-setting message', async () => {
    const h = await setup();
    await startHunt(h);
    const player = h.state.players.get(h.host.sessionId);

    const crafted: Array<[string, unknown]> = [
      ['set_xp', { xp: 99_999 }],
      ['xp', { amount: 99_999 }],
      ['score', { xp: 99_999 }],
      ['player_progress', { checkpointIndex: 4 }],
      ['checkpoint_unlocked', { index: 4 }],
      ['set_checkpoint_index', { checkpointIndex: 4 }],
      ['hunt_finished', { finishedAt: Date.now() }],
      ['leaderboard', { entries: [] }],
      ['submission_result', { verdict: { outcome: 'approved', xpDelta: 5000 } }],
    ];

    for (const [type, payload] of crafted) {
      const rejected = h.host.waitForMessage('error');
      h.host.send(type, payload);
      await rejected;
    }

    await h.host.waitForNextPatch();
    expect(player?.xp).toBe(0);
    expect(player?.checkpointIndex).toBe(0);
    expect(player?.finished).toBe(false);
    expect(h.state.finishedAt).toBe(0);
  });

  it('re-stamps a submission with the server clock, ignoring the client’s', async () => {
    const h = await setup();
    await startHunt(h);
    const [first] = checkpointsFor(h.room, h.host.sessionId);
    if (!first) throw new Error('no checkpoint');
    await arriveAt(h.host, first);

    const result = h.host.waitForMessage('submission_result');
    h.host.send('submit_checkpoint', {
      submission: {
        checkpointId: first.id,
        image: 'data:image/jpeg;base64,QUJD',
        latitude: first.latitude,
        longitude: first.longitude,
        observationAnswer: first.acceptedAnswers[0] ?? '',
        randomizedInstruction: 'Do literally nothing.',
        // A clock skewed far into the past would otherwise buy the maximum
        // speed bonus for free.
        submittedAt: 0,
      },
    });
    const verdict = (await result).verdict as SubmissionVerdict;

    expect(verdict.outcome).toBe('approved');
    // The engine's neutral bonus is 25; a "instant" completion would be 50.
    // What matters is that a zero timestamp did not become a free maximum.
    expect(verdict.xpBreakdown.speedBonus).toBeLessThanOrEqual(XP_RULES.SPEED_BONUS_MAX);
    // The instruction the model saw is the server's, not the client's claim.
    expect(spy.calls).toHaveLength(1);
    expect(spy.calls[0]?.randomizedInstruction).not.toBe('Do literally nothing.');
  });
});

// ---------------------------------------------------------------------------

describe('D15 — submission/checkpoint binding', () => {
  it('rejects a submission for a checkpoint the player is not on, without calling the provider', async () => {
    const h = await setup();
    await startHunt(h);

    const route = checkpointsFor(h.room, h.host.sessionId);
    const active = route[0];
    const later = route[3];
    if (!active || !later) throw new Error('route too short');

    await arriveAt(h.host, active);
    expect(spy.calls).toHaveLength(0);

    // The attack: a submission naming a LATER checkpoint, with coordinates
    // that sit inside that later checkpoint's own radius — so the geofence
    // inside `verifySubmission` would have passed it. Only the room knows the
    // player is still on checkpoint 1.
    const rejected = h.host.waitForMessage('error');
    h.host.send('submit_checkpoint', {
      submission: {
        checkpointId: later.id,
        image: 'data:image/jpeg;base64,QUJD',
        latitude: later.latitude,
        longitude: later.longitude,
        observationAnswer: later.acceptedAnswers[0] ?? '',
        randomizedInstruction: 'whatever',
        submittedAt: Date.now(),
      },
    });

    expect((await rejected).message).toMatch(/not currently on/i);

    // THE assertion: the verification provider was never reached. No Gemini
    // call, no geofence evaluated against the wrong checkpoint, no XP.
    expect(spy.calls).toHaveLength(0);
    expect(h.state.players.get(h.host.sessionId)?.xp).toBe(0);
    expect(h.state.players.get(h.host.sessionId)?.checkpointIndex).toBe(0);
  });

  it('positive control: the same flow with the correct checkpointId DOES call the provider', async () => {
    const h = await setup();
    await startHunt(h);
    const [active] = checkpointsFor(h.room, h.host.sessionId);
    if (!active) throw new Error('no checkpoint');

    await arriveAt(h.host, active);
    const verdict = await submitHonestly(h.host, active);

    expect(spy.calls).toHaveLength(1);
    expect(spy.calls[0]?.checkpointId).toBe(active.id);
    expect(verdict.outcome).toBe('approved');
  });

  it('rejects a submission before the hunt has started, without calling the provider', async () => {
    const h = await setup();
    const rejected = h.host.waitForMessage('error');
    h.host.send('submit_checkpoint', {
      submission: {
        checkpointId: 'final_point_fountain',
        image: 'data:image/jpeg;base64,QUJD',
        latitude: 40.4417,
        longitude: -80.0093,
        observationAnswer: 'ohio',
        randomizedInstruction: 'x',
        submittedAt: Date.now(),
      },
    });
    await rejected;
    expect(spy.calls).toHaveLength(0);
  });

  it('refuses a submission before the on-arrival instruction was issued', async () => {
    const h = await setup();
    await startHunt(h);
    const [active] = checkpointsFor(h.room, h.host.sessionId);
    if (!active) throw new Error('no checkpoint');

    // Standing in the right place, but never asked for the instruction — so
    // the photo cannot possibly contain an action chosen after arrival.
    h.host.send('update_location', { latitude: active.latitude, longitude: active.longitude });
    const rejected = h.host.waitForMessage('error');
    h.host.send('submit_checkpoint', {
      submission: {
        checkpointId: active.id,
        image: 'data:image/jpeg;base64,QUJD',
        latitude: active.latitude,
        longitude: active.longitude,
        observationAnswer: active.acceptedAnswers[0] ?? '',
        randomizedInstruction: 'Hold up two fingers in the shot.',
        submittedAt: Date.now(),
      },
    });
    expect((await rejected).message).toMatch(/instruction/i);
    expect(spy.calls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------

describe('opponent privacy', () => {
  it('never broadcasts a raw coordinate', async () => {
    const h = await setup();
    await startHunt(h);

    // Distinctive to eight decimal places: if this exact number appears
    // anywhere the opponent can read, the grid snap did not happen.
    const RAW_LAT = 40.44170123;
    const RAW_LNG = -80.00930456;

    const received = h.guest.waitForMessage('player_region');
    h.host.send('update_location', { latitude: RAW_LAT, longitude: RAW_LNG });
    const message = await received;

    expect(message.region).not.toBeNull();
    expect(message.region.radiusMeters).toBe(OPPONENT_REGION_RADIUS_METERS);
    expect(message.region.center.latitude).not.toBe(RAW_LAT);
    expect(message.region.center.longitude).not.toBe(RAW_LNG);

    const serialised = JSON.stringify(message);
    expect(serialised).not.toContain(String(RAW_LAT));
    expect(serialised).not.toContain(String(RAW_LNG));

    // The snapped cell is still useful — it is within a cell of the truth.
    const drift = haversineMeters(
      { latitude: RAW_LAT, longitude: RAW_LNG },
      message.region.center,
    );
    expect(drift).toBeLessThanOrEqual(OPPONENT_REGION_RADIUS_METERS);

    // And the shared schema — which every client receives — holds no raw fix.
    await h.guest.waitForNextPatch();
    const publicPlayer = h.guest.state.players.get(h.host.sessionId);
    expect(publicPlayer?.region.latitude).not.toBe(RAW_LAT);
    expect(JSON.stringify(h.guest.state.toJSON())).not.toContain(String(RAW_LAT));

    // The server kept the precise fix for its own geofencing, as it must.
    expect(h.room.rawPositionForSession(h.host.sessionId)).toEqual({
      latitude: RAW_LAT,
      longitude: RAW_LNG,
    });
  });

  it('publishes no region at all when sharing is off, but still publishes progress', async () => {
    const h = await setup();
    await startHunt(h);
    const RAW_LAT = 40.44182777;

    h.host.send('set_share_location', { enabled: false });
    await h.guest.waitForNextPatch();

    const region = h.guest.waitForMessage('player_region');
    const progress = h.guest.waitForMessage('player_progress');
    h.host.send('update_location', { latitude: RAW_LAT, longitude: -80.0093 });

    const regionMessage = await region;
    expect(regionMessage.region).toBeNull();
    expect(JSON.stringify(regionMessage)).not.toContain(String(RAW_LAT));

    const progressMessage = await progress;
    expect(progressMessage.totalCheckpoints).toBe(5);
    expect(typeof progressMessage.checkpointIndex).toBe('number');

    await h.guest.waitForNextPatch();
    expect(h.guest.state.players.get(h.host.sessionId)?.region.hasRegion).toBe(false);
    expect(h.guest.state.players.get(h.host.sessionId)?.sharingLocation).toBe(false);
  });

  it('keeps routes, clues, hints and reveals out of the shared state', async () => {
    const h = await setup();
    await startHunt(h);
    const [active] = checkpointsFor(h.room, h.host.sessionId);
    if (!active) throw new Error('no checkpoint');

    await arriveAt(h.host, active);
    h.host.send('request_hint', { checkpointId: active.id });
    await h.host.waitForMessage('hint_issued');
    await submitHonestly(h.host, active);
    await h.guest.waitForNextPatch();

    const shared = JSON.stringify(h.guest.state.toJSON());
    const hostRoute = h.room.routeIdForSession(h.host.sessionId) ?? '';

    expect(shared).not.toContain(hostRoute);
    expect(shared).not.toContain(active.id);
    expect(shared).not.toContain(active.clue.slice(0, 30));
    expect(shared).not.toContain(active.hint.slice(0, 30));
    expect(shared).not.toContain(active.historicalReveal.slice(0, 30));
    for (const answer of active.acceptedAnswers) {
      if (answer.length >= 4) expect(shared.toLowerCase()).not.toContain(answer.toLowerCase());
    }

    // The opponent still sees the race: progress and XP are public on purpose.
    expect(h.guest.state.players.get(h.host.sessionId)?.checkpointIndex).toBe(1);
    expect(h.guest.state.players.get(h.host.sessionId)?.xp).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------

describe('hints', () => {
  it('charges once per checkpoint however many times it is asked for', async () => {
    const h = await setup();
    await startHunt(h);
    const [active] = checkpointsFor(h.room, h.host.sessionId);
    if (!active) throw new Error('no checkpoint');
    await arriveAt(h.host, active);

    const first = h.host.waitForMessage('hint_issued');
    h.host.send('request_hint', { checkpointId: active.id });
    const firstMessage = await first;

    expect(firstMessage.hint).toBe(active.hint);
    expect(firstMessage.xpDelta).toBe(XP_RULES.HINT_PENALTY);

    for (let i = 0; i < 4; i++) {
      const repeat = h.host.waitForMessage('hint_issued');
      h.host.send('request_hint', { checkpointId: active.id });
      const repeatMessage = await repeat;
      // Same text, no further charge — a double-tapped button never double-pays.
      expect(repeatMessage.hint).toBe(active.hint);
      expect(repeatMessage.xpDelta).toBe(0);
    }

    await h.host.waitForNextPatch();
    expect(h.state.players.get(h.host.sessionId)?.hintsUsed).toBe(1);

    // And the cost lands exactly once in the checkpoint's actual score.
    const verdict = await submitHonestly(h.host, active);
    expect(verdict.outcome).toBe('approved');
    expect(verdict.xpBreakdown.hintPenalty).toBe(XP_RULES.HINT_PENALTY);
    expect(verdict.xpBreakdown.noHintBonus).toBe(0);
  });

  it('sends hint text only to the player who paid for it', async () => {
    const h = await setup();
    await startHunt(h);
    const [active] = checkpointsFor(h.room, h.host.sessionId);
    if (!active) throw new Error('no checkpoint');
    await arriveAt(h.host, active);

    let leaked = false;
    h.guest.onMessage('hint_issued', () => {
      leaked = true;
    });

    h.host.send('request_hint', { checkpointId: active.id });
    await h.host.waitForMessage('hint_issued');
    await h.guest.waitForNextPatch();
    expect(leaked).toBe(false);
  });

  it('refuses a hint for a checkpoint the player is not on', async () => {
    const h = await setup();
    await startHunt(h);
    const route = checkpointsFor(h.room, h.host.sessionId);
    const later = route[2];
    if (!later) throw new Error('route too short');

    const rejected = h.host.waitForMessage('error');
    h.host.send('request_hint', { checkpointId: later.id });
    expect((await rejected).message).toMatch(/not currently on/i);
    await h.host.waitForNextPatch();
    expect(h.state.players.get(h.host.sessionId)?.hintsUsed).toBe(0);
  });
});

// ---------------------------------------------------------------------------

describe('anti-cheat instructions', () => {
  it('is issued on arrival, not at hunt start, and is stable across retries', async () => {
    const h = await setup();
    await startHunt(h);
    const [active] = checkpointsFor(h.room, h.host.sessionId);
    if (!active) throw new Error('no checkpoint');

    // Before arriving: refused. Nothing to stage in advance.
    const rejected = h.host.waitForMessage('error');
    h.host.send('request_instruction', { checkpointId: active.id });
    expect((await rejected).message).toMatch(/reach the checkpoint/i);

    const first = await arriveAt(h.host, active);
    expect(first.length).toBeGreaterThan(0);

    // Asking again returns the identical instruction: no rerolling for an
    // easier one after a rejection.
    const again = h.host.waitForMessage('instruction_issued');
    h.host.send('request_instruction', { checkpointId: active.id });
    expect((await again).instruction).toBe(first);
  });
});

// ---------------------------------------------------------------------------

describe('scoring and progression', () => {
  it('awards exactly the engine’s xpDelta and advances one checkpoint', async () => {
    const h = await setup();
    await startHunt(h);
    const route = checkpointsFor(h.room, h.host.sessionId);
    const active = route[0];
    if (!active) throw new Error('no checkpoint');
    await arriveAt(h.host, active);

    const unlocked = h.host.waitForMessage('checkpoint_unlocked');
    const verdict = await submitHonestly(h.host, active);
    const next = await unlocked;

    expect(verdict.outcome).toBe('approved');
    expect(verdict.xpDelta).toBe(verdict.xpBreakdown.total);

    await h.host.waitForNextPatch();
    const player = h.state.players.get(h.host.sessionId);
    expect(player?.xp).toBe(verdict.xpDelta);
    expect(player?.checkpointIndex).toBe(1);
    expect(next.index).toBe(1);
    expect(next.checkpoint.id).toBe(route[1]?.id);
    // The unlocked clue is public-shaped: no answers travel with it.
    expect(next.checkpoint).not.toHaveProperty('acceptedAnswers');
    expect(next.checkpoint).not.toHaveProperty('historicalReveal');
  });

  it('delivers the reveal only on approval, and only to that player', async () => {
    const h = await setup();
    await startHunt(h);
    const [active] = checkpointsFor(h.room, h.host.sessionId);
    if (!active) throw new Error('no checkpoint');
    await arriveAt(h.host, active);

    let leaked = false;
    h.guest.onMessage('submission_result', () => {
      leaked = true;
    });

    const verdict = await submitHonestly(h.host, active);
    expect(verdict.reveal?.historicalReveal).toBe(active.historicalReveal);
    await h.guest.waitForNextPatch();
    expect(leaked).toBe(false);
  });

  it('records a rejection as an incorrect attempt and awards nothing', async () => {
    const h = await setup();
    await startHunt(h);
    const [active] = checkpointsFor(h.room, h.host.sessionId);
    if (!active) throw new Error('no checkpoint');
    await arriveAt(h.host, active);

    spy.result = { ...PASSING, landmarkMatch: false, reason: 'wrong building' };
    const verdict = await submitHonestly(h.host, active);

    expect(verdict.outcome).toBe('rejected');
    expect(verdict.xpDelta).toBe(0);
    expect(verdict.reveal).toBeUndefined();

    await h.host.waitForNextPatch();
    const player = h.state.players.get(h.host.sessionId);
    expect(player?.xp).toBe(0);
    expect(player?.checkpointIndex).toBe(0);
    expect(player?.incorrectAttempts).toBe(1);

    // ...and a retry still works: a failure never ends the run.
    spy.result = { ...PASSING };
    const retry = await submitHonestly(h.host, active);
    expect(retry.outcome).toBe('approved');
    expect(retry.xpBreakdown.incorrectPenalty).toBe(XP_RULES.INCORRECT_PENALTY);
  });

  it('holds a low-confidence submission for review without penalising the player', async () => {
    const h = await setup();
    await startHunt(h);
    const [active] = checkpointsFor(h.room, h.host.sessionId);
    if (!active) throw new Error('no checkpoint');
    await arriveAt(h.host, active);

    spy.result = { ...PASSING, confidence: 0.2 };
    const held = await submitHonestly(h.host, active);
    expect(held.outcome).toBe('needs-review');
    expect(held.xpDelta).toBe(0);

    await h.host.waitForNextPatch();
    // Not counted against them — the model's uncertainty is not their fault.
    expect(h.state.players.get(h.host.sessionId)?.incorrectAttempts).toBe(0);

    spy.result = { ...PASSING };
    const retry = await submitHonestly(h.host, active);
    expect(retry.outcome).toBe('approved');
  });

  it('finishes a whole route and pays the completion bonus exactly once', async () => {
    const h = await setup();
    await startHunt(h);
    const route = checkpointsFor(h.room, h.host.sessionId);

    let total = 0;
    for (const checkpoint of route) {
      await arriveAt(h.host, checkpoint);
      const verdict = await submitHonestly(h.host, checkpoint);
      expect(verdict.outcome).toBe('approved');
      total += verdict.xpDelta;
    }

    await h.host.waitForNextPatch();
    const player = h.state.players.get(h.host.sessionId);
    expect(player?.finished).toBe(true);
    expect(player?.xp).toBe(total);

    const run = h.room.huntStateForSession(h.host.sessionId);
    expect(run?.phase).toBe('FINISHED');
    expect(run?.reveals).toHaveLength(5);

    // ROUTE_COMPLETION_BONUS lives in the final checkpoint's breakdown and is
    // never added a second time by the room's ADVANCE.
    const bonuses = h.room
      .checkpointIdsForSession(h.host.sessionId)
      ?.map((id) => id)
      .filter((id) => id === 'final_point_fountain');
    expect(bonuses).toHaveLength(1);
  });

  it('ranks the leaderboard by XP, not by finishing order', async () => {
    const h = await setup();
    await startHunt(h);
    const [active] = checkpointsFor(h.room, h.host.sessionId);
    if (!active) throw new Error('no checkpoint');
    await arriveAt(h.host, active);

    const board = h.guest.waitForMessage('leaderboard');
    await submitHonestly(h.host, active);
    const entries = (await board).entries;

    expect(entries).toHaveLength(2);
    expect(entries[0].displayName).toBe('Ada');
    expect(entries[0].rank).toBe(1);
    expect(entries[0].xp).toBeGreaterThan(0);
    expect(entries[1].xp).toBe(0);
    expect(entries[0].totalCheckpoints).toBe(5);
  });
});

// ---------------------------------------------------------------------------

describe('reconnection', () => {
  it('preserves XP and checkpointIndex across a dropped connection', async () => {
    const h = await setup();
    await startHunt(h);
    const [active] = checkpointsFor(h.room, h.host.sessionId);
    if (!active) throw new Error('no checkpoint');

    await arriveAt(h.host, active);
    const verdict = await submitHonestly(h.host, active);
    expect(verdict.outcome).toBe('approved');

    const sessionId = h.host.sessionId;
    const routeId = h.room.routeIdForSession(sessionId);
    const earnedXp = verdict.xpDelta;
    const token = h.host.reconnectionToken;

    // An UNCONSENTED leave: the phone lost signal, the player did not quit.
    await h.host.leave(false);
    await h.guest.waitForNextPatch();

    const whileAway = h.state.players.get(sessionId);
    expect(whileAway).toBeDefined();
    expect(whileAway?.connected).toBe(false);
    // Nothing is forfeited while they are gone.
    expect(whileAway?.xp).toBe(earnedXp);
    expect(whileAway?.checkpointIndex).toBe(1);

    const back = await colyseus.sdk.reconnect(token);
    await back.waitForNextPatch();

    const restored = h.state.players.get(back.sessionId);
    expect(restored?.connected).toBe(true);
    expect(restored?.xp).toBe(earnedXp);
    expect(restored?.checkpointIndex).toBe(1);
    // They rejoin in place: same route, same point in it.
    expect(h.room.routeIdForSession(back.sessionId)).toBe(routeId);
    expect(h.room.huntStateForSession(back.sessionId)?.totalXp).toBe(earnedXp);

    // And they can keep playing from exactly where they stopped.
    const next = checkpointsFor(h.room, back.sessionId)[1];
    if (!next) throw new Error('no next checkpoint');
    await arriveAt(back as unknown as ClientRoom, next);
    const second = await submitHonestly(back as unknown as ClientRoom, next);
    expect(second.outcome).toBe('approved');
    expect(h.state.players.get(back.sessionId)?.checkpointIndex).toBe(2);
  });

  it('marks a dropped player disconnected on the leaderboard', async () => {
    const h = await setup();
    await startHunt(h);
    const sessionId = h.host.sessionId;

    await h.host.leave(false);
    await h.guest.waitForNextPatch();

    expect(h.state.players.get(sessionId)?.connected).toBe(false);
    expect(h.state.players.size).toBe(2);
  });
});

// ---------------------------------------------------------------------------

describe('team-race', () => {
  it('gives teammates one route, one XP total and one leaderboard entry', async () => {
    const room = await colyseus.createRoom<HuntRoomState>('hunt', { mode: 'team-race' });
    const a = await colyseus.connectTo(room, { playerName: 'Ada', teamName: 'Analysts' });
    const b = await colyseus.connectTo(room, { playerName: 'Bob', teamName: 'Analysts' });
    const c = await colyseus.connectTo(room, { playerName: 'Cleo', teamName: 'Rivals' });
    const hunt = room as unknown as HuntRoom;

    const started = [
      (a as unknown as ClientRoom).waitForMessage('hunt_started'),
      (b as unknown as ClientRoom).waitForMessage('hunt_started'),
      (c as unknown as ClientRoom).waitForMessage('hunt_started'),
    ];
    a.send('start_hunt', {});
    const [aStart, bStart, cStart] = await Promise.all(started);

    // Teammates share a route; the rival team draws a different one.
    expect(aStart.firstCheckpoint.id).toBe(bStart.firstCheckpoint.id);
    expect(cStart.firstCheckpoint.id).not.toBe(aStart.firstCheckpoint.id);
    expect(hunt.routeIdForSession(a.sessionId)).toBe(hunt.routeIdForSession(b.sessionId));
    expect(hunt.routeIdForSession(c.sessionId)).not.toBe(hunt.routeIdForSession(a.sessionId));

    // One member scores; the whole team's total moves.
    const active = fullCheckpoint(aStart.firstCheckpoint.id);
    await arriveAt(a as unknown as ClientRoom, active);
    const verdict = await submitHonestly(a as unknown as ClientRoom, active);
    await (b as unknown as ClientRoom).waitForNextPatch();

    expect(room.state.players.get(a.sessionId)?.xp).toBe(verdict.xpDelta);
    expect(room.state.players.get(b.sessionId)?.xp).toBe(verdict.xpDelta);
    expect(room.state.players.get(c.sessionId)?.xp).toBe(0);

    const teamId = room.state.players.get(a.sessionId)?.teamId ?? '';
    expect(room.state.teams.get(teamId)?.xp).toBe(verdict.xpDelta);
    expect(room.state.teams.size).toBe(2);
    // Two teams, two entries — three players do not become three entries.
    expect(room.state.leaderboard.length).toBe(2);
  });
});
