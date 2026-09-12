/**
 * The creator's working document.
 *
 * A draft is the `{hunt, routes, checkpoints}` bundle that `huntData.ts`
 * consumes, held in a slightly different shape while it is being edited:
 * the shared finish is stored as an ID rather than an embedded `Checkpoint`,
 * so moving or renaming that checkpoint cannot leave two divergent copies of
 * it in the document. `toBundle()` re-embeds it on the way out.
 *
 * Every mutation here is a pure function returning a NEW draft, and every one
 * of them ends in `normalize()`. That is what makes the hunt-engine's contract
 * — every route's `checkpointIds` ends with the shared destination — an
 * invariant of the editor rather than something the user has to remember.
 */

import {
  haversineMeters,
  type Checkpoint,
  type ChallengeKind,
  type Hunt,
  type HuntDuration,
  type HuntTheme,
  type Route,
} from '@ww/shared';

/** The hunt fields a creator edits. `finalDestination` is derived, not stored. */
export interface HuntMeta {
  id: string;
  title: string;
  city: string;
  theme: HuntTheme;
  duration: HuntDuration;
  description: string;
  published: boolean;
}

export interface CreatorDraft {
  hunt: HuntMeta;
  /** The one checkpoint every route must end at. Null until designated. */
  finalDestinationId: string | null;
  routes: Route[];
  checkpoints: Checkpoint[];
  /**
   * Route id -> MEASURED walking distance in metres, as entered by a human who
   * walked it. `Route.approxDistanceMeters` means the measured walk — that is
   * the fairness-relevant number, and `data/validate.ts` makes its 20% spread a
   * FATAL check. Deriving it from crow-flight would quietly feed a guess into
   * that check and destroy any measurement carried in on import, so an override
   * always wins and the straight-line figure is only the fallback.
   */
  walkingOverrides: Record<string, number>;
  updatedAt: number;
}

/** The exact export/import shape (`data/pittsburgh-hunts.json`). */
export interface HuntBundleFile {
  hunt: Hunt;
  routes: Route[];
  checkpoints: Checkpoint[];
}

export const CHALLENGE_KINDS: ChallengeKind[] = [
  'observe-detail',
  'count-feature',
  'missing-name',
  'recreate-pose',
  'then-and-now',
  'hidden-angle',
  'narrated-event',
];

export const HUNT_THEMES: HuntTheme[] = [
  'famous-landmarks',
  'hidden-history',
  'architecture',
  'strange-stories',
  'local-legends',
  'mixed',
];

export const HUNT_DURATIONS: HuntDuration[] = ['quick-detour', 'city-quest', 'deep-dive'];

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

let counter = 0;

/** Collision-resistant enough for a single-user internal tool. */
function newId(prefix: string): string {
  counter += 1;
  return `${prefix}_${Date.now().toString(36)}${counter.toString(36)}`;
}

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

export function blankCheckpoint(latitude: number, longitude: number): Checkpoint {
  return {
    id: newId('cp'),
    name: '',
    latitude,
    longitude,
    clue: '',
    hint: '',
    hints: [],
    challengeKind: 'observe-detail',
    observationQuestion: '',
    acceptedAnswers: [],
    photoRequirement: '',
    landmarkDescription: '',
    historicalReveal: '',
    sources: [],
    radiusMeters: 50,
    baseXp: 100,
    expectedCompletionSeconds: 480,
  };
}

export function emptyDraft(): CreatorDraft {
  const huntId = newId('hunt');
  return normalize({
    hunt: {
      id: huntId,
      title: 'Untitled hunt',
      city: 'Pittsburgh',
      theme: 'mixed',
      duration: 'city-quest',
      description: '',
      published: false,
    },
    finalDestinationId: null,
    routes: [
      {
        id: newId('route'),
        huntId,
        label: 'Route A',
        checkpointIds: [],
        approxDistanceMeters: 0,
        approxDurationSeconds: 0,
      },
    ],
    checkpoints: [],
    walkingOverrides: {},
    updatedAt: Date.now(),
  });
}

