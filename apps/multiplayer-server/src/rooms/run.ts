/**
 * A "run" — one hunt-engine state machine plus the private bookkeeping that
 * goes with it.
 *
 * A run belongs to an ENTITY, not to a connection: in `individual-race` the
 * entity is a player, in `team-race` it is a team. That indirection is the
 * whole of team mode — teammates share one run, so they share one route, one
 * XP total and one leaderboard entry, and none of that needs a second code
 * path in the room.
 *
 * NOTHING HERE IS PUBLISHED. The route id, the checkpoint ids, the issued
 * instructions and the reveals all live on the server only; see
 * `rooms/schema.ts` for what a client is actually allowed to see.
 */

import {
  createHuntState,
  toClientHuntState,
  type CheckpointProgress,
  type HuntState,
} from '@ww/hunt-engine';
import type { CompletedCheckpoint, XpBreakdown } from '@ww/shared';

/** An anti-cheat instruction, remembered so a retry cannot reroll it. */
export interface IssuedInstruction {
  checkpointId: string;
  instruction: string;
  /** Server-observed arrival time — the seed that makes it unpredictable. */
  arrivalTime: number;
}

export interface HuntRun {
  /** Player id in `individual-race`, team id in `team-race`. */
  entityId: string;
  isTeam: boolean;
  displayName: string;
  routeId: string;
  /** Server-side only. A client learns these one checkpoint at a time. */
  checkpointIds: readonly string[];
  state: HuntState;
  /** Keyed by checkpoint id, so a retry gets the identical instruction. */
  instructions: Map<string, IssuedInstruction>;
  /** One entry per approved checkpoint, straight from `scoreCheckpoint`. */
  breakdowns: XpBreakdown[];
  completed: CompletedCheckpoint[];
  /** Submissions the model was unsure about. Reported, never silently passed. */
  needsReviewCount: number;
  /**
   * Set when the run ends: either the state machine reached FINISHED, or the
   * player sent `finish_hunt` to bow out early. Kept here rather than read off
   * `state.finishedAt` because a forfeit is a legitimate ending the pure state
   * machine has no action for.
   */
  finishedAt: number | null;
}

export function createRun(params: {
  entityId: string;
  isTeam: boolean;
  displayName: string;
  routeId: string;
  checkpointIds: readonly string[];
}): HuntRun {
  return {
    entityId: params.entityId,
    isTeam: params.isTeam,
    displayName: params.displayName,
    routeId: params.routeId,
    checkpointIds: [...params.checkpointIds],
    state: createHuntState(params.routeId, params.checkpointIds),
    instructions: new Map(),
    breakdowns: [],
    completed: [],
    needsReviewCount: 0,
    finishedAt: null,
  };
}

/**
 * The one checkpoint this run may currently act on.
 *
 * Delegates to hunt-engine's own client projection rather than indexing
 * `checkpointIds` directly, so "which checkpoint is active" has exactly one
 * definition: null before the hunt starts and after it finishes, the active id
 * otherwise. Every authority check in the room is built on this.
 */
export function activeCheckpointId(run: HuntRun): string | null {
  return toClientHuntState(run.state).activeCheckpointId;
}

export function activeProgress(run: HuntRun): CheckpointProgress | undefined {
  return run.state.progress.find((p) => p.index === run.state.activeIndex);
}

export function isFinalCheckpointIndex(run: HuntRun, index: number): boolean {
  return index === run.checkpointIds.length - 1;
}

export function completedCount(run: HuntRun): number {
  return run.state.progress.filter((p) => p.completedAt !== null).length;
}

export function hintsUsedCount(run: HuntRun): number {
  return run.state.progress.filter((p) => p.hintUsed).length;
}

export function incorrectAttemptsTotal(run: HuntRun): number {
  return run.state.progress.reduce((sum, p) => sum + p.incorrectAttempts, 0);
}

export function isRunFinished(run: HuntRun): boolean {
  return run.state.phase === 'FINISHED' || run.finishedAt !== null;
}
