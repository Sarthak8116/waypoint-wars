/**
 * The typed React -> Phaser event bridge.
 *
 * PHASER HOLDS NO GAME STATE (see events.ts). The bridge is a transport, not a
 * store: it forwards events and — crucially — holds events that arrive before
 * a scene exists.
 *
 * Why the queue matters: `Phaser.Game` boots asynchronously. React will happily
 * emit `XP_AWARDED` in the same tick it mounts the overlay, several frames
 * before `HudScene.create()` runs. Without a queue that first award is dropped
 * on the floor and the very first XP animation of the game never plays — a bug
 * that only shows up in front of an audience. Events emitted while no scene is
 * listening are buffered and flushed exactly once when the scene reports ready.
 *
 * `destroy()` drops every handler so React StrictMode's double mount/unmount
 * cannot leak listeners or double-fire animations.
 *
 * Runtime-safe in Node/SSR: this module imports no Phaser and touches no DOM.
 */

import type { HudEvent, HudEventOf, HudEventType } from './events.js';

/** A handler narrowed to exactly one variant of the union. */
export type GameEventHandler<T extends HudEventType> = (event: HudEventOf<T>) => void;

/** A handler that sees every event. Used by the scenes themselves. */
export type AnyEventHandler = (event: HudEvent) => void;

/** Returned by `on`/`onAny`; calling it unsubscribes. */
export type Unsubscribe = () => void;

/**
 * Events that are safe to discard if the queue overflows because a newer event
 * fully supersedes them. XP and verdicts are never discarded.
 */
const SUPERSEDABLE: ReadonlySet<HudEventType> = new Set<HudEventType>([
  'TIMER_TICK',
  'OPPONENT_PROGRESS',
  'PROGRESS_UPDATE',
]);

const MAX_QUEUED_EVENTS = 256;

export class GameBridge {
  private readonly typed = new Map<HudEventType, Set<AnyEventHandler>>();
  private readonly any = new Set<AnyEventHandler>();
  private queue: HudEvent[] = [];
  private isReady = false;
  private isDestroyed = false;

  /** True once a scene has reported it can render. */
  get ready(): boolean {
    return this.isReady;
  }

  get destroyed(): boolean {
    return this.isDestroyed;
  }

  /** Number of events waiting for a scene. Test/diagnostic affordance. */
  get queuedCount(): number {
    return this.queue.length;
  }

  /** Total live handlers, or those for one event type. Used to prove no leaks. */
  listenerCount(type?: HudEventType): number {
    if (type) return this.typed.get(type)?.size ?? 0;
    let total = this.any.size;
    for (const set of this.typed.values()) total += set.size;
    return total;
  }

  /**
   * Subscribe to one variant. `on('XP_AWARDED', h)` gives `h` the narrowed
   * `XP_AWARDED` event, not the whole union.
   */
  on<T extends HudEventType>(type: T, handler: GameEventHandler<T>): Unsubscribe {
    if (this.isDestroyed) return () => {};
    let set = this.typed.get(type);
    if (!set) {
      set = new Set<AnyEventHandler>();
      this.typed.set(type, set);
    }
    set.add(handler as AnyEventHandler);
    return () => this.off(type, handler);
  }

  off<T extends HudEventType>(type: T, handler: GameEventHandler<T>): void {
    const set = this.typed.get(type);
    if (!set) return;
    set.delete(handler as AnyEventHandler);
    if (set.size === 0) this.typed.delete(type);
  }

  /** Subscribe to every event. The scenes use this for their exhaustive switch. */
  onAny(handler: AnyEventHandler): Unsubscribe {
    if (this.isDestroyed) return () => {};
    this.any.add(handler);
    return () => this.offAny(handler);
  }

  offAny(handler: AnyEventHandler): void {
    this.any.delete(handler);
  }

  /**
   * Emit an event. Before a scene is ready the event is queued; after
   * `destroy()` it is a silent no-op (React may still be flushing effects).
   */
  emit(event: HudEvent): void {
    if (this.isDestroyed) return;
    if (!this.isReady) {
      this.enqueue(event);
      return;
    }
    this.dispatch(event);
  }

  /**
   * Scenes call `setReady(true)` from `create()` and `setReady(false)` on
   * shutdown. Going ready flushes the queue exactly once, in order; going
   * un-ready re-arms buffering so a StrictMode remount loses nothing.
   */
  setReady(ready: boolean): void {
    if (this.isDestroyed || ready === this.isReady) return;
    this.isReady = ready;
    if (!ready) return;
    // Take the queue before dispatching: a handler that emits during the flush
    // sees `isReady === true` and goes straight through rather than re-queuing.
    const pending = this.queue;
    this.queue = [];
    for (const event of pending) this.dispatch(event);
  }

  /** Drop the buffer without delivering it (e.g. after a hunt is abandoned). */
  clearQueue(): void {
    this.queue = [];
  }

  /**
   * Remove every handler and buffered event. Idempotent; safe to call from a
   * React cleanup that runs twice.
   */
  destroy(): void {
    this.isDestroyed = true;
    this.isReady = false;
    this.typed.clear();
    this.any.clear();
    this.queue = [];
  }

  private enqueue(event: HudEvent): void {
    if (this.queue.length >= MAX_QUEUED_EVENTS) {
      const stale = this.queue.findIndex((e) => SUPERSEDABLE.has(e.type));
      this.queue.splice(stale === -1 ? 0 : stale, 1);
    }
    this.queue.push(event);
  }

  private dispatch(event: HudEvent): void {
    // Copy before iterating: a handler may unsubscribe itself mid-dispatch.
    const typed = this.typed.get(event.type);
    if (typed && typed.size > 0) {
      for (const handler of [...typed]) safeCall(handler, event);
    }
    if (this.any.size > 0) {
      for (const handler of [...this.any]) safeCall(handler, event);
    }
  }
}

/** One thrown handler must not stop the rest of the HUD from updating. */
function safeCall(handler: AnyEventHandler, event: HudEvent): void {
  try {
    handler(event);
  } catch (error) {
    console.error(`[ww:game] handler for ${event.type} threw`, error);
  }
}