// ---------------------------------------------------------------------------
// Derived geometry
// ---------------------------------------------------------------------------

/**
 * Straight-line (crow-flight) length of an ordered checkpoint list.
 *
 * ADVISORY ONLY. `data/validate.ts` explains why: in a street grid cut by two
 * rivers this understates the real walk unevenly, so it catches a coordinate
 * typo that teleports a stop, and it must never be presented as the measured
 * walking distance that fairness actually depends on.
 */
export function straightLineMeters(ordered: Checkpoint[]): number {
  let total = 0;
  for (let i = 1; i < ordered.length; i++) {
    const prev = ordered[i - 1];
    const curr = ordered[i];
    if (prev && curr) total += haversineMeters(prev, curr);
  }
  return Math.round(total);
}

export function checkpointMap(draft: CreatorDraft): Map<string, Checkpoint> {
  return new Map(draft.checkpoints.map((c) => [c.id, c]));
}

export function routeCheckpointsOf(draft: CreatorDraft, route: Route): Checkpoint[] {
  const byId = checkpointMap(draft);
  return route.checkpointIds
    .map((id) => byId.get(id))
    .filter((c): c is Checkpoint => Boolean(c));
}

// ---------------------------------------------------------------------------
// The invariant
// ---------------------------------------------------------------------------

/**
 * Re-establish every structural rule the engine relies on:
 *  - routes reference only checkpoints that exist
 *  - no checkpoint appears twice within one route
 *  - the shared destination is LAST in every route, exactly once
 *  - derived distance/duration match the current content
 *
 * `assertSharedDestination()` infers the finish as the last id and throws at
 * route assignment when routes disagree, so this runs after every edit rather
 * than only at publish time.
 */
export function normalize(draft: CreatorDraft): CreatorDraft {
  const byId = new Map(draft.checkpoints.map((c) => [c.id, c]));
  const finishId = draft.finalDestinationId && byId.has(draft.finalDestinationId)
    ? draft.finalDestinationId
    : null;

  const overrides = draft.walkingOverrides ?? {};

  const routes = draft.routes.map((route) => {
    const seen = new Set<string>();
    const ids: string[] = [];
    for (const id of route.checkpointIds) {
      if (!byId.has(id) || id === finishId || seen.has(id)) continue;
      seen.add(id);
      ids.push(id);
    }
    if (finishId) ids.push(finishId);

    const ordered = ids.map((id) => byId.get(id)).filter((c): c is Checkpoint => Boolean(c));
    const measured = overrides[route.id];
    return {
      ...route,
      huntId: draft.hunt.id,
      checkpointIds: ids,
      approxDistanceMeters: measured && measured > 0 ? measured : straightLineMeters(ordered),
      approxDurationSeconds: ordered.reduce((s, c) => s + c.expectedCompletionSeconds, 0),
    };
  });

  return {
    ...draft,
    finalDestinationId: finishId,
    walkingOverrides: overrides,
    routes,
    updatedAt: Date.now(),
  };
}

// ---------------------------------------------------------------------------
// Mutations (pure)
// ---------------------------------------------------------------------------

export function addCheckpoint(
  draft: CreatorDraft,
  latitude: number,
  longitude: number,
  routeId: string | null,
): { draft: CreatorDraft; checkpoint: Checkpoint } {
  const checkpoint = blankCheckpoint(latitude, longitude);
  const next = normalize({
    ...draft,
    checkpoints: [...draft.checkpoints, checkpoint],
    routes: draft.routes.map((r) =>
      r.id === routeId ? { ...r, checkpointIds: [...r.checkpointIds, checkpoint.id] } : r,
    ),
  });
  return { draft: next, checkpoint };
}

