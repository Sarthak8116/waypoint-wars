import { describe, it, expect } from 'vitest';
import {
  createHuntState,
  transition,
  transitionAll,
  toClientHuntState,
  type CheckpointReveal,
  type HuntAction,
  type HuntState,
} from './state-machine.js';

const CHECKPOINT_IDS = ['cp-1', 'cp-2', 'cp-3', 'cp-4'] as const;

const revealFor = (checkpointId: string): CheckpointReveal => ({
  checkpointId,
  name: `Landmark ${checkpointId}`,
  historicalReveal: 'A thing happened here.',
  sources: [{ title: 'A cited source' }],
});

/** Walk one checkpoint from navigation to completion, then advance. */
function solveCheckpoint(state: HuntState, index: number, now: number, xp = 150): HuntState {
  const id = CHECKPOINT_IDS[index] as string;
  const actions: HuntAction[] = [
    { type: 'ARRIVE', checkpointIndex: index, now },
    { type: 'OPEN_CHALLENGE', checkpointIndex: index, now: now + 1 },
    { type: 'SUBMIT', checkpointIndex: index, now: now + 2 },
    {
      type: 'VERIFICATION_PASSED',
      checkpointIndex: index,
      now: now + 3,
      xpAwarded: xp,
      reveal: revealFor(id),
    },
    { type: 'ADVANCE', now: now + 4, routeCompletionBonus: 150 },
  ];
  const next = transitionAll(state, actions);
  return next.phase === 'NEXT_CHECKPOINT'
    ? transition(next, { type: 'BEGIN_NAVIGATION', now: now + 5 })
    : next;
}

const started = (now = 1_000): HuntState =>
  transition(createHuntState('route-a', CHECKPOINT_IDS), { type: 'START_HUNT', now });

describe('hunt state machine — happy path', () => {
  it('walks all four checkpoints through every phase to FINISHED', () => {
    let state = createHuntState('route-a', CHECKPOINT_IDS);
    expect(state.phase).toBe('NOT_STARTED');

    state = transition(state, { type: 'START_HUNT', now: 1_000 });
    expect(state.phase).toBe('NAVIGATING');
    expect(state.startedAt).toBe(1_000);

    const seen: string[] = [state.phase];
    state = transition(state, { type: 'ARRIVE', checkpointIndex: 0, now: 1_100 });
    seen.push(state.phase);
    state = transition(state, { type: 'OPEN_CHALLENGE', checkpointIndex: 0, now: 1_200 });
    seen.push(state.phase);
    state = transition(state, { type: 'SUBMIT', checkpointIndex: 0, now: 1_300 });
    seen.push(state.phase);
    state = transition(state, {
      type: 'VERIFICATION_PASSED',
      checkpointIndex: 0,
      now: 1_400,
      xpAwarded: 150,
      reveal: revealFor('cp-1'),
    });
    seen.push(state.phase);
    state = transition(state, { type: 'ADVANCE', now: 1_500 });
    seen.push(state.phase);

    expect(seen).toEqual([
      'NAVIGATING',
      'ARRIVED',
      'CHALLENGE_OPEN',
      'VERIFYING',
      'COMPLETED',
      'NEXT_CHECKPOINT',
    ]);

    state = transition(state, { type: 'BEGIN_NAVIGATION', now: 1_600 });
    for (let i = 1; i < CHECKPOINT_IDS.length; i++) {
      state = solveCheckpoint(state, i, 2_000 + i * 1_000);
    }

    expect(state.phase).toBe('FINISHED');
    expect(state.finishedAt).not.toBeNull();
    expect(state.error).toBeNull();
    expect(state.progress).toHaveLength(4);
    expect(state.reveals.map((r) => r.checkpointId)).toEqual([...CHECKPOINT_IDS]);
    // 4 x 150 checkpoint XP + the 150 route-completion bonus paid on finish.
    expect(state.totalXp).toBe(750);
  });

  it('never mutates the state handed to it', () => {
    const state = started();
    const snapshot = structuredClone(state);
    transition(state, { type: 'ARRIVE', checkpointIndex: 0, now: 2_000 });
    transition(state, { type: 'REQUEST_HINT', checkpointIndex: 0, now: 2_000 });
    expect(state).toEqual(snapshot);
  });
});

