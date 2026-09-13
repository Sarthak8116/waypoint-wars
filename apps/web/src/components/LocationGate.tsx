'use client';

/**
 * Where are you, and is there anything to play here?
 *
 * Solo used to drop straight into the Pittsburgh hunt regardless of where the
 * player was standing, which is nonsense for a product whose promise is "any
 * city". So: ask for GPS, look for a published hunt within five miles, and if
 * there is nothing, offer to build one for exactly where they are.
 *
 * Permission is never assumed. A player who declines still gets a way in —
 * they pick a city by name instead — because a hard requirement on GPS would
 * lock out anyone testing indoors, on a desktop, or with location off.
 */

import { useCallback, useState } from 'react';
import type { Checkpoint, Hunt, Route } from '@ww/shared';
import { loadHuntBundle, normalizeBundle, type HuntBundle } from '@/lib/huntData';
import BackButton from '@/components/BackButton';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:2567';

interface NearbyHunt {
  huntId: string;
  title: string;
  city: string;
  distanceMeters: number;
  startName?: string;
  routes: number;
}

type Phase = 'asking' | 'locating' | 'searching' | 'choose' | 'generating' | 'error';

const miles = (m: number) => (m / 1609.34).toFixed(1);

export default function LocationGate({ onReady }: { onReady: (b: HuntBundle) => void }) {
  const [phase, setPhase] = useState<Phase>('asking');
  const [coords, setCoords] = useState<{ latitude: number; longitude: number } | null>(null);
  const [nearby, setNearby] = useState<NearbyHunt[]>([]);
  /**
   * True when the search could not be performed at all.
   *
   * Distinct from finding nothing, and the distinction is the whole point: an
   * empty result means "we looked and there is nothing here", which is a claim
   * about the world. A failed lookup means we do not know. Telling a player
   * standing in Market Square that there is no hunt within five miles — while
   * the seeded Pittsburgh hunt starts at Market Square — is simply false, and
   * that is what this screen did whenever /api/hunts/nearby was unavailable.
   */
  const [lookupFailed, setLookupFailed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stage, setStage] = useState('');
  const [manual, setManual] = useState('');

  /** Load a specific hunt by id from the server and hand it up. */
  const startHunt = useCallback(
    async (huntId: string) => {
      setPhase('generating');
      setStage('loading the hunt');
      try {
        const res = await fetch(`${API_URL}/api/hunt?huntId=${encodeURIComponent(huntId)}`);
        if (!res.ok) throw new Error('Could not load that hunt.');
        const bundle = normalizeBundle(await res.json());
        if (!bundle) throw new Error('That hunt is missing content.');
        onReady(bundle);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not load that hunt.');
        setPhase('error');
      }
    },
    [onReady],
  );

  /** Build a hunt for a point or a place name. */
  const generateHere = useCallback(
    async (body: Record<string, unknown>, label: string) => {
      setPhase('generating');
      setStage(`finding landmarks near ${label}`);
      const t = setTimeout(() => setStage('writing a clue for each one'), 5000);
      try {
        const res = await fetch(`${API_URL}/api/hunts/generate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ duration: 'quick-detour', routeCount: 3, stopsPerRoute: 3, ...body }),
        });
        const data = (await res.json()) as {
          hunt?: Hunt;
          routes?: Route[];
          checkpoints?: Checkpoint[];
          error?: string;
        };
        if (!res.ok || !data.hunt) throw new Error(data.error ?? 'Could not build a hunt there.');

        const bundle = normalizeBundle(data);
        if (!bundle) throw new Error('The generated hunt was incomplete.');
        onReady(bundle);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not build a hunt there.');
        setPhase('error');
      } finally {
        clearTimeout(t);
      }
    },
    [onReady],
  );

  const askForLocation = useCallback(() => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setError('This browser has no location support.');
      setPhase('error');
      return;
    }

    setPhase('locating');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const here = { latitude: pos.coords.latitude, longitude: pos.coords.longitude };
        setCoords(here);
        setPhase('searching');

        void (async () => {
          try {
            const res = await fetch(
              `${API_URL}/api/hunts/nearby?lat=${here.latitude}&lng=${here.longitude}`,
            );
            // Checked, because a 404 body parses to {} and `hunts ?? []` then
            // reports an empty search that never happened.
            if (!res.ok) throw new Error(`nearby lookup returned ${res.status}`);
            const data = (await res.json()) as { hunts?: NearbyHunt[] };
            setNearby(data.hunts ?? []);
            setLookupFailed(false);
          } catch {
            // Not fatal — but not "there is nothing here" either.
            setNearby([]);
            setLookupFailed(true);
          }
          setPhase('choose');
        })();
      },
      (err) => {
        setError(
          err.code === err.PERMISSION_DENIED
            ? 'Location is off, so we cannot tell what is near you. Name a city instead.'
            : err.message,
        );
        setPhase('error');
      },
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 60_000 },
    );
  }, []);

  /** Last resort: the bundled Pittsburgh content, clearly labelled. */
  const playBundled = useCallback(() => {
    void loadHuntBundle().then(onReady);
  }, [onReady]);

  return (
    <main className="wrap stack">
      <div>
        <BackButton label="Home" />
      </div>

      {/* ------------------------------------------------------------ ask */}
      {phase === 'asking' && (
        <>
          <div>
            <p className="label" style={{ color: 'var(--cyan)', marginBottom: 10 }}>
              Solo hunt
            </p>
            <h1 className="display" style={{ fontSize: 44 }}>
              Where are you?
            </h1>
            <p className="muted" style={{ fontSize: 18, marginTop: 12 }}>
              We&apos;ll look for a hunt within five miles. If there isn&apos;t one,
              we&apos;ll build one from the landmarks around you.
            </p>
          </div>

          <button className="btn btn-lime btn-block" onClick={askForLocation}>
            Use my location
          </button>

          <div className="card stack" style={{ gap: 12 }}>
            <p className="label dim">Or name a place</p>
            <input
              className="field"
              value={manual}
              onChange={(e) => setManual(e.target.value)}
              onKeyDown={(e) =>
                e.key === 'Enter' &&
                manual.trim().length > 1 &&
                void generateHere({ query: manual.trim() }, manual.trim())
              }
              placeholder="Miami, Kyoto, Edinburgh…"
            />
            <button
              className="btn btn-cyan btn-block"
              disabled={manual.trim().length < 2}
              onClick={() => void generateHere({ query: manual.trim() }, manual.trim())}
            >
              Build a hunt there
            </button>
          </div>

          <button className="btn btn-ghost btn-block" onClick={playBundled}>
            Play the Pittsburgh demo hunt
          </button>
        </>
      )}

      {/* ------------------------------------------------------- in flight */}
      {(phase === 'locating' || phase === 'searching' || phase === 'generating') && (
        <div className="card">
          <p className="caret" style={{ fontWeight: 800, margin: 0 }}>
            {phase === 'locating'
              ? 'Getting your location'
              : phase === 'searching'
                ? 'Looking for hunts near you'
                : stage}
          </p>
          {phase === 'generating' && (
            <p className="dim" style={{ fontSize: 14, margin: '10px 0 0' }}>
              Building a hunt takes 15–40 seconds. We look up real landmarks first,
              then write a clue for each one.
            </p>
          )}
        </div>
      )}

      {/* --------------------------------------------------------- choose */}
      {phase === 'choose' && (
        <>
          {nearby.length > 0 ? (
            <>
              <div>
                <h2 style={{ marginBottom: 8 }}>
                  {nearby.length === 1 ? 'One hunt near you' : `${nearby.length} hunts near you`}
                </h2>
                <p className="muted" style={{ fontSize: 16 }}>
                  Within five miles of where you&apos;re standing.
                </p>
              </div>

              {nearby.map((h) => (
                <button
                  key={h.huntId}
                  className="card"
                  onClick={() => void startHunt(h.huntId)}
                  style={{ textAlign: 'left', cursor: 'pointer', width: '100%' }}
                >
                  <p className="label" style={{ color: 'var(--lime)', marginBottom: 6 }}>
                    {miles(h.distanceMeters)} miles away
                  </p>
                  <h3 style={{ marginBottom: 4 }}>{h.title}</h3>
                  <p className="muted" style={{ fontSize: 15, margin: 0 }}>
                    {h.city}
                    {h.startName ? ` · starts at ${h.startName}` : ''} · {h.routes} routes
                  </p>
                </button>
              ))}

              <button
                className="btn btn-ghost btn-block"
                onClick={() => coords && void generateHere({ ...coords }, 'you')}
              >
                Build a fresh one here instead
              </button>
            </>
          ) : (
            <>
              <div>
                <h2 style={{ marginBottom: 8 }}>
                  {lookupFailed ? "Couldn't check for hunts nearby" : 'Nothing here yet'}
                </h2>
                <p className="muted" style={{ fontSize: 17 }}>
                  {lookupFailed
                    ? "The server didn't answer, so there may well be a hunt near you — we just can't see it from here. You can still build one, or play the Pittsburgh hunt."
                    : 'No hunt within five miles. Want one built from the landmarks around you right now?'}
                </p>
              </div>
              <button
                className="btn btn-lime btn-block"
                onClick={() => coords && void generateHere({ ...coords }, 'you')}
              >
                Build a hunt here
              </button>
              <button className="btn btn-ghost btn-block" onClick={playBundled}>
                Play the Pittsburgh demo hunt
              </button>
            </>
          )}
        </>
      )}

      {/* ---------------------------------------------------------- error */}
      {phase === 'error' && (
        <>
          <div className="card" style={{ borderColor: 'var(--pink)' }}>
            <p className="label" style={{ color: 'var(--pink)', marginBottom: 8 }}>
              Couldn&apos;t do that
            </p>
            <p style={{ margin: 0 }}>{error}</p>
          </div>
          {/* Never a dead end. The seeded hunt needs no permission and no server. */}
          <button className="btn btn-lime btn-block" onClick={playBundled}>
            Use demo location · Pittsburgh hunt
          </button>
          <button className="btn btn-ghost btn-block" onClick={() => setPhase('asking')}>
            Try another way
          </button>
        </>
      )}
    </main>
  );
}
