'use client';

/**
 * Post-hunt animated route replay.
 *
 * This is the payoff screen: every player's path drawn at once, so the table
 * can see that they walked genuinely different routes and still converged on
 * the same finish. The route-exclusive discoveries are what makes the
 * comparison interesting, so they surface as each pin is reached.
 *
 * MapLibre owns the geography here too — this component feeds it interpolated
 * positions and lets it draw. Phaser is not involved; the replay is a map
 * artifact, not an animation artifact.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import maplibregl, { type Map as MapLibreMap } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { Feature, FeatureCollection, GeoJSON as GeoJSONObject } from 'geojson';
import { lerpLatLng, type LatLng } from '@ww/shared';
import { identityFor } from '@/lib/routeIdentity';

export interface ReplayCheckpointEvent {
  position: LatLng;
  name: string;
  /** Milliseconds from hunt start. */
  atMs: number;
  xpAwarded: number;
  hintUsed: boolean;
  /** The route-exclusive story earned here. */
  reveal: string;
}

export interface ReplayPlayer {
  id: string;
  name: string;
  routeLabel: string;
  color: string;
  /** Breadcrumb trail, each with ms-from-start. */
  path: Array<LatLng & { atMs: number }>;
  checkpoints: ReplayCheckpointEvent[];
  finalXp: number;
}

export interface RouteReplayProps {
  players: ReplayPlayer[];
  /** The shared gathering point, drawn once so the split is legible. */
  start?: LatLng & { name: string };
  /** Total hunt duration in ms; the scrubber spans this. */
  durationMs: number;
  onDone?: () => void;
}

const SPEEDS = [1, 2, 4] as const;

/**
 * Seconds the whole hunt takes to replay at 1x.
 *
 * 30s was too fast to follow — the dots crossed Downtown before anyone could
 * read what was happening. 75s at 1x gives the eye time to see three routes
 * diverge and converge, and 2x/4x are there for anyone who wants it quicker.
 */
const REPLAY_BASE_SECONDS = 75;

const OSM_STYLE: maplibregl.StyleSpecification = {
  version: 8,
  sources: {
    osm: {
      type: 'raster',
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      attribution: '© OpenStreetMap contributors',
      maxzoom: 19,
    },
  },
  layers: [
    /**
     * A painted background UNDER the tiles.
     *
     * If the tile server is unreachable — throttled venue wifi, a captive
     * portal, no signal — the map area would otherwise be pure black, and the
     * routes drawn on top of it read as floating lines in a void. A muted
     * land colour keeps the trails, markers and the converging-routes story
     * legible with no network at all.
     *
     * Caching OSM's tiles locally is NOT an option: their usage policy
     * prohibits bulk downloading, and they serve an "Access blocked" image to
     * clients that try. A paid provider (MAPTILER_KEY) is the supported route
     * if offline tiles are ever needed.
     */
    { id: 'backdrop', type: 'background', paint: { 'background-color': '#1a1147' } },
    {
      id: 'osm',
      type: 'raster',
      source: 'osm',
      // Schematic: desaturate hard so the three saturated trails are the
      // brightest thing on the map and the convergence reads instantly.
      paint: { 'raster-saturation': -0.8, 'raster-brightness-max': 0.5, 'raster-opacity': 0.65 },
    },
    /**
     * Indigo wash ABOVE the tiles, below the routes.
     *
     * Without it the map reads as a grey rectangle dropped into the design.
     * Kept light on purpose: this is a navigation aid a player squints at on a
     * street corner, so street names must stay readable. Routes are drawn
     * after this and remain the brightest thing on screen.
     */
    { id: 'tint', type: 'background', paint: { 'background-color': '#1a1147', 'background-opacity': 0.42 } },
  ],
};

const empty: FeatureCollection = { type: 'FeatureCollection', features: [] };