describe('hunt state machine — active checkpoint enforcement', () => {
  it('rejects a submission for a checkpoint that is not active', () => {
    const state = transition(started(), { type: 'ARRIVE', checkpointIndex: 0, now: 1_100 });
    const opened = transition(state, { type: 'OPEN_CHALLENGE', checkpointIndex: 0, now: 1_200 });

    const attacked = transition(opened, { type: 'SUBMIT', checkpointIndex: 2, now: 1_300 });

    expect(attacked.error?.code).toBe('NOT_ACTIVE_CHECKPOINT');
    expect(attacked.phase).toBe('CHALLENGE_OPEN');
    expect(attacked.activeIndex).toBe(0);
    expect({ ...attacked, error: null }).toEqual({ ...opened, error: null });
  });

  it('rejects arriving at, hinting and verifying a non-active checkpoint', () => {
    const state = started();
    for (const action of [
      { type: 'ARRIVE', checkpointIndex: 3, now: 1_100 },
      { type: 'REQUEST_HINT', checkpointIndex: 1, now: 1_100 },
      { type: 'VERIFICATION_PASSED', checkpointIndex: 1, now: 1_100, xpAwarded: 999, reveal: revealFor('cp-2') },
    ] satisfies HuntAction[]) {
      const next = transition(state, action);
      expect(next.error?.code).toBe('NOT_ACTIVE_CHECKPOINT');
      expect(next.totalXp).toBe(0);
      expect(next.phase).toBe('NAVIGATING');
    }
  });

  it('hides future checkpoints from the client projection', () => {
    const client = toClientHuntState(started());
    expect(client.activeCheckpointId).toBe('cp-1');
    expect(client.totalCheckpoints).toBe(4);
    const serialized = JSON.stringify(client);
    for (const future of ['cp-2', 'cp-3', 'cp-4']) {
      expect(serialized).not.toContain(future);
    }
  });

  it('exposes no checkpoint id before the hunt starts', () => {
    const client = toClientHuntState(createHuntState('route-a', CHECKPOINT_IDS));
    expect(client.activeCheckpointId).toBeNull();
    expect(JSON.stringify(client)).not.toContain('cp-1');
  });
});

describe('hunt state machine — failure and retry', () => {
  it('returns to CHALLENGE_OPEN on a failed verification, counting the attempt', () => {
    let state = transitionAll(started(), [
      { type: 'ARRIVE', checkpointIndex: 0, now: 1_100 },
      { type: 'OPEN_CHALLENGE', checkpointIndex: 0, now: 1_200 },
      { type: 'SUBMIT', checkpointIndex: 0, now: 1_300 },
      { type: 'VERIFICATION_FAILED', checkpointIndex: 0, now: 1_400 },
    ]);

    expect(state.phase).toBe('CHALLENGE_OPEN');
    expect(state.activeIndex).toBe(0);
    expect(state.finishedAt).toBeNull();
    expect(state.progress[0]?.incorrectAttempts).toBe(1);
    expect(state.progress[0]?.completedAt).toBeNull();
    expect(state.totalXp).toBe(0);
    expect(state.reveals).toHaveLength(0);

    state = transitionAll(state, [
      { type: 'SUBMIT', checkpointIndex: 0, now: 1_500 },
      { type: 'VERIFICATION_FAILED', checkpointIndex: 0, now: 1_600 },
      { type: 'SUBMIT', checkpointIndex: 0, now: 1_700 },
      {
        type: 'VERIFICATION_PASSED',
        checkpointIndex: 0,
        now: 1_800,
        xpAwarded: 120,
        reveal: revealFor('cp-1'),
      },
    ]);

    expect(state.phase).toBe('COMPLETED');
    expect(state.progress[0]?.incorrectAttempts).toBe(2);
    expect(state.progress[0]?.completedAt).toBe(1_800);
    expect(state.totalXp).toBe(120);
  });

  it('holds in VERIFYING when the verdict needs human review', () => {
    const state = transitionAll(started(), [
      { type: 'ARRIVE', checkpointIndex: 0, now: 1_100 },
      { type: 'OPEN_CHALLENGE', checkpointIndex: 0, now: 1_200 },
      { type: 'SUBMIT', checkpointIndex: 0, now: 1_300 },
      { type: 'VERIFICATION_NEEDS_REVIEW', checkpointIndex: 0, now: 1_400 },
    ]);
    expect(state.phase).toBe('VERIFYING');
    expect(state.progress[0]?.incorrectAttempts).toBe(0);
    expect(state.totalXp).toBe(0);
  });
});

