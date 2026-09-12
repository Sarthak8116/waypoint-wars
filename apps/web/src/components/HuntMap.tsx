'use client';

/**
 * MapLibre owns geography — and nothing else (see ARCHITECTURE.md).
 *
 * It draws anything with a coordinate: the player, the accuracy circle, the
 * active checkpoint's radius, completed checkpoints, the shared destination,
 * and the breadcrumb trail. It decides nothing about the game.
 *
 * Note the prop shape: this component is given ONLY the active checkpoint and
 * the already-completed ones. Future checkpoints are never passed in, so they
 * cannot leak through the DOM or a devtools inspection of the map source.
 */

import { useEffect, useRef } from 'react';
import maplibregl, { type Map as MapLibreMap } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { Feature, FeatureCollection, GeoJSON as GeoJSONObject } from 'geojson';
import type { LatLng } from '@ww/shared';

export interface HuntMapProps {
  player: LatLng | null;
  accuracyMeters: number;
  /** The one checkpoint currently being hunted. Null before start / after finish. */
  activeTarget: { position: LatLng; radiusMeters: number } | null;
  /** Checkpoints already completed — safe to reveal. */
  completed: Array<{ position: LatLng; name: string }>;
  /** The shared finish, known to everyone from the start. */
  finalDestination: LatLng | null;
  /** Breadcrumb trail for the replay / progress line. */
  trail: LatLng[];
  /** True once the player is inside the active radius, for styling emphasis. */
  arrived: boolean;
}

/**
 * Free OpenStreetMap raster tiles — no API key required (DECISIONS.md D2).
 * Swap for a MapTiler vector style if MAPTILER_KEY is ever provided.
 */
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
      // Desaturated and dimmed so the indigo canvas reads through and our
      // saturated route strokes stay the brightest thing on screen.
      paint: { 'raster-saturation': -0.75, 'raster-brightness-max': 0.55, 'raster-opacity': 0.72 },
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

const DOWNTOWN_PITTSBURGH: [number, number] = [-80.0045, 40.4406];

/** Approximate a geodesic circle as a polygon, for the radius fills. */
function circlePolygon(center: LatLng, radiusMeters: number, steps = 64): Feature {
  const coords: [number, number][] = [];
  const latRad = (center.latitude * Math.PI) / 180;
  const dLat = radiusMeters / 111_320;
  const dLng = radiusMeters / (111_320 * Math.max(0.1, Math.cos(latRad)));

  for (let i = 0; i <= steps; i++) {
    const theta = (i / steps) * 2 * Math.PI;
    coords.push([
      center.longitude + dLng * Math.cos(theta),
      center.latitude + dLat * Math.sin(theta),
    ]);
  }

  return { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [coords] } };
}

const emptyFC: FeatureCollection = { type: 'FeatureCollection', features: [] };

export default function HuntMap(props: HuntMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const readyRef = useRef(false);
  const followRef = useRef(true);

  // --- Create the map once -------------------------------------------------
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: OSM_STYLE,
      center: DOWNTOWN_PITTSBURGH,
      zoom: 15.5,
      attributionControl: { compact: true },
    });
    mapRef.current = map;

    // Dragging the map means "let me look around" — stop yanking it back.
    map.on('dragstart', () => {
      followRef.current = false;
    });

    map.on('load', () => {
      map.addSource('accuracy', { type: 'geojson', data: emptyFC });
      map.addLayer({
        id: 'accuracy-fill',
        type: 'fill',
        source: 'accuracy',
        paint: { 'fill-color': '#27e1ff', 'fill-opacity': 0.14 },
      });

      map.addSource('target', { type: 'geojson', data: emptyFC });
      map.addLayer({
        id: 'target-fill',
        type: 'fill',
        source: 'target',
        paint: { 'fill-color': '#ffd23d', 'fill-opacity': 0.13 },
      });
      map.addLayer({
        id: 'target-line',
        type: 'line',
        source: 'target',
        // The destination is a dashed RADIUS, never a pin — the player is
        // looking for an area, and a pin implies a precision we don't have.
        paint: { 'line-color': '#ffd23d', 'line-width': 3, 'line-dasharray': [2, 2] },
      });

      map.addSource('trail', { type: 'geojson', data: emptyFC });
      map.addLayer({
        id: 'trail-line',
        type: 'line',
        source: 'trail',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#ff3d8b', 'line-width': 6, 'line-opacity': 0.95 },
      });

      map.addSource('completed', { type: 'geojson', data: emptyFC });
      map.addLayer({
        id: 'completed-dots',
        type: 'circle',
        source: 'completed',
        paint: {
          'circle-radius': 8,
          'circle-color': '#b6ff3d',
          'circle-stroke-color': '#1a1147',
          'circle-stroke-width': 3,
        },
      });

      map.addSource('finish', { type: 'geojson', data: emptyFC });
      map.addLayer({
        id: 'finish-dot',
        type: 'circle',
        source: 'finish',
        paint: {
          'circle-radius': 10,
          'circle-color': '#ffd23d',
          'circle-stroke-color': '#1a1147',
          'circle-stroke-width': 3,
        },
      });

      map.addSource('player', { type: 'geojson', data: emptyFC });
      map.addLayer({
        id: 'player-dot',
        type: 'circle',
        source: 'player',
        paint: {
          'circle-radius': 9,
          'circle-color': '#ffffff',
          'circle-stroke-color': '#ff3d8b',
          'circle-stroke-width': 4,
        },
      });

      readyRef.current = true;
    });

    return () => {
      readyRef.current = false;
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // --- Push data on every prop change -------------------------------------
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;

    const setData = (id: string, data: FeatureCollection | Feature) => {
      const src = map.getSource(id) as maplibregl.GeoJSONSource | undefined;
      src?.setData(data as GeoJSONObject);
    };

    const { player, accuracyMeters, activeTarget, completed, finalDestination, trail } = props;

    if (player) {
      setData('player', {
        type: 'Feature',
        properties: {},
        geometry: { type: 'Point', coordinates: [player.longitude, player.latitude] },
      });
      setData('accuracy', circlePolygon(player, Math.max(accuracyMeters, 10)));
      if (followRef.current) {
        map.easeTo({ center: [player.longitude, player.latitude], duration: 500 });
      }
    } else {
      setData('player', emptyFC);
      setData('accuracy', emptyFC);
    }

    setData('target', activeTarget ? circlePolygon(activeTarget.position, activeTarget.radiusMeters) : emptyFC);

    map.setPaintProperty('target-fill', 'fill-opacity', props.arrived ? 0.32 : 0.18);

    setData('completed', {
      type: 'FeatureCollection',
      features: completed.map((c) => ({
        type: 'Feature' as const,
        properties: { name: c.name },
        geometry: { type: 'Point' as const, coordinates: [c.position.longitude, c.position.latitude] },
      })),
    });

    setData(
      'finish',
      finalDestination
        ? {
            type: 'Feature',
            properties: {},
            geometry: {
              type: 'Point',
              coordinates: [finalDestination.longitude, finalDestination.latitude],
            },
          }
        : emptyFC,
    );

    setData(
      'trail',
      trail.length > 1
        ? {
            type: 'Feature',
            properties: {},
            geometry: { type: 'LineString', coordinates: trail.map((p) => [p.longitude, p.latitude]) },
          }
        : emptyFC,
    );
  }, [props]);

  return <div ref={containerRef} style={{ position: 'absolute', inset: 0 }} />;
}
