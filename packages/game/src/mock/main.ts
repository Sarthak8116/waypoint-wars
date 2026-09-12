/**
 * Standalone mock harness for the HUD.
 *
 * Runs the overlay with no server, no map, no React and no API keys: a button
 * per `GameEvent` variant so every animation can be triggered and eyeballed.
 * The button list is generated from `EVENT_CATALOG`, which is a mapped type
 * over `HudEventType` — so a new event variant cannot be added without a button
 * appearing here.
 *
 *   pnpm --filter @ww/game mock   ->  http://localhost:5174
 */

import { GameBridge } from '../bridge.js';
import type { GameHandle } from '../types.js';
import { mountGame } from '../mount.js';
import { EVENT_CATALOG, EVENT_TYPES, LEADERBOARD, createMockState } from './fixtures.js';

const container = document.getElementById('hud');
const eventButtons = document.getElementById('event-buttons');
const sceneButtons = document.getElementById('scene-buttons');
const log = document.getElementById('log');
if (!container || !eventButtons || !sceneButtons || !log) throw new Error('mock page markup missing');

const state = createMockState();
// The bridge outlives the Phaser instance on purpose: destroy and remount the
// HUD below and watch that nothing is lost.
const bridge = new GameBridge();
let handle: GameHandle | undefined;

function note(message: string): void {
  log!.textContent = `${new Date().toLocaleTimeString()}  ${message}\n${log!.textContent ?? ''}`
    .split('\n')
    .slice(0, 12)
    .join('\n');
}

function mount(): void {
  handle?.destroy();
  handle = mountGame(container!, {
    bridge,
    totalCheckpoints: state.total,
    selfPlayerId: 'p1',
    hintCostLabel: '-20 XP',
    onHintRequested: () => {
      note('onHintRequested -> the app would ask the server what a hint costs');
      bridge.emit(EVENT_CATALOG.HINT_USED.make(state));
    },
    onReplayRequested: () => note('onReplayRequested -> MapLibre would draw the replay'),
    onResultsDismissed: () => note('results dismissed'),
  });
  note('HUD mounted');
}

function button(parent: HTMLElement, label: string, onClick: () => void, alt = false): void {
  const el = document.createElement('button');
  el.textContent = label;
  if (alt) el.className = 'alt';
  el.addEventListener('click', onClick);
  parent.appendChild(el);
}

for (const type of EVENT_TYPES) {
  const sample = EVENT_CATALOG[type];
  button(eventButtons, `${sample.label}  ·  ${type}`, () => {
    const event = sample.make(state);
    bridge.emit(event);
    note(`emit ${event.type}`);
  });
}

button(
  sceneButtons,
  'Show results scene',
  () => {
    handle?.showResults(LEADERBOARD, {
      selfPlayerId: 'p1',
      elapsedSeconds: 42 * 60 + 17,
      hintsUsed: state.hintsUsed,
      incorrectAttempts: state.incorrectAttempts,
      achievements: ['First blood', 'No hints', 'Fountain finisher'],
    });
    note('results scene started');
  },
  true,
);

button(
  sceneButtons,
  'Emit BEFORE mounting (queue test)',
  () => {
    handle?.destroy();
    handle = undefined;
    bridge.emit(EVENT_CATALOG.XP_AWARDED.make(state));
    note('emitted with no scene alive — it is queued, not dropped');
    window.setTimeout(mount, 600);
  },
  true,
);

button(
  sceneButtons,
  'Destroy + remount (StrictMode)',
  () => {
    mount();
    bridge.emit(EVENT_CATALOG.HUD_RESYNC.make(state));
    note('remounted and resynced — nothing lost');
  },
  true,
);

button(sceneButtons, 'Destroy HUD', () => {
  handle?.destroy();
  handle = undefined;
  note('HUD destroyed; the map below must still be usable');
}, true);

mount();
