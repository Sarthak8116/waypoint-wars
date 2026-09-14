/**
 * Checkpoint progression state machine.
 *
 * Pure and framework-independent: no clocks, no I/O, no mutation. Every action
 * carries its own `now` so the browser, the Colyseus room and the tests can all
 * drive the identical reducer and get identical results.
 *
 * The server is the only legitimate driver of this machine. The browser may run
 * a mirror copy for optimistic UI, but the authoritative XP and progression are
 * whatever the server's copy says.
 *
 *   NOT_STARTED -> NAVIGATING -> ARRIVED -> CHALLENGE_OPEN -> VERIFYING
 *                      ^                         ^               |
 *                      |                         +-- failed -----+
 *                      |                                         |
 *                 NEXT_CHECKPOINT <- ADVANCE <- COMPLETED <- passed
 *                                       |
 *                                       +-- last checkpoint -> FINISHED
 */

import type { HistoricalSource } from '@ww/shared';

export type HuntPhase =
  | 'NOT_STARTED'
  | 'NAVIGATING'
  | 'ARRIVED'
  | 'CHALLENGE_OPEN'
  | 'VERIFYING'
  | 'COMPLETED'
  | 'NEXT_CHECKPOINT'
  | 'FINISHED';

/** Unlocked only once a checkpoint is completed — this is the earned payload. */
export interface CheckpointReveal {
  checkpointId: string;
  name: string;
  historicalReveal: string;
  sources: HistoricalSource[];
  hiddenDetail?: string;
}

/** Per-checkpoint bookkeeping. Only exists for reached checkpoints. */
export interface CheckpointProgress {
  checkpointId: string;
  index: number;
  /** When this checkpoint became active — the start of its speed-bonus clock. */
  activatedAt: number;
  arrivedAt: number | null;
  completedAt: number | null;
  hintUsed: boolean;
  hintUsedAt: number | null;
  incorrectAttempts: number;
  xpAwarded: number;
}

export type HuntErrorCode =
  | 'HUNT_NOT_STARTED'
  | 'HUNT_ALREADY_STARTED'
  | 'HUNT_ALREADY_FINISHED'
  | 'NOT_ACTIVE_CHECKPOINT'
  | 'ILLEGAL_PHASE'
  | 'HINT_ALREADY_USED'
  | 'EMPTY_ROUTE';

export interface HuntError {
  code: HuntErrorCode;
  message: string;
}

export interface HuntState {
  readonly phase: HuntPhase;
  readonly routeId: string;
  /** Server-side only. `toClientHuntState` strips the unreached ids. */
  readonly checkpointIds: readonly string[];
  readonly activeIndex: number;
  readonly startedAt: number | null;
  readonly finishedAt: number | null;
  readonly totalXp: number;
  readonly progress: readonly CheckpointProgress[];
  readonly reveals: readonly CheckpointReveal[];
  /** Set by the last rejected action; cleared by the next accepted one. */
  readonly error: HuntError | null;
}

export type HuntAction =
  | { type: 'START_HUNT'; now: number }
  | { type: 'BEGIN_NAVIGATION'; now: number }
  | { type: 'ARRIVE'; checkpointIndex: number; now: number }
  | { type: 'OPEN_CHALLENGE'; checkpointIndex: number; now: number }
  | { type: 'REQUEST_HINT'; checkpointIndex: number; now: number }
  | { type: 'SUBMIT'; checkpointIndex: number; now: number }
  | { type: 'VERIFICATION_FAILED'; checkpointIndex: number; now: number }
  | { type: 'VERIFICATION_NEEDS_REVIEW'; checkpointIndex: number; now: number }
  /**
   * The verifier could not answer — a rate limit, a timeout, an outage.
   *
   * Distinct from VERIFICATION_FAILED, which records an incorrect attempt and
   * costs 15 XP. That is the right response to a bad submission and the wrong
   * one to our own downtime: the player did nothing, and the message they are
   * shown promises "nothing was counted against you". Reopens the challenge so
   * they can simply submit again.
   */
  | { type: 'VERIFICATION_UNAVAILABLE'; checkpointIndex: number; now: number }
  | {
      type: 'VERIFICATION_PASSED';
      checkpointIndex: number;
      now: number;
      xpAwarded: number;
      reveal: CheckpointReveal;
    }
  | { type: 'ADVANCE'; now: number; routeCompletionBonus?: number };

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

