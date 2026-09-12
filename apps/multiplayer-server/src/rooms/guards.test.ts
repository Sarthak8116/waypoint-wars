/**
 * DECISIONS.md D15, at the unit level. The integration counterpart — proving
 * the verification provider is never reached on a mismatch — lives in
 * `HuntRoom.test.ts`.
 */

import { describe, expect, it } from 'vitest';
import { GUARD_MESSAGES, assertSubmissionMatchesActiveCheckpoint } from './guards.js';

describe('assertSubmissionMatchesActiveCheckpoint (D15)', () => {
  it('accepts the player’s own active checkpoint', () => {
    const result = assertSubmissionMatchesActiveCheckpoint('cp_market_square', 'cp_market_square');
    expect(result).toEqual({ ok: true, checkpointId: 'cp_market_square' });
  });

  it('rejects a checkpoint further along the route', () => {
    // The attack it exists for: a photo genuinely taken at checkpoint 1,
    // submitted against checkpoint 4's rules.
    const result = assertSubmissionMatchesActiveCheckpoint(
      'final_point_fountain',
      'cp_smithfield_bridge',
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.code).toBe('CHECKPOINT_MISMATCH');
  });

  it('rejects a checkpoint already completed', () => {
    const result = assertSubmissionMatchesActiveCheckpoint('cp_market_square', 'cp_ppg_place');
    expect(result.ok).toBe(false);
  });

  it('rejects everything when no hunt is running', () => {
    for (const active of [null, '']) {
      const result = assertSubmissionMatchesActiveCheckpoint('cp_market_square', active);
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error('unreachable');
      expect(result.code).toBe('HUNT_NOT_ACTIVE');
    }
  });

  it('leaks nothing about which checkpoint IS active', () => {
    const result = assertSubmissionMatchesActiveCheckpoint('cp_wrong', 'cp_secret_active_id');
    if (result.ok) throw new Error('unreachable');
    expect(result.message).toBe(GUARD_MESSAGES.mismatch);
    expect(result.message).not.toContain('cp_secret_active_id');
    expect(result.message).not.toContain('cp_wrong');
  });
});
