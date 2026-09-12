/**
 * @ww/game — the Phaser HUD overlay.
 *
 * ============================================================================
 * THIS BARREL IS SSR-SAFE. KEEP IT THAT WAY.
 * ============================================================================
 * Nothing exported here imports Phaser or touches `window`, so a Next.js server
 * component, a route handler, or a Node test can import `@ww/game` freely.
 * Everything that needs a browser lives behind `loadMountGame()` or the
 * `@ww/game/mount` subpath, both of which must be reached from a client
 * component inside an effect.
 *
 * Do NOT add `export * from './mount.js'`, './HudScene.js' or './ResultsScene.js'
 * here. A static re-export would pull Phaser into the server bundle and the
 * first server render would die on `window is not defined`.
 * ============================================================================
 *
 * PHASER HOLDS NO GAME STATE: the HUD renders `GameEvent`s and animates. If the
 * Phaser instance were destroyed and recreated mid-hunt, nothing would be lost.
 */

// --- The bridge: pure TypeScript, safe everywhere -------------------------
export { GameBridge } from './bridge.js';
export type { GameEventHandler, AnyEventHandler, Unsubscribe } from './bridge.js';

// --- Event contract -------------------------------------------------------
export { assertNever, EMPTY_SNAPSHOT } from './events.js';
export type {
  GameEvent,
  HudEvent,
  HudEventOf,
  HudEventType,
  HudSnapshot,
  LocalHudEvent,
  OpponentProgress,
  VerificationStatus,
} from './events.js';

// --- Pure display helpers (no Phaser, no DOM) -----------------------------
export {
  applyEvent,
  emptySnapshot,
  formatCountdown,
  formatXp,
  isTimerWarning,
  TIMER_WARNING_SECONDS,
} from './hudModel.js';

// --- Animation constants --------------------------------------------------
// `animations.ts` imports Phaser for TYPES ONLY, so it erases to nothing at
// runtime and is safe to pull into the server bundle.
export { ANIMATION_DURATIONS, MAX_ANIMATION_MS, leaderboardStagger } from './animations.js';
export type { AnimationName } from './animations.js';

// --- Mount surface: types here, implementation behind a dynamic import ----
export { HitRegionRegistry } from './types.js';
export type { GameHandle, HitRegion, MountOptions, ResultsSummary } from './types.js';

/**
 * Browser-only entry point. Call this from a client component's effect:
 *
 *   const mountGame = await loadMountGame();
 *   const handle = mountGame(containerRef.current, { bridge });
 *
 * The `import()` is never evaluated on the server, so Phaser stays out of the
 * server bundle.
 */
export async function loadMountGame(): Promise<typeof import('./mount.js').mountGame> {
  if (typeof window === 'undefined') {
    throw new Error('[ww:game] loadMountGame is browser-only. Call it inside a client effect.');
  }
  const mod = await import('./mount.js');
  return mod.mountGame;
}
