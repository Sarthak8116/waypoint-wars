import { describe, it, expect } from 'vitest';
import { HINT_TRUE_COST_XP, XP_RULES } from '@ww/shared';
import {
  MIN_PLAUSIBLE_SECONDS,
  scoreCheckpoint,
  scoreRun,
  speedBonus,
  type CheckpointScoreInput,
} from './scoring.js';

const EXPECTED = 300;

const base: CheckpointScoreInput = {
  expectedCompletionSeconds: EXPECTED,
  actualSeconds: EXPECTED,
  answerCorrect: true,
  hintUsed: false,
  incorrectAttempts: 0,
};

describe('speed bonus — normalization', () => {
  it('awards a mid-range bonus for exactly the expected time', () => {
    expect(speedBonus(EXPECTED, EXPECTED)).toBe(25);
    expect(speedBonus(EXPECTED, EXPECTED)).toBe(XP_RULES.SPEED_BONUS_MAX / 2);
  });

  it('is normalized per checkpoint, not on raw seconds', () => {
    // A short checkpoint done in 60s and a long one done in 600s are both
    // exactly on pace, so they must score identically.
    expect(speedBonus(60, 60)).toBe(speedBonus(600, 600));
    // And being twice as fast pays the same on either route.
    expect(speedBonus(60, 30)).toBe(speedBonus(600, 300));
  });

  it('is roughly symmetric in log space around on-pace', () => {
    // 2x faster: +13; 2x slower: -12 (the 0.5 difference is rounding).
    expect(speedBonus(EXPECTED, EXPECTED / 2)).toBe(38);
    expect(speedBonus(EXPECTED, EXPECTED * 2)).toBe(13);
  });

  it('saturates at the configured ratio in both directions', () => {
    expect(speedBonus(EXPECTED, EXPECTED / 4)).toBe(XP_RULES.SPEED_BONUS_MAX);
    expect(speedBonus(EXPECTED, EXPECTED * 4)).toBe(0);
    expect(speedBonus(EXPECTED, EXPECTED * 1000)).toBe(0);
  });
});

