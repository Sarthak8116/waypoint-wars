/**
 * Lets the HUD canvas float over MapLibre without stealing the map's gestures.
 *
 * MapLibre owns geography; the player must be able to pan and pinch the map
 * through the overlay. So the canvas is `pointer-events: none` by default, and
 * a window-level `pointermove` listener (which still fires, because the listener
 * is not on the canvas) flips it to `auto` only while the pointer is inside a
 * rectangle a scene has registered — the hint button, the replay button.
 *
 * DOM-only. Imported exclusively from `mount.ts`, never from the barrel.
 */

import type { HitRegionRegistry } from './types.js';

export interface PointerPassthrough {
  destroy(): void;
}

export function installPointerPassthrough(
  canvas: HTMLCanvasElement,
  registry: HitRegionRegistry,
): PointerPassthrough {
  canvas.style.pointerEvents = 'none';

  let interactive = false;

  const update = (clientX: number, clientY: number): void => {
    const rect = canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    const hit = registry.all().some(
      (r) => x >= r.x && x <= r.x + r.width && y >= r.y && y <= r.y + r.height,
    );
    if (hit === interactive) return;
    interactive = hit;
    canvas.style.pointerEvents = hit ? 'auto' : 'none';
  };

  const onMove = (event: PointerEvent): void => update(event.clientX, event.clientY);

  // Touch devices get no hover, so arm the canvas on the *down* that starts the
  // gesture; if it missed a button the map still receives the same pointerdown
  // because we only ever enable it for the region under the finger.
  const onDown = (event: PointerEvent): void => update(event.clientX, event.clientY);

  window.addEventListener('pointermove', onMove, { passive: true });
  window.addEventListener('pointerdown', onDown, { passive: true, capture: true });

  return {
    destroy(): void {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerdown', onDown, { capture: true });
      canvas.style.pointerEvents = 'none';
    },
  };
}
