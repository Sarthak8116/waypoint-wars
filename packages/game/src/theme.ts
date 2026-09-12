/**
 * HUD palette and type scale. Phaser-free and DOM-free so it can be imported
 * anywhere, including tests.
 *
 * The overlay sits on top of a live map, so every surface is a translucent dark
 * plate and every glyph is high-contrast: the HUD has to stay legible over
 * pale streets and dark parks alike, in sunlight, on a phone.
 */

export const COLORS = {
  xp: 0xffd15c,
  xpText: '#ffd15c',
  ink: '#f5f7fa',
  inkDim: '#aab4c2',
  plate: 0x0d1220,
  plateEdge: 0x2a3350,
  accent: 0x4cc2ff,
  accentText: '#4cc2ff',
  success: 0x53d98b,
  successText: '#53d98b',
  danger: 0xff6b6b,
  dangerText: '#ff6b6b',
  warning: 0xffa94d,
  warningText: '#ffa94d',
  pipDone: 0x53d98b,
  pipTodo: 0x39435a,
} as const;

export const FONT = {
  family: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  xp: '30px',
  timer: '26px',
  label: '13px',
  body: '15px',
  title: '34px',
  stat: '22px',
} as const;

export const PLATE_ALPHA = 0.72;
export const PAD = 14;
