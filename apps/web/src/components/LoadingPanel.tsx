'use client';

/**
 * Loading that gives up.
 *
 * An indefinite "Loading…" is the single worst thing a judge can be shown,
 * because it is indistinguishable from a hang and there is nothing to do about
 * it. Every load in this app is bounded: after `timeoutMs` the spinner is
 * replaced by a plain explanation and two ways out.
 */

import { useEffect, useState } from 'react';

export interface LoadingPanelProps {
  /** What is being waited on, in the player's words. */
  what: string;
  /** How long before this is treated as broken rather than slow. */
  timeoutMs?: number;
  /** Called when the player asks to try again. Omit to hide the retry. */
  onRetry?: () => void;
  /** Offered alongside retry — a path that cannot fail. */
  fallbackLabel?: string;
  onFallback?: () => void;
}

export default function LoadingPanel({
  what,
  timeoutMs = 12_000,
  onRetry,
  fallbackLabel,
  onFallback,
}: LoadingPanelProps) {
  const [timedOut, setTimedOut] = useState(false);

  useEffect(() => {
    setTimedOut(false);
    const id = setTimeout(() => setTimedOut(true), timeoutMs);
    return () => clearTimeout(id);
  }, [what, timeoutMs]);

  if (!timedOut) {
    return (
      <div className="card">
        <p className="caret" style={{ margin: 0, fontWeight: 800 }}>
          {what}
        </p>
      </div>
    );
  }

  return (
    <div className="card" style={{ borderColor: 'var(--pink)' }}>
      <p className="label" style={{ color: 'var(--pink)', marginBottom: 8 }}>
        Taking too long
      </p>
      <p style={{ margin: '0 0 14px' }}>
        {what} is not responding. The server may be asleep or unreachable.
      </p>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        {onRetry && (
          <button className="btn btn-cyan" style={{ flex: 1, minWidth: 140 }} onClick={onRetry}>
            Try again
          </button>
        )}
        {onFallback && fallbackLabel && (
          <button className="btn btn-lime" style={{ flex: 1, minWidth: 140 }} onClick={onFallback}>
            {fallbackLabel}
          </button>
        )}
        <a className="btn btn-ghost" style={{ flex: 1, minWidth: 120 }} href="/">
          ← Home
        </a>
      </div>
    </div>
  );
}
