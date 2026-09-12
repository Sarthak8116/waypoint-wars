/**
 * The HUD's *display* projection.
 *
 * PHASER HOLDS NO GAME STATE. Read that literally when reading this file:
 * `HudSnapshot` is not the game's state, it is a description of what pixels
 * should currently be on screen. Every field is written directly from the
 * authoritative value carried by the incoming event — the HUD never adds,
 * subtracts, or times anything itself:
 *
 *   XP_AWARDED       carries `total`          -> we assign, never accumulate
 *   PROGRESS_UPDATE  carries `completed/total`-> we assign
 *   TIMER_TICK       carries `secondsRemaining` -> we assign; the HUD never
 *                    decides that time is up, it only renders the number
 *   HUD_RESYNC       replaces the snapshot wholesale
 *
 * The two counters that look like accumulation (`hintsUsed`,
 * `incorrectAttempts`) are display tallies for the results panel only. They are
 * overwritten by `HUD_RESYNC` and by the server-supplied results summary, and
 * nothing in the game reads them back.
 *
 * Pure and Phaser-free, which is what makes the exhaustiveness of the event
 * switch unit-testable in Node.
 */

import {
  assertNever,
  EMPTY_SNAPSHOT,
  type HudEvent,
  type HudSnapshot,
  type OpponentProgress,
} from './events.js';

export function emptySnapshot(): HudSnapshot {
  return { ...EMPTY_SNAPSHOT, opponents: [] };
}

/**
 * Fold one event into the display snapshot. Returns a new object; never
 * mutates. Exhaustive over `HudEvent` — a new variant in @ww/shared breaks the
 * typecheck here rather than silently rendering nothing.
 */
export function applyEvent(view: HudSnapshot, event: HudEvent): HudSnapshot {
  switch (event.type) {
    case 'HUD_RESYNC':
      return { ...event.snapshot, opponents: [...event.snapshot.opponents] };

    case 'XP_AWARDED':
      // `total` is authoritative. Deliberately not `view.xpTotal + amount`.
      return { ...view, xpTotal: event.total };

    case 'PROGRESS_UPDATE':
      return { ...view, completed: event.completed, total: event.total };

    case 'TIMER_TICK':
      return { ...view, secondsRemaining: event.secondsRemaining };

    case 'PLAYER_ARRIVED':
      return { ...view, verification: 'idle' };

    case 'VERIFICATION_STARTED':
      return { ...view, verification: 'verifying' };

    case 'SUBMISSION_APPROVED':
      return { ...view, verification: 'approved' };

    case 'SUBMISSION_REJECTED':
      return {
        ...view,
        verification: 'rejected',
        incorrectAttempts: view.incorrectAttempts + 1,
      };

    case 'HINT_USED':
      return { ...view, hintsUsed: view.hintsUsed + 1 };

    case 'OPPONENT_PROGRESS':
      return { ...view, opponents: mergeOpponent(view.opponents, event) };

    case 'HUNT_FINISHED':
      return { ...view, verification: 'idle' };

    default: {
      const _never: never = event;
      return assertNever(_never, 'applyEvent');
    }
  }
}

/** Last-write-wins per opponent, ordered by first appearance for a stable row order. */
function mergeOpponent(
  current: readonly OpponentProgress[],
  event: { playerId: string; name: string; checkpointIndex: number },
): OpponentProgress[] {
  const next: OpponentProgress = {
    playerId: event.playerId,
    name: event.name,
    checkpointIndex: event.checkpointIndex,
  };
  const index = current.findIndex((o) => o.playerId === event.playerId);
  if (index === -1) return [...current, next];
  const copy = [...current];
  copy[index] = next;
  return copy;
}

/** mm:ss. Never negative — a finished clock reads 00:00, it does not count up. */
export function formatCountdown(secondsRemaining: number): string {
  const safe = Math.max(0, Math.floor(secondsRemaining));
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

/** Below this the clock turns warning-coloured. Rendering only; nothing expires here. */
export const TIMER_WARNING_SECONDS = 5 * 60;

export function isTimerWarning(secondsRemaining: number): boolean {
  return secondsRemaining <= TIMER_WARNING_SECONDS;
}

export function formatXp(xp: number): string {
  return `${Math.round(xp).toLocaleString('en-US')} XP`;
}
