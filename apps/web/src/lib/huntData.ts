/**
 * Hunt content loading.
 *
 * The real content lives in `data/pittsburgh-hunts.json`. This module loads it
 * lazily and falls back to a tiny built-in fixture so the game loop is testable
 * before the curated routes exist — and so a corrupt data file degrades to
 * "playable but obviously placeholder" rather than a white screen.
 *
 * The fallback is DELIBERATELY labeled. Per the project rules, a placeholder
 * must never be able to pass as real content.
 */

import type { Checkpoint, Hunt, Route } from '@ww/shared';

export interface HuntBundle {
  hunt: Hunt;
  routes: Route[];
  checkpoints: Record<string, Checkpoint>;
  /** True when the curated Pittsburgh content could not be loaded. */
  isFallback: boolean;
}

/**
 * Minimal two-checkpoint placeholder around Point State Park. Exists only so
 * the state machine, camera and map can be exercised end-to-end before the
 * curated routes land. Not a demo asset.
 */
function buildFallback(): HuntBundle {
  const mk = (
    id: string,
    name: string,
    latitude: number,
    longitude: number,
    clue: string,
  ): Checkpoint => ({
    id,
    name,
    latitude,
    longitude,
    clue,
    hint: 'PLACEHOLDER hint — curated content not loaded.',
    challengeKind: 'observe-detail',
    observationQuestion: 'PLACEHOLDER: how many words are on the nearest sign?',
    acceptedAnswers: ['two', '2'],
    photoRequirement: 'Photograph the landmark.',
    landmarkDescription: 'Placeholder landmark.',
    historicalReveal:
      'PLACEHOLDER content. The curated Pittsburgh routes failed to load — see data/pittsburgh-hunts.json.',
    sources: [],
    radiusMeters: 60,
    baseXp: 100,
    expectedCompletionSeconds: 360,
  });

  const finish = mk(
    'fallback-finish',
    'Point State Park Fountain',
    40.4417,
    -80.0095,
    'PLACEHOLDER: walk to the fountain where three rivers meet.',
  );

  const checkpoints: Record<string, Checkpoint> = {
    'fallback-cp1': mk('fallback-cp1', 'Placeholder A', 40.4406, -80.0085, 'PLACEHOLDER clue A.'),
    'fallback-cp2': mk('fallback-cp2', 'Placeholder B', 40.4409, -80.0021, 'PLACEHOLDER clue B.'),
    'fallback-finish': finish,
  };

  const route: Route = {
    id: 'fallback-route',
    huntId: 'fallback-hunt',
    label: 'Placeholder route',
    checkpointIds: ['fallback-cp1', 'fallback-cp2', 'fallback-finish'],
    approxDistanceMeters: 900,
    approxDurationSeconds: 1080,
  };

  return {
    hunt: {
      id: 'fallback-hunt',
      title: 'PLACEHOLDER HUNT',
      city: 'Pittsburgh',
      theme: 'mixed',
      duration: 'quick-detour',
      description: 'Placeholder content — curated routes not loaded.',
      finalDestination: finish,
      routeIds: [route.id],
      published: false,
    },
    routes: [route],
    checkpoints,
    isFallback: true,
  };
}

/** Shape of `data/pittsburgh-hunts.json`. Kept loose; validated on load. */
interface RawBundle {
  hunt?: Hunt;
  hunts?: Hunt[];
  routes?: Route[];
  checkpoints?: Checkpoint[] | Record<string, Checkpoint>;
}

function normalize(raw: RawBundle): HuntBundle | null {
  const hunt = raw.hunt ?? raw.hunts?.[0];
  const routes = raw.routes;
  if (!hunt || !routes?.length || !raw.checkpoints) return null;

  const checkpoints: Record<string, Checkpoint> = Array.isArray(raw.checkpoints)
    ? Object.fromEntries(raw.checkpoints.map((c) => [c.id, c]))
    : raw.checkpoints;

  // Every id referenced by a route must exist, or the run will break mid-hunt
  // at an arbitrary checkpoint — far worse than refusing to load now.
  for (const route of routes) {
    for (const id of route.checkpointIds) {
      if (!checkpoints[id]) {
        console.error(`[hunt-data] route ${route.id} references missing checkpoint ${id}`);
        return null;
      }
    }
  }

  return { hunt, routes, checkpoints, isFallback: false };
}

/**
 * Where the creator dashboard parks a draft so `/play` can walk it before it
 * is published. Exported so the creator writes the same key this reads — a
 * mismatched string here fails silently, which is the worst kind of bug.
 */
export const CREATOR_PREVIEW_KEY = 'ww.creator.preview';

/** Clears the preview, so `/play` returns to published content. */
export function clearCreatorPreview(): void {
  try {
    window.localStorage.removeItem(CREATOR_PREVIEW_KEY);
    cached = null;
  } catch {
    // Private window / blocked storage. Nothing to clear.
  }
}

function readCreatorPreview(): HuntBundle | null {
  // localStorage throws outright in a private window or with site data
  // blocked, so every access is guarded rather than feature-detected.
  try {
    const raw = window.localStorage.getItem(CREATOR_PREVIEW_KEY);
    if (!raw) return null;
    const normalized = normalize(JSON.parse(raw) as RawBundle);
    if (!normalized) {
      console.error('[hunt-data] creator preview failed validation — ignoring it.');
      return null;
    }
    return normalized;
  } catch {
    return null;
  }
}

let cached: HuntBundle | null = null;

export async function loadHuntBundle(): Promise<HuntBundle> {
  if (cached) return cached;

  // 1. A creator preview takes precedence over everything.
  //
  // This is what makes P10's acceptance test true — "a checkpoint created in
  // the UI is playable without a restart". The creator writes its draft here
  // before opening /play, so an UNPUBLISHED hunt can be walked immediately.
  // Publishing is a separate, deliberate act.
  const preview = readCreatorPreview();
  if (preview) {
    console.info('[hunt-data] playing a CREATOR PREVIEW draft, not published content.');
    cached = preview;
    return cached;
  }

  // 2. Fetched at runtime rather than imported at build time, so a missing or
  // half-written content file degrades to the placeholder instead of breaking
  // the build. `scripts/sync-content.mjs` copies it into public/ on dev/build.
  try {
    const res = await fetch('/hunts/pittsburgh.json', { cache: 'no-store' });
    if (res.ok) {
      const normalized = normalize((await res.json()) as RawBundle);
      if (normalized) {
        cached = normalized;
        return cached;
      }
      console.error('[hunt-data] curated content failed validation — using placeholder.');
    } else {
      console.warn('[hunt-data] no curated content published — using placeholder.');
    }
  } catch {
    console.warn('[hunt-data] could not fetch curated content — using placeholder.');
  }

  cached = buildFallback();
  return cached;
}

/** Resolve a route's checkpoints in order. */
export function routeCheckpoints(bundle: HuntBundle, routeId: string): Checkpoint[] {
  const route = bundle.routes.find((r) => r.id === routeId) ?? bundle.routes[0];
  if (!route) return [];
  return route.checkpointIds
    .map((id) => bundle.checkpoints[id])
    .filter((c): c is Checkpoint => Boolean(c));
}
