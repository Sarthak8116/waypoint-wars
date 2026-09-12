/**
 * Route identity — colour AND shape, never colour alone.
 *
 * Three players walk three routes and the whole pitch is "look, they're
 * different". Colour carries that on a healthy screen; a dash pattern and a
 * marker shape carry it in grayscale, in sunlight, and for the ~8% of men with
 * a colour vision deficiency. Every place a route is drawn should use all
 * three fields.
 */

export interface RouteIdentity {
  key: 'pink' | 'cyan' | 'lime';
  /** Stroke / fill colour. */
  color: string;
  /** The hard-shadow colour that pairs with it. */
  shadow: string;
  /** Readable text colour ON the accent. */
  ink: string;
  /** MapLibre line-dasharray, in line-width multiples. Distinct silhouettes. */
  dash: number[];
  /** A one-word name for the pattern, for legends. */
  pattern: 'solid' | 'dashed' | 'dotted';
  /** Marker glyph, so pins differ in shape as well as colour. */
  glyph: string;
}

export const ROUTE_IDENTITIES: RouteIdentity[] = [
  {
    key: 'pink',
    color: '#ff3d8b',
    shadow: '#c41e68',
    ink: '#ffffff',
    dash: [1],
    pattern: 'solid',
    glyph: '●',
  },
  {
    key: 'cyan',
    color: '#27e1ff',
    shadow: '#00a9c4',
    ink: '#0b2b33',
    dash: [2.4, 1.6],
    pattern: 'dashed',
    glyph: '▲',
  },
  {
    key: 'lime',
    color: '#b6ff3d',
    shadow: '#85c516',
    ink: '#1b2e05',
    dash: [0.6, 1.6],
    pattern: 'dotted',
    glyph: '■',
  },
];

/** Stable identity for a route, by position in the hunt. */
export function identityFor(index: number): RouteIdentity {
  return ROUTE_IDENTITIES[index % ROUTE_IDENTITIES.length]!;
}
