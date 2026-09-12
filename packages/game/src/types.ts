/**
 * Public types for mounting the HUD.
 *
 * Deliberately Phaser-free so `@ww/game`'s barrel can be imported from a
 * Next.js server component without dragging `window` into Node.
 */

import type { LeaderboardEntry } from '@ww/shared';
import type { GameBridge } from './bridge.js';

/**
 * Facts about the finished run that the HUD could not have observed.
 *
 * PHASER HOLDS NO GAME STATE: these numbers come from the server via React.
 * The HUD keeps display tallies of hints and rejections only as a fallback for
 * the mock harness; whatever is supplied here wins.
 */
export interface ResultsSummary {
  /** Which leaderboard entry is "you". Without it the results panel shows rank only. */
  selfPlayerId?: string;
  /** Wall-clock duration of the run, from the server's start time. */
  elapsedSeconds?: number;
  hintsUsed?: number;
  incorrectAttempts?: number;
  /** Achievement badge labels, already decided by the server. */
  achievements?: string[];
}

export interface MountOptions {
  /**
   * Reuse an existing bridge (e.g. one owned by a React context so events
   * emitted between unmount and remount are not lost). When omitted, `mountGame`
   * creates one and destroys it with the handle.
   */
  bridge?: GameBridge;
  /** Number of checkpoint pips to draw before the first PROGRESS_UPDATE lands. */
  totalCheckpoints?: number;
  selfPlayerId?: string;
  /**
   * Fired when the player taps the hint button. The SCENE DOES NOT DECIDE THE
   * XP COST — it asks, React asks the server, and the resulting `HINT_USED`
   * event comes back through the bridge.
   */
  onHintRequested?: () => void;
  /**
   * Fired by the results scene's "view route replay" button. MapLibre owns the
   * replay; this scene only triggers it.
   */
  onReplayRequested?: () => void;
  /** Fired when the player closes the results panel. */
  onResultsDismissed?: () => void;
  /** Label under the hint button, e.g. "-20 XP". Supplied, never computed here. */
  hintCostLabel?: string;
  /** Hide the hint button entirely (room setting `hintsEnabled: false`). */
  hintsEnabled?: boolean;
}

export interface GameHandle {
  /** The event bridge feeding the scenes. */
  readonly bridge: GameBridge;
  /** Bring up the end-of-hunt scene. Idempotent. */
  showResults(entries: LeaderboardEntry[], summary?: ResultsSummary): void;
  /** Tear down Phaser. Safe to call more than once (React StrictMode). */
  destroy(): void;
  readonly destroyed: boolean;
}

/** A rectangle, in CSS pixels relative to the canvas, that should catch taps. */
export interface HitRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Shared between the scenes and the pointer pass-through shim. The canvas sits
 * on top of MapLibre, so it must not swallow drags; only these rectangles do.
 * Keyed by scene so the results panel's button does not clobber the HUD's.
 */
export class HitRegionRegistry {
  private readonly byOwner = new Map<string, HitRegion[]>();

  set(owner: string, regions: HitRegion[]): void {
    this.byOwner.set(owner, regions);
  }

  clear(owner: string): void {
    this.byOwner.delete(owner);
  }

  all(): HitRegion[] {
    return [...this.byOwner.values()].flat();
  }
}
