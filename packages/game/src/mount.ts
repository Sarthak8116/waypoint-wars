/**
 * Mounts the Phaser HUD over the map.
 *
 * ============================================================================
 * SSR WARNING — READ BEFORE IMPORTING THIS FILE.
 * ============================================================================
 * This module imports Phaser at module scope, and Phaser touches `window` the
 * moment it is evaluated. Importing it from a Next.js server component, a route
 * handler, or any module that a server component pulls in will crash the render
 * with `window is not defined`.
 *
 * Import it CLIENT-SIDE ONLY, and dynamically:
 *
 *   'use client';
 *   useEffect(() => {
 *     let handle: GameHandle | undefined;
 *     let cancelled = false;
 *     import('@ww/game/mount').then(({ mountGame }) => {
 *       if (cancelled) return;
 *       handle = mountGame(ref.current!, { bridge, onHintRequested });
 *     });
 *     return () => { cancelled = true; handle?.destroy(); };
 *   }, []);
 *
 * The package barrel (`@ww/game`) is safe to import anywhere: it exports types
 * and the Phaser-free bridge, and reaches this module only through the async
 * `loadMountGame()` helper.
 * ============================================================================
 *
 * PHASER HOLDS NO GAME STATE. `mountGame` builds a renderer and hands back a
 * handle. Destroy and remount it as often as React likes: as long as the same
 * `GameBridge` is reused (or one `HUD_RESYNC` is replayed), nothing is lost.
 */

// Phaser 3.90's ESM build has NO default export (only named ones), while its
// .d.ts declares one — so a default import typechecks but is undefined at
// runtime under webpack/Vite. A namespace import is correct for both.
import * as Phaser from 'phaser';
import type { LeaderboardEntry } from '@ww/shared';
import { GameBridge } from './bridge.js';
import { HudScene, HUD_SCENE_KEY } from './HudScene.js';
import { ResultsScene, RESULTS_SCENE_KEY, type ResultsSceneData } from './ResultsScene.js';
import { installPointerPassthrough, type PointerPassthrough } from './pointerPassthrough.js';
import { HitRegionRegistry, type GameHandle, type MountOptions, type ResultsSummary } from './types.js';

export { HUD_SCENE_KEY, RESULTS_SCENE_KEY };

/**
 * Create the transparent overlay inside `container`.
 *
 * `container` should be a positioned element stacked above the MapLibre canvas.
 * The overlay is `pointer-events: none` except over registered buttons, so the
 * map keeps its pans and pinches.
 */
export function mountGame(container: HTMLElement, opts: MountOptions = {}): GameHandle {
  if (typeof window === 'undefined') {
    throw new Error('[ww:game] mountGame requires a browser. Import it client-side only.');
  }

  const ownsBridge = opts.bridge === undefined;
  const bridge = opts.bridge ?? new GameBridge();
  const hitRegions = new HitRegionRegistry();

  const hud = new HudScene({
    bridge,
    hitRegions,
    totalCheckpoints: opts.totalCheckpoints,
    hintsEnabled: opts.hintsEnabled,
    hintCostLabel: opts.hintCostLabel,
    onHintRequested: opts.onHintRequested,
  });

  const results = new ResultsScene({
    hitRegions,
    onReplayRequested: opts.onReplayRequested,
    onDismissed: opts.onResultsDismissed,
  });

  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: container,
    transparent: true,
    scale: {
      mode: Phaser.Scale.RESIZE,
      autoCenter: Phaser.Scale.NO_CENTER,
      width: '100%',
      height: '100%',
    },
    audio: { noAudio: true },
    banner: false,
    scene: [hud, results],
  });

  let passthrough: PointerPassthrough | undefined;
  game.events.once(Phaser.Core.Events.READY, () => {
    if (game.canvas) passthrough = installPointerPassthrough(game.canvas, hitRegions);
  });

  let destroyed = false;

  return {
    bridge,

    showResults(entries: LeaderboardEntry[], summary: ResultsSummary = {}): void {
      if (destroyed) return;
      const data: ResultsSceneData = { entries, summary: { ...summary, ...selfIdFrom(opts) } };
      const manager = game.scene;
      if (manager.isActive(RESULTS_SCENE_KEY)) manager.stop(RESULTS_SCENE_KEY);
      manager.start(RESULTS_SCENE_KEY, data);
    },

    destroy(): void {
      if (destroyed) return;
      destroyed = true;
      passthrough?.destroy();
      passthrough = undefined;
      // Scene shutdown already calls bridge.setReady(false), so events emitted
      // between this unmount and the next mount are buffered, not dropped.
      game.destroy(true, false);
      if (ownsBridge) bridge.destroy();
    },

    get destroyed(): boolean {
      return destroyed;
    },
  };
}

function selfIdFrom(opts: MountOptions): { selfPlayerId?: string } {
  return opts.selfPlayerId === undefined ? {} : { selfPlayerId: opts.selfPlayerId };
}
