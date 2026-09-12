import { describe, expect, it } from 'vitest';
import { ANIMATION_DURATIONS, MAX_ANIMATION_MS, leaderboardStagger } from './animations.js';

describe('the one-second ceiling', () => {
  // Players are walking down a street. A two-second celebration is an obstacle,
  // and blocking the UI outdoors is a safety issue. This test is what keeps the
  // constraint enforced rather than aspirational.
  it.each(Object.entries(ANIMATION_DURATIONS))('%s finishes in under 1s', (name, ms) => {
    expect(ms, `${name} must stay under ${MAX_ANIMATION_MS}ms`).toBeLessThan(MAX_ANIMATION_MS);
    expect(ms, `${name} must be a positive duration`).toBeGreaterThan(0);
  });

  it('has no duration that is merely close to the ceiling by accident', () => {
    const slowest = Math.max(...Object.values(ANIMATION_DURATIONS));
    expect(slowest).toBeLessThan(MAX_ANIMATION_MS);
  });
});

describe('leaderboard reveal', () => {
  it('fits any number of rows inside the reveal budget', () => {
    for (const rows of [1, 2, 3, 5, 8, 20, 100]) {
      const total =
        leaderboardStagger(rows) * Math.max(0, rows - 1) + ANIMATION_DURATIONS.LEADERBOARD_ROW;
      expect(total).toBeLessThan(MAX_ANIMATION_MS);
    }
  });

  it('does not stagger a single row', () => {
    expect(leaderboardStagger(1)).toBe(0);
    expect(leaderboardStagger(0)).toBe(0);
  });
});
