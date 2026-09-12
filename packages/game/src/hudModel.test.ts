import { describe, expect, it } from 'vitest';
import type { GameEvent } from '@ww/shared';
import { applyEvent, emptySnapshot, formatCountdown, formatXp, isTimerWarning } from './hudModel.js';
import type { HudEvent, HudEventOf, HudEventType, HudSnapshot } from './events.js';
import { EVENT_CATALOG, EVENT_TYPES, LEADERBOARD, createMockState } from './mock/fixtures.js';

// ---------------------------------------------------------------------------
// Compile-time contract
// ---------------------------------------------------------------------------

/** Fails to compile if `A` is not assignable to `B`. */
type Assignable<A extends B, B> = true;

// Every GameEvent from @ww/shared is a HudEvent. Combined with the
// `const _never: never = event` at the bottom of the switches in hudModel.ts and
// HudScene.ts — which the compiler enforces over the whole HudEvent union —
// this proves both switches are exhaustive over GameEvent. Adding a variant in
// @ww/shared fails `pnpm typecheck`, not silently at runtime.
type _GameEventIsHudEvent = Assignable<GameEvent, HudEvent>;
type _NoGameEventTypeEscapes = Assignable<Exclude<GameEvent['type'], HudEventType>, never>;

// The narrowing the bridge promises: `HudEventOf<'XP_AWARDED'>` really is the
// single variant, not the union.
type _Narrowed = Assignable<HudEventOf<'XP_AWARDED'>, { type: 'XP_AWARDED'; total: number }>;

// Touch the aliases so `noUnusedLocals`-style tooling sees them used.
const _contract: [_GameEventIsHudEvent, _NoGameEventTypeEscapes, _Narrowed] = [true, true, true];

// ---------------------------------------------------------------------------
// Runtime exhaustiveness
// ---------------------------------------------------------------------------

describe('applyEvent is exhaustive over HudEvent', () => {
  it('handles one instance of every variant without hitting assertNever', () => {
    const state = createMockState();
    let view = emptySnapshot();
    for (const type of EVENT_TYPES) {
      const event = EVENT_CATALOG[type].make(state);
      expect(() => {
        view = applyEvent(view, event);
      }, `unhandled variant: ${type}`).not.toThrow();
    }
    expect(EVENT_TYPES.length).toBeGreaterThanOrEqual(9);
  });

  it('throws loudly if an unknown variant ever reaches it', () => {
    const rogue = { type: 'NOT_A_REAL_EVENT' } as unknown as HudEvent;
    expect(() => applyEvent(emptySnapshot(), rogue)).toThrow(/unhandled event/);
  });
});

// ---------------------------------------------------------------------------
// The no-state rule
// ---------------------------------------------------------------------------

describe('the incoming event is always authoritative', () => {
  it('assigns XP_AWARDED.total rather than accumulating amount', () => {
    const view = applyEvent(emptySnapshot(), { type: 'XP_AWARDED', amount: 150, total: 150 });
    // A server correction arrives: total disagrees with amount. The event wins.
    const corrected = applyEvent(view, { type: 'XP_AWARDED', amount: 150, total: 275 });
    expect(corrected.xpTotal).toBe(275);
  });

  it('renders the timer it is given and never decides that time is up', () => {
    const view = applyEvent(emptySnapshot(), { type: 'TIMER_TICK', secondsRemaining: 90 });
    expect(view.secondsRemaining).toBe(90);
    // Going back up (a reconnect resync) is accepted without argument.
    expect(applyEvent(view, { type: 'TIMER_TICK', secondsRemaining: 600 }).secondsRemaining).toBe(600);
  });

  it('snaps everything into line on HUD_RESYNC', () => {
    const drifted: HudSnapshot = {
      ...emptySnapshot(),
      xpTotal: 999,
      completed: 4,
      verification: 'rejected',
      opponents: [{ playerId: 'ghost', name: 'Ghost', checkpointIndex: 9 }],
    };
    const snapshot: HudSnapshot = {
      xpTotal: 275,
      secondsRemaining: 1200,
      completed: 2,
      total: 5,
      verification: 'idle',
      opponents: [{ playerId: 'p2', name: 'Riverbend', checkpointIndex: 1 }],
      hintsUsed: 1,
      incorrectAttempts: 0,
    };
    expect(applyEvent(drifted, { type: 'HUD_RESYNC', snapshot })).toEqual(snapshot);
  });

  it('never mutates the snapshot it was given', () => {
    const before = emptySnapshot();
    const frozen = JSON.stringify(before);
    applyEvent(before, { type: 'PROGRESS_UPDATE', completed: 3, total: 5 });
    expect(JSON.stringify(before)).toBe(frozen);
  });
});

