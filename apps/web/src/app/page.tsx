'use client';

import { useEffect, useState } from 'react';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:2567';

type IntegrationStatus = 'live' | 'mocked' | 'in-memory' | 'disabled';

interface Health {
  ok: boolean;
  service: string;
  time: string;
  integrations: Record<string, IntegrationStatus>;
}

/** Mocks must be visibly labeled — never let a demo mistake a mock for the real thing. */
function StatusBadge({ name, status }: { name: string; status: IntegrationStatus }) {
  const cls = status === 'live' ? 'live' : status === 'disabled' ? 'off' : 'mock';
  return (
    <span className={`badge ${cls}`}>
      {name}: {status}
    </span>
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
    <main className="wrap">
      <h1 style={{ fontSize: 34, margin: '0 0 4px', letterSpacing: '-0.02em' }}>Waypoint Wars</h1>
      <p className="muted" style={{ marginTop: 0, fontSize: 17, lineHeight: 1.5 }}>
        A real-world historical scavenger hunt through Downtown Pittsburgh. Different routes, the
        same finish line.
      </p>

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', margin: '24px 0' }}>
        <a className="btn primary" href="/play">
          Play solo
        </a>
        <a className="btn" href="/lobby">
          Multiplayer lobby
        </a>
      </div>

      <section className="card" style={{ marginTop: 8 }}>
        <h2 style={{ fontSize: 15, margin: '0 0 12px', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
          <span className="muted">System status</span>
        </h2>

        {error && (
          <p style={{ color: 'var(--bad)', margin: '0 0 8px', fontSize: 14 }}>
            Server unreachable ({error}). Start it with <code>pnpm dev</code>.
          </p>
        )}

        {health && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <span className="badge live">server: ok</span>
            {Object.entries(health.integrations).map(([name, status]) => (
              <StatusBadge key={name} name={name} status={status} />
            ))}
          </div>
        )}

        {!health && !error && <p className="muted" style={{ margin: 0, fontSize: 14 }}>Checking…</p>}
      </section>
    </main>
  );
}
