/**
 * Generate a complete, playable hunt for any place on earth.
 *
 *   "Miami" -> geocode -> real landmarks -> drafted checkpoints -> balanced
 *              routes from ONE shared start to ONE shared finish.
 *
 * The shape of the game, restated because the assembly below exists to
 * produce exactly it:
 *   · everyone gathers at the same start
 *   · each player walks a DIFFERENT route
 *   · routes MAY share a stop — they must not be identical, and each must
 *     show its player at least one thing the others do not
 *   · everyone converges on the same finish
 */

import {
  HUNT_DURATION_MINUTES,
  haversineMeters,
  type Hunt,
  type HuntDuration,
  type HuntTheme,
  type Checkpoint,
  type Route,
} from '@ww/shared';
import { findLandmarks, geocode, PlacesError, type Place, type GeocodedPlace } from './places.js';
import { createDrafter, type Drafter, DRAFT_MODEL_ID } from './draft.js';

export interface GenerateRequest {
  /** "Miami", "Downtown Austin", "Edinburgh Old Town" — anything geocodable. */
  query: string;
  duration?: HuntDuration;
  theme?: HuntTheme;
  /** How many parallel routes. One per team, or per player. */
  routeCount?: number;
  /** Stops per route, excluding the shared finish. */
  stopsPerRoute?: number;
}

export interface GeneratedHunt {
  hunt: Hunt;
  routes: Route[];
  checkpoints: Checkpoint[];
  /** Everything a reviewer needs to decide whether this is publishable. */
  report: {
    resolvedPlace: string;
    landmarksFound: number;
    checkpointsDrafted: number;
    /** Drafts the model was NOT confident about. Must be reviewed. */
    needsReview: string[];
    mocked: boolean;
    /**
     * Checkpoints that fell back to a labelled placeholder because the real
     * model call failed, and why. Empty on a clean run. A caller that ignores
     * this can ship a hunt where most clues read "[DRAFT] Find <name>".
     */
    placeholders: Array<{ name: string; reason: string }>;
    routeSummary: Array<{ id: string; label: string; stops: number; meters: number }>;
    warnings: string[];
  };
}

const DEFAULTS = {
  duration: 'city-quest' as HuntDuration,
  theme: 'mixed' as HuntTheme,
  routeCount: 3,
  stopsPerRoute: 4,
};

/** Walking pace, for turning distance into an expected time. */
const WALK_MPS = 1.25;
/** Time at a checkpoint: read the clue, look, photograph, answer. */
const SOLVE_SECONDS = 180;

/**
 * Pick the finish: somewhere notable and reasonably central, because every
 * route has to reach it and the group gathers there at the end.
 */
function chooseFinish(places: Place[], centre: { latitude: number; longitude: number }): Place {
  const ranked = [...places].sort((a, b) => {
    const centrality = a.distanceMeters - b.distanceMeters;
    return b.score - a.score || centrality;
  });
  // Prefer something with real standing; fall back to the most central.
  return ranked.find((p) => p.score >= 6) ?? ranked[0]!;
}

/**
 * Deal landmarks into routes.
 *
 * Round-robin over the interest-ranked list, so every route gets a mix of
 * strong and ordinary stops rather than one route taking all the good ones.
 * Overlap is permitted; when there are too few landmarks to fill every route
 * uniquely, routes reuse stops rather than coming up short — but the caller
 * then checks that each route still has something of its own.
 */
function dealRoutes(pool: Place[], routeCount: number, stopsPerRoute: number): Place[][] {
  const routes: Place[][] = Array.from({ length: routeCount }, () => []);

  let cursor = 0;
  for (let slot = 0; slot < stopsPerRoute; slot++) {
    for (let r = 0; r < routeCount; r++) {
      // Wraps deliberately: reuse beats an empty slot.
      routes[r]!.push(pool[cursor % pool.length]!);
      cursor += 1;
    }
  }

  // Order each route by proximity from the previous stop, so the walk is a
  // path rather than a zigzag. Greedy nearest-neighbour is enough here.
  return routes.map((stops) => {
    const remaining = [...stops];
    const ordered: Place[] = [];
    let current = remaining.shift()!;
    ordered.push(current);
    while (remaining.length) {
      remaining.sort((a, b) => haversineMeters(current, a) - haversineMeters(current, b));
      current = remaining.shift()!;
      ordered.push(current);
    }
    return ordered;
  });
}

