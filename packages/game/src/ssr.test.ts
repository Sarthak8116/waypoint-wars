import { describe, expect, it } from 'vitest';

/**
 * Runs in vitest's default Node environment: there is no `window` here, which
 * is exactly the situation a Next.js server render is in.
 *
 * Phaser dereferences `window` the moment it is evaluated, so if the barrel
 * ever grows a static `export * from './mount.js'` these tests fail instead of
 * the first server render in production.
 */
describe('the package barrel is SSR-safe', () => {
  it('has no window to begin with', () => {
    expect(typeof window).toBe('undefined');
  });

  it('imports cleanly with no DOM', async () => {
    const mod = await import('./index.js');
    expect(typeof mod.GameBridge).toBe('function');
    expect(mod.ANIMATION_DURATIONS.XP_FLY).toBeGreaterThan(0);
    expect(typeof mod.applyEvent).toBe('function');
  });

  it('never pulls Phaser into the server bundle', async () => {
    await import('./index.js');
    // Phaser assigns `global.Phaser` on evaluation. Its absence proves the
    // barrel did not reach `mount.ts`, `HudScene.ts` or `ResultsScene.ts`.
    expect((globalThis as { Phaser?: unknown }).Phaser).toBeUndefined();
  });

  it('refuses to load the mount path on the server, with a usable message', async () => {
    const { loadMountGame } = await import('./index.js');
    await expect(loadMountGame()).rejects.toThrow(/browser-only/);
    expect((globalThis as { Phaser?: unknown }).Phaser).toBeUndefined();
  });

  it('exposes a working bridge without a DOM, so React can emit before mount', async () => {
    const { GameBridge } = await import('./index.js');
    const bridge = new GameBridge();
    const seen: string[] = [];
    bridge.onAny((event) => seen.push(event.type));
    bridge.emit({ type: 'XP_AWARDED', amount: 10, total: 10 });
    bridge.setReady(true);
    expect(seen).toEqual(['XP_AWARDED']);
    bridge.destroy();
  });
});
