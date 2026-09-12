'use client';

/**
 * The creator's map surface.
 *
 * Same layer ownership as the player's map (ARCHITECTURE.md): MapLibre draws
 * anything with a coordinate and decides nothing. The draft lives in React;
 * this component reports clicks and drags and re-renders whatever it is given.
 *
 * Checkpoints are `maplibregl.Marker`s rather than a GeoJSON symbol layer,
 * because markers are the thing MapLibre gives drag behaviour to for free. The
 * radius rings stay in a GeoJSON source — they are decoration, never a hit
 * target, and a fill layer is far cheaper than N DOM circles.
 */

import { useEffect, useRef } from 'react';
import maplibregl, { type Map as MapLibreMap } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { Feature, FeatureCollection, GeoJSON as GeoJSONObject } from 'geojson';
import type { LatLng } from '@ww/shared';

export type MarkerKind = 'finish' | 'assigned' | 'unassigned';

export interface CreatorMapMarker {
  id: string;
  latitude: number;
  longitude: number;
  radiusMeters: number;
  /** Order number within its route, or a dot when unassigned. */
  label: string;
  name: string;
  kind: MarkerKind;
  selected: boolean;
}

export interface CreatorMapProps {
  markers: CreatorMapMarker[];
  /** Ordered points of the route being edited, drawn as a walking order line. */
  routeLine: LatLng[];
  /** When false, clicking the map pans instead of creating a checkpoint. */
  addOnClick: boolean;
  onAdd: (latitude: number, longitude: number) => void;
  onMove: (id: string, latitude: number, longitude: number) => void;
  onSelect: (id: string) => void;
}

/** Free OpenStreetMap raster tiles — no API key (DECISIONS.md D2). */
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
  layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
};

const DOWNTOWN_PITTSBURGH: [number, number] = [-80.0045, 40.4406];

const COLORS: Record<MarkerKind, string> = {
  finish: '#fbbf24',
  assigned: '#a78bfa',
  unassigned: '#9aa6c9',
};

/** Approximate a geodesic circle as a polygon, for the radius fills. */
function circlePolygon(center: LatLng, radiusMeters: number, props: Record<string, unknown>, steps = 48): Feature {
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
  return { type: 'Feature', properties: props, geometry: { type: 'Polygon', coordinates: [coords] } };
}

const emptyFC: FeatureCollection = { type: 'FeatureCollection', features: [] };

/**
 * MapLibre positions a Marker by writing `transform: translate(...)` onto its
 * element, so the element it is given must stay untouched: every visual style
 * goes on an inner "pin" node instead. Styling the outer node would fight the
 * map for the transform and the marker would detach from its coordinate.
 */
function styleElement(el: HTMLElement, m: CreatorMapMarker): void {
  const pin = el.firstElementChild as HTMLElement | null;
  const label = pin?.firstElementChild as HTMLElement | null;
  if (!pin || !label) return;

  const color = COLORS[m.kind];
  const size = m.kind === 'finish' ? 34 : 28;
  pin.style.width = `${size}px`;
  pin.style.height = `${size}px`;
  pin.style.borderRadius = m.kind === 'finish' ? '9px' : '999px';
  pin.style.transform = m.kind === 'finish' ? 'rotate(45deg)' : 'none';
  pin.style.background = color;
  pin.style.color = '#0b1020';
  pin.style.font = '700 13px/1 ui-sans-serif, system-ui, sans-serif';
  pin.style.display = 'flex';
  pin.style.alignItems = 'center';
  pin.style.justifyContent = 'center';
  pin.style.cursor = 'grab';
  pin.style.border = m.selected ? '3px solid #eef2ff' : '2px solid #0b1020';
  pin.style.boxShadow = m.selected ? '0 0 0 3px rgba(94,234,212,0.6)' : '0 1px 4px rgba(0,0,0,0.5)';

  label.textContent = m.label;
  label.style.transform = m.kind === 'finish' ? 'rotate(-45deg)' : 'none';
  el.title = `${m.name || 'Untitled checkpoint'} — drag to move, click to edit`;
}

