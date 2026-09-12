/**
 * Live content validation for the creator.
 *
 * These rules are a reimplementation of `data/validate.ts` — deliberately not
 * an import. That file is a Node script inside `@ww/data`: it reads the
 * filesystem and calls `process.exit`, neither of which belongs in a browser
 * bundle. The RULES are shared; the plumbing is not.
 *
 * Each hard rule corresponds to a specific way the demo breaks:
 *  - mismatched finishes throw inside `assertSharedDestination()` at route
 *    assignment — i.e. the instant a player presses Start
 *  - unequal route lengths make the leaderboard unfair in a way players notice
 *  - a checkpoint shared between two routes quietly destroys the end-screen
 *    "you each saw different history" comparison
 *  - missing content strands a player at a stop with nothing to do
 *
 * Errors block publish. Warnings never do — they are judgement calls, and a
 * creator who knows the content better should be able to overrule them.
 */

import { haversineMeters, type Checkpoint, type Route } from '@ww/shared';
import { straightLineMeters, type CreatorDraft } from './creatorDraft';

export type RuleId =
  | 'structure'
  | 'equal-length'
  | 'shared-finish'
  | 'exclusivity'
  | 'content'
  | 'answers-normalized';

export interface ValidationIssue {
  level: 'error' | 'warning';
  rule: RuleId | 'advisory';
  message: string;
  checkpointId?: string;
  routeId?: string;
}

/** One issue before the runner stamps a level and rule onto it. */
type Finding = Omit<ValidationIssue, 'level' | 'rule'>;

export interface RuleCheck {
  id: RuleId;
  label: string;
  ok: boolean;
  failures: number;
}

export interface RouteSummary {
  id: string;
  label: string;
  stops: number;
  /** Crow-flight. ADVISORY — see straightLineMeters(). */
  straightLineMeters: number;
  baseXp: number;
  expectedMinutes: number;
}

export interface ValidationReport {
  checks: RuleCheck[];
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
  summaries: RouteSummary[];
  publishable: boolean;
}

const HARD_RULES: Array<{ id: RuleId; label: string }> = [
  { id: 'structure', label: 'Hunt and routes are structurally complete' },
  { id: 'equal-length', label: 'Every route has the same number of checkpoints' },
  { id: 'shared-finish', label: 'All routes end at the same final destination' },
  { id: 'exclusivity', label: 'Every route has at least one exclusive stop' },
  { id: 'content', label: 'Every checkpoint has all three layers filled in' },
  { id: 'answers-normalized', label: 'Accepted answers are lowercase and trimmed' },
];

const isBlank = (v: unknown): boolean => typeof v !== 'string' || v.trim() === '';
const nameOf = (c: Checkpoint | undefined): string => c?.name.trim() || 'Untitled checkpoint';
const mean = (ns: number[]): number => (ns.length ? ns.reduce((a, b) => a + b, 0) / ns.length : 0);

/** Worst relative deviation from the mean, as a fraction. */
function spread(values: number[]): number {
  const avg = mean(values);
  if (avg === 0) return 0;
  return Math.max(...values.map((v) => Math.abs(v - avg) / avg));
}

interface Ctx {
  draft: CreatorDraft;
  byId: Map<string, Checkpoint>;
  finishId: string | null;
  /** checkpoint id -> the route that claimed it first (finish excluded). */
  owner: Map<string, Route>;
}

// ---------------------------------------------------------------------------
// Hard rules
// ---------------------------------------------------------------------------

function checkStructure({ draft, byId }: Ctx): Finding[] {
  const out: Finding[] = [];
  if (draft.routes.length === 0) out.push({ message: 'The hunt has no routes.' });
  if (isBlank(draft.hunt.title)) out.push({ message: 'The hunt has no title.' });

  for (const route of draft.routes) {
    for (const id of route.checkpointIds) {
      if (!byId.has(id)) {
        out.push({
          message: `Route "${route.label}" references a checkpoint that no longer exists.`,
          routeId: route.id,
        });
      }
    }
    if (route.checkpointIds.length < 2) {
      out.push({
        message: `Route "${route.label}" needs at least one stop before the finish.`,
        routeId: route.id,
      });
    }
  }
  return out;
}

function checkEqualLength({ draft }: Ctx): Finding[] {
  const lengths = new Set(draft.routes.map((r) => r.checkpointIds.length));
  if (lengths.size <= 1) return [];
  return [
    { message: `Routes have different numbers of checkpoints: ${[...lengths].sort().join(', ')}.` },
  ];
}

