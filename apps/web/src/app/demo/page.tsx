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
import { identityFor } from '@/lib/routeIdentity';

const RouteReplay = dynamic(() => import('@/components/RouteReplay'), { ssr: false });


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
        color: identityFor(i).color,
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
      <div className="hud" style={{ position: 'fixed', top: 0, left: 0, right: 0, zIndex: 40 }}>
        <span />
        <span className="hud-center">
          <span className="pill pill-cyan">▶ Demo Mode · real scoring</span>
        </span>
        <span />
      </div>

      {bundle.isFallback && (
        <div className="hud" style={{ position: 'fixed', top: 44, left: 0, right: 0, zIndex: 40 }}>
          <span />
          <span className="hud-center">
            <span className="pill pill-yellow">⚠ Placeholder content</span>
          </span>
          <span />
        </div>
      )}

      <RouteReplay players={players} durationMs={durationMs} />
    </>
  );
}
