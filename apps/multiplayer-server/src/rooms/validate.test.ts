import { describe, expect, it } from 'vitest';
import {
  MAX_ANSWER_CHARS,
  sanitizePlayerName,
  validateCheckpointId,
  validateLocation,
  validateShareLocation,
  validateSubmission,
} from './validate.js';

const goodSubmission = {
  checkpointId: 'cp_market_square',
  image: 'data:image/jpeg;base64,AAAA',
  latitude: 40.4406,
  longitude: -80.0,
  observationAnswer: 'four',
  randomizedInstruction: 'Hold up two fingers in the shot.',
  submittedAt: 1_700_000_000_000,
};

describe('validateLocation', () => {
  it('accepts a plausible fix', () => {
    const result = validateLocation({ latitude: 40.4406, longitude: -79.9959, accuracyMeters: 12 });
    expect(result).toEqual({
      ok: true,
      value: { latitude: 40.4406, longitude: -79.9959, accuracyMeters: 12 },
    });
  });

  it('rejects out-of-range, non-finite and non-numeric coordinates', () => {
    const hostile = [
      { latitude: 91, longitude: 0 },
      { latitude: 0, longitude: 181 },
      { latitude: Number.NaN, longitude: 0 },
      { latitude: Number.POSITIVE_INFINITY, longitude: 0 },
      { latitude: '40.44', longitude: -80 },
      { latitude: 40.44 },
      null,
      'not an object',
      [40.44, -80],
    ];
    for (const payload of hostile) {
      expect(validateLocation(payload).ok, JSON.stringify(payload)).toBe(false);
    }
  });

  it('rejects a negative or absurd accuracy', () => {
    expect(validateLocation({ latitude: 1, longitude: 1, accuracyMeters: -1 }).ok).toBe(false);
    expect(validateLocation({ latitude: 1, longitude: 1, accuracyMeters: 1e9 }).ok).toBe(false);
  });
});

describe('validateCheckpointId', () => {
  it('requires a non-empty bounded string', () => {
    expect(validateCheckpointId({ checkpointId: 'cp_a' }, 'request_hint')).toEqual({
      ok: true,
      value: 'cp_a',
    });
    expect(validateCheckpointId({ checkpointId: '' }, 'request_hint').ok).toBe(false);
    expect(validateCheckpointId({ checkpointId: 'x'.repeat(500) }, 'request_hint').ok).toBe(false);
    expect(validateCheckpointId({}, 'request_hint').ok).toBe(false);
    expect(validateCheckpointId(null, 'request_hint').ok).toBe(false);
  });
});

describe('validateShareLocation', () => {
  it('requires a real boolean, not a truthy value', () => {
    expect(validateShareLocation({ enabled: false })).toEqual({ ok: true, value: false });
    expect(validateShareLocation({ enabled: 'false' }).ok).toBe(false);
    expect(validateShareLocation({ enabled: 1 }).ok).toBe(false);
  });
});

describe('validateSubmission', () => {
  it('accepts a well-formed submission', () => {
    const result = validateSubmission({ submission: goodSubmission });
    expect(result.ok).toBe(true);
  });

  it('rejects hostile shapes', () => {
    const hostile = [
      {},
      { submission: null },
      { submission: { ...goodSubmission, checkpointId: '' } },
      { submission: { ...goodSubmission, image: '' } },
      { submission: { ...goodSubmission, image: 42 } },
      { submission: { ...goodSubmission, latitude: 999 } },
      { submission: { ...goodSubmission, longitude: 'west' } },
      { submission: { ...goodSubmission, observationAnswer: 'x'.repeat(MAX_ANSWER_CHARS + 1) } },
      { submission: { ...goodSubmission, observationAnswer: { toString: 'nope' } } },
      { submission: { ...goodSubmission, randomizedInstruction: 7 } },
    ];
    for (const payload of hostile) {
      expect(validateSubmission(payload).ok, JSON.stringify(payload).slice(0, 80)).toBe(false);
    }
  });

  it('carries no xp, checkpointIndex or finished field through, however hard a client tries', () => {
    const result = validateSubmission({
      submission: { ...goodSubmission, xp: 99_999, checkpointIndex: 4, finished: true },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.value).not.toHaveProperty('xp');
    expect(result.value).not.toHaveProperty('checkpointIndex');
    expect(result.value).not.toHaveProperty('finished');
    expect(Object.keys(result.value).sort()).toEqual([
      'checkpointId',
      'image',
      'latitude',
      'longitude',
      'observationAnswer',
      'randomizedInstruction',
      'submittedAt',
    ]);
  });
});

describe('sanitizePlayerName', () => {
  it('keeps ordinary names intact', () => {
    expect(sanitizePlayerName('Ada Lovelace', 'Player 1')).toBe('Ada Lovelace');
    expect(sanitizePlayerName('Player 42', 'Player 1')).toBe('Player 42');
  });

  it('strips markup and control characters and falls back when empty', () => {
    expect(sanitizePlayerName('<script>x</script>', 'Player 1')).toBe('scriptx/script');
    expect(sanitizePlayerName('   ', 'Player 1')).toBe('Player 1');
    expect(sanitizePlayerName(undefined, 'Player 1')).toBe('Player 1');
    expect(sanitizePlayerName('x'.repeat(200), 'Player 1')).toHaveLength(32);
  });
});
