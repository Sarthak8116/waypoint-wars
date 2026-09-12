/**
 * HUD event contract for the Phaser presentation layer.
 *
 * ============================================================================
 * THE RULE: PHASER HOLDS NO GAME STATE.
 * ============================================================================
 * Every value rendered by this package arrives inside an event. The HUD never
 * derives, accumulates, or decides anything authoritative. If the Phaser
 * instance were destroyed and recreated mid-hunt, nothing would be lost: React
 * replays a single `HUD_RESYNC` and the overlay is whole again.
 *
 * A scene MAY cache a display value purely to animate a transition (tweening
 * the XP number from the old figure to the new one). That cache is never the
 * source of truth — the incoming event always wins, and `HUD_RESYNC` snaps
 * every cached value into line without animation.
 * ============================================================================
 *
 * `GameEvent` (from @ww/shared) is the inbound contract. Two presentation-only
 * events are added locally because they carry no game state and therefore do
 * not belong in the cross-process wire protocol:
 *
 *   VERIFICATION_STARTED — "the spinner should start now". The server does not
 *                          need to know the HUD spins.
 *   HUD_RESYNC           — a full display snapshot, replayed after a remount.
 *
 * If these ever need to cross a process boundary they should move into
 * @ww/shared. They do not today.
 */

import type { GameEvent, LeaderboardEntry } from '@ww/shared';

export type { GameEvent, LeaderboardEntry };

/** Where the current submission stands. Purely a rendering state. */
export type VerificationStatus = 'idle' | 'verifying' | 'approved' | 'rejected';

/** One opponent's last-broadcast progress. Coarse by design — see ARCHITECTURE.md. */
export interface OpponentProgress {
  playerId: string;
  name: string;
  checkpointIndex: number;
}

/**
 * A complete description of what the HUD should be showing right now.
 * Produced by React (which talks to the authoritative server), consumed by
 * Phaser. This is what makes the overlay disposable.
 */
export interface HudSnapshot {
  xpTotal: number;
  secondsRemaining: number;
  completed: number;
  total: number;
  verification: VerificationStatus;
  opponents: OpponentProgress[];
  hintsUsed: number;
  incorrectAttempts: number;
}

/** Presentation-only events that never cross a process boundary. */
export type LocalHudEvent =
  | { type: 'VERIFICATION_STARTED'; checkpointId: string }
  | { type: 'HUD_RESYNC'; snapshot: HudSnapshot };

/** Everything the bridge can carry. A strict superset of `GameEvent`. */
export type HudEvent = GameEvent | LocalHudEvent;

export type HudEventType = HudEvent['type'];

/** Narrows the union to the single variant named by `T`. */
export type HudEventOf<T extends HudEventType> = Extract<HudEvent, { type: T }>;

/**
 * Call in the `default:` arm of a switch over `HudEvent`. Adding a variant to
 * `GameEvent` then fails `pnpm typecheck` instead of silently doing nothing.
 */
export function assertNever(event: never, context: string): never {
  throw new Error(`${context}: unhandled event ${JSON.stringify(event)}`);
}

export const EMPTY_SNAPSHOT: HudSnapshot = {
  xpTotal: 0,
  secondsRemaining: 0,
  completed: 0,
  total: 0,
  verification: 'idle',
  opponents: [],
  hintsUsed: 0,
  incorrectAttempts: 0,
};
