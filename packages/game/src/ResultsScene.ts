/**
 * End-of-hunt results.
 *
 * PHASER HOLDS NO GAME STATE. Everything shown here arrives in `init(data)`:
 * the leaderboard the server computed, and a summary of facts the HUD could not
 * have observed. The scene ranks nothing, scores nothing, and awards no badges
 * — it lays out what it was handed. "View route replay" fires an outbound
 * callback and stops there: MapLibre owns geography, including the replay path.
 *
 * SSR: imports Phaser at module scope. Reachable only through `mountGame`.
 */

// Phaser 3.90's ESM build has NO default export (only named ones), while its
// .d.ts declares one — so a default import typechecks but is undefined at
// runtime under webpack/Vite. A namespace import is correct for both.
import * as Phaser from 'phaser';
import type { LeaderboardEntry } from '@ww/shared';
import type { HitRegionRegistry, ResultsSummary } from './types.js';
import { huntFinishedSequence, revealLeaderboard } from './animations.js';
import { formatCountdown, formatXp } from './hudModel.js';
import { COLORS, FONT, PAD, PLATE_ALPHA } from './theme.js';

export const RESULTS_SCENE_KEY = 'ww-results';

export interface ResultsSceneConfig {
  hitRegions: HitRegionRegistry;
  /** Outbound only. The replay itself is MapLibre's job. */
  onReplayRequested?: () => void;
  onDismissed?: () => void;
}

export interface ResultsSceneData {
  entries: LeaderboardEntry[];
  summary: ResultsSummary;
}

const PANEL_WIDTH = 360;
const ROW_HEIGHT = 26;
const MAX_ROWS = 8;

export class ResultsScene extends Phaser.Scene {
  private readonly cfg: ResultsSceneConfig;
  private payload: ResultsSceneData = { entries: [], summary: {} };

  constructor(cfg: ResultsSceneConfig) {
    super({ key: RESULTS_SCENE_KEY, active: false });
    this.cfg = cfg;
  }

  init(data: ResultsSceneData): void {
    this.payload = { entries: data?.entries ?? [], summary: data?.summary ?? {} };
  }

