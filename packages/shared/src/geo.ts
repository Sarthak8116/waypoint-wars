/** Geodesy helpers shared by the client geofence and the server validator. */

import type { LatLng, ApproximateRegion } from './domain.js';

const EARTH_RADIUS_M = 6_371_000;

const toRad = (deg: number): number => (deg * Math.PI) / 180;

/** Great-circle distance in metres. Accurate enough at city scale. */
export function haversineMeters(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.latitude - a.latitude);
  const dLng = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);

  const h =
    Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function isWithinRadius(point: LatLng, target: LatLng, radiusMeters: number): boolean {
  return haversineMeters(point, target) <= radiusMeters;
}

/**
 * Coarsen a precise position into a region safe to show opponents.
 * Snapping to a grid (rather than adding noise) means a player cannot be
 * triangulated by sampling the broadcast repeatedly while standing still.
 */
export function toApproximateRegion(point: LatLng, radiusMeters = 150): ApproximateRegion {
  // ~0.00135 deg latitude ≈ 150 m. Longitude is scaled by cos(lat).
  const latStep = radiusMeters / 111_320;
  const lngStep = latStep / Math.max(0.1, Math.cos(toRad(point.latitude)));

  const snap = (value: number, step: number): number => Math.round(value / step) * step;

  return {
    center: {
      latitude: snap(point.latitude, latStep),
      longitude: snap(point.longitude, lngStep),
    },
    radiusMeters,
  };
}

/** Total path length in metres, for replay stats. */
export function pathLengthMeters(path: LatLng[]): number {
  let total = 0;
  for (let i = 1; i < path.length; i++) {
    const prev = path[i - 1];
    const curr = path[i];
    if (prev && curr) total += haversineMeters(prev, curr);
  }
  return total;
}

/** Linear interpolation between two coordinates, used by demo movement. */
export function lerpLatLng(a: LatLng, b: LatLng, t: number): LatLng {
  const clamped = Math.max(0, Math.min(1, t));
  return {
    latitude: a.latitude + (b.latitude - a.latitude) * clamped,
    longitude: a.longitude + (b.longitude - a.longitude) * clamped,
  };
}