export function updateCheckpoint(
  draft: CreatorDraft,
  id: string,
  patch: Partial<Checkpoint>,
): CreatorDraft {
  return normalize({
    ...draft,
    checkpoints: draft.checkpoints.map((c) => (c.id === id ? { ...c, ...patch, id: c.id } : c)),
  });
}

export function removeCheckpoint(draft: CreatorDraft, id: string): CreatorDraft {
  return normalize({
    ...draft,
    finalDestinationId: draft.finalDestinationId === id ? null : draft.finalDestinationId,
    checkpoints: draft.checkpoints.filter((c) => c.id !== id),
    routes: draft.routes.map((r) => ({
      ...r,
      checkpointIds: r.checkpointIds.filter((cid) => cid !== id),
    })),
  });
}

export function setFinalDestination(draft: CreatorDraft, id: string | null): CreatorDraft {
  return normalize({ ...draft, finalDestinationId: id });
}

export function addRoute(draft: CreatorDraft): CreatorDraft {
  const label = `Route ${String.fromCharCode(65 + draft.routes.length)}`;
  return normalize({
    ...draft,
    routes: [
      ...draft.routes,
      {
        id: newId('route'),
        huntId: draft.hunt.id,
        label,
        checkpointIds: [],
        approxDistanceMeters: 0,
        approxDurationSeconds: 0,
      },
    ],
  });
}

export function renameRoute(draft: CreatorDraft, routeId: string, label: string): CreatorDraft {
  return normalize({
    ...draft,
    routes: draft.routes.map((r) => (r.id === routeId ? { ...r, label } : r)),
  });
}

export function removeRoute(draft: CreatorDraft, routeId: string): CreatorDraft {
  return normalize({ ...draft, routes: draft.routes.filter((r) => r.id !== routeId) });
}

/** Record (or clear, with null) the measured walking distance for a route. */
export function setWalkingDistance(
  draft: CreatorDraft,
  routeId: string,
  meters: number | null,
): CreatorDraft {
  const next = { ...(draft.walkingOverrides ?? {}) };
  if (meters && meters > 0) next[routeId] = Math.round(meters);
  else delete next[routeId];
  return normalize({ ...draft, walkingOverrides: next });
}

export function assignCheckpoint(
  draft: CreatorDraft,
  routeId: string,
  checkpointId: string,
): CreatorDraft {
  return normalize({
    ...draft,
    routes: draft.routes.map((r) =>
      r.id === routeId ? { ...r, checkpointIds: [...r.checkpointIds, checkpointId] } : r,
    ),
  });
}

export function unassignCheckpoint(
  draft: CreatorDraft,
  routeId: string,
  checkpointId: string,
): CreatorDraft {
  return normalize({
    ...draft,
    routes: draft.routes.map((r) =>
      r.id === routeId
        ? { ...r, checkpointIds: r.checkpointIds.filter((id) => id !== checkpointId) }
        : r,
    ),
  });
}

/**
 * Move a checkpoint one slot within its route. The shared finish is excluded
 * from reordering entirely — it is appended by `normalize()` and cannot be
 * displaced, because the engine reads the LAST id as the finish.
 */
export function reorderCheckpoint(
  draft: CreatorDraft,
  routeId: string,
  checkpointId: string,
  direction: -1 | 1,
): CreatorDraft {
  if (checkpointId === draft.finalDestinationId) return draft;

  return normalize({
    ...draft,
    routes: draft.routes.map((route) => {
      if (route.id !== routeId) return route;
      const body = route.checkpointIds.filter((id) => id !== draft.finalDestinationId);
      const from = body.indexOf(checkpointId);
      const to = from + direction;
      if (from < 0 || to < 0 || to >= body.length) return route;
      const swapped = [...body];
      const a = swapped[from];
      const b = swapped[to];
      if (a === undefined || b === undefined) return route;
      swapped[from] = b;
      swapped[to] = a;
      return { ...route, checkpointIds: swapped };
    }),
  });
}