export function createHuntState(routeId: string, checkpointIds: readonly string[]): HuntState {
  return {
    phase: 'NOT_STARTED',
    routeId,
    checkpointIds: [...checkpointIds],
    activeIndex: 0,
    startedAt: null,
    finishedAt: null,
    totalXp: 0,
    progress: [],
    reveals: [],
    error: checkpointIds.length === 0 ? err('EMPTY_ROUTE', 'Route has no checkpoints.') : null,
  };
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

const err = (code: HuntErrorCode, message: string): HuntError => ({ code, message });

/** Illegal transitions never throw: they return the state plus a reason. */
function reject(state: HuntState, code: HuntErrorCode, message: string): HuntState {
  return { ...state, error: err(code, message) };
}

function accept(state: HuntState, patch: Partial<HuntState>): HuntState {
  return { ...state, ...patch, error: null };
}

function activeProgress(state: HuntState): CheckpointProgress | undefined {
  return state.progress.find((p) => p.index === state.activeIndex);
}

function patchActive(
  state: HuntState,
  patch: Partial<CheckpointProgress>,
): readonly CheckpointProgress[] {
  return state.progress.map((p) => (p.index === state.activeIndex ? { ...p, ...patch } : p));
}

function newProgress(state: HuntState, index: number, now: number): CheckpointProgress {
  return {
    checkpointId: state.checkpointIds[index] ?? '',
    index,
    activatedAt: now,
    arrivedAt: null,
    completedAt: null,
    hintUsed: false,
    hintUsedAt: null,
    incorrectAttempts: 0,
    xpAwarded: 0,
  };
}

/**
 * The single gate that enforces "only the ACTIVE checkpoint is submittable".
 * Every index-bearing action passes through here first.
 */
function guardActive(state: HuntState, index: number, allowed: readonly HuntPhase[]): HuntError | null {
  if (state.phase === 'NOT_STARTED') return err('HUNT_NOT_STARTED', 'The hunt has not started.');
  if (state.phase === 'FINISHED') return err('HUNT_ALREADY_FINISHED', 'The hunt is already finished.');
  if (index !== state.activeIndex) {
    return err(
      'NOT_ACTIVE_CHECKPOINT',
      `Checkpoint ${index} is not active (active index is ${state.activeIndex}).`,
    );
  }
  if (!allowed.includes(state.phase)) {
    return err('ILLEGAL_PHASE', `Not allowed while in phase ${state.phase}.`);
  }
  return null;
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

function start(state: HuntState, now: number): HuntState {
  if (state.checkpointIds.length === 0) {
    return reject(state, 'EMPTY_ROUTE', 'Route has no checkpoints.');
  }
  if (state.phase !== 'NOT_STARTED') {
    return reject(state, 'HUNT_ALREADY_STARTED', 'The hunt has already started.');
  }
  return accept(state, {
    phase: 'NAVIGATING',
    startedAt: now,
    activeIndex: 0,
    progress: [newProgress(state, 0, now)],
  });
}

function requestHint(state: HuntState, index: number, now: number): HuntState {
  const bad = guardActive(state, index, ['NAVIGATING', 'ARRIVED', 'CHALLENGE_OPEN']);
  if (bad) return reject(state, bad.code, bad.message);
  // Idempotent on purpose: a double-tapped hint button must never double-charge.
  if (activeProgress(state)?.hintUsed) {
    return reject(state, 'HINT_ALREADY_USED', 'A hint was already issued for this checkpoint.');
  }
  return accept(state, { progress: patchActive(state, { hintUsed: true, hintUsedAt: now }) });
}

function verificationPassed(
  state: HuntState,
  action: Extract<HuntAction, { type: 'VERIFICATION_PASSED' }>,
): HuntState {
  const bad = guardActive(state, action.checkpointIndex, ['VERIFYING']);
  if (bad) return reject(state, bad.code, bad.message);
  const xp = Number.isFinite(action.xpAwarded) ? Math.max(0, action.xpAwarded) : 0;
  return accept(state, {
    phase: 'COMPLETED',
    totalXp: state.totalXp + xp,
    progress: patchActive(state, { completedAt: action.now, xpAwarded: xp }),
    reveals: [...state.reveals, action.reveal],
  });
}

function advance(state: HuntState, now: number, routeCompletionBonus = 0): HuntState {
  if (state.phase !== 'COMPLETED') {
    return reject(state, 'ILLEGAL_PHASE', `Cannot advance from phase ${state.phase}.`);
  }
  const nextIndex = state.activeIndex + 1;
  if (nextIndex >= state.checkpointIds.length) {
    const bonus = Number.isFinite(routeCompletionBonus) ? Math.max(0, routeCompletionBonus) : 0;
    return accept(state, {
      phase: 'FINISHED',
      finishedAt: now,
      totalXp: state.totalXp + bonus,
    });
  }
  return accept(state, {
    phase: 'NEXT_CHECKPOINT',
    activeIndex: nextIndex,
    progress: [...state.progress, newProgress(state, nextIndex, now)],
  });
}

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

/** Pure reducer. Never mutates `state`; never throws. */
export function transition(state: HuntState, action: HuntAction): HuntState {
  switch (action.type) {
    case 'START_HUNT':
      return start(state, action.now);

    case 'BEGIN_NAVIGATION': {
      if (state.phase !== 'NEXT_CHECKPOINT') {
        return reject(state, 'ILLEGAL_PHASE', `Cannot begin navigation from ${state.phase}.`);
      }
      void action.now;
      return accept(state, { phase: 'NAVIGATING' });
    }

    case 'ARRIVE': {
      // NEXT_CHECKPOINT is treated as navigable so a player who is already
      // standing on the next waypoint is not forced to walk away and back.
      const bad = guardActive(state, action.checkpointIndex, ['NAVIGATING', 'NEXT_CHECKPOINT']);
      if (bad) return reject(state, bad.code, bad.message);
      return accept(state, {
        phase: 'ARRIVED',
        progress: patchActive(state, { arrivedAt: action.now }),
      });
    }

    case 'OPEN_CHALLENGE': {
      const bad = guardActive(state, action.checkpointIndex, ['ARRIVED']);
      if (bad) return reject(state, bad.code, bad.message);
      return accept(state, { phase: 'CHALLENGE_OPEN' });
    }

    case 'REQUEST_HINT':
      return requestHint(state, action.checkpointIndex, action.now);

    case 'SUBMIT': {
      const bad = guardActive(state, action.checkpointIndex, ['CHALLENGE_OPEN']);
      if (bad) return reject(state, bad.code, bad.message);
      return accept(state, { phase: 'VERIFYING' });
    }

    case 'VERIFICATION_FAILED': {
      const bad = guardActive(state, action.checkpointIndex, ['VERIFYING']);
      if (bad) return reject(state, bad.code, bad.message);
      // A failure costs XP but never ends the run: back to the challenge.
      const attempts = (activeProgress(state)?.incorrectAttempts ?? 0) + 1;
      return accept(state, {
        phase: 'CHALLENGE_OPEN',
        progress: patchActive(state, { incorrectAttempts: attempts }),
      });
    }

    case 'VERIFICATION_NEEDS_REVIEW': {
      // Low Gemini confidence: hold in VERIFYING, never a silent pass or fail.
      const bad = guardActive(state, action.checkpointIndex, ['VERIFYING']);
      if (bad) return reject(state, bad.code, bad.message);
      return accept(state, { phase: 'VERIFYING' });
    }

    case 'VERIFICATION_UNAVAILABLE': {
      // Reopen WITHOUT touching incorrectAttempts. The distinction from
      // VERIFICATION_FAILED is the entire point of this action existing.
      const bad = guardActive(state, action.checkpointIndex, ['VERIFYING']);
      if (bad) return reject(state, bad.code, bad.message);
      return accept(state, { phase: 'CHALLENGE_OPEN' });
    }

    case 'VERIFICATION_PASSED':
      return verificationPassed(state, action);

    case 'ADVANCE':
      return advance(state, action.now, action.routeCompletionBonus);

    default: {
      const never: never = action;
      void never;
      return state;
    }
  }
}

/** Convenience: fold a list of actions. Useful in tests and replay. */
export function transitionAll(state: HuntState, actions: readonly HuntAction[]): HuntState {
  return actions.reduce(transition, state);
}

// ---------------------------------------------------------------------------
// Client projection
// ---------------------------------------------------------------------------

/**
 * What a hunting player is allowed to know. Future checkpoint ids are removed
 * entirely: a client that never receives them cannot pre-walk the route, and
 * cannot correlate an opponent's position with an unreached waypoint.
 */
export interface PublicHuntState {
  phase: HuntPhase;
  activeIndex: number;
  totalCheckpoints: number;
  /** Null before the hunt starts and after it finishes. */
  activeCheckpointId: string | null;
  completedCheckpointIds: string[];
  hintUsedOnActive: boolean;
  incorrectAttemptsOnActive: number;
  startedAt: number | null;
  finishedAt: number | null;
  totalXp: number;
  reveals: CheckpointReveal[];
  error: HuntError | null;
}

export function toClientHuntState(state: HuntState): PublicHuntState {
  const active = activeProgress(state);
  const visible = state.phase === 'NOT_STARTED' || state.phase === 'FINISHED' ? null : active;
  return {
    phase: state.phase,
    activeIndex: state.activeIndex,
    totalCheckpoints: state.checkpointIds.length,
    activeCheckpointId: visible?.checkpointId ?? null,
    completedCheckpointIds: state.progress
      .filter((p) => p.completedAt !== null)
      .map((p) => p.checkpointId),
    hintUsedOnActive: active?.hintUsed ?? false,
    incorrectAttemptsOnActive: active?.incorrectAttempts ?? 0,
    startedAt: state.startedAt,
    finishedAt: state.finishedAt,
    totalXp: state.totalXp,
    reveals: state.reveals.map((r) => ({ ...r })),
    error: state.error,
  };
}
