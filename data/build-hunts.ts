/**
 * Build `pittsburgh-hunts.json` from the curated "Three Rivers Run" seed.
 *
 * The seed (`data/source/three-rivers-run.seed.ts`) is the human-authored
 * content of record. It uses its own richer shape — two-tier hints, per-field
 * verification notes, audio scripts, accessibility warnings — and this script
 * projects it onto the `@ww/shared` domain types the app consumes.
 *
 * Keeping the seed in its own shape is deliberate: content authors should not
 * have to track engineering type changes, and the app should not inherit
 * fields it has no use for. This adapter is the one place the two meet.
 *
 * Run:  pnpm --filter @ww/data build
 */

import { writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ChallengeKind, Checkpoint, Hunt, HistoricalSource, Route } from '@ww/shared';
import {
  checkpoints as seedCheckpoints,
  finalDestination as seedFinal,
  routes as seedRoutes,
} from './source/three-rivers-run.seed.js';

const here = dirname(fileURLToPath(import.meta.url));

/**
 * Sources in the seed are bare titles ("ASCE Historic Landmarks"). Where a
 * canonical URL is well known it is attached here so the reveal can cite a
 * link; otherwise the title stands alone rather than inventing a URL.
 */
const SOURCE_URLS: Record<string, string> = {
  'Wikipedia: Smithfield Street Bridge': 'https://en.wikipedia.org/wiki/Smithfield_Street_Bridge',
  'ASCE Historic Landmarks': 'https://www.asce.org/about-civil-engineering/history-and-heritage/historic-landmarks',
  'SAH Archipedia': 'https://sah-archipedia.org/',
  'PA DCNR': 'https://www.dcnr.pa.gov/StateParks/FindAPark/PointStatePark/',
  NPS: 'https://www.nps.gov/',
  Clio: 'https://theclio.com/',
  'Great Allegheny Passage': 'https://gaptrail.org/',
};

function toSources(titles: readonly string[]): HistoricalSource[] {
  return titles.map((title) => {
    const url = SOURCE_URLS[title];
    return url ? { title, url } : { title };
  });
}

/**
 * The seed describes each challenge in prose rather than tagging it, so the
 * kind is assigned here per checkpoint. Explicit beats inferred: a keyword
 * heuristic over prose would silently mislabel, and `challengeKind` drives
 * which UI affordance the player sees.
 */
const CHALLENGE_KINDS: Record<string, ChallengeKind> = {
  cp_smithfield_bridge: 'observe-detail',
  cp_market_square: 'observe-detail',
  cp_ppg_place: 'count-feature',
  cp_block_house: 'then-and-now',
  cp_us_steel_tower: 'observe-detail',
  cp_courthouse_bridge_of_sighs: 'hidden-angle',
  cp_kaufmanns_clock: 'missing-name',
  cp_dollar_bank_lions: 'recreate-pose',
  cp_katz_plaza: 'observe-detail',
  cp_byham_theater: 'then-and-now',
  cp_clemente_bridge: 'count-feature',
  cp_fort_duquesne_outline: 'narrated-event',
  final_point_fountain: 'narrated-event',
};

/** Structural subset of a seed entry. Kept loose — the seed is `as const`. */
interface SeedLike {
  id: string;
  name: string;
  realWorldLocation?: string;
  coordinates: { latitude: number; longitude: number };
  radiusMeters: number;
  clue: string;
  hints?: readonly { readonly text: string; readonly costXp: number }[];
  timing?: { walkFromPrevMin?: number; challengeMin?: number };
  challenge?: {
    observation?: string;
    answerQuestion?: string;
    acceptedAnswerCriteria?: readonly string[];
  };
  finalChallenge?: string;
  answerQuestion?: string;
  acceptedAnswerCriteria?: readonly string[];
  verification?: { landmarkMatch?: string; confidenceConcerns?: string };
  scoring?: { baseXp?: number };
  historicalReveal?: { full?: string; audioShort?: string };
  sources?: readonly string[];
  accessibility?: string;
  demo?: { referenceImageId?: string };
}

