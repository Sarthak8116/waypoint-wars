/**
 * One sample event per `HudEvent` variant.
 *
 * The catalog is typed as a mapped type over `HudEventType`, so it is
 * impossible to add a variant to `GameEvent` in @ww/shared without this file
 * failing to compile. That is what keeps both promises honest at once:
 *   - the mock harness really does have a button for every event type
 *   - the exhaustiveness tests really do exercise every variant
 *
 * Phaser-free and DOM-free: imported by the tests as well as the mock page.
 */

import type { LeaderboardEntry } from '@ww/shared';
import type { HudEventOf, HudEventType } from '../events.js';

/** The harness's own scratch state. The HUD has none; this stands in for React. */
export interface MockState {
  xpTotal: number;
  secondsRemaining: number;
  completed: number;
  total: number;
  hintsUsed: number;
  incorrectAttempts: number;
  opponentIndex: number;
}

export function createMockState(): MockState {
  return {
    xpTotal: 0,
    secondsRemaining: 45 * 60,
    completed: 0,
    total: 5,
    hintsUsed: 0,
    incorrectAttempts: 0,
    opponentIndex: 0,
  };
}

export interface EventSample<K extends HudEventType> {
  label: string;
  /** May advance the harness's own state; returns the event to emit. */
  make(state: MockState): HudEventOf<K>;
}

export type EventCatalog = { [K in HudEventType]: EventSample<K> };

export const LEADERBOARD: LeaderboardEntry[] = [
  {
    rank: 1,
    playerId: 'p1',
    displayName: 'You',
    isTeam: false,
    xp: 640,
    checkpointsCompleted: 5,
    totalCheckpoints: 5,
    hintsUsed: 1,
    finished: true,
  },
  {
    rank: 2,
    playerId: 'p2',
    displayName: 'Riverbend',
    isTeam: false,
    xp: 585,
    checkpointsCompleted: 5,
    totalCheckpoints: 5,
    hintsUsed: 0,
    finished: true,
  },
  {
    rank: 3,
    playerId: 'p3',
    displayName: 'Blockhouse Crew',
    isTeam: true,
    xp: 430,
    checkpointsCompleted: 4,
    totalCheckpoints: 5,
    hintsUsed: 2,
    finished: false,
  },
];

export const EVENT_CATALOG: EventCatalog = {
  PLAYER_ARRIVED: {
    label: 'Player arrived',
    make: (s) => ({ type: 'PLAYER_ARRIVED', checkpointId: `cp-${s.completed + 1}`, index: s.completed }),
  },
  VERIFICATION_STARTED: {
    label: 'Verification started',
    make: (s) => ({ type: 'VERIFICATION_STARTED', checkpointId: `cp-${s.completed + 1}` }),
  },
  SUBMISSION_APPROVED: {
    label: 'Submission approved',
    make: (s) => ({ type: 'SUBMISSION_APPROVED', checkpointId: `cp-${s.completed + 1}`, xpAwarded: 150 }),
  },
  SUBMISSION_REJECTED: {
    label: 'Submission rejected',
    make: (s) => {
      s.incorrectAttempts += 1;
      return {
        type: 'SUBMISSION_REJECTED',
        checkpointId: `cp-${s.completed + 1}`,
        reason: "That's the Burke Building, not the Blockhouse",
      };
    },
  },
  XP_AWARDED: {
    label: 'XP awarded (+150)',
    make: (s) => {
      s.xpTotal += 150;
      return { type: 'XP_AWARDED', amount: 150, total: s.xpTotal, label: 'checkpoint' };
    },
  },
  HINT_USED: {
    label: 'Hint used (-20)',
    make: (s) => {
      s.hintsUsed += 1;
      s.xpTotal -= 20;
      return { type: 'HINT_USED', checkpointId: `cp-${s.completed + 1}`, xpDelta: -20 };
    },
  },
  OPPONENT_PROGRESS: {
    label: 'Opponent progress',
    make: (s) => {
      s.opponentIndex = Math.min(s.opponentIndex + 1, s.total);
      return {
        type: 'OPPONENT_PROGRESS',
        playerId: 'p2',
        name: 'Riverbend',
        checkpointIndex: s.opponentIndex,
      };
    },
  },
  TIMER_TICK: {
    label: 'Timer tick (-60s)',
    make: (s) => {
      s.secondsRemaining = Math.max(0, s.secondsRemaining - 60);
      return { type: 'TIMER_TICK', secondsRemaining: s.secondsRemaining };
    },
  },
  PROGRESS_UPDATE: {
    label: 'Checkpoint completed',
    make: (s) => {
      s.completed = Math.min(s.completed + 1, s.total);
      return { type: 'PROGRESS_UPDATE', completed: s.completed, total: s.total };
    },
  },
  HUNT_FINISHED: {
    label: 'Hunt finished',
    make: () => ({ type: 'HUNT_FINISHED', entries: LEADERBOARD }),
  },
  HUD_RESYNC: {
    label: 'Resync (remount recovery)',
    make: (s) => ({
      type: 'HUD_RESYNC',
      snapshot: {
        xpTotal: s.xpTotal,
        secondsRemaining: s.secondsRemaining,
        completed: s.completed,
        total: s.total,
        verification: 'idle',
        opponents: [{ playerId: 'p2', name: 'Riverbend', checkpointIndex: s.opponentIndex }],
        hintsUsed: s.hintsUsed,
        incorrectAttempts: s.incorrectAttempts,
      },
    }),
  },
};

/** Every event type, in the order the mock page renders its buttons. */
export const EVENT_TYPES = Object.keys(EVENT_CATALOG) as HudEventType[];

/** One instance of every variant. Used by the exhaustiveness tests. */
export function allSampleEvents(state: MockState = createMockState()) {
  return EVENT_TYPES.map((type) => EVENT_CATALOG[type].make(state));
}
