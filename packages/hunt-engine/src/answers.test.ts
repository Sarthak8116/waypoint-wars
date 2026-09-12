import { describe, it, expect } from 'vitest';
import { matchesAcceptedAnswer, normalizeAnswer } from './answers.js';

describe('answer matching — forgiving about typing', () => {
  const accepted = ['four'];

  it('accepts case, whitespace and digit/word variants of the same answer', () => {
    for (const submitted of ['Four', 'four ', '  FOUR', '4', ' 4 ', 'four.', '"four"', 'Four!']) {
      expect(matchesAcceptedAnswer(submitted, accepted)).toBe(true);
    }
  });

  it('matches in the other direction too (digit accepted, word submitted)', () => {
    expect(matchesAcceptedAnswer('four', ['4'])).toBe(true);
    expect(matchesAcceptedAnswer('04', ['4'])).toBe(true);
  });

  it('tolerates punctuation, internal spacing and accents', () => {
    expect(matchesAcceptedAnswer('  the   Fort   Pitt  Blockhouse ', ['fort pitt blockhouse'])).toBe(
      true,
    );
    expect(matchesAcceptedAnswer("St. Mary's", ['st marys'])).toBe(true);
    expect(matchesAcceptedAnswer('Café', ['cafe'])).toBe(true);
  });

  it('tolerates simple singular/plural differences', () => {
    expect(matchesAcceptedAnswer('lions', ['lion'])).toBe(true);
    expect(matchesAcceptedAnswer('arch', ['arches'])).toBe(true);
    expect(matchesAcceptedAnswer('canopies', ['canopy'])).toBe(true);
  });

  it('tries every accepted answer', () => {
    expect(matchesAcceptedAnswer('gargoyle', ['griffin', 'gargoyles', 'grotesque'])).toBe(true);
  });
});

describe('answer matching — strict about knowledge', () => {
  it('rejects a different number', () => {
    expect(matchesAcceptedAnswer('five', ['four'])).toBe(false);
    expect(matchesAcceptedAnswer('5', ['four'])).toBe(false);
    expect(matchesAcceptedAnswer('fourteen', ['four'])).toBe(false);
    expect(matchesAcceptedAnswer('forty', ['four'])).toBe(false);
  });

  it('rejects a near miss rather than guessing', () => {
    expect(matchesAcceptedAnswer('fou', ['four'])).toBe(false);
    expect(matchesAcceptedAnswer('fourr', ['four'])).toBe(false);
    expect(matchesAcceptedAnswer('block house', ['blockhouse'])).toBe(false);
  });

  it('rejects a substring or a superset of the answer', () => {
    expect(matchesAcceptedAnswer('pitt', ['fort pitt blockhouse'])).toBe(false);
    expect(
      matchesAcceptedAnswer('fort pitt blockhouse museum entrance', ['fort pitt blockhouse']),
    ).toBe(false);
  });

  it('rejects empty and whitespace-only submissions, even against empty content', () => {
    expect(matchesAcceptedAnswer('', ['four'])).toBe(false);
    expect(matchesAcceptedAnswer('   ', ['four'])).toBe(false);
    expect(matchesAcceptedAnswer('!!!', ['four'])).toBe(false);
    expect(matchesAcceptedAnswer('', [''])).toBe(false);
    expect(matchesAcceptedAnswer('anything', [])).toBe(false);
  });

  it('does not over-singularize words that merely end in s', () => {
    expect(normalizeAnswer('glass')).toBe('glass');
    expect(normalizeAnswer('cross')).toBe('cross');
    expect(matchesAcceptedAnswer('glass', ['glas'])).toBe(false);
  });
});
