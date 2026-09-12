'use client';

/**
 * Demo Mode — the three-minute pitch, runnable indoors and unattended.
 *
 * Simulates three players on the three different Downtown routes, then plays
 * the converging replay. Every XP figure comes from the real scoring engine
 * and the real curated content; only the walking is simulated. See
 * DECISIONS.md D6 — this is a product feature, not a dev hack, and it is
 * always visibly labeled so nobody mistakes it for a live run.
 */

import { useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { loadHuntBundle, routeCheckpoints, type HuntBundle } from '@/lib/huntData';
import { simulateRun } from '@/lib/simulateRun';
import type { ReplayPlayer } from '@/components/RouteReplay';

const RouteReplay = dynamic(() => import('@/components/RouteReplay'), { ssr: false });

/** Distinct hues that stay legible on the map and in both themes. */
const PLAYER_COLORS = ['#5eead4', '#a78bfa', '#fbbf24'];

const PERSONAS = [
  { name: 'Ava', pace: 0.86, hintAt: [], missAt: [2] },
  { name: 'Ben', pace: 1.0, hintAt: [1], missAt: [] },
  { name: 'Cruz', pace: 1.18, hintAt: [0, 3], missAt: [1] },
];

export default function DemoPage() {
  const [bundle, setBundle] = useState<HuntBundle | null>(null);

  useEffect(() => {
    void loadHuntBundle().then(setBundle);
  }, []);

  const players = useMemo<ReplayPlayer[]>(() => {
    if (!bundle) return [];

    return bundle.routes.slice(0, 3).map((route, i) => {
      const persona = PERSONAS[i] ?? PERSONAS[0]!;
      const checkpoints = routeCheckpoints(bundle, route.id);

      const run = simulateRun(checkpoints, {
        seed: 1000 + i * 77,
        pace: persona.pace,
        hintAt: persona.hintAt,
        missAt: persona.missAt,
      });

      return {
        id: route.id,
        name: persona.name,
        routeLabel: route.label,
        color: PLAYER_COLORS[i] ?? '#5eead4',
        path: run.path,
        checkpoints: run.checkpoints,
        finalXp: run.totalXp,
      };
    });
  }, [bundle]);

  const durationMs = useMemo(
    () => Math.max(0, ...players.map((p) => p.path.at(-1)?.atMs ?? 0)),
    [players],
  );

  if (!bundle) {
    return (
      <main className="wrap">
        <p className="muted">Loading demo…</p>
      </main>
    );
  }

  if (players.length === 0) {
    return (
      <main className="wrap">
        <p style={{ color: 'var(--bad)' }}>No routes available to demo.</p>
      </main>
    );
  }

  return (
    <>
      <div
        style={{
          position: 'fixed',
          top: 10,
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 40,
          background: 'rgba(94,234,212,0.14)',
          color: 'var(--accent)',
          border: '1px solid var(--accent)',
          borderRadius: 999,
          padding: '5px 12px',
          fontSize: 11,
          fontWeight: 700,
          // Was clipped off both edges at phone width: translateX(-50%) plus
          // nowrap plus a label wider than the viewport.
          maxWidth: 'calc(100vw - 24px)',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        ▶ Demo Mode — real scoring
      </div>

      {bundle.isFallback && (
        <div
          style={{
            position: 'fixed',
            top: 46,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 40,
            background: 'rgba(251,191,36,0.16)',
            color: 'var(--warn)',
            border: '1px solid var(--warn)',
            borderRadius: 999,
            padding: '5px 12px',
            fontSize: 11,
            fontWeight: 700,
            maxWidth: 'calc(100vw - 24px)',
          }}
        >
          ⚠ Placeholder content
        </div>
      )}

      <RouteReplay players={players} durationMs={durationMs} />
    </>
  );
}