/**
 * Even out walking distance between routes.
 *
 * Round-robin dealing ignores geography, so one route can land every far-flung
 * stop. Observed on the first real Miami generation: 1206m vs 2343m, a 94%
 * spread — and raw finishing time is meaningless across routes precisely
 * BECAUSE we normalise per checkpoint, which only holds if the routes are
 * comparable in the first place.
 *
 * Repeatedly moves a stop from the longest route to the shortest whenever that
 * strictly reduces the spread. Greedy and bounded; it will not find an optimum
 * and does not need to.
 */
/**
 * Nearest-neighbour ordering, starting from the first stop.
 *
 * Extracted because the balancer and the final assembly MUST agree on it.
 * They used to disagree: the balancer measured the dealt order while the
 * route was re-ordered into a path afterwards, so it spent forty passes
 * optimising a distance nobody walks. Savannah came out 2227m / 1426m /
 * 1098m — a 51% spread — from a balancer that believed it was done.
 */
export function orderPath(stops: Place[]): Place[] {
  const remaining = [...stops];
  const ordered: Place[] = [];
  let current = remaining.shift();
  if (!current) return ordered;
  ordered.push(current);
  while (remaining.length) {
    remaining.sort((a, b) => haversineMeters(current!, a) - haversineMeters(current!, b));
    current = remaining.shift()!;
    ordered.push(current);
  }
  return ordered;
}

export function balanceRoutes(routes: Place[][], finish: Place): Place[][] {
  // Measure what the player actually walks: ordered stops, then the finish.
  const lengthOf = (stops: Place[]) => routeMeters([...orderPath(stops), finish]);
  const spread = (rs: Place[][]) => {
    const ls = rs.map(lengthOf);
    return Math.max(...ls) - Math.min(...ls);
  };

  const working = routes.map((r) => [...r]);
  if (working.length < 2) return working;

  for (let pass = 0; pass < 40; pass++) {
    const lengths = working.map(lengthOf);
    const longest = lengths.indexOf(Math.max(...lengths));
    const shortest = lengths.indexOf(Math.min(...lengths));
    if (longest === shortest) break;

    const before = spread(working);
    let improved = false;

    // Try swapping each stop of the longest against each of the shortest.
    for (let i = 0; i < working[longest]!.length && !improved; i++) {
      for (let j = 0; j < working[shortest]!.length && !improved; j++) {
        const a = working[longest]![i]!;
        const b = working[shortest]![j]!;
        working[longest]![i] = b;
        working[shortest]![j] = a;

        if (spread(working) < before) improved = true;
        else {
          // revert
          working[longest]![i] = a;
          working[shortest]![j] = b;
        }
      }
    }

    if (!improved) break;
  }

  // Same ordering the balancer measured, so the two cannot drift apart.
  return working.map(orderPath);
}

export function routeMeters(stops: Array<{ latitude: number; longitude: number }>): number {
  let total = 0;
  for (let i = 1; i < stops.length; i++) total += haversineMeters(stops[i - 1]!, stops[i]!);
  return Math.round(total);
}

/**
 * Pick a place a group of strangers can actually be told to meet at.
 *
 * "Everyone starts from the same location" is a core mechanic, but generated
 * hunts used the geocoded city centroid named after the city — so a Savannah
 * hunt told four teams to "gather at Savannah", which is a coordinate, not a
 * meeting point. Pittsburgh's hand-authored hunt says "Market Square — meet by
 * the fountain in the middle of the square", and generated hunts should be no
 * worse.
 *
 * Wants an OPEN, PUBLIC, findable space — a square, park, plaza or fountain —
 * rather than the highest-scoring landmark, which is usually a building
 * interior nobody can loiter outside of. Deliberately excludes anything used
 * as a checkpoint: the gathering point is announced by name, so using one
 * would hand every player a free clue.
 */
const GATHERING_SCORES: Array<[string, string | null, number]> = [
  ['place', 'square', 10],
  ['amenity', 'marketplace', 9],
  ['leisure', 'park', 8],
  ['amenity', 'fountain', 7],
  ['leisure', 'common', 6],
  ['landuse', 'village_green', 6],
  ['highway', 'pedestrian', 4],
];

/**
 * Only OPEN SPACES qualify, which is why tourism=attraction and
 * historic=memorial are absent: they are landmarks, not places to stand
 * around waiting for four other people. Left in, Charleston picked "Model of
 * the Civil War Submarine, H.L. Hunley" as its gathering point. When nothing
 * qualifies, the honest centroid fallback is better than confidently naming
 * something nobody can assemble at.
 */

