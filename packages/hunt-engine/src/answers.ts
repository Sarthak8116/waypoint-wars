/**
 * Fuzzy answer matching for the observation question.
 *
 * The design target: forgive how a person types, never forgive what they know.
 * "Four", "4", " four. " and "FOUR" are the same answer; "five" is not.
 * Matching is exact after canonicalization — no edit distance, no substring
 * containment — because a loose matcher silently hands out XP for wrong
 * answers, which is far worse for the game than a player retyping once.
 */

const NUMBER_WORDS: Readonly<Record<string, string>> = {
  zero: '0',
  one: '1',
  two: '2',
  three: '3',
  four: '4',
  five: '5',
  six: '6',
  seven: '7',
  eight: '8',
  nine: '9',
  ten: '10',
  eleven: '11',
  twelve: '12',
  thirteen: '13',
  fourteen: '14',
  fifteen: '15',
  sixteen: '16',
  seventeen: '17',
  eighteen: '18',
  nineteen: '19',
  twenty: '20',
  thirty: '30',
  forty: '40',
  fifty: '50',
  sixty: '60',
  seventy: '70',
  eighty: '80',
  ninety: '90',
  hundred: '100',
};

/** Leading articles carry no information in a one-line answer. */
const LEADING_ARTICLES = new Set(['the', 'a', 'an']);

/**
 * Naive singularization. Deliberately conservative: it only touches endings
 * where the singular is unambiguous, so "glass" and "cross" are left alone.
 */
function singularize(token: string): string {
  if (token.length <= 3) return token;
  if (token.endsWith('ies')) return `${token.slice(0, -3)}y`;
  if (/(ch|sh|s|x|z)es$/.test(token)) return token.slice(0, -2);
  if (token.endsWith('ss')) return token;
  if (token.endsWith('s')) return token.slice(0, -1);
  return token;
}

function canonicalToken(token: string): string {
  const numeric = NUMBER_WORDS[token];
  if (numeric !== undefined) return numeric;
  // A bare integer is normalized away from leading zeros: "04" -> "4".
  if (/^\d+$/.test(token)) return String(Number(token));
  return singularize(token);
}

/**
 * Lowercase, strip accents and punctuation, collapse whitespace, drop a
 * leading article, then canonicalize each token (numbers, plurals).
 */
export function normalizeAnswer(raw: string): string {
  if (typeof raw !== 'string') return '';
  const cleaned = raw
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    // Apostrophes are deleted rather than turned into a separator, so that
    // "St. Mary's" and "st marys" canonicalize the same way.
    .replace(/['\u2018\u2019\u02bc`]/g, '')
    // Keep alphanumerics only; everything else (punctuation, hyphens, quotes)
    // becomes a token separator.
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

  if (cleaned === '') return '';

  const tokens = cleaned.split(' ');
  const first = tokens[0];
  const body = tokens.length > 1 && first !== undefined && LEADING_ARTICLES.has(first)
    ? tokens.slice(1)
    : tokens;

  return body.map(canonicalToken).join(' ');
}

/**
 * True when `submitted` canonicalizes to any of `accepted`.
 * An empty or whitespace-only submission never matches, even if the content
 * author left an empty string in `acceptedAnswers`.
 */
export function matchesAcceptedAnswer(submitted: string, accepted: readonly string[]): boolean {
  const needle = normalizeAnswer(submitted);
  if (needle === '') return false;
  if (!Array.isArray(accepted)) return false;
  return accepted.some((candidate) => normalizeAnswer(candidate) === needle);
}
