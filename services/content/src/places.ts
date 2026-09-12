/**
 * Landmark discovery — real places with real coordinates.
 *
 * THE RULE THIS FILE EXISTS TO ENFORCE: coordinates come from a gazetteer,
 * never from a language model. Ask Gemini for "famous places in Miami" and it
 * will name real landmarks and attach plausible, wrong coordinates — and a
 * wrong coordinate is not a cosmetic bug here. It strands a player on the
 * wrong corner with a geofence that will never open, in a city they don't know.
 *
 * So: OpenStreetMap finds the places and owns the coordinates. Gemini writes
 * *about* places we already know exist. Those two jobs never swap.
 *
 * Uses Nominatim (place name -> coordinate) and Overpass (features near a
 * coordinate). Both are volunteer-run and both require a real User-Agent and
 * modest request rates — see USAGE below.
 */

import type { LatLng } from '@ww/shared';

/**
 * USAGE POLICY, honoured deliberately.
 *
 * Nominatim: max 1 request/second, User-Agent identifying the app.
 * Overpass:  be gentle, prefer one bigger query to many small ones.
 *
 * A hunt generation makes ONE geocode and ONE Overpass call. Results are
 * cached by the caller so regenerating the same city costs nothing.
 */
const USER_AGENT = 'WaypointWars/0.1 (scavenger hunt generator; contact via repo)';

const NOMINATIM = 'https://nominatim.openstreetmap.org/search';

/**
 * Overpass mirrors, tried in order.
 *
 * The main instance is volunteer-run and intermittently answers 504 or 429
 * under load — observed once during development, between two calls that both
 * succeeded. That is a coin flip, and a coin flip is not acceptable when
 * someone is generating a hunt in front of an audience. Retry, then fail over.
 */
const OVERPASS_MIRRORS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
] as const;

export interface Place {
  /** Stable id derived from the OSM element. */
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  /** OSM tags we kept, for Gemini grounding and for filtering. */
  kind: string;
  /** e.g. "historic=memorial", useful context for the clue writer. */
  tags: Record<string, string>;
  /** Metres from the search centre. */
  distanceMeters: number;
  /** Rough interest score; higher is more likely to be worth a checkpoint. */
  score: number;
}

export interface GeocodedPlace {
  displayName: string;
  latitude: number;
  longitude: number;
}

export class PlacesError extends Error {
  constructor(
    message: string,
    readonly kind: 'not-found' | 'unreachable' | 'rate-limited' | 'empty',
  ) {
    super(message);
    this.name = 'PlacesError';
  }
}

const TIMEOUT_MS = 25_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function getJson(url: string, init: RequestInit = {}): Promise<unknown> {
  const res = await fetch(url, {
    ...init,
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/json', ...(init.headers ?? {}) },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (res.status === 429) throw new PlacesError('Map data service is rate limited.', 'rate-limited');
  if (!res.ok) throw new PlacesError(`Map data service returned ${res.status}.`, 'unreachable');
  return res.json();
}

/**
 * Turn "Miami" or "Downtown Austin" into a coordinate.
 *
 * Deliberately returns the FIRST result rather than trying to disambiguate:
 * the caller shows the resolved `displayName` back to the user, so a wrong
 * Springfield is visible and correctable rather than silent.
 */
export async function geocode(query: string): Promise<GeocodedPlace> {
  const url = `${NOMINATIM}?q=${encodeURIComponent(query)}&format=json&limit=1&addressdetails=0`;
  const data = (await getJson(url)) as Array<{ lat: string; lon: string; display_name: string }>;

  const first = data[0];
  if (!first) throw new PlacesError(`Could not find a place called "${query}".`, 'not-found');

  return {
    displayName: first.display_name,
    latitude: Number(first.lat),
    longitude: Number(first.lon),
  };
}

/**
 * What counts as a landmark worth walking to.
 *
 * Tuned toward things that are (a) outdoors or visible from outside, (b) have
 * a name, and (c) have some physical detail worth observing. Museums and
 * theatres are included because their facades work even when closed — a hunt
 * should not depend on opening hours.
 */
const LANDMARK_FILTERS = [
  'nwr["historic"]["name"]',
  'nwr["tourism"~"^(attraction|museum|artwork|viewpoint|gallery)$"]["name"]',
  'nwr["amenity"~"^(theatre|townhall|place_of_worship|fountain|clock|arts_centre)$"]["name"]',
  'nwr["man_made"~"^(bridge|tower|obelisk|lighthouse)$"]["name"]',
  'nwr["leisure"~"^(park|garden)$"]["name"]',
  'nwr["building"~"^(cathedral|chapel|civic|train_station)$"]["name"]',
] as const;

/** Tag-based interest weighting. Not clever, just consistent. */
function scoreOf(tags: Record<string, string>): number {
  let score = 0;
  if (tags['historic']) score += 5;
  if (tags['heritage'] || tags['listed_status']) score += 4;
  if (tags['wikipedia'] || tags['wikidata']) score += 4; // has written history
  if (tags['tourism'] === 'attraction') score += 3;
  if (tags['tourism'] === 'artwork') score += 2;
  if (tags['man_made'] === 'bridge' || tags['man_made'] === 'tower') score += 3;
  if (tags['amenity'] === 'theatre' || tags['amenity'] === 'townhall') score += 2;
  if (tags['leisure'] === 'park') score += 1;
  if (tags['building'] === 'cathedral') score += 3;
  return score;
}

const EARTH_R = 6_371_000;
function metersBetween(a: LatLng, b: LatLng): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLng = toRad(b.longitude - a.longitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.sin(dLng / 2) ** 2 * Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude));
  return 2 * EARTH_R * Math.asin(Math.min(1, Math.sqrt(h)));
}

