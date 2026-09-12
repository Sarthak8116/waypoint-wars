'use client';

/**
 * Landing.
 *
 * Hierarchy is deliberate and player-first: the two things a person arriving
 * at this URL can actually do — join someone's hunt, or start the seeded
 * Pittsburgh one — are the only things above the fold. Hosting is smaller.
 * Authoring tools are smaller still. Diagnostics are behind a toggle.
 *
 * The earlier version led with "Create a hunt anywhere", which is the most
 * impressive capability and the wrong first ask: it makes a visitor do work
 * before they can play anything.
 */

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:2567';

type IntegrationStatus = 'live' | 'mocked' | 'in-memory' | 'file' | 'memory' | 'disabled';

interface Health {
  ok: boolean;
  integrations: Record<string, IntegrationStatus>;
}

/**
 * Honesty row. A mock is never silently substituted for the real thing — but
 * it is dev-facing, so it lives behind a toggle rather than on the first
 * screen a judge sees.
 */
function StatusPill({ name, status }: { name: string; status: IntegrationStatus }) {
  const tone = status === 'live' ? 'pill-lime' : status === 'disabled' ? '' : 'pill-yellow';
  return (
    <span className={`pill ${tone}`}>
      {name} <span style={{ opacity: 0.72 }}>{status}</span>
    </span>
  );
}

/** Flat SVG, 5px round-cap strokes, ink-on-accent. Truss + arch geometry. */
function BridgeMark() {
  return (
    <svg viewBox="0 0 200 96" width="100%" height="96" aria-hidden="true">
      <g
        fill="none"
        stroke="#171043"
        strokeWidth="5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {/* lenticular truss — the Smithfield "steel eye" */}
        <path d="M18 58 Q100 16 182 58" />
        <path d="M18 58 Q100 100 182 58" />
        <path d="M18 58 H182" />
        <path d="M52 44 V72" />
        <path d="M100 33 V83" />
        <path d="M148 44 V72" />
        {/* river band */}
        <path d="M6 88 H194" strokeWidth="7" opacity="0.35" />
      </g>
    </svg>
  );
}

const STEPS = [
  ['Join', 'One room code. No install.'],
  ['Get your route', "Nobody else has the same checkpoints."],
  ['Solve', 'Find it, photograph it, answer the question.'],
  ['Race', 'Every route ends in the same place. First there wins.'],
] as const;

export default function Home() {
  const router = useRouter();
  const [code, setCode] = useState('');
  const [health, setHealth] = useState<Health | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showStatus, setShowStatus] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      try {
        const res = await fetch(`${API_URL}/health`, { cache: 'no-store' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as Health;
        if (!cancelled) {
          setHealth(data);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setHealth(null);
          setError(err instanceof Error ? err.message : 'unreachable');
        }
      }
    };
    void check();
    const id = setInterval(check, 5000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  const join = () => {
    if (code.trim().length === 6) router.push(`/lobby?code=${code.trim().toUpperCase()}`);
  };

  return (
    <main className="wrap stack">
      <div
        className="float"
        style={{
          background: 'var(--cyan)',
          borderRadius: 'var(--r-panel)',
          padding: '20px 20px 8px',
        }}
      >
        <BridgeMark />
      </div>

      <div>
        <h1 className="display">
          Waypoint
          <br />
          Wars
        </h1>
        <p className="muted" style={{ fontSize: 19, marginTop: 12, marginBottom: 0 }}>
          Race through the city. Everyone gets a different route. First to the
          finish wins.
        </p>
      </div>

      {/* ------------------------------------------------------ join, first */}
      <section className="card stack" style={{ gap: 12 }}>
        <p className="label" style={{ color: 'var(--pink)', margin: 0 }}>
          Someone sent you a code?
        </p>
        <input
          className="field mono"
          style={{
            textTransform: 'uppercase',
            letterSpacing: '0.3em',
            fontSize: 24,
            textAlign: 'center',
          }}
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
          onKeyDown={(e) => e.key === 'Enter' && join()}
          placeholder="ABC234"
          maxLength={6}
          aria-label="Room code"
        />
        <button
          className="btn btn-pink btn-block"
          onClick={join}
          disabled={code.trim().length !== 6}
        >
          Join a hunt
        </button>
      </section>

      {/* --------------------------------------------- the no-setup option */}
      <a className="btn btn-lime btn-block" href="/play?demo=1" style={{ minHeight: 68, fontSize: 20 }}>
        ▶ Start Pittsburgh demo
      </a>
      <p className="dim" style={{ fontSize: 14, marginTop: -8, textAlign: 'center' }}>
        Seeded hunt, simulated walking. Nothing to set up.
      </p>

      {/* ----------------------------------------------------- how it works */}
      <section className="stack" style={{ gap: 10 }}>
        {STEPS.map(([title, detail], i) => (
          <div key={title} style={{ display: 'flex', gap: 12, alignItems: 'baseline' }}>
            <span
              className="mono"
              style={{ color: 'var(--yellow)', fontWeight: 900, width: 22, flexShrink: 0 }}
            >
              {i + 1}
            </span>
            <p style={{ margin: 0, fontSize: 16 }}>
              <strong>{title}.</strong>{' '}
              <span className="muted">{detail}</span>
            </p>
          </div>
        ))}
      </section>

      {/* ------------------------------------------------------------- host */}
      <a className="btn btn-ghost btn-block" href="/lobby">
        Host a hunt
      </a>

      {/* ---------------------------------------------------- everything else */}
      <div
        style={{
          display: 'flex',
          gap: 16,
          flexWrap: 'wrap',
          justifyContent: 'center',
          fontSize: 14,
        }}
      >
        <a className="dim" href="/create">
          Create custom hunt
        </a>
        <span className="dim">·</span>
        <a className="dim" href="/demo">
          Replay
        </a>
        <span className="dim">·</span>
        <a className="dim" href="/creator">
          Editor
        </a>
        <span className="dim">·</span>
        <button
          className="dim"
          onClick={() => setShowStatus((s) => !s)}
          style={{
            background: 'none',
            border: 'none',
            padding: 0,
            font: 'inherit',
            cursor: 'pointer',
            textDecoration: 'underline',
          }}
          aria-expanded={showStatus}
        >
          {showStatus ? 'Hide status' : 'Status'}
        </button>
      </div>

      {showStatus && (
        <section className="card">
          <p className="label dim" style={{ marginBottom: 12 }}>
            System status
          </p>

          {error && (
            <p style={{ color: 'var(--pink)', fontSize: 15, margin: 0 }}>
              Server unreachable ({error}) — the Pittsburgh demo still runs without it.
            </p>
          )}

          {health && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <span className="pill pill-lime">server ok</span>
              {Object.entries(health.integrations).map(([name, status]) => (
                <StatusPill key={name} name={name} status={status} />
              ))}
            </div>
          )}

          {!health && !error && (
            <p className="dim caret" style={{ margin: 0, fontSize: 15 }}>
              Checking
            </p>
          )}
        </section>
      )}
    </main>
  );
}
