/**
 * XP scoring. Pure, deterministic, and the only place XP is ever computed.
 *
 * Gemini never awards XP; it returns observations. The server turns those
 * observations plus the geofence result plus the clock into an `XpBreakdown`
 * here, so that the browser, the room and the results screen cannot disagree.
 */

import { XP_RULES, type XpBreakdown } from '@ww/shared';

// ---------------------------------------------------------------------------
// Speed-bonus tuning
// ---------------------------------------------------------------------------

/**
 * Fraction of SPEED_BONUS_MAX awarded to a player who takes exactly the
 * expected time. 0.5 keeps "on pace" comfortably mid-range: there is room to
 * gain by hurrying and room to lose by dawdling.
 */
export const NEUTRAL_SPEED_FRACTION = 0.5;

/**
 * The ratio at which the bonus saturates (and, reciprocally, bottoms out).
 * 4x faster than expected earns the full bonus; 4x slower earns none.
 */
export const SPEED_SATURATION_RATIO = 4;

/**
 * A checkpoint physically cannot be finished faster than this: the player has
 * to walk to it, frame a photo of the right landmark performing a randomized
 * action, and type an answer. Anything quicker is a broken clock, a replayed
 * submission or a timezone bug — not a world record.
 */
export const MIN_PLAUSIBLE_SECONDS = 5;

const isPositiveFinite = (n: number): boolean => typeof n === 'number' && Number.isFinite(n) && n > 0;

const clamp01 = (n: number): number => (n < 0 ? 0 : n > 1 ? 1 : n);

const safeCount = (n: number): number =>
  Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : 0;

/**
 * Multiplying a negative rule by zero attempts yields -0, which survives into
 * the breakdown, compares oddly and renders as "-0" in a UI. Normalize it.
 */
const noNegativeZero = (n: number): number => (n === 0 ? 0 : n);

/**
 * Speed bonus, normalized per checkpoint.
 *
 * Raw elapsed time is meaningless across routes: players walk different
 * distances on different streets. What IS comparable is how a player performed
 * against the expectation set for the checkpoint they were given, so the input
 * is a ratio:
 *
 *     speedRatio = expectedCompletionSeconds / actualSeconds
 *
 * The curve is logarithmic in that ratio:
 *
 *     fraction = 0.5 + 0.5 * log2(ratio) / log2(SPEED_SATURATION_RATIO)
 *     bonus    = SPEED_BONUS_MAX * clamp(fraction, 0, 1)
 *
 * Why logarithmic rather than linear in the ratio:
 *   - It is symmetric around "on pace". Being twice as fast gains exactly as
 *     much as being twice as slow loses (+/- 12.5 XP of 50). A linear ratio is
 *     wildly asymmetric: it is bounded below by 0 but unbounded above, so one
 *     lucky checkpoint would swamp four honest ones.
 *   - It has diminishing returns, so shaving seconds off an already-fast
 *     checkpoint is worth little. That matters for player safety: we do not
 *     want an incentive to sprint across Downtown traffic.
 *   - It saturates. Combined with the hard clamp at SPEED_BONUS_MAX, a single
 *     anomalous checkpoint can contribute at most 50 XP against the 150 XP a
 *     normal checkpoint yields, so the leaderboard still ranks on completion,
 *     accuracy and hint discipline first.
 *
 * Degenerate inputs (NaN, Infinity, zero or negative durations, an
 * implausibly fast completion, or content with a nonsensical expected time)
 * return the NEUTRAL bonus rather than the maximum. The player is not
 * punished for our clock skew, and a skewed clock is not a way to farm the
 * maximum bonus.
 */
export function speedBonus(expectedCompletionSeconds: number, actualSeconds: number): number {
  const max = XP_RULES.SPEED_BONUS_MAX;
  const neutral = Math.round(max * NEUTRAL_SPEED_FRACTION);

  if (!isPositiveFinite(expectedCompletionSeconds)) return neutral;
  if (!isPositiveFinite(actualSeconds)) return neutral;
  if (actualSeconds < MIN_PLAUSIBLE_SECONDS) return neutral;

  const ratio = expectedCompletionSeconds / actualSeconds;
  if (!isPositiveFinite(ratio)) return neutral;

  const fraction = 0.5 + (0.5 * Math.log2(ratio)) / Math.log2(SPEED_SATURATION_RATIO);
  return Math.round(max * clamp01(fraction));
}

// ---------------------------------------------------------------------------
// Checkpoint scoring
// ---------------------------------------------------------------------------