/** Position along a timestamped path at time t, interpolated between samples. */
function positionAt(path: ReplayPlayer['path'], t: number): LatLng | null {
  if (path.length === 0) return null;
  const first = path[0];
  const last = path[path.length - 1];
  if (!first || !last) return null;
  if (t <= first.atMs) return first;
  if (t >= last.atMs) return last;

  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1];
    const b = path[i];
    if (!a || !b) continue;
    if (t <= b.atMs) {
      const span = b.atMs - a.atMs;
      return span <= 0 ? b : lerpLatLng(a, b, (t - a.atMs) / span);
    }
  }
  return last;
}

/**
 * A map label short enough not to run off the screen.
 *
 * Landmark names come from OpenStreetMap and hand-authored content, and some
 * are long: "Allegheny County Courthouse — Bridge of Sighs" ran past the right
 * edge of a 430px viewport even wrapped. The full name is already shown in the
 * discoveries sheet, so the pin only needs enough to identify the place.
 *
 * Cuts at a subtitle separator first, since the useful half is almost always
 * before the dash.
 */
function pinLabel(name: string): string {
  // Drop a parenthetical alias first. Truncating through one leaves a dangling
  // bracket — "Market Square (The Diamond)" became "Market Square (The…".
  const head = (name.replace(/\s*\([^)]*\)\s*$/, '').split(/\s+[—–-]\s+/)[0] ?? name).trim();
  if (head.length <= 26) return head;
  const clipped = head.slice(0, 26);
  const lastSpace = clipped.lastIndexOf(' ');
  return `${(lastSpace > 12 ? clipped.slice(0, lastSpace) : clipped).trimEnd()}…`;
}