describe('speed bonus — clamping and degenerate input', () => {
  it('never exceeds SPEED_BONUS_MAX, however absurd the ratio', () => {
    const absurd = [0.001, 0.01, 1, 5, 6, 30];
    for (const actual of absurd) {
      const bonus = speedBonus(EXPECTED, actual);
      expect(bonus).toBeLessThanOrEqual(XP_RULES.SPEED_BONUS_MAX);
      expect(bonus).toBeGreaterThanOrEqual(0);
      expect(Number.isFinite(bonus)).toBe(true);
    }
    expect(speedBonus(6000, 6)).toBe(XP_RULES.SPEED_BONUS_MAX);
  });

  it('treats an implausibly fast completion as a broken clock, not a record', () => {
    // 0.001s cannot be walked, photographed and answered. Neutral, not max.
    expect(speedBonus(EXPECTED, 0.001)).toBe(25);
    expect(speedBonus(EXPECTED, MIN_PLAUSIBLE_SECONDS - 0.001)).toBe(25);
  });

  it('handles zero, negative, NaN and Infinity without NaN or Infinity out', () => {
    for (const actual of [0, -0, -60, Number.NaN, Number.POSITIVE_INFINITY]) {
      const bonus = speedBonus(EXPECTED, actual);
      expect(Number.isFinite(bonus)).toBe(true);
      expect(Number.isNaN(bonus)).toBe(false);
      expect(bonus).toBe(25);
    }
  });

  it('falls back to neutral when the content has a nonsensical expected time', () => {
    for (const expected of [0, -10, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(speedBonus(expected, 120)).toBe(25);
    }
  });
});

describe('scoreCheckpoint', () => {
  it('pays every component of a clean checkpoint', () => {
    const b = scoreCheckpoint({ ...base, hiddenDetailFound: true });
    expect(b).toMatchObject({
      checkpointCompletion: XP_RULES.CHECKPOINT_COMPLETION,
      correctObservation: XP_RULES.CORRECT_OBSERVATION,
      speedBonus: 25,
      noHintBonus: XP_RULES.NO_HINT_BONUS,
      hiddenDetailBonus: XP_RULES.HIDDEN_DETAIL_BONUS,
      incorrectPenalty: 0,
      hintPenalty: 0,
      routeCompletionBonus: 0,
    });
    expect(b.total).toBe(225);
  });

  it('honours the checkpoint-specific baseXp', () => {
    expect(scoreCheckpoint({ ...base, baseXp: 250 }).checkpointCompletion).toBe(250);
  });

  it('charges the hint once and removes the no-hint bonus', () => {
    const b = scoreCheckpoint({ ...base, hintUsed: true });
    expect(b.hintPenalty).toBe(XP_RULES.HINT_PENALTY);
    expect(b.noHintBonus).toBe(0);
    expect(b.total).toBe(155);
  });

  it('charges the incorrect penalty once per failed attempt', () => {
    expect(scoreCheckpoint({ ...base, incorrectAttempts: 3 }).incorrectPenalty).toBe(
      XP_RULES.INCORRECT_PENALTY * 3,
    );
    expect(scoreCheckpoint({ ...base, incorrectAttempts: -5 }).incorrectPenalty).toBe(0);
    expect(scoreCheckpoint({ ...base, incorrectAttempts: Number.NaN }).incorrectPenalty).toBe(0);
  });

  it('pays the route completion bonus only at the final destination', () => {
    expect(scoreCheckpoint(base).routeCompletionBonus).toBe(0);
    expect(scoreCheckpoint({ ...base, isFinalCheckpoint: true }).routeCompletionBonus).toBe(
      XP_RULES.ROUTE_COMPLETION_BONUS,
    );
  });

  it('pays no rewards for an uncompleted checkpoint but still records penalties', () => {
    const b = scoreCheckpoint({ ...base, completed: false, hintUsed: true, incorrectAttempts: 2 });
    expect(b.checkpointCompletion).toBe(0);
    expect(b.correctObservation).toBe(0);
    expect(b.speedBonus).toBe(0);
    expect(b.hintPenalty).toBe(XP_RULES.HINT_PENALTY);
    expect(b.incorrectPenalty).toBe(-30);
    expect(b.total).toBe(0);
  });
});

describe('scoreRun — the zero floor', () => {
  it('floors a disastrous run at zero without losing the ledger', () => {
    const disaster: CheckpointScoreInput = {
      expectedCompletionSeconds: EXPECTED,
      actualSeconds: EXPECTED * 10,
      completed: false,
      answerCorrect: false,
      hintUsed: true,
      incorrectAttempts: 6,
    };
    const run = scoreRun([disaster, disaster, disaster, disaster]);

    expect(run.total).toBe(0);
    expect(run.total).toBeGreaterThanOrEqual(0);
    // The penalties are still reported so the results screen can explain it.
    expect(run.incorrectPenalty).toBe(XP_RULES.INCORRECT_PENALTY * 24);
    expect(run.hintPenalty).toBe(XP_RULES.HINT_PENALTY * 4);
    expect(run.checkpointCompletion).toBe(0);
  });

  it('never claws back XP already earned at an earlier checkpoint', () => {
    const good = scoreCheckpoint(base);
    const run = scoreRun([
      base,
      { ...base, completed: false, answerCorrect: false, hintUsed: true, incorrectAttempts: 9 },
    ]);
    expect(good.total).toBe(200);
    expect(run.total).toBe(good.total);
  });

  it('sums a realistic four-checkpoint run', () => {
    const run = scoreRun([
      base,
      { ...base, actualSeconds: EXPECTED / 2 },
      { ...base, hintUsed: true, incorrectAttempts: 1 },
      { ...base, isFinalCheckpoint: true, hiddenDetailFound: true },
    ]);
    // 200 + 213 + (155 - 15) + 375
    expect(run.total).toBe(928);
    expect(run.routeCompletionBonus).toBe(XP_RULES.ROUTE_COMPLETION_BONUS);
  });

  it('returns a zeroed breakdown for an empty run', () => {
    expect(scoreRun([]).total).toBe(0);
  });

  /**
   * The number on the hint button must be the number the player loses.
   *
   * It was not. Every hint button read "-20 XP" — HINT_PENALTY — while taking
   * a hint also forfeits the +25 no-hint bonus. Measured in the live app on
   * one checkpoint: 225 XP without a hint, 180 with one. The player was told
   * 20 and charged 45.
   *
   * This asserts the advertised cost against the engine rather than against a
   * constant, so changing either XP rule without updating the other fails
   * here instead of in front of a player.
   */
  it('HINT_TRUE_COST_XP is what taking a hint actually costs', () => {
    const base = {
      baseXp: 100,
      expectedCompletionSeconds: 600,
      actualSeconds: 600,
      completed: true,
      answerCorrect: true,
      incorrectAttempts: 0,
      isFinalCheckpoint: false,
    } as const;

    const without = scoreCheckpoint({ ...base, hintUsed: false });
    const withHint = scoreCheckpoint({ ...base, hintUsed: true });

    expect(without.total - withHint.total).toBe(HINT_TRUE_COST_XP);
    // And it is genuinely more than the penalty alone, which is the trap.
    expect(HINT_TRUE_COST_XP).toBeGreaterThan(Math.abs(XP_RULES.HINT_PENALTY));
  });
});