function checkSharedFinish({ draft, byId, finishId }: Ctx): Finding[] {
  if (!finishId || !byId.has(finishId)) {
    return [{ message: 'No shared final destination has been designated.' }];
  }
  if (draft.routes.length === 0) return [];

  const endings = new Set(draft.routes.map((r) => r.checkpointIds.at(-1)));
  if (endings.size !== 1 || !endings.has(finishId)) {
    return [{ message: 'Routes do not all end at the shared final destination.' }];
  }
  return [];
}

/**
 * Overlap between routes is ALLOWED and often necessary — in a small town, or
 * around one dense cluster of landmarks, forcing disjoint sets would push
 * players somewhere boring purely to keep the sets apart.
 *
 * What the finish-line comparison actually needs is weaker: every route must
 * show its player at least ONE thing the others did not. That is what makes
 * "what did you find?" worth asking.
 */
function checkExclusivity(ctx: Ctx): Finding[] {
  const out: Finding[] = [];
  for (const route of ctx.draft.routes) {
    const others = new Set(
      ctx.draft.routes.filter((r) => r.id !== route.id).flatMap((r) => r.checkpointIds),
    );
    const exclusive = route.checkpointIds.filter(
      (id) => id !== ctx.finishId && !others.has(id),
    );
    if (route.checkpointIds.length > 1 && exclusive.length === 0) {
      out.push({
        message: `"${route.label}" has no stop of its own — its player would have nothing different to compare at the finish.`,
        routeId: route.id,
      });
    }
  }
  return out;
}

function checkContent({ draft }: Ctx): Finding[] {
  const out: Finding[] = [];
  for (const cp of draft.checkpoints) {
    const label = nameOf(cp);
    const required: Array<[string, unknown]> = [
      ['clue', cp.clue],
      ['observation question', cp.observationQuestion],
      ['photo requirement', cp.photoRequirement],
      ['landmark description', cp.landmarkDescription],
      ['historical reveal', cp.historicalReveal],
    ];
    for (const [field, value] of required) {
      if (isBlank(value)) out.push({ message: `${label}: empty ${field}.`, checkpointId: cp.id });
    }
    if (!cp.acceptedAnswers.length) {
      out.push({ message: `${label}: no accepted answers.`, checkpointId: cp.id });
    }
    if (!cp.sources.length) {
      out.push({ message: `${label}: the reveal cites no sources.`, checkpointId: cp.id });
    }
    if (cp.sources.some((s) => isBlank(s.title))) {
      out.push({ message: `${label}: a source has no title.`, checkpointId: cp.id });
    }
  }
  return out;
}

function checkAnswersNormalized({ draft }: Ctx): Finding[] {
  const out: Finding[] = [];
  for (const cp of draft.checkpoints) {
    for (const answer of cp.acceptedAnswers) {
      if (answer !== answer.toLowerCase().trim()) {
        out.push({
          message: `${nameOf(cp)}: accepted answer "${answer}" is not lowercased and trimmed.`,
          checkpointId: cp.id,
        });
      }
    }
  }
  return out;
}

const RULE_FNS: Record<RuleId, (ctx: Ctx) => Finding[]> = {
  structure: checkStructure,
  'equal-length': checkEqualLength,
  'shared-finish': checkSharedFinish,
  exclusivity: checkExclusivity,
  content: checkContent,
  'answers-normalized': checkAnswersNormalized,
};

// ---------------------------------------------------------------------------
// Warnings
// ---------------------------------------------------------------------------

/**
 * The answer matcher canonicalizes digits but does not COMPOSE multi-word
 * numbers: "twenty-four" becomes "20 4", which never matches "24". Anything
 * above twenty therefore needs spelled-out variants added by hand.
 */
function isUncomposableNumber(answer: string): boolean {
  return /^\d+$/.test(answer) && Number(answer) > 20;
}