  create(): void {
    const { width, height } = this.scale;
    const panel = this.add.container(width / 2, height / 2).setDepth(1200);

    panel.add(this.buildBackdrop());
    panel.add(this.buildHeader());
    panel.add(this.buildStatGrid());
    panel.add(this.buildBadges());

    const rows = this.buildLeaderboard();
    panel.add(rows);
    panel.add(this.buildReplayButton(width, height));

    huntFinishedSequence(this, panel);
    revealLeaderboard(this, rows);

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.cfg.hitRegions.clear(RESULTS_SCENE_KEY);
      this.cfg.onDismissed?.();
    });
  }

  private get self(): LeaderboardEntry | undefined {
    const { selfPlayerId } = this.payload.summary;
    if (selfPlayerId) {
      return this.payload.entries.find((entry) => entry.playerId === selfPlayerId);
    }
    return this.payload.entries[0];
  }

  private buildBackdrop(): Phaser.GameObjects.Rectangle {
    const rows = Math.min(this.payload.entries.length, MAX_ROWS);
    const panelHeight = 260 + rows * ROW_HEIGHT;
    return this.add
      .rectangle(0, 0, PANEL_WIDTH, panelHeight, COLORS.plate, PLATE_ALPHA + 0.2)
      .setStrokeStyle(1, COLORS.plateEdge, 1);
  }

  private buildHeader(): Phaser.GameObjects.Container {
    const rows = Math.min(this.payload.entries.length, MAX_ROWS);
    const top = -(260 + rows * ROW_HEIGHT) / 2 + PAD;
    const title = this.add
      .text(0, top, 'Hunt complete', {
        fontFamily: FONT.family,
        fontSize: FONT.title,
        color: COLORS.ink,
        fontStyle: 'bold',
      })
      .setOrigin(0.5, 0);
    const xp = this.add
      .text(0, top + 42, formatXp(this.self?.xp ?? 0), {
        fontFamily: FONT.family,
        fontSize: FONT.xp,
        color: COLORS.xpText,
        fontStyle: 'bold',
      })
      .setOrigin(0.5, 0);
    return this.add.container(0, 0, [title, xp]);
  }

  private buildStatGrid(): Phaser.GameObjects.Text[] {
    const entry = this.self;
    const summary = this.payload.summary;
    const stats: Array<[string, string]> = [
      ['Time', formatCountdown(summary.elapsedSeconds ?? 0)],
      ['Checkpoints', `${entry?.checkpointsCompleted ?? 0}/${entry?.totalCheckpoints ?? 0}`],
      ['Hints', String(summary.hintsUsed ?? entry?.hintsUsed ?? 0)],
      ['Misses', String(summary.incorrectAttempts ?? 0)],
    ];
    const rows = Math.min(this.payload.entries.length, MAX_ROWS);
    const top = -(260 + rows * ROW_HEIGHT) / 2 + 100;
    return stats.flatMap(([label, value], index) => {
      const x = -PANEL_WIDTH / 2 + PAD + (index % 4) * (PANEL_WIDTH - PAD * 2) / 4;
      return [
        this.add
          .text(x, top, label, {
            fontFamily: FONT.family,
            fontSize: FONT.label,
            color: COLORS.inkDim,
          })
          .setOrigin(0, 0),
        this.add
          .text(x, top + 16, value, {
            fontFamily: FONT.family,
            fontSize: FONT.stat,
            color: COLORS.ink,
          })
          .setOrigin(0, 0),
      ];
    });
  }

  /** Badge labels are handed to us already decided. The scene awards nothing. */
  private buildBadges(): Phaser.GameObjects.Container[] {
    const achievements = this.payload.summary.achievements ?? [];
    if (achievements.length === 0) return [];
    const rows = Math.min(this.payload.entries.length, MAX_ROWS);
    const top = -(260 + rows * ROW_HEIGHT) / 2 + 150;
    let x = -PANEL_WIDTH / 2 + PAD;
    return achievements.slice(0, 4).map((name) => {
      const label = this.add
        .text(0, 0, name, {
          fontFamily: FONT.family,
          fontSize: FONT.label,
          color: COLORS.successText,
        })
        .setOrigin(0, 0.5);
      const plate = this.add
        .rectangle(-6, 0, label.width + 16, 22, COLORS.plate, 0.9)
        .setStrokeStyle(1, COLORS.success, 0.8)
        .setOrigin(0, 0.5);
      const badge = this.add.container(x, top, [plate, label]);
      x += label.width + 24;
      return badge;
    });
  }

  private buildLeaderboard(): Phaser.GameObjects.Container[] {
    const rowCount = Math.min(this.payload.entries.length, MAX_ROWS);
    const top = -(260 + rowCount * ROW_HEIGHT) / 2 + 190;
    const left = -PANEL_WIDTH / 2 + PAD;
    const right = PANEL_WIDTH / 2 - PAD;
    return this.payload.entries.slice(0, MAX_ROWS).map((entry, index) => {
      const isSelf = entry.playerId === this.payload.summary.selfPlayerId;
      const color = isSelf ? COLORS.xpText : COLORS.ink;
      const rank = this.text(0, `${entry.rank}`, color).setOrigin(0, 0.5);
      const name = this.text(26, entry.displayName, color).setOrigin(0, 0.5);
      const progress = this.text(
        right - left - 90,
        `${entry.checkpointsCompleted}/${entry.totalCheckpoints}`,
        COLORS.inkDim,
      ).setOrigin(1, 0.5);
      const xp = this.text(right - left, `${entry.xp}`, color).setOrigin(1, 0.5);
      return this.add.container(left, top + index * ROW_HEIGHT, [rank, name, progress, xp]);
    });
  }

  private text(x: number, value: string, color: number | string): Phaser.GameObjects.Text {
    return this.add.text(x, 0, value, {
      fontFamily: FONT.family,
      fontSize: FONT.body,
      color: typeof color === 'string' ? color : `#${color.toString(16).padStart(6, '0')}`,
    });
  }

  private buildReplayButton(width: number, height: number): Phaser.GameObjects.Container {
    const rows = Math.min(this.payload.entries.length, MAX_ROWS);
    const bottom = (260 + rows * ROW_HEIGHT) / 2 - 34;
    const plate = this.add
      .rectangle(0, 0, 220, 44, COLORS.plate, 0.95)
      .setStrokeStyle(1, COLORS.accent, 1);
    const label = this.add
      .text(0, 0, 'View route replay', {
        fontFamily: FONT.family,
        fontSize: FONT.body,
        color: COLORS.accentText,
        fontStyle: 'bold',
      })
      .setOrigin(0.5);

    plate
      .setInteractive({ useHandCursor: true })
      .on(Phaser.Input.Events.GAMEOBJECT_POINTER_UP, () => this.cfg.onReplayRequested?.());

    // Tell the pass-through shim this rectangle should catch taps.
    this.cfg.hitRegions.set(RESULTS_SCENE_KEY, [
      { x: width / 2 - 110, y: height / 2 + bottom - 22, width: 220, height: 44 },
    ]);

    return this.add.container(0, bottom, [plate, label]);
  }
}