interface OverpassElement {
  type: string;
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

/**
 * Run an Overpass query, retrying and failing over between mirrors.
 *
 * Two attempts per mirror with a short backoff, then the next mirror. Total
 * worst case is bounded so a generation cannot hang indefinitely — it either
 * returns data or reports a clear failure the UI can show.
 */
async function queryOverpass(query: string): Promise<unknown> {
  let last: unknown;

  for (const mirror of OVERPASS_MIRRORS) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        return await getJson(mirror, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: `data=${encodeURIComponent(query)}`,
        });
      } catch (err) {
        last = err;
        // A 429 means slow down, not try harder — go straight to the next
        // mirror rather than spending another request here.
        if (err instanceof PlacesError && err.kind === 'rate-limited') break;
        await sleep(700 * (attempt + 1));
      }
    }
  }

  throw last instanceof Error
    ? last
    : new PlacesError('Could not reach any map data service.', 'unreachable');
}

/**
 * Find named landmarks within `radiusMeters` of a point.
 *
 * One Overpass query covering every filter, rather than one per filter —
 * gentler on a volunteer-run service and faster besides.
 */
export async function findLandmarks(
  centre: LatLng,
  radiusMeters = 1200,
  limit = 40,
): Promise<Place[]> {
  const around = `(around:${Math.round(radiusMeters)},${centre.latitude},${centre.longitude})`;
  const body = `[out:json][timeout:25];(${LANDMARK_FILTERS.map((f) => `${f}${around};`).join('')});out center tags ${limit * 4};`;

  const data = (await queryOverpass(body)) as { elements?: OverpassElement[] };

  const seen = new Set<string>();
  const places: Place[] = [];

  for (const el of data.elements ?? []) {
    const tags = el.tags ?? {};
    const name = tags['name'];
    if (!name) continue;

    const lat = el.lat ?? el.center?.lat;
    const lon = el.lon ?? el.center?.lon;
    if (typeof lat !== 'number' || typeof lon !== 'number') continue;

    // The same landmark often appears as a node AND a way. Dedupe by name.
    const key = name.toLowerCase().trim();
    if (seen.has(key)) continue;

    /**
     * Overpass matches a feature if ANY part of it falls inside the radius,
     * but `out center` returns its CENTROID — so a long way like a highway
     * matches on a nearby segment and reports a centre tens of kilometres
     * away. Observed live: "Tamiami Trail" came back 82 km from Miami.
     *
     * Dropping anything whose centre is outside the radius is the fix. A
     * checkpoint the player cannot walk to is worse than one fewer option.
     */
    const distance = Math.round(metersBetween(centre, { latitude: lat, longitude: lon }));
    if (distance > radiusMeters) continue;

    seen.add(key);

    places.push({
      id: `${el.type}_${el.id}`,
      name,
      latitude: lat,
      longitude: lon,
      kind:
        tags['historic'] ??
        tags['tourism'] ??
        tags['amenity'] ??
        tags['man_made'] ??
        tags['leisure'] ??
        tags['building'] ??
        'landmark',
      tags,
      distanceMeters: distance,
      score: scoreOf(tags),
    });
  }

  if (places.length === 0) {
    throw new PlacesError(
      'No named landmarks found near there. Try a city centre, or a wider radius.',
      'empty',
    );
  }

  // Best first, but break ties by proximity so a hunt stays walkable.
  return places
    .sort((a, b) => b.score - a.score || a.distanceMeters - b.distanceMeters)
    .slice(0, limit);
}