/** A clue that names its own landmark defeats the entire challenge. */
function clueNamesLandmark(cp: Checkpoint): string | null {
  const firstWord = cp.name.split(/[\s—(-]/)[0];
  if (!firstWord || firstWord.length <= 4) return null;
  return cp.clue.toLowerCase().includes(firstWord.toLowerCase()) ? firstWord : null;
}

function checkpointWarnings(ctx: Ctx): Finding[] {
  const out: Finding[] = [];
  for (const cp of ctx.draft.checkpoints) {
    const label = nameOf(cp);
    const at = { checkpointId: cp.id };

    for (const answer of cp.acceptedAnswers) {
      if (isUncomposableNumber(answer)) {
        out.push({
          message: `${label}: "${answer}" is above twenty — the matcher cannot compose "twenty-four", so add spelled-out variants.`,
          ...at,
        });
      }
    }

    const named = clueNamesLandmark(cp);
    if (named) out.push({ message: `${label}: the clue may name its own landmark ("${named}").`, ...at });

    if (isBlank(cp.hint) && !cp.hints?.length) {
      out.push({ message: `${label}: no hint — the hint button will have nothing to show.`, ...at });
    }
    if (isBlank(cp.name)) {
      out.push({ message: 'A checkpoint has no name — the name is shown after completion.', ...at });
    }
    if (cp.radiusMeters < 15 || cp.radiusMeters > 120) {
      out.push({ message: `${label}: radius ${cp.radiusMeters}m is outside the usual 15–120m band.`, ...at });
    }
    if (!ctx.owner.has(cp.id) && cp.id !== ctx.finishId) {
      out.push({ message: `${label}: not assigned to any route — it will ship unreachable.`, ...at });
    }
  }
  return out;
}

function balanceWarnings(summaries: RouteSummary[], draft: CreatorDraft): Finding[] {
  if (summaries.length < 2) return [];
  const out: Finding[] = [];

  // The measured walk, where a human has entered one, is the number that
  // actually decides whether the routes are fair to each other.
  const measured = draft.routes.map((r) => draft.walkingOverrides?.[r.id] ?? 0);
  if (measured.every((m) => m > 0)) {
    const walk = spread(measured);
    if (walk > 0.2) {
      out.push({
        message: `Measured walking distance varies by ${(walk * 100).toFixed(0)}% (tolerance 20%). This is the one that makes routes unfair.`,
      });
    }
  } else {
    out.push({
      message: 'Some routes have no measured walking distance — straight-line is standing in, and it understates the real walk unevenly.',
    });
  }

  // Straight-line only. data/validate.ts explains why this is advisory: in a
  // street grid cut by two rivers, crow-flight understates the real walk
  // unevenly, so it catches a coordinate typo — not an unfair route.
  const distance = spread(summaries.map((s) => s.straightLineMeters));
  if (distance > 0.45) {
    out.push({
      message: `Straight-line route length varies by ${(distance * 100).toFixed(0)}% (advisory, tolerance 45%). Crow-flight is a sanity bound, not the walk — measure the sidewalk route before trusting it.`,
    });
  }
  const xp = spread(summaries.map((s) => s.baseXp));
  if (xp > 0.05) out.push({ message: `Route base XP varies by ${(xp * 100).toFixed(0)}% (tolerance 5%).` });

  const time = spread(summaries.map((s) => s.expectedMinutes));
  if (time > 0.2) {
    out.push({ message: `Expected duration varies by ${(time * 100).toFixed(0)}% (tolerance 20%).` });
  }
  return out;
}

// ---------------------------------------------------------------------------

function summarize(ctx: Ctx): RouteSummary[] {
  return ctx.draft.routes.map((route) => {
    const ordered = route.checkpointIds
      .map((id) => ctx.byId.get(id))
      .filter((c): c is Checkpoint => Boolean(c));
    return {
      id: route.id,
      label: route.label,
      stops: ordered.length,
      straightLineMeters: straightLineMeters(ordered),
      baseXp: ordered.reduce((s, c) => s + c.baseXp, 0),
      expectedMinutes: Math.round(ordered.reduce((s, c) => s + c.expectedCompletionSeconds, 0) / 60),
    };
  });
}

export function validateDraft(draft: CreatorDraft): ValidationReport {
  const ctx: Ctx = {
    draft,
    byId: new Map(draft.checkpoints.map((c) => [c.id, c])),
    finishId: draft.finalDestinationId,
    owner: new Map(),
  };

  const errors: ValidationIssue[] = [];
  const checks: RuleCheck[] = HARD_RULES.map(({ id, label }) => {
    const findings = RULE_FNS[id](ctx);
    for (const f of findings) errors.push({ level: 'error', rule: id, ...f });
    return { id, label, ok: findings.length === 0, failures: findings.length };
  });

  const summaries = summarize(ctx);
  const warnings: ValidationIssue[] = [...checkpointWarnings(ctx), ...balanceWarnings(summaries, draft)].map(
    (f) => ({ level: 'warning', rule: 'advisory', ...f }),
  );

  return { checks, errors, warnings, summaries, publishable: errors.length === 0 };
}

/** Distance from a checkpoint to the shared finish. Straight-line, advisory. */
export function metersToFinish(draft: CreatorDraft, cp: Checkpoint): number | null {
  const finish = draft.checkpoints.find((c) => c.id === draft.finalDestinationId);
  if (!finish || finish.id === cp.id) return null;
  return Math.round(haversineMeters(cp, finish));
}
