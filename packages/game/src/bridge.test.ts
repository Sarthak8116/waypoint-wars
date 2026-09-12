import { describe, expect, it, vi } from 'vitest';
import { GameBridge } from './bridge.js';
import type { HudEvent } from './events.js';

const XP: HudEvent = { type: 'XP_AWARDED', amount: 150, total: 150, label: 'checkpoint' };
const TICK: HudEvent = { type: 'TIMER_TICK', secondsRemaining: 120 };

function ready(): GameBridge {
  const bridge = new GameBridge();
  bridge.setReady(true);
  return bridge;
}

describe('typed dispatch', () => {
  it('narrows the handler to the requested variant', () => {
    const bridge = ready();
    const seen: number[] = [];

    // Compile-time proof of narrowing: `event` is the XP_AWARDED variant, so
    // `event.amount` exists. It would not on the full union.
    bridge.on('XP_AWARDED', (event) => {
      const amount: number = event.amount;
      const total: number = event.total;
      const label: string | undefined = event.label;
      expect(label).toBe('checkpoint');
      seen.push(amount + total);
    });

    bridge.emit(XP);
    expect(seen).toEqual([300]);
  });

  it('delivers only to the matching type', () => {
    const bridge = ready();
    const xp = vi.fn();
    const tick = vi.fn();
    bridge.on('XP_AWARDED', xp);
    bridge.on('TIMER_TICK', tick);

    bridge.emit(XP);
    expect(xp).toHaveBeenCalledTimes(1);
    expect(tick).not.toHaveBeenCalled();

    bridge.emit(TICK);
    expect(tick).toHaveBeenCalledWith(TICK);
  });

  it('feeds onAny every event, in order', () => {
    const bridge = ready();
    const seen: string[] = [];
    bridge.onAny((event) => seen.push(event.type));
    bridge.emit(XP);
    bridge.emit(TICK);
    expect(seen).toEqual(['XP_AWARDED', 'TIMER_TICK']);
  });

  it('keeps the rest of the HUD alive when one handler throws', () => {
    const bridge = ready();
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const second = vi.fn();
    bridge.on('XP_AWARDED', () => {
      throw new Error('bad tween');
    });
    bridge.on('XP_AWARDED', second);

    expect(() => bridge.emit(XP)).not.toThrow();
    expect(second).toHaveBeenCalledTimes(1);
    errors.mockRestore();
  });

  it('tolerates a handler unsubscribing itself mid-dispatch', () => {
    const bridge = ready();
    const other = vi.fn();
    const off = bridge.on('XP_AWARDED', () => off());
    bridge.on('XP_AWARDED', other);
    expect(() => bridge.emit(XP)).not.toThrow();
    expect(other).toHaveBeenCalledTimes(1);
  });
});