export interface CheckpointScoreInput {
  /** Defaults to XP_RULES.CHECKPOINT_COMPLETION; use `Checkpoint.baseXp`. */
  baseXp?: number;
  expectedCompletionSeconds: number;
  /** Wall-clock seconds from the checkpoint being unlocked to it being solved. */
  actualSeconds: number;
  /** False for a checkpoint the player never solved (abandoned / timed out). */
  completed?: boolean;
  answerCorrect: boolean;
  hintUsed: boolean;
  /** Rejected submissions, NOT counting the successful one. */
  incorrectAttempts: number;
  hiddenDetailFound?: boolean;
  /** True for the shared final destination — pays the route completion bonus. */
  isFinalCheckpoint?: boolean;
}

export function emptyBreakdown(): XpBreakdown {
  return {
    checkpointCompletion: 0,
    correctObservation: 0,
    speedBonus: 0,
    noHintBonus: 0,
    hiddenDetailBonus: 0,
    incorrectPenalty: 0,
    hintPenalty: 0,
    routeCompletionBonus: 0,
    total: 0,
  };
}

const sumFields = (b: XpBreakdown): number =>
  b.checkpointCompletion +
  b.correctObservation +
  b.speedBonus +
  b.noHintBonus +
  b.hiddenDetailBonus +
  b.incorrectPenalty +
  b.hintPenalty +
  b.routeCompletionBonus;

/**
 * Score one checkpoint.
 *
 * The floor: `total` is clamped at 0 per checkpoint, and again for the run.
 * Penalties are deliberately still reported in the individual fields so the
 * results screen can show the player exactly what their hints and wrong
 * answers cost, but a bad checkpoint can only cancel its own rewards — it can
 * never claw back XP already earned at an earlier checkpoint. A visibly
 * decreasing XP counter mid-hunt reads as a bug, discourages retrying, and
 * (since failed attempts are unbounded) would let a player grief themselves
 * into a negative score. Hence: sum the ledger, then clamp at zero.
 */
export function scoreCheckpoint(input: CheckpointScoreInput): XpBreakdown {
  const completed = input.completed !== false;
  const attempts = safeCount(input.incorrectAttempts);
  const base = Number.isFinite(input.baseXp ?? NaN)
    ? Math.max(0, input.baseXp as number)
    : XP_RULES.CHECKPOINT_COMPLETION;

  const breakdown: XpBreakdown = {
    checkpointCompletion: completed ? base : 0,
    correctObservation: completed && input.answerCorrect ? XP_RULES.CORRECT_OBSERVATION : 0,
    speedBonus: completed ? speedBonus(input.expectedCompletionSeconds, input.actualSeconds) : 0,
    noHintBonus: completed && !input.hintUsed ? XP_RULES.NO_HINT_BONUS : 0,
    hiddenDetailBonus: completed && input.hiddenDetailFound ? XP_RULES.HIDDEN_DETAIL_BONUS : 0,
    incorrectPenalty: noNegativeZero(XP_RULES.INCORRECT_PENALTY * attempts),
    hintPenalty: input.hintUsed ? XP_RULES.HINT_PENALTY : 0,
    routeCompletionBonus:
      completed && input.isFinalCheckpoint ? XP_RULES.ROUTE_COMPLETION_BONUS : 0,
    total: 0,
  };

  breakdown.total = noNegativeZero(Math.max(0, sumFields(breakdown)));
  return breakdown;
}

/** Sum per-checkpoint breakdowns into a run total. Floored at 0, as above. */
export function scoreRun(inputs: readonly CheckpointScoreInput[]): XpBreakdown {
  return mergeBreakdowns(inputs.map(scoreCheckpoint));
}

/** Fold already-computed breakdowns (e.g. replayed from persisted runs). */
export function mergeBreakdowns(parts: readonly XpBreakdown[]): XpBreakdown {
  const out = parts.reduce<XpBreakdown>((acc, part) => {
    acc.checkpointCompletion += part.checkpointCompletion;
    acc.correctObservation += part.correctObservation;
    acc.speedBonus += part.speedBonus;
    acc.noHintBonus += part.noHintBonus;
    acc.hiddenDetailBonus += part.hiddenDetailBonus;
    acc.incorrectPenalty += part.incorrectPenalty;
    acc.hintPenalty += part.hintPenalty;
    acc.routeCompletionBonus += part.routeCompletionBonus;
    acc.total += part.total;
    return acc;
  }, emptyBreakdown());

  out.total = noNegativeZero(Math.max(0, out.total));
  out.incorrectPenalty = noNegativeZero(out.incorrectPenalty);
  out.hintPenalty = noNegativeZero(out.hintPenalty);
  return out;
}