describe('verification status', () => {
  const statuses = (events: GameEvent[]): string[] => {
    let view = emptySnapshot();
    return events.map((event) => {
      view = applyEvent(view, event);
      return view.verification;
    });
  };

  it('walks idle -> verifying -> approved', () => {
    let view = applyEvent(emptySnapshot(), { type: 'PLAYER_ARRIVED', checkpointId: 'c1', index: 0 });
    expect(view.verification).toBe('idle');
    view = applyEvent(view, { type: 'VERIFICATION_STARTED', checkpointId: 'c1' });
    expect(view.verification).toBe('verifying');
    view = applyEvent(view, { type: 'SUBMISSION_APPROVED', checkpointId: 'c1', xpAwarded: 150 });
    expect(view.verification).toBe('approved');
  });

  it('resets to idle on arrival at the next checkpoint', () => {
    expect(
      statuses([
        { type: 'SUBMISSION_REJECTED', checkpointId: 'c1', reason: 'nope' },
        { type: 'PLAYER_ARRIVED', checkpointId: 'c2', index: 1 },
      ]),
    ).toEqual(['rejected', 'idle']);
  });
});

describe('opponent rows', () => {
  it('keeps one row per opponent, last write wins', () => {
    let view = emptySnapshot();
    view = applyEvent(view, { type: 'OPPONENT_PROGRESS', playerId: 'p2', name: 'A', checkpointIndex: 0 });
    view = applyEvent(view, { type: 'OPPONENT_PROGRESS', playerId: 'p3', name: 'B', checkpointIndex: 1 });
    view = applyEvent(view, { type: 'OPPONENT_PROGRESS', playerId: 'p2', name: 'A', checkpointIndex: 2 });
    expect(view.opponents).toEqual([
      { playerId: 'p2', name: 'A', checkpointIndex: 2 },
      { playerId: 'p3', name: 'B', checkpointIndex: 1 },
    ]);
  });
});

describe('formatting', () => {
  it('renders mm:ss and never counts past zero', () => {
    expect(formatCountdown(0)).toBe('00:00');
    expect(formatCountdown(59)).toBe('00:59');
    expect(formatCountdown(600)).toBe('10:00');
    expect(formatCountdown(-30)).toBe('00:00');
  });

  it('turns the timer to warning under five minutes', () => {
    expect(isTimerWarning(301)).toBe(false);
    expect(isTimerWarning(300)).toBe(true);
    expect(isTimerWarning(0)).toBe(true);
  });

  it('groups the XP figure', () => {
    expect(formatXp(0)).toBe('0 XP');
    expect(formatXp(1234)).toBe('1,234 XP');
  });
});

describe('fixtures', () => {
  it('covers every event type, which is what makes the mock page complete', () => {
    expect(_contract).toEqual([true, true, true]);
    const keys = new Set<HudEventType>(EVENT_TYPES);
    expect(keys.size).toBe(EVENT_TYPES.length);
    expect(keys.has('HUNT_FINISHED')).toBe(true);
    expect(LEADERBOARD.length).toBeGreaterThan(1);
  });
});