describe('events emitted before the scene is ready', () => {
  // Phaser boots asynchronously. Without this queue the FIRST XP award of the
  // game is silently dropped, which is exactly the award a demo audience sees.
  it('queues instead of dropping, and flushes in order', () => {
    const bridge = new GameBridge();
    const seen: HudEvent[] = [];
    bridge.onAny((event) => seen.push(event));

    bridge.emit(XP);
    bridge.emit(TICK);
    expect(seen).toEqual([]);
    expect(bridge.queuedCount).toBe(2);

    bridge.setReady(true);
    expect(seen).toEqual([XP, TICK]);
    expect(bridge.queuedCount).toBe(0);
  });

  it('flushes exactly once — not duplicated by a second setReady', () => {
    const bridge = new GameBridge();
    const seen: HudEvent[] = [];
    bridge.onAny((event) => seen.push(event));

    bridge.emit(XP);
    bridge.setReady(true);
    bridge.setReady(true);
    expect(seen).toEqual([XP]);
  });

  it('passes through directly once ready', () => {
    const bridge = new GameBridge();
    const seen: HudEvent[] = [];
    bridge.onAny((event) => seen.push(event));
    bridge.setReady(true);
    bridge.emit(XP);
    expect(seen).toEqual([XP]);
    expect(bridge.queuedCount).toBe(0);
  });

  it('re-arms buffering when the scene shuts down, losing nothing across a remount', () => {
    const bridge = new GameBridge();
    const seen: HudEvent[] = [];
    const off = bridge.onAny((event) => seen.push(event));

    bridge.setReady(true);
    bridge.emit(XP);
    off();
    bridge.setReady(false); // scene shutdown

    bridge.emit(TICK); // arrives while no scene exists
    expect(seen).toEqual([XP]);

    bridge.onAny((event) => seen.push(event)); // scene 2 subscribes
    bridge.setReady(true);
    expect(seen).toEqual([XP, TICK]);
  });

  it('does not let a handler that emits during the flush re-queue', () => {
    const bridge = new GameBridge();
    const seen: string[] = [];
    bridge.onAny((event) => {
      seen.push(event.type);
      if (event.type === 'XP_AWARDED') bridge.emit(TICK);
    });
    bridge.emit(XP);
    bridge.setReady(true);
    expect(seen).toEqual(['XP_AWARDED', 'TIMER_TICK']);
    expect(bridge.queuedCount).toBe(0);
  });

  it('caps the buffer so a scene that never boots cannot grow it forever', () => {
    const bridge = new GameBridge();
    for (let i = 0; i < 400; i += 1) {
      bridge.emit({ type: 'TIMER_TICK', secondsRemaining: i });
    }
    expect(bridge.queuedCount).toBeLessThanOrEqual(256);
  });
});

describe('destroy', () => {
  it('removes every handler', () => {
    const bridge = ready();
    bridge.on('XP_AWARDED', vi.fn());
    bridge.onAny(vi.fn());
    expect(bridge.listenerCount()).toBe(2);

    bridge.destroy();
    expect(bridge.listenerCount()).toBe(0);
    expect(bridge.destroyed).toBe(true);
  });

  it('makes emit a silent no-op afterwards', () => {
    const bridge = ready();
    const handler = vi.fn();
    bridge.onAny(handler);
    bridge.destroy();

    expect(() => bridge.emit(XP)).not.toThrow();
    expect(handler).not.toHaveBeenCalled();
    expect(bridge.queuedCount).toBe(0);
  });

  it('is idempotent, as a React cleanup that runs twice requires', () => {
    const bridge = ready();
    bridge.destroy();
    expect(() => bridge.destroy()).not.toThrow();
  });

  it('ignores subscriptions made after destroy', () => {
    const bridge = ready();
    bridge.destroy();
    const handler = vi.fn();
    const off = bridge.on('XP_AWARDED', handler);
    bridge.onAny(handler);
    expect(bridge.listenerCount()).toBe(0);
    expect(() => off()).not.toThrow();
  });
});

describe('React StrictMode double mounting', () => {
  // Each "mount" subscribes the way HudScene.create does and unsubscribes the
  // way its shutdown handler does.
  function mountScene(bridge: GameBridge, sink: string[]): () => void {
    const off = bridge.onAny((event) => sink.push(event.type));
    bridge.setReady(true);
    return () => {
      off();
      bridge.setReady(false);
    };
  }

  it('leaks no listeners across repeated mount/destroy cycles', () => {
    const bridge = new GameBridge();
    const sink: string[] = [];
    for (let i = 0; i < 5; i += 1) {
      const unmount = mountScene(bridge, sink);
      unmount();
      expect(bridge.listenerCount()).toBe(0);
    }
  });

  it('does not double-fire animations when mounted twice in a row', () => {
    const bridge = new GameBridge();
    const sink: string[] = [];

    const unmountFirst = mountScene(bridge, sink); // StrictMode mount #1
    unmountFirst(); //                                StrictMode cleanup
    mountScene(bridge, sink); //                      StrictMode mount #2

    bridge.emit(XP);
    expect(sink).toEqual(['XP_AWARDED']);
  });
});
