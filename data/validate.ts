/**
 * Validate `pittsburgh-hunts.json` against the rules the game depends on.
 *
 * These are not style checks. Each one corresponds to a way the demo breaks:
 * a missing checkpoint id strands a player mid-hunt, mismatched final
 * destinations throw at route assignment, and unbalanced routes make the
 * leaderboard unfair in a way players will notice and judges will ask about.
 *
 * Run: pnpm --filter @ww/data validate
 */

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { haversineMeters, type Checkpoint, type Hunt, type Route } from '@ww/shared';

const here = dirname(fileURLToPath(import.meta.url));
const bundle = JSON.parse(readFileSync(resolve(here, 'pittsburgh-hunts.json'), 'utf8')) as {
  hunt: Hunt;
  routes: Route[];
  checkpoints: Checkpoint[];
};

const failures: string[] = [];
const warnings: string[] = [];

const fail = (msg: string) => failures.push(msg);
const warn = (msg: string) => warnings.push(msg);

const byId = new Map(bundle.checkpoints.map((c) => [c.id, c]));

// --- Structural integrity ---------------------------------------------------

for (const route of bundle.routes) {
  for (const id of route.checkpointIds) {
    if (!byId.has(id)) fail(`route ${route.id} references missing checkpoint "${id}"`);
  }
}

const lengths = new Set(bundle.routes.map((r) => r.checkpointIds.length));
if (lengths.size !== 1) {
  fail(`routes have differing checkpoint counts: ${[...lengths].join(', ')}`);
}

// --- Shared destination (hunt-engine contract) ------------------------------
// assertSharedDestination() infers the finish as the LAST checkpoint id and
// throws at route assignment if they disagree. Catch it here instead.

const finishes = new Set(bundle.routes.map((r) => r.checkpointIds.at(-1)));
if (finishes.size !== 1) {
  fail(`routes do not share a final destination: ${[...finishes].join(', ')}`);
} else if ([...finishes][0] !== bundle.hunt.finalDestination.id) {
  fail(
    `routes end at "${[...finishes][0]}" but hunt.finalDestination is "${bundle.hunt.finalDestination.id}"`,
  );
}

// --- Route overlap ----------------------------------------------------------
//
// Overlap is ALLOWED. Routes are meant to be mostly different, not disjoint:
// in a small town, or around one dense cluster of landmarks, forcing zero
// overlap would either fail generation or push players somewhere boring just
// to keep the sets apart.
//
// What the end screen needs is that each player saw something the others did
// not — so this warns when routes converge too much, rather than failing.

const OVERLAP_WARN_RATIO = 0.5;

const owners = new Map<string, string[]>();
const finishId = bundle.hunt.finalDestination.id;
for (const route of bundle.routes) {
  for (const id of route.checkpointIds) {
    if (id === finishId) continue;
    owners.set(id, [...(owners.get(id) ?? []), route.id]);
  }
}

for (const route of bundle.routes) {
  const body = route.checkpointIds.filter((id) => id !== finishId);
  const shared = body.filter((id) => (owners.get(id)?.length ?? 0) > 1);
  if (body.length && shared.length / body.length > OVERLAP_WARN_RATIO) {
    warn(
      `${route.id} shares ${shared.length}/${body.length} stops with another route — ` +
        'players will come back with much the same story',
    );
  }
}

// Total overlap IS a failure: identical routes make the whole design pointless.
for (const a of bundle.routes) {
  for (const b of bundle.routes) {
    if (a.id >= b.id) continue;
    const sa = new Set(a.checkpointIds);
    if (b.checkpointIds.every((id) => sa.has(id))) {
      fail(`routes ${a.id} and ${b.id} are identical`);
    }
  }
}

// --- Content completeness ---------------------------------------------------

