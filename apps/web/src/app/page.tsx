'use client';

import { useEffect, useState } from 'react';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:2567';

type IntegrationStatus = 'live' | 'mocked' | 'in-memory' | 'file' | 'memory' | 'disabled';

interface Health {
  ok: boolean;
  integrations: Record<string, IntegrationStatus>;
}

/**
 * Honesty row. A mock is never silently substituted for the real thing, so
 * this is styled as an intentional part of the page rather than debug output.
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

export default function Home() {
  const [health, setHealth] = useState<Health | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  return (
    <main className="wrap stack">
      {/* Hero: full-bleed accent block with a flat line illustration */}
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
        <p className="label" style={{ color: 'var(--pink)', marginBottom: 10 }}>
          Any city · Pittsburgh loaded
        </p>
        <h1 className="display">
          Waypoint
          <br />
          Wars
        </h1>
        <p className="muted" style={{ fontSize: 19, marginTop: 14, marginBottom: 0 }}>
          Drop into any city and build a hunt from the places around you. Everyone
          starts together, walks a different route, and finishes in the same
          place with a different story.
        </p>
      </div>

      <div className="stack" style={{ gap: 12 }}>
        {/* The product, first: a hunt anywhere. */}
        <a className="btn btn-lime btn-block" href="/create">
          ✦ Create a hunt anywhere
        </a>
        <a className="btn btn-pink btn-block" href="/play">
          Play solo
        </a>
        <a className="btn btn-cyan btn-block" href="/lobby">
          Multiplayer lobby
        </a>
        <div style={{ display: 'flex', gap: 12 }}>
          <a className="btn btn-ghost" style={{ flex: 1 }} href="/demo">
            Watch replay
          </a>
          <a className="btn btn-ghost" style={{ flex: 1 }} href="/creator">
            Editor
          </a>
        </div>
      </div>

      <section className="card">
        <p className="label dim" style={{ marginBottom: 12 }}>
          System status
        </p>

        {error && (
          <p style={{ color: 'var(--pink)', fontSize: 15, margin: 0 }}>
            Server unreachable ({error}) — run <span className="mono">pnpm dev</span>
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
    </main>
  );
}