export default function CreatorMap(props: CreatorMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const readyRef = useRef(false);
  const fittedRef = useRef(false);
  const draggingRef = useRef<string | null>(null);
  const markersRef = useRef(new Map<string, maplibregl.Marker>());
  const syncRef = useRef<(() => void) | null>(null);

  // Callbacks change identity on every parent render; markers must not be
  // torn down and rebuilt for that, so they read through a ref instead.
  const propsRef = useRef(props);
  propsRef.current = props;

  // --- Create the map once -------------------------------------------------
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: OSM_STYLE,
      center: DOWNTOWN_PITTSBURGH,
      zoom: 15,
      attributionControl: { compact: true },
    });
    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');

    map.on('click', (e) => {
      if (!propsRef.current.addOnClick) return;
      // A double-click to zoom emits two clicks; without this guard it would
      // stack two checkpoints on the same spot.
      if (e.originalEvent.detail > 1) return;
      propsRef.current.onAdd(e.lngLat.lat, e.lngLat.lng);
    });

    map.on('load', () => {
      map.addSource('radii', { type: 'geojson', data: emptyFC });
      map.addLayer({
        id: 'radii-fill',
        type: 'fill',
        source: 'radii',
        paint: {
          'fill-color': ['get', 'color'],
          'fill-opacity': ['case', ['get', 'selected'], 0.3, 0.12],
        },
      });
      map.addLayer({
        id: 'radii-line',
        type: 'line',
        source: 'radii',
        paint: {
          'line-color': ['get', 'color'],
          'line-width': ['case', ['get', 'selected'], 2, 1],
          'line-dasharray': [2, 2],
        },
      });

      map.addSource('route-line', { type: 'geojson', data: emptyFC });
      map.addLayer({
        id: 'route-line',
        type: 'line',
        source: 'route-line',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#5eead4', 'line-width': 3, 'line-opacity': 0.65 },
      });

      readyRef.current = true;
      // Force one sync pass now that the sources exist.
      syncRef.current?.();
    });

    return () => {
      readyRef.current = false;
      fittedRef.current = false;
      markersRef.current.forEach((m) => m.remove());
      markersRef.current.clear();
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // --- Sync markers + rings on every change -------------------------------
  useEffect(() => {
    const sync = () => {
      const map = mapRef.current;
      if (!map || !readyRef.current) return;
      const { markers, routeLine } = propsRef.current;

      const live = markersRef.current;
      const wanted = new Set(markers.map((m) => m.id));

      for (const [id, marker] of live) {
        if (!wanted.has(id)) {
          marker.remove();
          live.delete(id);
        }
      }

      for (const m of markers) {
        let marker = live.get(m.id);
        if (!marker) {
          const el = document.createElement('div');
          const pin = document.createElement('div');
          pin.appendChild(document.createElement('span'));
          el.appendChild(pin);
          el.addEventListener('click', (ev) => {
            ev.stopPropagation();
            propsRef.current.onSelect(m.id);
          });
          marker = new maplibregl.Marker({ element: el, draggable: true, anchor: 'center' })
            .setLngLat([m.longitude, m.latitude])
            .addTo(map);
          marker.on('dragstart', () => {
            draggingRef.current = m.id;
          });
          marker.on('dragend', () => {
            draggingRef.current = null;
            const { lat, lng } = marker!.getLngLat();
            propsRef.current.onMove(m.id, lat, lng);
          });
          live.set(m.id, marker);
        }
        // Never fight the user's finger mid-drag.
        if (draggingRef.current !== m.id) marker.setLngLat([m.longitude, m.latitude]);
        styleElement(marker.getElement(), m);
      }

      const radii = map.getSource('radii') as maplibregl.GeoJSONSource | undefined;
      radii?.setData({
        type: 'FeatureCollection',
        features: markers.map((m) =>
          circlePolygon(m, m.radiusMeters, { color: COLORS[m.kind], selected: m.selected }),
        ),
      } as GeoJSONObject);

      const line = map.getSource('route-line') as maplibregl.GeoJSONSource | undefined;
      line?.setData(
        (routeLine.length > 1
          ? {
              type: 'Feature',
              properties: {},
              geometry: {
                type: 'LineString',
                coordinates: routeLine.map((p) => [p.longitude, p.latitude]),
              },
            }
          : emptyFC) as GeoJSONObject,
      );

      // Frame the content once, the first time there is any.
      if (!fittedRef.current && markers.length > 0) {
        fittedRef.current = true;
        const bounds = new maplibregl.LngLatBounds();
        for (const m of markers) bounds.extend([m.longitude, m.latitude]);
        map.fitBounds(bounds, { padding: 80, maxZoom: 16.5, duration: 0 });
      }
    };

    syncRef.current = sync;
    sync();
  });

  // --- Cursor affordance ---------------------------------------------------
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.getCanvas().style.cursor = props.addOnClick ? 'crosshair' : '';
  }, [props.addOnClick]);

  return <div ref={containerRef} style={{ position: 'absolute', inset: 0 }} />;
}