for (const c of bundle.checkpoints) {
  const need: Array<[string, unknown]> = [
    ['clue', c.clue],
    ['hint', c.hint],
    ['observationQuestion', c.observationQuestion],
    ['photoRequirement', c.photoRequirement],
    ['landmarkDescription', c.landmarkDescription],
    ['historicalReveal', c.historicalReveal],
  ];
  for (const [field, value] of need) {
    if (typeof value !== 'string' || value.trim() === '') fail(`${c.id}: empty ${field}`);
  }
  if (!c.acceptedAnswers?.length) fail(`${c.id}: no acceptedAnswers`);
  if (!c.sources?.length) fail(`${c.id}: no sources cited`);
  if (c.radiusMeters < 15 || c.radiusMeters > 120) {
    warn(`${c.id}: radius ${c.radiusMeters}m is outside the usual 15-120m band`);
  }

  // The answer matcher does not compose multi-word numbers ("twenty-four"
  // canonicalizes to "20 4"), so high numeric answers need explicit variants.
  for (const a of c.acceptedAnswers) {
    if (a !== a.toLowerCase().trim()) fail(`${c.id}: acceptedAnswer "${a}" is not normalized`);
  }

  // A clue that names the landmark outright defeats the challenge.
  const firstWord = c.name.split(/[\s—(-]/)[0];
  if (firstWord && firstWord.length > 4 && c.clue.toLowerCase().includes(firstWord.toLowerCase())) {
    warn(`${c.id}: clue may name the landmark ("${firstWord}")`);
  }
}

// --- Balance ----------------------------------------------------------------

interface Summary {
  id: string;
  label: string;
  stops: number;
  meters: number;
  walkMeters: number;
  xp: number;
  minutes: number;
}

const summaries: Summary[] = bundle.routes.map((route) => {
  const cps = route.checkpointIds.map((id) => byId.get(id)!).filter(Boolean);
  let meters = 0;
  for (let i = 1; i < cps.length; i++) {
    meters += haversineMeters(cps[i - 1]!, cps[i]!);
  }
  return {
    id: route.id,
    label: route.label,
    stops: cps.length,
    meters: Math.round(meters),
    walkMeters: route.approxDistanceMeters,
    xp: cps.reduce((sum, c) => sum + c.baseXp, 0),
    minutes: Math.round(cps.reduce((s, c) => s + c.expectedCompletionSeconds, 0) / 60),
  };
});

const mean = (ns: number[]) => ns.reduce((a, b) => a + b, 0) / ns.length;

const checkSpread = (name: string, values: number[], tolerance: number, isFatal: boolean) => {
  const avg = mean(values);
  if (avg === 0) return;
  const worst = Math.max(...values.map((v) => Math.abs(v - avg) / avg));
  if (worst > tolerance) {
    const msg = `${name} spread is ${(worst * 100).toFixed(1)}% (tolerance ${(tolerance * 100).toFixed(0)}%)`;
    if (isFatal) fail(msg);
    else warn(msg);
  }
};

// Two distance measures, and which one is authoritative matters.
//
// `approxDistanceMeters` is the content author's MEASURED WALKING distance —
// actual sidewalk routing. That is the fairness-relevant number and the fatal
// check.
//
// The straight-line sum below is point-to-point crow-flight between stops. In
// a street grid interrupted by two rivers it understates walking distance
// unevenly: a route whose stops sit along one axis measures short even when
// the walk is long. So it is a loose sanity bound (warning only) — useful for
// catching a coordinate typo that teleports a checkpoint, not for judging
// balance.
checkSpread('measured walking distance', bundle.routes.map((r) => r.approxDistanceMeters), 0.2, true);
checkSpread('route base XP', summaries.map((s) => s.xp), 0.05, true);
checkSpread('expected duration', summaries.map((s) => s.minutes), 0.2, false);
checkSpread('straight-line distance (advisory)', summaries.map((s) => s.meters), 0.45, false);

// --- Report -----------------------------------------------------------------

const pad = (s: string | number, n: number) => String(s).padEnd(n);

console.log('\nRoute summary');
console.log('─'.repeat(74));
console.log(`${pad('route', 18)}${pad('label', 18)}${pad('stops', 6)}${pad('walk m', 8)}${pad('line m', 8)}${pad('base XP', 8)}min`);
console.log('─'.repeat(74));
for (const s of summaries) {
  console.log(
    `${pad(s.id, 18)}${pad(s.label, 18)}${pad(s.stops, 6)}${pad(s.walkMeters, 8)}${pad(s.meters, 8)}${pad(s.xp, 8)}${s.minutes}`,
  );
}
console.log('─'.repeat(74));
console.log(
  `${pad('MEAN', 42)}${pad(Math.round(mean(summaries.map((s) => s.walkMeters))), 8)}${pad(Math.round(mean(summaries.map((s) => s.meters))), 8)}${pad(Math.round(mean(summaries.map((s) => s.xp))), 8)}${Math.round(mean(summaries.map((s) => s.minutes)))}`,
);

console.log(`\nfinish (shared by all routes): ${bundle.hunt.finalDestination.name}`);
console.log(`checkpoints: ${bundle.checkpoints.length}  routes: ${bundle.routes.length}`);

if (warnings.length) {
  console.log(`\n⚠ ${warnings.length} warning(s):`);
  for (const w of warnings) console.log(`  · ${w}`);
}

if (failures.length) {
  console.error(`\n✖ ${failures.length} failure(s):`);
  for (const f of failures) console.error(`  · ${f}`);
  process.exit(1);
}

console.log('\n✓ content valid\n');