function adapt(seed: SeedLike): Checkpoint {
  // The final destination puts its challenge fields at the top level; the
  // ordinary checkpoints nest them under `challenge`.
  const question = seed.challenge?.answerQuestion ?? seed.answerQuestion ?? '';
  const accepted = seed.challenge?.acceptedAnswerCriteria ?? seed.acceptedAnswerCriteria ?? [];
  const photoRequirement = seed.challenge?.observation ?? seed.finalChallenge ?? '';

  const hints = seed.hints?.map((h) => ({ text: h.text, costXp: h.costXp })) ?? [];

  const walkMin = seed.timing?.walkFromPrevMin ?? 0;
  const challengeMin = seed.timing?.challengeMin ?? 5;

  const kind = CHALLENGE_KINDS[seed.id];
  if (!kind) throw new Error(`No challengeKind mapped for checkpoint "${seed.id}"`);

  const checkpoint: Checkpoint = {
    id: seed.id,
    name: seed.name,
    latitude: seed.coordinates.latitude,
    longitude: seed.coordinates.longitude,

    clue: seed.clue,
    hint: hints[0]?.text ?? 'No hint available for this checkpoint.',
    hints,

    challengeKind: kind,
    observationQuestion: question,
    // Answer matching is case-insensitive downstream, but normalizing here
    // means the stored content is already in the form the matcher compares.
    acceptedAnswers: accepted.map((a) => a.toLowerCase().trim()),
    photoRequirement,
    landmarkDescription: seed.verification?.landmarkMatch ?? '',

    historicalReveal: seed.historicalReveal?.full ?? '',
    sources: toSources(seed.sources ?? []),

    radiusMeters: seed.radiusMeters,
    baseXp: seed.scoring?.baseXp ?? 100,
    // The speed clock starts when the checkpoint unlocks, so the expected time
    // must include the walk from the previous stop, not just the solve.
    expectedCompletionSeconds: (walkMin + challengeMin) * 60,
  };

  if (seed.verification?.confidenceConcerns) {
    checkpoint.confidenceConcerns = seed.verification.confidenceConcerns;
  }
  if (seed.historicalReveal?.audioShort) checkpoint.audioShort = seed.historicalReveal.audioShort;
  if (seed.realWorldLocation) checkpoint.realWorldLocation = seed.realWorldLocation;
  if (seed.accessibility) checkpoint.accessibility = seed.accessibility;
  if (seed.demo?.referenceImageId) checkpoint.referenceImageId = seed.demo.referenceImageId;

  return checkpoint;
}

// ---------------------------------------------------------------------------

const finalCheckpoint = adapt(seedFinal as unknown as SeedLike);

const checkpoints: Checkpoint[] = [
  ...(seedCheckpoints as unknown as SeedLike[]).map(adapt),
  finalCheckpoint,
];

const HUNT_ID = 'hunt_three_rivers_run';

const routes: Route[] = (seedRoutes as unknown as Array<{
  id: string;
  name: string;
  checkpointIds: readonly string[];
  estimatedWalkingDistanceKm: number;
  expectedCompletionMinutes: number;
}>).map((r) => ({
  id: r.id,
  huntId: HUNT_ID,
  label: r.name,
  // The engine infers the shared destination as the LAST checkpoint id, so the
  // finish must be appended to every route rather than living only on the hunt.
  checkpointIds: [...r.checkpointIds, finalCheckpoint.id],
  approxDistanceMeters: Math.round(r.estimatedWalkingDistanceKm * 1000),
  approxDurationSeconds: r.expectedCompletionMinutes * 60,
}));

const hunt: Hunt = {
  id: HUNT_ID,
  title: 'Three Rivers Run',
  city: 'Pittsburgh',
  theme: 'mixed',
  duration: 'city-quest',
  description:
    'Three asymmetric trails through Downtown Pittsburgh — rivers and founding, steel and money, arts and discovery — all converging at the Point where two rivers become a third.',
  finalDestination: finalCheckpoint,
  routeIds: routes.map((r) => r.id),
  published: true,
};

const bundle = { hunt, routes, checkpoints };

const out = resolve(here, 'pittsburgh-hunts.json');
writeFileSync(out, `${JSON.stringify(bundle, null, 2)}\n`, 'utf8');

console.log(`[build-hunts] wrote ${out}`);
console.log(`[build-hunts] ${routes.length} routes, ${checkpoints.length} checkpoints`);
