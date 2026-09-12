/**
 * The transparent HUD overlay.
 *
 * ============================================================================
 * PHASER HOLDS NO GAME STATE.
 * ============================================================================
 * `this.view` is a *display snapshot*, not the game. Every number in it was
 * assigned straight from an incoming event's own authoritative field. The scene
 * decides nothing: it does not count XP, it does not know when a hint costs
 * what, and it does NOT decide when the timer expires — it renders
 * `TIMER_TICK.secondsRemaining` and colours it. `displayedXp` is the single
 * deliberate exception permitted by ARCHITECTURE.md: a cached value that exists
 * only so the counter can tween from the old figure to the new one, and
 * `HUD_RESYNC` snaps it into line without animation. Destroy this scene
 * mid-hunt, recreate it, replay one `HUD_RESYNC`, and nothing has been lost.
 * ============================================================================
 *
 * SSR: imports Phaser at module scope. Reachable only through the dynamic
 * `mountGame` path — never from the package barrel.
 */

// Phaser 3.90's ESM build has NO default export (only named ones), while its
// .d.ts declares one — so a default import typechecks but is undefined at
// runtime under webpack/Vite. A namespace import is correct for both.
import * as Phaser from 'phaser';
import {
  assertNever,
  type HudEvent,
  type HudSnapshot,
  type OpponentProgress,
} from './events.js';
import type { GameBridge, Unsubscribe } from './bridge.js';
import type { HitRegionRegistry } from './types.js';
import {
  applyEvent,
  emptySnapshot,
  formatCountdown,
  formatXp,
  isTimerWarning,
} from './hudModel.js';
import {
  TweenSlot,
  checkpointBurst,
  flashTimerWarning,
  flyXpToCounter,
  huntFinishedSequence,
  nextClueUnlock,
  playToast,
  popApproved,
  pulseVerifying,
  shakeRejected,
  tweenXpCounter,
} from './animations.js';
import { COLORS, FONT, PAD, PLATE_ALPHA } from './theme.js';

export const HUD_SCENE_KEY = 'ww-hud';

export interface HudSceneConfig {
  bridge: GameBridge;
  hitRegions: HitRegionRegistry;
  totalCheckpoints?: number;
  hintsEnabled?: boolean;
  /** Shown under the hint button. The scene never computes the cost. */
  hintCostLabel?: string;
  /** Outbound: the player asked for a hint. React + server decide what that costs. */
  onHintRequested?: () => void;
}

const MAX_OPPONENT_ROWS = 4;
const MAX_TOASTS = 3;

export class HudScene extends Phaser.Scene {
  private readonly cfg: HudSceneConfig;

  /** Display snapshot. NOT authoritative — see the header. */
  private view: HudSnapshot = emptySnapshot();
  /** Cached purely to tween the counter. Snapped by HUD_RESYNC. */
  private displayedXp = 0;

  private readonly xpSlot = new TweenSlot();
  private readonly verifySlot = new TweenSlot();

  private xpText!: Phaser.GameObjects.Text;
  private timerText!: Phaser.GameObjects.Text;
  private timerPlate!: Phaser.GameObjects.Rectangle;
  private pipRow!: Phaser.GameObjects.Container;
  private pips: Phaser.GameObjects.Rectangle[] = [];
  private progressLabel!: Phaser.GameObjects.Text;
  private hintButton?: Phaser.GameObjects.Container;
  private hintPlate?: Phaser.GameObjects.Rectangle;
  private verifyDot!: Phaser.GameObjects.Arc;
  private verifyLabel!: Phaser.GameObjects.Text;
  private opponentRows!: Phaser.GameObjects.Container;
  private toastLayer!: Phaser.GameObjects.Container;
  private clueCard!: Phaser.GameObjects.Container;

  private unsubscribe: Unsubscribe = () => {};
  private timerWasWarning = false;

  constructor(cfg: HudSceneConfig) {
    super(HUD_SCENE_KEY);
    this.cfg = cfg;
    this.view = { ...emptySnapshot(), total: cfg.totalCheckpoints ?? 0 };
  }

  create(): void {
    this.buildXpCounter();
    this.buildTimer();
    this.buildProgress();
    this.buildVerification();
    this.buildOpponents();
    this.buildClueCard();
    this.toastLayer = this.add.container(0, 0).setDepth(900);
    if (this.cfg.hintsEnabled !== false) this.buildHintButton();

    this.layout();
    this.scale.on(Phaser.Scale.Events.RESIZE, this.layout, this);

    this.unsubscribe = this.cfg.bridge.onAny((event) => this.handleEvent(event));
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.teardown, this);
    this.events.once(Phaser.Scenes.Events.DESTROY, this.teardown, this);

