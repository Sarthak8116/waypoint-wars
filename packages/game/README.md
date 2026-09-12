# `@ww/game` — the Phaser HUD overlay

A transparent Phaser layer that sits on top of MapLibre and animates numbers.

## The one rule

**Phaser holds no game state.**

The HUD receives `GameEvent`s and animates them. It decides nothing: not XP, not
what a hint costs, not when the timer expires. If the Phaser instance were
destroyed and recreated mid-hunt, nothing would be lost — replay one
`HUD_RESYNC` and the overlay is whole again.

The single permitted exception is a *display cache*: `HudScene` remembers the XP
figure currently on screen so the counter can tween from the old number to the
new one. The incoming event is always authoritative (`XP_AWARDED` carries
`total`, and the scene assigns it rather than accumulating `amount`), and
`HUD_RESYNC` snaps every cached value into line without animation.

MapLibre owns geography. Phaser owns feelings. Nothing with a coordinate is
drawn here.

## Using it from Next.js — Phaser needs `window`

`@ww/game` (the barrel) is safe to import anywhere, including server
components: it exports types, the pure `GameBridge`, the display helpers and the
animation constants, and none of them touch `window`. `src/ssr.test.ts` runs in
Node and fails the build if that ever stops being true.

Everything that needs a browser lives behind a dynamic import:

```tsx
'use client';
import { useEffect, useRef } from 'react';
import { GameBridge, type GameHandle } from '@ww/game';

const bridge = new GameBridge(); // owned by React, outlives the Phaser instance

export function HudOverlay() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let handle: GameHandle | undefined;
    let cancelled = false;

    // Client-only, dynamic. Never a static import of '@ww/game/mount'.
    import('@ww/game/mount').then(({ mountGame }) => {
      if (cancelled || !ref.current) return;
      handle = mountGame(ref.current, {
        bridge,
        totalCheckpoints: 5,
        hintCostLabel: '-20 XP',
        onHintRequested: () => sendToServer({ type: 'request_hint', checkpointId }),
        onReplayRequested: () => map.startReplay(),
      });
    });

    return () => {
      cancelled = true;
      handle?.destroy();
    };
  }, []);

  return <div ref={ref} className="absolute inset-0" />;
}
```

Equivalently, `const mountGame = await loadMountGame()` from the barrel, or
`next/dynamic` with `{ ssr: false }` around a component that imports it.

Two details that matter:

- **Own the bridge in React, not in the handle.** Passing a `bridge` means
  events emitted while no scene is alive (between a StrictMode unmount and
  remount) are buffered and flushed when the next scene boots, instead of being
  dropped.
- **The overlay does not steal the map's gestures.** The canvas is
  `pointer-events: none`; a window-level listener flips it to `auto` only while
  the pointer is over a registered button. Pans and pinches reach MapLibre.

## The bridge

```ts
bridge.on('XP_AWARDED', (event) => event.amount); // narrowed, not the union
bridge.emit({ type: 'TIMER_TICK', secondsRemaining: 900 });
bridge.destroy(); // drops every handler — StrictMode-safe
```

Events emitted before a scene exists are **queued and flushed exactly once**.
Phaser boots asynchronously, so without this the first XP award of the game is
silently dropped — the one an audience is watching for.

## Animations

Every animation completes in **under one second**, because players are walking
down a street while it plays. Durations are named constants in
`src/animations.ts` and `src/animations.test.ts` fails the build if any of them
reaches 1000ms. Animations are interruptible: two XP awards 200ms apart retarget
the counter rather than queuing a visible backlog.

## The mock harness

Mounts the HUD over a stand-in for the map, with a button for **every**
`GameEvent` variant plus lifecycle controls. No server, no map, no API keys.

```bash
pnpm --filter @ww/game mock     # http://localhost:5174
```

The button list is generated from `src/mock/fixtures.ts`, whose catalog is a
mapped type over `HudEventType` — a new event variant cannot be added to
`@ww/shared` without a button appearing here and the tests exercising it.

Use it to check:

- every animation, in any order (the HUD has no state, so order is always legal)
- **Emit BEFORE mounting** — proves a pre-boot event is queued, not dropped
- **Destroy + remount** — proves a resync restores the overlay exactly
- **Destroy HUD** — proves the map underneath stays usable

## Scripts

| Command | |
| --- | --- |
| `pnpm --filter @ww/game typecheck` | includes the compile-time exhaustiveness checks |
| `pnpm --filter @ww/game test` | bridge, durations, display projection, SSR safety |
| `pnpm --filter @ww/game mock` | the standalone harness |

## What is not tested here

Phaser needs a real WebGL/Canvas context, which headless vitest does not have,
and jsdom canvas shims buy nothing but flakiness. So the scenes' *rendering* is
verified by eye in the mock harness. Everything reducer-free is unit-tested: the
bridge, the durations, the display projection, the type contract and the
SSR boundary.