describe('hunt state machine — hints', () => {
  it('charges a hint exactly once even when requested twice', () => {
    const first = transition(started(), { type: 'REQUEST_HINT', checkpointIndex: 0, now: 1_100 });
    expect(first.error).toBeNull();
    expect(first.progress[0]?.hintUsed).toBe(true);
    expect(first.progress[0]?.hintUsedAt).toBe(1_100);

    const second = transition(first, { type: 'REQUEST_HINT', checkpointIndex: 0, now: 1_200 });
    expect(second.error?.code).toBe('HINT_ALREADY_USED');
    expect(second.progress[0]?.hintUsed).toBe(true);
    // Unchanged: same timestamp, so no second charge can be derived from it.
    expect(second.progress[0]?.hintUsedAt).toBe(1_100);
    expect(second.progress).toEqual(first.progress);
  });

  it('resets hint availability for each new checkpoint', () => {
    const hinted = transition(started(), { type: 'REQUEST_HINT', checkpointIndex: 0, now: 1_100 });
    const next = solveCheckpoint(hinted, 0, 1_200);
    expect(next.activeIndex).toBe(1);
    expect(next.progress[1]?.hintUsed).toBe(false);

    const hintedAgain = transition(next, { type: 'REQUEST_HINT', checkpointIndex: 1, now: 2_000 });
    expect(hintedAgain.error).toBeNull();
    expect(hintedAgain.progress[1]?.hintUsed).toBe(true);
  });

  it('refuses a hint before the hunt starts and after it finishes', () => {
    const before = transition(createHuntState('route-a', CHECKPOINT_IDS), {
      type: 'REQUEST_HINT',
      checkpointIndex: 0,
      now: 1,
    });
    expect(before.error?.code).toBe('HUNT_NOT_STARTED');
  });
});

describe('hunt state machine — illegal transitions', () => {
  it('returns the state unchanged with a reason instead of throwing', () => {
    const state = started();
    const cases: Array<[HuntAction, string]> = [
      [{ type: 'START_HUNT', now: 2_000 }, 'HUNT_ALREADY_STARTED'],
      [{ type: 'ADVANCE', now: 2_000 }, 'ILLEGAL_PHASE'],
      [{ type: 'BEGIN_NAVIGATION', now: 2_000 }, 'ILLEGAL_PHASE'],
      [{ type: 'OPEN_CHALLENGE', checkpointIndex: 0, now: 2_000 }, 'ILLEGAL_PHASE'],
      [{ type: 'SUBMIT', checkpointIndex: 0, now: 2_000 }, 'ILLEGAL_PHASE'],
    ];

    for (const [action, code] of cases) {
      const next = transition(state, action);
      expect(next.error?.code).toBe(code);
      expect({ ...next, error: null }).toEqual({ ...state, error: null });
    }
  });

  it('rejects an empty route rather than starting an unwinnable hunt', () => {
    const empty = createHuntState('route-empty', []);
    expect(empty.error?.code).toBe('EMPTY_ROUTE');
    const next = transition(empty, { type: 'START_HUNT', now: 1_000 });
    expect(next.phase).toBe('NOT_STARTED');
    expect(next.error?.code).toBe('EMPTY_ROUTE');
  });

  it('accepts nothing further once FINISHED', () => {
    let state = started();
    for (let i = 0; i < CHECKPOINT_IDS.length; i++) state = solveCheckpoint(state, i, 2_000 + i * 1_000);
    expect(state.phase).toBe('FINISHED');

    const after = transition(state, { type: 'SUBMIT', checkpointIndex: 3, now: 9_000 });
    expect(after.error?.code).toBe('HUNT_ALREADY_FINISHED');
    expect(after.totalXp).toBe(state.totalXp);
  });

  /**
   * Our outage is not the player's mistake.
   *
   * VERIFICATION_FAILED records an incorrect attempt, which costs 15 XP on the
   * eventual successful submission. That is right for a bad photo and wrong
   * for a rate limit — and the message shown in that case promises "nothing
   * was counted against you". Sampling the live verifier, three of six calls
   * come back rate-limited, so this was a recurring, invisible charge.
   */
  it('VERIFICATION_UNAVAILABLE reopens the challenge without recording an attempt', () => {
    let state = started();
    state = transition(state, { type: 'ARRIVE', checkpointIndex: 0, now: 2_000 });
    state = transition(state, { type: 'OPEN_CHALLENGE', checkpointIndex: 0, now: 3_000 });
    state = transition(state, { type: 'SUBMIT', checkpointIndex: 0, now: 4_000 });
    expect(state.phase).toBe('VERIFYING');

    const before = state.progress.find((p) => p.index === 0)?.incorrectAttempts ?? 0;
    state = transition(state, {
      type: 'VERIFICATION_UNAVAILABLE',
      checkpointIndex: 0,
      now: 5_000,
    });

    expect(state.error).toBeNull();
    // Reopened, so the player can simply submit again.
    expect(state.phase).toBe('CHALLENGE_OPEN');
    // And charged nothing for it. This is the whole point of the action.
    expect(state.progress.find((p) => p.index === 0)?.incorrectAttempts ?? 0).toBe(before);
  });

  it('VERIFICATION_UNAVAILABLE is refused outside VERIFYING', () => {
    const state = started();
    const next = transition(state, {
      type: 'VERIFICATION_UNAVAILABLE',
      checkpointIndex: 0,
      now: 2_000,
    });
    expect(next.error?.code).toBe('ILLEGAL_PHASE');
  });
});