export default function RouteReplay({ players, durationMs, onDone, start }: RouteReplayProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const readyRef = useRef(false);
  const rafRef = useRef<number | null>(null);
  const lastFrameRef = useRef<number>(0);

  const [elapsed, setElapsed] = useState(0);
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(1);
  const [playing, setPlaying] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const [discoveries, setDiscoveries] = useState<Array<{ player: string; name: string; reveal: string }>>([]);

  /**
   * XP awards that are currently animating.
   *
   * Anchored to the checkpoint's screen position and re-projected every frame,
   * so a pop stays attached to the place it was earned while the map pans.
   * Keyed by player+checkpoint so a replay restart can fire them again.
   */
  const [pops, setPops] = useState<
    Array<{ key: string; lng: number; lat: number; xp: number; color: string; bornAt: number }>
  >([]);
  const firedPops = useRef<Set<string>>(new Set());

  // Refs so the animation loop reads fresh values without re-subscribing.
  const speedRef = useRef(speed);
  speedRef.current = speed;
  const playingRef = useRef(playing);
  playingRef.current = playing;

  const msPerRealSecond = durationMs / REPLAY_BASE_SECONDS;

  // --- Map setup ----------------------------------------------------------
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: OSM_STYLE,
      center: [-80.0045, 40.4406],
      zoom: 14.6,
      attributionControl: { compact: true },
    });
    mapRef.current = map;

    map.on('load', () => {
      players.forEach((p, i) => {
        map.addSource(`trail-${p.id}`, { type: 'geojson', data: empty });
        map.addLayer({
          id: `trail-${p.id}`,
          type: 'line',
          source: `trail-${p.id}`,
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: {
            'line-color': p.color,
            'line-width': 6,
            'line-opacity': 1,
            // Pattern as well as colour, so the routes stay distinguishable
            // in grayscale and for colour-blind viewers.
            'line-dasharray': identityFor(i).dash,
          },
        });

        map.addSource(`pins-${p.id}`, { type: 'geojson', data: empty });
        map.addLayer({
          id: `pins-${p.id}`,
          type: 'circle',
          source: `pins-${p.id}`,
          paint: {
            'circle-radius': 7,
            'circle-color': p.color,
            'circle-stroke-color': '#1a1147',
            'circle-stroke-width': 3,
          },
        });

        /**
         * Name every monument as it is reached.
         *
         * The whole argument for asymmetric routes is that players see
         * DIFFERENT places — which is invisible if the map only shows
         * anonymous dots. Labelled in the route's own colour with a dark
         * halo, so three sets of names stay attributable at a glance.
         */
        map.addLayer({
          id: `labels-${p.id}`,
          type: 'symbol',
          source: `pins-${p.id}`,
          layout: {
            'text-field': ['get', 'name'],
            'text-size': 12,
            'text-offset': [0, 1.3],
            'text-anchor': 'top',
            'text-max-width': 8,
            // Keep labels clear of the viewport edge, not just of each other.
            'text-padding': 6,
            'text-allow-overlap': false,
            'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold'],
          },
          paint: {
            'text-color': p.color,
            'text-halo-color': '#1a1147',
            'text-halo-width': 2.2,
          },
        });

        map.addSource(`head-${p.id}`, { type: 'geojson', data: empty });
        map.addLayer({
          id: `head-${p.id}`,
          type: 'circle',
          source: `head-${p.id}`,
          paint: {
            'circle-radius': 10,
            'circle-color': p.color,
            'circle-stroke-color': '#ffffff',
            'circle-stroke-width': 4,
          },
        });
      });

      // The shared start: one marker, drawn under everything else.
      map.addSource('start', { type: 'geojson', data: empty });
      map.addLayer({
        id: 'start-ring',
        type: 'circle',
        source: 'start',
        paint: {
          'circle-radius': 13,
          'circle-color': 'rgba(255,210,61,0.18)',
          'circle-stroke-color': '#ffd23d',
          'circle-stroke-width': 3,
        },
      });
      map.addLayer({
        id: 'start-label',
        type: 'symbol',
        source: 'start',
        layout: {
          'text-field': ['get', 'name'],
          'text-size': 12,
          'text-offset': [0, -1.6],
          'text-anchor': 'bottom',
          'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold'],
        },
        paint: { 'text-color': '#ffd23d', 'text-halo-color': '#1a1147', 'text-halo-width': 2.2 },
      });

      if (start) {
        (map.getSource('start') as maplibregl.GeoJSONSource | undefined)?.setData({
          type: 'Feature',
          properties: { name: `START · ${pinLabel(start.name)}` },
          geometry: { type: 'Point', coordinates: [start.longitude, start.latitude] },
        } as GeoJSONObject);
      }

      // Frame every path so all three routes are visible from the first frame.
      const all = players.flatMap((p) => p.path);
      if (all.length) {
        const bounds = all.reduce(
          (b, pt) => b.extend([pt.longitude, pt.latitude]),
          new maplibregl.LngLatBounds(
            [all[0]!.longitude, all[0]!.latitude],
            [all[0]!.longitude, all[0]!.latitude],
          ),
        );
        // Pad the bottom for the sheet so no route hides behind it.
        map.fitBounds(bounds, {
          // Generous sides: pin labels sit BESIDE their dot, so a route that
          // fits the viewport exactly still pushes its labels off the edge.
          padding: { top: 70, left: 64, right: 64, bottom: 300 },
          duration: 0,
        });
      }

      readyRef.current = true;
    });

    return () => {
      readyRef.current = false;
      map.remove();
      mapRef.current = null;
    };
  }, [players]);

  // --- Animation loop -----------------------------------------------------
  useEffect(() => {
    const tick = (ts: number) => {
      const prev = lastFrameRef.current || ts;
      const dt = Math.min(0.1, (ts - prev) / 1000);
      lastFrameRef.current = ts;

      if (playingRef.current) {
        setElapsed((e) => {
          const next = e + dt * msPerRealSecond * speedRef.current;
          if (next >= durationMs) {
            playingRef.current = false;
            setPlaying(false);
            onDone?.();
            return durationMs;
          }
          return next;
        });
      }

      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      lastFrameRef.current = 0;
    };
  }, [durationMs, msPerRealSecond, onDone]);

  // --- Render frame -------------------------------------------------------
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;

    const set = (id: string, data: FeatureCollection | Feature) =>
      (map.getSource(id) as maplibregl.GeoJSONSource | undefined)?.setData(data as GeoJSONObject);

    for (const p of players) {
      const drawn = p.path.filter((pt) => pt.atMs <= elapsed);
      const head = positionAt(p.path, elapsed);

      set(
        `trail-${p.id}`,
        drawn.length > 1
          ? {
              type: 'Feature',
              properties: {},
              geometry: {
                type: 'LineString',
                coordinates: drawn.map((pt) => [pt.longitude, pt.latitude]),
              },
            }
          : empty,
      );

      set(
        `head-${p.id}`,
        head
          ? {
              type: 'Feature',
              properties: {},
              geometry: { type: 'Point', coordinates: [head.longitude, head.latitude] },
            }
          : empty,
      );

      const reached = p.checkpoints.filter((c) => c.atMs <= elapsed);
      set(`pins-${p.id}`, {
        type: 'FeatureCollection',
        features: reached.map((c) => ({
          type: 'Feature' as const,
          properties: { name: pinLabel(c.name) },
          geometry: {
            type: 'Point' as const,
            coordinates: [c.position.longitude, c.position.latitude],
          },
        })),
      });
    }
  }, [elapsed, players]);

  // Surface each route-exclusive discovery as its pin is reached.
  useEffect(() => {
    const found: Array<{ player: string; name: string; reveal: string }> = [];
    for (const p of players) {
      for (const c of p.checkpoints) {
        if (c.atMs <= elapsed) found.push({ player: p.name, name: c.name, reveal: c.reveal });
      }
    }
    setDiscoveries(found);
  }, [elapsed, players]);

  const restart = useCallback(() => {
    setElapsed(0);
    setPlaying(true);
    firedPops.current.clear();
    setPops([]);
  }, []);

  /** POP_MS must stay under a second — see the motion rules. */
  const POP_MS = 900;

  // Fire an XP pop the moment a checkpoint is reached.
  useEffect(() => {
    const now = performance.now();
    const fresh: typeof pops = [];

    for (const p of players) {
      for (const c of p.checkpoints) {
        const key = `${p.id}:${c.name}:${c.atMs}`;
        if (c.atMs <= elapsed && !firedPops.current.has(key)) {
          firedPops.current.add(key);
          fresh.push({
            key,
            lng: c.position.longitude,
            lat: c.position.latitude,
            xp: c.xpAwarded,
            color: p.color,
            bornAt: now,
          });
        }
      }
    }

    if (fresh.length) setPops((prev) => [...prev, ...fresh]);
  }, [elapsed, players]);

  // Retire finished pops. Separate from firing so a re-render cannot drop one.
  useEffect(() => {
    if (pops.length === 0) return;
    const id = setInterval(() => {
      const now = performance.now();
      setPops((prev) => prev.filter((x) => now - x.bornAt < POP_MS));
    }, 120);
    return () => clearInterval(id);
  }, [pops.length]);

  const progressPct = durationMs > 0 ? (elapsed / durationMs) * 100 : 0;
  const xpAt = useMemo(
    () =>
      players.map((p) => ({
        ...p,
        xp: p.checkpoints.filter((c) => c.atMs <= elapsed).reduce((s, c) => s + c.xpAwarded, 0),
      })),
    [players, elapsed],
  );

  return (
    <div style={{ position: 'fixed', inset: 0, display: 'flex', flexDirection: 'column' }}>
      <div ref={containerRef} style={{ position: 'absolute', inset: 0 }} />

      {/* XP awards, anchored to the checkpoint that earned them. */}
      {pops.map((pop) => {
        const map = mapRef.current;
        if (!map) return null;
        const pt = map.project([pop.lng, pop.lat]);
        return (
          <div
            key={pop.key}
            style={{
              position: 'absolute',
              left: pt.x,
              top: pt.y,
              transform: 'translate(-50%, -100%)',
              pointerEvents: 'none',
              zIndex: 9,
              background: pop.color,
              color: '#1a1147',
              borderRadius: 'var(--r-pill)',
              padding: '5px 11px',
              fontWeight: 800,
              fontSize: 15,
              whiteSpace: 'nowrap',
              animation: 'xppop 900ms ease-out forwards',
            }}
          >
            +{pop.xp} XP
          </div>
        );
      })}

      <div className="sheet" style={{ maxHeight: expanded ? '62dvh' : '34dvh' }}>
        {/* The routes converging IS the pitch, so the map keeps most of the
            screen by default and the detail is one tap away. */}
        <button
          className="btn btn-ghost"
          onClick={() => setExpanded((v) => !v)}
          style={{
            width: '100%',
            minHeight: 38,
            marginBottom: 12,
            fontSize: 13,
            padding: 0,
          }}
          aria-expanded={expanded}
        >
          {expanded ? '▼ Hide details' : '▲ Discoveries & scores'}
        </button>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
          {/* Glyph-only buttons need names. A screen reader otherwise
              announces "❚❚" and "↺", and nothing outside the component can
              tell the transport controls apart either — which is how a broken
              control would go unnoticed. */}
          <button
            className="btn btn-ghost"
            style={{ minWidth: 56, padding: 0 }}
            onClick={() => setPlaying((v) => !v)}
            aria-label={playing ? 'Pause the replay' : 'Play the replay'}
          >
            {playing ? '❚❚' : '▶'}
          </button>
          <button
            className="btn btn-ghost"
            style={{ minWidth: 56, padding: 0 }}
            onClick={restart}
            aria-label="Restart the replay"
          >
            ↺
          </button>
          {SPEEDS.map((s) => (
            <button
              key={s}
              className={`btn${speed === s ? ' btn-yellow' : ' btn-ghost'}`}
              style={{ minWidth: 56, padding: '0 12px' }}
              onClick={() => setSpeed(s)}
              aria-label={`Play at ${s} times speed`}
              aria-pressed={speed === s}
            >
              {s}×
            </button>
          ))}
        </div>

        <div
          style={{
            height: 7,
            background: 'var(--panel-raised)',
            borderRadius: 'var(--r-pill)',
            overflow: 'hidden',
            marginBottom: 16,
          }}
        >
          <div
            style={{
              width: `${progressPct}%`,
              height: '100%',
              background: 'var(--yellow)',
            }}
          />
        </div>

        {xpAt.map((p, i) => (
          <div
            key={p.id}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '11px 0',
              borderBottom: '2px solid var(--border)',
            }}
          >
            <span
              className="pill"
              style={{
                background: p.color,
                color: '#1a1147',
                borderColor: p.color,
                padding: '4px 9px',
                fontSize: 13,
                flexShrink: 0,
              }}
            >
              {/* Glyph as well as colour — the route identity has to survive
                  grayscale and colour-blindness. */}
              {identityFor(i).glyph}
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 700 }}>{p.name}</div>
              <div className="muted" style={{ fontSize: 12 }}>
                {p.routeLabel}
              </div>
            </div>
            <span className="mono" style={{ fontWeight: 700, color: 'var(--lime)', fontSize: 17 }}>{p.xp} XP</span>
          </div>
        ))}

        {discoveries.length > 0 && (
          <div style={{ marginTop: 14 }}>
            <p className="muted" style={{ fontSize: 11, letterSpacing: '0.08em', margin: '0 0 8px' }}>
              DISCOVERIES ALONG THE WAY
            </p>
            {discoveries.slice(-4).map((d, i) => (
              <p key={`${d.name}-${i}`} style={{ fontSize: 13, margin: '0 0 8px', lineHeight: 1.5 }}>
                <strong>{d.name}</strong> <span className="muted">· {d.player}</span>
                <br />
                <span className="muted">{d.reveal.slice(0, 150)}…</span>
              </p>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