export function pickGatheringPoint(
  landmarks: Place[],
  excludeIds: Set<string>,
  centre: GeocodedPlace,
): { name: string; latitude: number; longitude: number; instructions: string } {
  let best: { place: Place; score: number } | null = null;

  for (const place of landmarks) {
    if (excludeIds.has(place.id)) continue;

    let score = 0;
    for (const [key, value, points] of GATHERING_SCORES) {
      const tag = place.tags[key];
      if (tag && (value === null || tag === value)) score += points;
    }
    if (score === 0) continue;

    // Central is better: everyone walks out from here, so a gathering point on
    // the edge makes one route much longer than the rest.
    score -= place.distanceMeters / 1000;

    if (!best || score > best.score) best = { place, score };
  }

  if (!best) {
    // No open space found. The centroid is a poor meeting point, so say so
    // rather than dressing it up as one.
    return {
      name: centre.displayName.split(',')[0]!.trim(),
      latitude: centre.latitude,
      longitude: centre.longitude,
      instructions:
        'No public square was found nearby — agree on an exact spot before you start.',
    };
  }

  return {
    name: best.place.name,
    latitude: best.place.latitude,
    longitude: best.place.longitude,
    instructions: `Meet at ${best.place.name}. Everyone starts here, then splits up.`,
  };
}

export interface GenerateOptions {
  drafter?: Drafter;
  /** Progress callback, so a UI can show what is happening during the wait. */
  onProgress?: (stage: string, detail?: string) => void;
}

