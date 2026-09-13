/**
 * Where the XP came from.
 *
 * The engine computes eight separate components for every submission and the
 * server sends the whole breakdown with each verdict. Nothing rendered any of
 * it: a player saw "+225 XP" and had no way to learn that 50 of it was for
 * being quick, or that the 25 they did not get was the no-hint bonus they
 * spent.
 *
 * That matters beyond curiosity. The speed bonus is the mechanic that makes
 * routes of different lengths comparable — the answer to "how is this fair?" —
 * and it was invisible. A scoring rule nobody can see may as well be
 * arbitrary.
 *
 * Rendered on the light reward surface, so the colours are ink-on-white.
 */

import { HINT_TRUE_COST_XP, type XpBreakdown as Breakdown } from '@ww/shared';

/** Display order, chosen to read as a story rather than as struct order. */
const LINES: Array<[keyof Breakdown, string]> = [
  ['checkpointCompletion', 'Checkpoint'],
  ['correctObservation', 'Right answer'],
  ['speedBonus', 'Speed'],
  ['noHintBonus', 'No hint taken'],
  ['hiddenDetailBonus', 'Hidden detail'],
  ['hintPenalty', 'Hint'],
  ['incorrectPenalty', 'Wrong answers'],
  ['routeCompletionBonus', 'Finished the route'],
];

export default function XpBreakdown({ breakdown }: { breakdown: Breakdown }) {
  // Zero-value lines are noise: they describe things that did not happen.
  const rows = LINES.filter(([key]) => breakdown[key] !== 0);
  if (rows.length === 0) return null;

  return (
    <div style={{ marginTop: 16 }}>
      <p
        className="label"
        style={{ color: 'var(--ink-body)', opacity: 0.7, marginBottom: 8 }}
      >
        How that was scored
      </p>
      {rows.map(([key, label]) => {
        const value = breakdown[key];
        return (
          <div
            key={key}
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              gap: 12,
              padding: '4px 0',
              fontSize: 15,
              color: 'var(--ink-body)',
            }}
          >
            <span>{label}</span>
            <span
              className="mono"
              style={{ fontWeight: 800, color: value < 0 ? 'var(--pink-shadow)' : 'var(--ink)' }}
            >
              {value > 0 ? `+${value}` : value}
            </span>
          </div>
        );
      })}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          gap: 12,
          paddingTop: 8,
          marginTop: 4,
          borderTop: '2px solid rgba(23,16,67,0.15)',
          fontSize: 16,
          color: 'var(--ink)',
          fontWeight: 900,
        }}
      >
        <span>Total</span>
        <span className="mono">{breakdown.total}</span>
      </div>

      {/**
        * Reconcile the two numbers a player sees for a hint.
        *
        * The button says -45 and this list says -20, because the other 25 is a
        * bonus that simply never arrived — a zero line, filtered out as noise.
        * Without this note the button looks like it lied, which is the exact
        * impression the -45 label was introduced to remove.
        */}
      {breakdown.hintPenalty !== 0 && (
        <p
          className="label"
          style={{
            color: 'var(--ink-body)',
            opacity: 0.7,
            marginTop: 10,
            marginBottom: 0,
            letterSpacing: '0.04em',
          }}
        >
          The hint also cost the {HINT_TRUE_COST_XP + breakdown.hintPenalty} no-hint bonus —{' '}
          {HINT_TRUE_COST_XP} in total
        </p>
      )}
    </div>
  );
}
