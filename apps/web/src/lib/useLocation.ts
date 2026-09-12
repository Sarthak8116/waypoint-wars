'use client';

/**
 * Player location, from either real GPS or simulated Demo Mode movement.
 *
 * Demo Mode is a first-class product feature, not a dev hack (see DECISIONS.md
 * D6). The demo is given on laptops indoors, and a venue with bad GPS must not
 * be able to sink it. Real geolocation stays fully implemented and is the
 * default; Demo Mode is opt-in and always visibly banner-ed.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { lerpLatLng, type LatLng } from '@ww/shared';

export type LocationSource = 'gps' | 'demo';

export type PermissionState = 'idle' | 'prompting' | 'granted' | 'denied' | 'unavailable';

export interface LocationState {
  position: LatLng | null;
  accuracyMeters: number;
  source: LocationSource;
  permission: PermissionState;
  error: string | null;
}

/** Metres per second for simulated walking. ~1.4 m/s is a real walking pace. */
const WALK_SPEED_MPS = 1.4;

/** How much faster Demo Mode walks, so a 30-minute hunt fits a 3-minute demo. */
export const DEMO_SPEED_MULTIPLIER = 25;

const GPS_OPTIONS: PositionOptions = {
  enableHighAccuracy: true,
  timeout: 15_000,
  maximumAge: 5_000,
};

export interface UseLocationOptions {
  /** Where simulated movement begins, and where it heads first. */
  demoStart: LatLng;
  initialSource?: LocationSource;
}

export function useLocation({ demoStart, initialSource = 'gps' }: UseLocationOptions) {
  const [state, setState] = useState<LocationState>({
    position: initialSource === 'demo' ? demoStart : null,
    accuracyMeters: initialSource === 'demo' ? 8 : 0,
    source: initialSource,
    permission: 'idle',
    error: null,
  });

  /** Demo Mode's current navigation target. Null means "hold position". */
  const demoTarget = useRef<LatLng | null>(null);
  const demoFrame = useRef<number | null>(null);
  const lastTick = useRef<number>(0);
  const watchId = useRef<number | null>(null);

  // --- Real GPS -----------------------------------------------------------

  const startGps = useCallback(() => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setState((s) => ({ ...s, permission: 'unavailable', error: 'Geolocation unsupported' }));
      return;
    }

    setState((s) => ({ ...s, permission: 'prompting', source: 'gps', error: null }));

    watchId.current = navigator.geolocation.watchPosition(
      (pos) => {
        setState((s) => ({
          ...s,
          position: { latitude: pos.coords.latitude, longitude: pos.coords.longitude },
          accuracyMeters: pos.coords.accuracy ?? 0,
          permission: 'granted',
          source: 'gps',
          error: null,
        }));
      },
      (err) => {
        // PERMISSION_DENIED is 1; the rest are transient and recoverable.
        const denied = err.code === err.PERMISSION_DENIED;
        setState((s) => ({
          ...s,
          permission: denied ? 'denied' : s.permission,
          error: denied
            ? 'Location permission denied. Enable it, or switch on Demo Mode.'
            : err.message,
        }));
      },
      GPS_OPTIONS,
    );
  }, []);

  const stopGps = useCallback(() => {
    if (watchId.current !== null && typeof navigator !== 'undefined') {
      navigator.geolocation.clearWatch(watchId.current);
      watchId.current = null;
    }
  }, []);

  // --- Demo Mode ----------------------------------------------------------

  /** Point simulated movement at a destination; it walks there and stops. */
  const walkTo = useCallback((target: LatLng) => {
    demoTarget.current = target;
  }, []);

  const enableDemoMode = useCallback(
    (at?: LatLng) => {
      stopGps();
      setState((s) => ({
        ...s,
        source: 'demo',
        position: at ?? s.position ?? demoStart,
        accuracyMeters: 8,
        permission: 'granted',
        error: null,
      }));
    },
    [demoStart, stopGps],
  );

  /** Jump instantly — used by dev controls and to reset the demo. */
  const teleport = useCallback((to: LatLng) => {
    demoTarget.current = null;
    setState((s) => ({ ...s, position: to }));
  }, []);

  // Simulated walking loop. Runs only in demo mode, and only while a target is set.
  useEffect(() => {
    if (state.source !== 'demo') return;

    const tick = (ts: number) => {
      const prev = lastTick.current || ts;
      const dtSeconds = Math.min(0.1, (ts - prev) / 1000); // clamp tab-switch jumps
      lastTick.current = ts;

      const target = demoTarget.current;
      if (target) {
        setState((s) => {
          if (!s.position) return s;

          const metresPerTick = WALK_SPEED_MPS * DEMO_SPEED_MULTIPLIER * dtSeconds;
          const remaining = haversine(s.position, target);

          if (remaining <= metresPerTick || remaining < 1) {
            demoTarget.current = null;
            return { ...s, position: target };
          }

          return { ...s, position: lerpLatLng(s.position, target, metresPerTick / remaining) };
        });
      }

      demoFrame.current = requestAnimationFrame(tick);
    };

    demoFrame.current = requestAnimationFrame(tick);
    return () => {
      if (demoFrame.current !== null) cancelAnimationFrame(demoFrame.current);
      lastTick.current = 0;
    };
  }, [state.source]);

  useEffect(() => stopGps, [stopGps]);

  return { ...state, startGps, enableDemoMode, walkTo, teleport };
}

/** Local copy to avoid importing the whole shared geo module into a hot loop. */
function haversine(a: LatLng, b: LatLng): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLng = toRad(b.longitude - a.longitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.sin(dLng / 2) ** 2 * Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude));
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}