export async function generateHunt(
  req: GenerateRequest,
  opts: GenerateOptions = {},
): Promise<GeneratedHunt> {
  const duration = req.duration ?? DEFAULTS.duration;
  const theme = req.theme ?? DEFAULTS.theme;
  const routeCount = Math.max(1, Math.min(6, req.routeCount ?? DEFAULTS.routeCount));
  const stopsPerRoute = Math.max(2, Math.min(8, req.stopsPerRoute ?? DEFAULTS.stopsPerRoute));

  const drafter = opts.drafter ?? createDrafter();
  const progress = opts.onProgress ?? (() => {});
  const warnings: string[] = [];

  // --- 1. where ------------------------------------------------------------
  progress('geocoding', req.query);
  const centre = await geocode(req.query);

  // Longer hunts search wider, but stay walkable.
  const radius = duration === 'quick-detour' ? 900 : duration === 'city-quest' ? 1500 : 2200;

  progress('finding landmarks', centre.displayName);
  const landmarks = await findLandmarks(centre, radius, 40);

  const needed = routeCount * stopsPerRoute + 1;
  if (landmarks.length < needed) {
    warnings.push(
      `Only ${landmarks.length} landmarks found for ${needed} slots — routes will share stops.`,
    );
  }

  // --- 2. shared finish, then deal the rest --------------------------------
  const finishPlace = chooseFinish(landmarks, centre);
  const pool = landmarks.filter((p) => p.id !== finishPlace.id);
  if (pool.length === 0) throw new PlacesError('Not enough landmarks to build a hunt.', 'empty');

  const dealt = balanceRoutes(dealRoutes(pool, routeCount, stopsPerRoute), finishPlace);

  // --- 3. draft the words --------------------------------------------------
  // One draft per UNIQUE place, not per route slot: a shared stop is drafted
  // once and reused, which is both cheaper and consistent for the players who
  // land on it.
  const unique = new Map<string, Place>();
  for (const stops of dealt) for (const p of stops) unique.set(p.id, p);
  unique.set(finishPlace.id, finishPlace);

  progress('writing clues', `${unique.size} places`);
  const drafted = new Map<string, Checkpoint>();
  const needsReview: string[] = [];
  const placeholders: Array<{ name: string; reason: string }> = [];

  // Sequential, deliberately. Parallel calls trip Gemini's per-minute limit,
  // and a rate-limited draft silently becomes a placeholder.
  for (const place of unique.values()) {
    const walkSeconds = Math.round(Math.min(900, place.distanceMeters / WALK_MPS));
    const result = await drafter.draft(place, {
      expectedCompletionSeconds: walkSeconds + SOLVE_SECONDS,
      radiusMeters: 55,
      baseXp: 100,
    });
    drafted.set(place.id, result.checkpoint);
    if (result.needsReview) needsReview.push(place.name);
    if (result.failureReason) {
      placeholders.push({ name: place.name, reason: result.failureReason });
    }
    progress('writing clues', place.name);
  }

  const finishCheckpoint = drafted.get(finishPlace.id)!;

  // After drafting, so every checkpoint id is known and none can be reused as
  // the announced gathering point.
  const gathering = pickGatheringPoint(landmarks, new Set(unique.keys()), centre);

  // --- 4. assemble ---------------------------------------------------------
  const huntId = `hunt_gen_${Date.now().toString(36)}`;

  const routes: Route[] = dealt.map((stops, i) => {
    const chain = [...stops, finishPlace];
    return {
      id: `${huntId}_r${i + 1}`,
      huntId,
      label: `Route ${String.fromCharCode(65 + i)}`,
      // The engine reads the LAST id as the shared finish.
      checkpointIds: [...stops.map((p) => drafted.get(p.id)!.id), finishCheckpoint.id],
      approxDistanceMeters: routeMeters(chain),
      approxDurationSeconds: HUNT_DURATION_MINUTES[duration] * 60,
    };
  });

  // Fairness depends on comparable routes; say so plainly when they are not.
  const lengths = routes.map((r) => r.approxDistanceMeters);
  const mean = lengths.reduce((a, b) => a + b, 0) / lengths.length;
  const worst = Math.max(...lengths.map((l) => Math.abs(l - mean) / mean));
  if (worst > 0.25) {
    warnings.push(
      `Routes differ by ${Math.round(worst * 100)}% in walking distance — the leaderboard will favour the short one.`,
    );
  }

  // Every route must show its player something the others did not.
  for (const route of routes) {
    const others = new Set(routes.filter((r) => r.id !== route.id).flatMap((r) => r.checkpointIds));
    const exclusive = route.checkpointIds.filter(
      (id) => id !== finishCheckpoint.id && !others.has(id),
    );
    if (exclusive.length === 0) {
      warnings.push(`${route.label} has no stop of its own — try a larger area or fewer routes.`);
    }
  }

  const hunt: Hunt = {
    id: huntId,
    title: `${centre.displayName.split(',')[0]!.trim()} Hunt`,
    city: centre.displayName.split(',')[0]!.trim(),
    area: centre.displayName.split(',').slice(1, 2).join('').trim() || undefined,
    theme,
    duration,
    description: `A generated walking hunt around ${centre.displayName.split(',')[0]!.trim()}. Everyone starts together at ${gathering.name}, walks a different route, and finishes at ${finishPlace.name}.`,
    startLocation: gathering,
    finalDestination: finishCheckpoint,
    routeIds: routes.map((r) => r.id),
    // NEVER auto-published. Generated history must be reviewed by a human
    // before anyone is told it as fact.
    published: false,
  };

  /**
   * Say it out loud. A hunt that is mostly placeholders is not a hunt, and the
   * single likeliest cause — an exhausted Gemini free-tier quota — is
   * something the operator can actually fix.
   */
  // A hunt written by the fallback model is still a real hunt, but the
  // operator should know their primary quota is gone before demo day.
  if (!drafter.mocked && drafter.modelUsed !== DRAFT_MODEL_ID) {
    warnings.push(
      `Clues were written by ${drafter.modelUsed}, not ${DRAFT_MODEL_ID} — the primary model was rate-limited or unavailable.`,
    );
  }

  if (placeholders.length > 0) {
    const rateLimited = placeholders.filter((p) => p.reason === 'rate-limited').length;
    warnings.push(
      `${placeholders.length} of ${drafted.size} clues are labelled [DRAFT] placeholders` +
        (rateLimited > 0
          ? ` — Gemini rejected ${rateLimited} call(s) as rate-limited. The free tier caps generate_content requests, and this hunt needs one per stop.`
          : ` — reasons: ${[...new Set(placeholders.map((p) => p.reason))].join(', ')}.`),
    );
  }

  progress('done');

  return {
    hunt,
    routes,
    checkpoints: [...drafted.values()],
    report: {
      resolvedPlace: centre.displayName,
      landmarksFound: landmarks.length,
      checkpointsDrafted: drafted.size,
      needsReview,
      mocked: drafter.mocked,
      placeholders,
      routeSummary: routes.map((r) => ({
        id: r.id,
        label: r.label,
        stops: r.checkpointIds.length,
        meters: r.approxDistanceMeters,
      })),
      warnings,
    },
  };
}
