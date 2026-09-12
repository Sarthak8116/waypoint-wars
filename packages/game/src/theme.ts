/**
 * HUD palette and type scale. Phaser-free and DOM-free so it can be imported
 * anywhere, including tests.
 *
 * The overlay sits on top of a live map, so every surface is a translucent dark
 * plate and every glyph is high-contrast: the HUD has to stay legible over
 * pale streets and dark parks alike, in sunlight, on a phone.
 */

export const COLORS = {
  /** Yellow is reserved for the CURRENT thing — timer, active pip. */
  xp: 0xffd23d,
  xpText: '#ffd23d',
  ink: '#ffffff',
  inkDim: '#c7bef5',
  /** Flat indigo plates with a solid edge. No blur, no glow. */
  plate: 0x241a63,
  plateEdge: 0x3b2e9a,
  accent: 0x27e1ff,
  accentText: '#27e1ff',
  success: 0xb6ff3d,
  successText: '#b6ff3d',
  danger: 0xff3d8b,
  dangerText: '#ff3d8b',
  warning: 0xffd23d,
  warningText: '#ffd23d',
  /** Progress segments: done in route pink, todo in raised panel. */
  pipDone: 0xff3d8b,
  pipTodo: 0x2e2280,
} as const;

export const FONT = {
  /** Outfit is loaded by the host page; fall back cleanly if it has not. */
  family: 'Outfit, ui-sans-serif, system-ui, sans-serif',
  /** Space Mono, and only for the timer. */
  mono: '"Space Mono", ui-monospace, monospace',
  xp: '30px',
  timer: '26px',
  label: '13px',
  body: '15px',
  title: '34px',
  stat: '22px',
} as const;

/** Flat blocks, so the plate is near-opaque rather than glassy. */
export const PLATE_ALPHA = 0.9;
export const PAD = 14;