    // Last: anything React queued before Phaser booted now flushes into us.
    this.cfg.bridge.setReady(true);
  }

  private teardown(): void {
    this.unsubscribe();
    this.unsubscribe = () => {};
    this.cfg.bridge.setReady(false);
    this.scale.off(Phaser.Scale.Events.RESIZE, this.layout, this);
    this.xpSlot.stop();
    this.verifySlot.stop();
    this.cfg.hitRegions.clear(HUD_SCENE_KEY);
  }

  // -------------------------------------------------------------------------
  // Event handling — exhaustive over HudEvent
  // -------------------------------------------------------------------------

  private handleEvent(event: HudEvent): void {
    const previous = this.view;
    this.view = applyEvent(previous, event);
    this.animateFor(event, previous);
  }

  /**
   * One switch, one arm per variant, `never` at the bottom. Adding a variant to
   * `GameEvent` in @ww/shared fails `pnpm typecheck` here instead of silently
   * rendering nothing.
   */
  private animateFor(event: HudEvent, previous: HudSnapshot): void {
    switch (event.type) {
      case 'HUD_RESYNC':
        this.snapToSnapshot();
        break;

      case 'XP_AWARDED':
        this.onXpAwarded(event.amount, event.total, event.label);
        break;

      case 'PROGRESS_UPDATE':
        this.onProgress(previous.completed);
        break;

      case 'TIMER_TICK':
        this.refreshTimer();
        break;

      case 'PLAYER_ARRIVED':
        this.refreshVerification();
        this.toast(`Checkpoint ${event.index + 1} — you're here`, COLORS.accent);
        break;

      case 'VERIFICATION_STARTED':
        this.refreshVerification();
        break;

      case 'SUBMISSION_APPROVED':
        this.refreshVerification();
        popApproved(this, this.verifyDot);
        checkpointBurst(this, this.verifyDot.x, this.verifyDot.y);
        break;

      case 'SUBMISSION_REJECTED':
        this.refreshVerification();
        shakeRejected(this, this.verifyLabel);
        this.toast(event.reason, COLORS.danger);
        break;

      case 'HINT_USED':
        this.toast(`Hint used · ${formatSigned(event.xpDelta)} XP`, COLORS.warning);
        break;

      case 'OPPONENT_PROGRESS':
        this.onOpponentProgress(event.playerId, event.name, event.checkpointIndex, previous);
        break;

      case 'HUNT_FINISHED':
        huntFinishedSequence(this, this.clueCard);
        this.toast(`Hunt complete · ${event.entries.length} on the board`, COLORS.success);
        break;

      default: {
        const _never: never = event;
        assertNever(_never, 'HudScene.animateFor');
      }
    }
  }

  // -------------------------------------------------------------------------
  // XP
  // -------------------------------------------------------------------------

  private onXpAwarded(amount: number, total: number, label?: string): void {
    flyXpToCounter(this, {
      amount,
      label,
      fromX: this.scale.width / 2,
      fromY: this.scale.height * 0.62,
      toX: this.xpText.x + this.xpText.displayWidth / 2,
      toY: this.xpText.y + this.xpText.displayHeight / 2,
    });
    // Retarget from wherever the number currently sits: a second award 200ms
    // later interrupts the first rather than queuing behind it.
    tweenXpCounter(this, this.xpSlot, {
      from: this.displayedXp,
      to: total,
      onUpdate: (value) => this.renderXp(value),
    });
  }

  private renderXp(value: number): void {
    this.displayedXp = value;
    this.xpText.setText(formatXp(value));
  }

  private snapToSnapshot(): void {
    this.xpSlot.stop();
    this.renderXp(this.view.xpTotal);
    this.rebuildPips();
    this.refreshTimer();
    this.refreshVerification();
    this.refreshOpponents();
  }

  // -------------------------------------------------------------------------
  // Timer — renders the number, never decides that time is up
  // -------------------------------------------------------------------------

  private refreshTimer(): void {
    const warning = isTimerWarning(this.view.secondsRemaining);
    this.timerText.setText(formatCountdown(this.view.secondsRemaining));
    this.timerText.setColor(warning ? COLORS.dangerText : COLORS.ink);
    this.timerPlate.setStrokeStyle(1, warning ? COLORS.danger : COLORS.plateEdge, 1);
    if (warning && !this.timerWasWarning) flashTimerWarning(this, this.timerText);
    this.timerWasWarning = warning;
  }

  // -------------------------------------------------------------------------
  // Checkpoint progress
  // -------------------------------------------------------------------------

  private onProgress(previousCompleted: number): void {
    this.rebuildPips();
    if (this.view.completed <= previousCompleted) return;
    const pip = this.pips[Math.min(this.view.completed, this.pips.length) - 1];
    if (pip) checkpointBurst(this, this.pipRow.x + pip.x, this.pipRow.y + pip.y);
    nextClueUnlock(this, this.clueCard, this.clueCard.y);
  }

  private rebuildPips(): void {
    const total = Math.max(this.view.total, this.cfg.totalCheckpoints ?? 0);
    if (this.pips.length !== total) {
      for (const pip of this.pips) pip.destroy();
      this.pips = [];
      for (let i = 0; i < total; i += 1) {
        const pip = this.add.rectangle(i * 26, 0, 20, 6, COLORS.pipTodo).setOrigin(0, 0.5);
        this.pipRow.add(pip);
        this.pips.push(pip);
      }
    }
    this.pips.forEach((pip, index) => {
      pip.setFillStyle(index < this.view.completed ? COLORS.pipDone : COLORS.pipTodo, 1);
    });
    this.progressLabel.setText(`${this.view.completed}/${total || '–'} checkpoints`);
  }

  // -------------------------------------------------------------------------
  // Verification indicator
  // -------------------------------------------------------------------------

  private refreshVerification(): void {
    const { color, label } = VERIFY_STYLES[this.view.verification];
    this.verifySlot.stop();
    this.verifyDot.setFillStyle(color, 1).setScale(1).setAlpha(1);
    this.verifyLabel.setText(label).setColor(toCss(color));
    if (this.view.verification === 'verifying') {
      pulseVerifying(this, this.verifySlot, this.verifyDot);
    }
  }

  // -------------------------------------------------------------------------
  // Opponents
  // -------------------------------------------------------------------------

  private onOpponentProgress(
    playerId: string,
    name: string,
    checkpointIndex: number,
    previous: HudSnapshot,
  ): void {
    this.refreshOpponents();
    const before = previous.opponents.find((o) => o.playerId === playerId);
    // Only announce forward movement; repeated broadcasts of the same index are noise.
    if (before && before.checkpointIndex >= checkpointIndex) return;
    this.toast(`${name} reached checkpoint ${checkpointIndex + 1}`, COLORS.accent);
  }

  private refreshOpponents(): void {
    this.opponentRows.removeAll(true);
    this.view.opponents.slice(0, MAX_OPPONENT_ROWS).forEach((opponent, index) => {
      this.opponentRows.add(this.buildOpponentRow(opponent, index));
    });
  }

  private buildOpponentRow(
    opponent: OpponentProgress,
    index: number,
  ): Phaser.GameObjects.Container {
    const y = index * 22;
    const name = this.add
      .text(0, y, opponent.name, { fontFamily: FONT.family, fontSize: FONT.label, color: COLORS.ink })
      .setOrigin(0, 0.5);
    const progress = this.add
      .text(150, y, `CP ${opponent.checkpointIndex + 1}`, {
        fontFamily: FONT.family,
        fontSize: FONT.label,
        color: COLORS.accentText,
      })
      .setOrigin(1, 0.5);
    return this.add.container(0, 0, [name, progress]);
  }

  // -------------------------------------------------------------------------
  // Toasts
  // -------------------------------------------------------------------------

  private toast(message: string, color: number): void {
    while (this.toastLayer.length >= MAX_TOASTS) {
      this.toastLayer.removeAt(0, true);
    }
    const y = this.scale.height * 0.3 + this.toastLayer.length * 34;
    const label = this.add
      .text(0, 0, message, {
        fontFamily: FONT.family,
        fontSize: FONT.body,
        color: toCss(color),
        align: 'center',
        wordWrap: { width: Math.min(340, this.scale.width - PAD * 4) },
      })
      .setOrigin(0.5);
    const plate = this.add
      .rectangle(0, 0, label.width + PAD * 2, label.height + PAD, COLORS.plate, PLATE_ALPHA)
      .setStrokeStyle(1, color, 0.8);
    const toast = this.add.container(this.scale.width / 2, y, [plate, label]);
    this.toastLayer.add(toast);
    playToast(this, toast);
  }

  // -------------------------------------------------------------------------
  // Construction + layout
  // -------------------------------------------------------------------------

  private buildXpCounter(): void {
    this.xpText = this.add
      .text(0, 0, formatXp(0), {
        fontFamily: FONT.mono,
        fontSize: FONT.xp,
        color: COLORS.xpText,
        fontStyle: 'bold',
      })
      .setOrigin(0, 0);
  }

  private buildTimer(): void {
    this.timerPlate = this.add
      .rectangle(0, 0, 96, 38, COLORS.plate, PLATE_ALPHA)
      .setStrokeStyle(1, COLORS.plateEdge, 1)
      .setOrigin(1, 0);
    this.timerText = this.add
      .text(0, 0, formatCountdown(0), {
        // Space Mono here specifically: a countdown that changes every second
        // must not reflow, and tabular digits are the only reason mono is
        // allowed anywhere in this design.
        fontFamily: FONT.mono,
        fontSize: FONT.timer,
        color: COLORS.ink,
      })
      .setOrigin(1, 0);
  }

  private buildProgress(): void {
    this.pipRow = this.add.container(0, 0);
    this.progressLabel = this.add
      .text(0, 0, '0/– checkpoints', {
        fontFamily: FONT.family,
        fontSize: FONT.label,
        color: COLORS.inkDim,
      })
      .setOrigin(0, 0);
    this.rebuildPips();
  }

  private buildVerification(): void {
    this.verifyDot = this.add.circle(0, 0, 7, COLORS.pipTodo, 1);
    this.verifyLabel = this.add
      .text(0, 0, VERIFY_STYLES.idle.label, {
        fontFamily: FONT.family,
        fontSize: FONT.label,
        color: COLORS.inkDim,
      })
      .setOrigin(0, 0.5);
  }

  private buildOpponents(): void {
    this.opponentRows = this.add.container(0, 0);
  }

  /**
   * A thin plate the "next clue unlocked" and "hunt finished" flourishes play
   * on. The clue TEXT itself lives in React — the HUD animates, the DOM reads.
   */
  private buildClueCard(): void {
    const plate = this.add
      .rectangle(0, 0, 220, 4, COLORS.accent, 0.9)
      .setOrigin(0.5, 0.5);
    this.clueCard = this.add.container(0, 0, [plate]).setAlpha(0.35);
  }

  private buildHintButton(): void {
    this.hintPlate = this.add
      .rectangle(0, 0, 132, 44, COLORS.plate, PLATE_ALPHA)
      .setStrokeStyle(1, COLORS.warning, 0.9)
      .setOrigin(0, 1);
    const label = this.add
      .text(66, -26, 'Hint', {
        fontFamily: FONT.family,
        fontSize: FONT.body,
        color: COLORS.warningText,
        fontStyle: 'bold',
      })
      .setOrigin(0.5);
    const cost = this.add
      .text(66, -11, this.cfg.hintCostLabel ?? '', {
        fontFamily: FONT.family,
        fontSize: FONT.label,
        color: COLORS.inkDim,
      })
      .setOrigin(0.5);
    this.hintButton = this.add.container(0, 0, [this.hintPlate, label, cost]).setDepth(800);

    this.hintPlate
      .setInteractive({ useHandCursor: true })
      // The scene asks; it never decides what a hint costs.
      .on(Phaser.Input.Events.GAMEOBJECT_POINTER_UP, () => this.cfg.onHintRequested?.());
  }

  private layout(): void {
    const w = this.scale.width;
    const h = this.scale.height;

    this.xpText.setPosition(PAD, PAD);
    this.timerPlate.setPosition(w - PAD, PAD);
    this.timerText.setPosition(w - PAD - 12, PAD + 6);

    this.pipRow.setPosition(PAD, PAD + 46);
    this.progressLabel.setPosition(PAD, PAD + 56);

    this.verifyDot.setPosition(PAD + 8, h - PAD - 76);
    this.verifyLabel.setPosition(PAD + 24, h - PAD - 76);

    this.opponentRows.setPosition(w - PAD - 160, PAD + 64);
    this.clueCard.setPosition(w / 2, h * 0.5);

    if (this.hintButton && this.hintPlate) {
      this.hintButton.setPosition(PAD, h - PAD);
      this.cfg.hitRegions.set(HUD_SCENE_KEY, [
        { x: PAD, y: h - PAD - 44, width: 132, height: 44 },
      ]);
    }
  }
}

const VERIFY_STYLES: Record<HudSnapshot['verification'], { color: number; label: string }> = {
  idle: { color: COLORS.pipTodo, label: 'Ready' },
  verifying: { color: COLORS.accent, label: 'Verifying…' },
  approved: { color: COLORS.success, label: 'Approved' },
  rejected: { color: COLORS.danger, label: 'Rejected' },
};

function toCss(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`;
}

function formatSigned(value: number): string {
  return value >= 0 ? `+${value}` : `${value}`;
}
