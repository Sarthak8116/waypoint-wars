'use client';

/**
 * Live pass/fail for the rules the hunt engine and the demo depend on.
 *
 * Publish is disabled while any hard rule fails, and every failure is listed
 * with the checkpoint it belongs to — a disabled button with no explanation is
 * how a creator ends up believing the tool is broken.
 */

import type { ValidationIssue, ValidationReport } from '@/lib/creatorValidation';

export interface ValidationPanelProps {
  report: ValidationReport;
  publishing: boolean;
  publishMessage: { tone: 'ok' | 'bad'; text: string } | null;
  /** Per-rule failures from the server's own 422. Rendered verbatim. */
  publishDetails: string[];
  onPublish: () => void;
  onSelectCheckpoint: (id: string) => void;
}

function IssueList({
  issues,
  tone,
  onSelect,
}: {
  issues: ValidationIssue[];
  tone: 'bad' | 'warn';
  onSelect: (id: string) => void;
}) {
  if (issues.length === 0) return null;
  return (
    <ul style={{ listStyle: 'none', margin: '0 0 10px', padding: 0 }}>
      {issues.map((issue, i) => (
        <li
          key={`${issue.message}-${i}`}
          style={{ fontSize: 12, lineHeight: 1.45, marginBottom: 6, display: 'flex', gap: 6 }}
        >
          <span style={{ color: `var(--${tone === 'bad' ? 'bad' : 'warn'})` }}>
            {tone === 'bad' ? '✖' : '⚠'}
          </span>
          {issue.checkpointId ? (
            <button
              onClick={() => onSelect(issue.checkpointId as string)}
              style={{
                background: 'none',
                border: 0,
                padding: 0,
                textAlign: 'left',
                color: 'var(--text)',
                cursor: 'pointer',
                fontSize: 12,
                lineHeight: 1.45,
                textDecoration: 'underline dotted',
              }}
            >
              {issue.message}
            </button>
          ) : (
            <span>{issue.message}</span>
          )}
        </li>
      ))}
    </ul>
  );
}

export default function ValidationPanel(props: ValidationPanelProps) {
  const { report } = props;

  return (
    <div className="card">
      <h3 style={{ fontSize: 13, margin: '0 0 10px', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
        Validation
      </h3>

      <ul style={{ listStyle: 'none', margin: '0 0 12px', padding: 0 }}>
        {report.checks.map((check) => (
          <li key={check.id} style={{ fontSize: 12, marginBottom: 5, display: 'flex', gap: 7 }}>
            <span style={{ color: check.ok ? 'var(--good)' : 'var(--bad)' }}>{check.ok ? '✓' : '✖'}</span>
            <span className={check.ok ? 'muted' : undefined}>
              {check.label}
              {!check.ok && ` (${check.failures})`}
            </span>
          </li>
        ))}
      </ul>

      {report.summaries.length > 0 && (
        <div style={{ overflowX: 'auto', marginBottom: 12 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
            <thead>
              <tr className="muted" style={{ textAlign: 'left' }}>
                <th style={{ padding: '2px 6px 2px 0' }}>route</th>
                <th style={{ padding: '2px 6px' }}>stops</th>
                <th style={{ padding: '2px 6px' }}>line m</th>
                <th style={{ padding: '2px 6px' }}>XP</th>
                <th style={{ padding: '2px 6px' }}>min</th>
              </tr>
            </thead>
            <tbody>
              {report.summaries.map((s) => (
                <tr key={s.id}>
                  <td style={{ padding: '2px 6px 2px 0' }}>{s.label}</td>
                  <td style={{ padding: '2px 6px' }}>{s.stops}</td>
                  <td style={{ padding: '2px 6px' }}>{s.straightLineMeters}</td>
                  <td style={{ padding: '2px 6px' }}>{s.baseXp}</td>
                  <td style={{ padding: '2px 6px' }}>{s.expectedMinutes}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="muted" style={{ fontSize: 10, margin: '4px 0 0', lineHeight: 1.4 }}>
            &ldquo;line m&rdquo; is straight-line distance between stops — advisory only. Real
            walking distance is what fairness depends on, and a street grid cut by two rivers makes
            crow-flight understate it unevenly.
          </p>
        </div>
      )}

      {report.errors.length > 0 && (
        <>
          <p style={{ fontSize: 11, letterSpacing: '0.06em', color: 'var(--bad)', margin: '0 0 6px' }}>
            {report.errors.length} BLOCKING
          </p>
          <IssueList issues={report.errors} tone="bad" onSelect={props.onSelectCheckpoint} />
        </>
      )}

      {report.warnings.length > 0 && (
        <>
          <p style={{ fontSize: 11, letterSpacing: '0.06em', color: 'var(--warn)', margin: '0 0 6px' }}>
            {report.warnings.length} WARNING{report.warnings.length === 1 ? '' : 'S'} (do not block)
          </p>
          <IssueList issues={report.warnings} tone="warn" onSelect={props.onSelectCheckpoint} />
        </>
      )}

      <button
        className="btn primary"
        style={{ width: '100%', minHeight: 42 }}
        disabled={!report.publishable || props.publishing}
        onClick={props.onPublish}
        title={report.publishable ? 'POST this hunt to the API' : 'Fix the blocking failures first'}
      >
        {props.publishing ? 'Publishing…' : report.publishable ? 'Publish hunt' : 'Publish blocked'}
      </button>

      {props.publishMessage && (
        <p
          style={{
            fontSize: 12,
            lineHeight: 1.45,
            marginBottom: props.publishDetails.length ? 6 : 0,
            color: props.publishMessage.tone === 'ok' ? 'var(--good)' : 'var(--bad)',
          }}
        >
          {props.publishMessage.text}
        </p>
      )}

      {props.publishDetails.length > 0 && (
        // The server re-checks route-length equality and shared-finish
        // agreement itself. When it disagrees with this panel, IT is right —
        // so its wording is shown as-is rather than reworded.
        <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {props.publishDetails.map((detail, i) => (
            <li
              key={`${detail}-${i}`}
              style={{ fontSize: 12, lineHeight: 1.45, marginBottom: 4, display: 'flex', gap: 6 }}
            >
              <span style={{ color: 'var(--bad)' }}>✖</span>
              <span>{detail}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