/** Which route (if any) owns a checkpoint, and at what 1-based position. */
export function placementOf(
  draft: CreatorDraft,
  checkpointId: string,
): { routeId: string; position: number; total: number } | null {
  for (const route of draft.routes) {
    const index = route.checkpointIds.indexOf(checkpointId);
    if (index >= 0) {
      return { routeId: route.id, position: index + 1, total: route.checkpointIds.length };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Import / export
// ---------------------------------------------------------------------------

export function toBundle(draft: CreatorDraft): HuntBundleFile | null {
  const finish = draft.checkpoints.find((c) => c.id === draft.finalDestinationId);
  if (!finish) return null;

  const hunt: Hunt = {
    ...draft.hunt,
    finalDestination: finish,
    routeIds: draft.routes.map((r) => r.id),
  };
  return { hunt, routes: draft.routes, checkpoints: draft.checkpoints };
}

export function fromBundle(bundle: HuntBundleFile): CreatorDraft {
  const checkpoints = Array.isArray(bundle.checkpoints) ? bundle.checkpoints : [];
  const finish = bundle.hunt.finalDestination;

  // The embedded finalDestination may not be present in the checkpoint list
  // (older exports inlined it). Fold it in rather than dropping the finish.
  const merged = checkpoints.some((c) => c.id === finish?.id)
    ? checkpoints
    : finish
      ? [...checkpoints, finish]
      : checkpoints;

  return normalize({
    hunt: {
      id: bundle.hunt.id,
      title: bundle.hunt.title,
      city: bundle.hunt.city,
      theme: bundle.hunt.theme,
      duration: bundle.hunt.duration,
      description: bundle.hunt.description,
      published: bundle.hunt.published,
    },
    finalDestinationId: finish?.id ?? null,
    routes: bundle.routes ?? [],
    checkpoints: merged,
    // An imported bundle's approxDistanceMeters IS someone's measured walk.
    // Adopting it as an override is what stops normalize() from replacing
    // curated measurements with crow-flight on the first edit.
    walkingOverrides: Object.fromEntries(
      (bundle.routes ?? [])
        .filter((r) => r.approxDistanceMeters > 0)
        .map((r) => [r.id, r.approxDistanceMeters]),
    ),
    updatedAt: Date.now(),
  });
}

/** Load the curated Pittsburgh content as a starting point. */
export async function importCuratedSeed(): Promise<CreatorDraft> {
  const res = await fetch('/hunts/pittsburgh.json', { cache: 'no-store' });
  if (!res.ok) throw new Error(`Curated content unavailable (HTTP ${res.status})`);
  return fromBundle((await res.json()) as HuntBundleFile);
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

const STORAGE_KEY = 'ww.creator.draft.v1';

/**
 * Every localStorage call is wrapped: Safari private mode throws on write,
 * and a draft carrying reference-image data URLs can exceed the ~5MB quota.
 * Losing autosave is survivable; a thrown exception mid-keystroke is not.
 */
export function saveDraft(draft: CreatorDraft): { ok: true } | { ok: false; reason: string } {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(draft));
    return { ok: true };
  } catch (err) {
    const quota = err instanceof DOMException && err.name === 'QuotaExceededError';
    return {
      ok: false,
      reason: quota
        ? 'Draft too large for local storage (reference images). Export to a file.'
        : 'Local storage unavailable — export to a file before closing this tab.',
    };
  }
}

export function loadDraft(): CreatorDraft | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CreatorDraft;
    if (!parsed?.hunt || !Array.isArray(parsed.routes) || !Array.isArray(parsed.checkpoints)) {
      return null;
    }
    return normalize(parsed);
  } catch {
    return null;
  }
}

export function clearDraft(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* nothing to do — the draft simply outlives this tab */
  }
}

/** Trigger a browser download of the bundle in the exact shape huntData reads. */
export function downloadBundle(bundle: HuntBundleFile, filename: string): void {
  const blob = new Blob([`${JSON.stringify(bundle, null, 2)}\n`], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
