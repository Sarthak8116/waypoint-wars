/**
 * Reusable HUD tweens.
 *
 * ============================================================================
 * HARD CONSTRAINT: EVERY ANIMATION FINISHES IN UNDER ONE SECOND.
 * ============================================================================
 * Players are walking down a street while this plays. A two-second celebration
 * is not delight, it is an obstacle: it keeps a head down and a thumb waiting at
 * a kerb. Every duration below is a named constant, every constant is under
 * 1000ms, and `animations.test.ts` fails the build if that ever stops being
 * true. The one repeating tween (the "verifying" pulse) is a status indicator
 * rather than a celebration — each cycle is still under a second and it never
 * gates input.
 *
 * Animations are also interruptible. Two XP awards landing 200ms apart must not
 * queue a visible backlog: `TweenSlot` holds at most one tween per channel and
 * a new award retargets from wherever the number currently sits.
 *
 * Phaser is imported here for TYPES ONLY (`import type`), so this module is
 * erased to zero runtime imports and stays safe to load in Node and during SSR.
 */

import type Phaser from 'phaser';
import { COLORS, FONT } from './theme.js';

/**
 * Every animation duration in the HUD, in milliseconds.
 * INVARIANT (enforced by test): every value here is < 1000.
 */
export const ANIMATION_DURATIONS = {
  /** XP chip flying from the event's origin into the counter. */
  XP_FLY: 420,
  /** The counter itself rolling from the old figure to the new one. */
  XP_COUNT_UP: 480,
  /** Checkpoint-complete radial burst. */
  CHECKPOINT_BURST: 560,
  /** Progress pip filling in. */
  PIP_FILL: 260,
  /** "Next clue unlocked" card sliding in. */
  NEXT_CLUE_UNLOCK: 520,
  /** Toast entering. */
  TOAST_IN: 260,
  /** How long a toast sits before leaving. */
  TOAST_HOLD: 900,
  /** Toast leaving. */
  TOAST_OUT: 220,
  /** One cycle of the repeating "verifying" pulse. */
  VERIFY_PULSE: 620,
  /** Approval tick popping in. */
  VERIFY_APPROVED: 380,
  /** Rejection shake. */
  VERIFY_REJECTED: 300,
  /** Timer flashing as it crosses into the warning band. */
  TIMER_WARN_FLASH: 500,
  /** The whole hunt-finished flourish, start to rest. */
  HUNT_FINISHED: 700,
  /** One leaderboard row arriving. */
  LEADERBOARD_ROW: 220,
  /** The whole staggered leaderboard reveal, however many rows there are. */
  LEADERBOARD_REVEAL: 880,
} as const;

export type AnimationName = keyof typeof ANIMATION_DURATIONS;

/** The ceiling. Nothing in this package may meet or exceed it. */
export const MAX_ANIMATION_MS = 1000;

type Scene = Phaser.Scene;
type Tween = Phaser.Tweens.Tween;
type GameObject = Phaser.GameObjects.GameObject;

/**
 * Holds at most one tween. Starting a new one stops the old one *where it is*,
 * so rapid-fire events retarget rather than queue. This is what keeps two XP
 * awards 200ms apart from producing a backlog.
 */
export class TweenSlot {
  private active: Tween | null = null;

  run(factory: () => Tween): Tween {
    this.stop();
    const tween = factory();
    this.active = tween;
    return tween;
  }

  stop(): void {
    if (this.active && this.active.isPlaying()) this.active.stop();
    this.active = null;
  }

  get isRunning(): boolean {
    return this.active !== null && this.active.isPlaying();
  }
}

// ---------------------------------------------------------------------------
// XP
// ---------------------------------------------------------------------------

export interface XpCountUpOptions {
  from: number;
  to: number;
  onUpdate: (value: number) => void;
  onComplete?: () => void;
}

/**
 * Roll a number from `from` to `to`. Always retargets from the value currently
 * displayed, so an interrupted count never jumps backwards.
 */
export function tweenXpCounter(scene: Scene, slot: TweenSlot, opts: XpCountUpOptions): Tween {
  const counter = { value: opts.from };
  return slot.run(() =>
    scene.tweens.add({
      targets: counter,
      value: opts.to,
      duration: ANIMATION_DURATIONS.XP_COUNT_UP,
      ease: 'Cubic.easeOut',
      onUpdate: () => opts.onUpdate(counter.value),
      onComplete: () => {
        // Land exactly on the authoritative figure, never on a rounding artefact.
        opts.onUpdate(opts.to);
        opts.onComplete?.();
      },
    }),
  );
}

export interface XpFlyOptions {
  amount: number;
  label?: string;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
}

/**
 * A "+120 XP" chip arcing into the counter. Self-destructing: each award spawns
 * its own object, so concurrent awards overlap harmlessly instead of fighting
 * over one shared node.
 */
export function flyXpToCounter(scene: Scene, opts: XpFlyOptions): Tween {
  const sign = opts.amount >= 0 ? '+' : '';
  const text = scene.add
    .text(opts.fromX, opts.fromY, `${sign}${opts.amount}${opts.label ? ` ${opts.label}` : ''}`, {
      fontFamily: FONT.family,
      fontSize: FONT.stat,
      color: opts.amount >= 0 ? COLORS.xpText : COLORS.dangerText,
      fontStyle: 'bold',
    })
    .setOrigin(0.5)
    .setDepth(1000);

  return scene.tweens.add({
    targets: text,
    x: opts.toX,
    y: opts.toY,
    scale: { from: 1.25, to: 0.6 },
    alpha: { from: 1, to: 0 },
    duration: ANIMATION_DURATIONS.XP_FLY,
    ease: 'Quad.easeIn',
    onComplete: () => text.destroy(),
  });
}

// ---------------------------------------------------------------------------
// Checkpoints
// ---------------------------------------------------------------------------

/** Radial burst marking a completed checkpoint. Decorative, non-blocking. */
export function checkpointBurst(scene: Scene, x: number, y: number, color = COLORS.success): Tween {
  const ring = scene.add.circle(x, y, 8, color, 0).setStrokeStyle(3, color, 1).setDepth(999);
  return scene.tweens.add({
    targets: ring,
    radius: 54,
    alpha: { from: 0.95, to: 0 },
    duration: ANIMATION_DURATIONS.CHECKPOINT_BURST,
    ease: 'Cubic.easeOut',
    onComplete: () => ring.destroy(),
  });
}

/** A progress pip filling in as a checkpoint completes. */
export function fillPip(scene: Scene, pip: GameObject): Tween {
  return scene.tweens.add({
    targets: pip,
    scale: { from: 1.6, to: 1 },
    duration: ANIMATION_DURATIONS.PIP_FILL,
    ease: 'Back.easeOut',
  });
}

/** The next clue becoming available: a card dropping into place. */
export function nextClueUnlock(scene: Scene, card: GameObject, restY: number): Tween {
  return scene.tweens.add({
    targets: card,
    y: { from: restY - 26, to: restY },
    alpha: { from: 0, to: 1 },
    duration: ANIMATION_DURATIONS.NEXT_CLUE_UNLOCK,
    ease: 'Back.easeOut',
  });
}

// ---------------------------------------------------------------------------
// Toasts
// ---------------------------------------------------------------------------

/**
 * Slide a toast in, hold, slide out, destroy. Used for opponent-completed
 * notices, hint confirmations and rejections. In + hold + out each sit under
 * the ceiling, and the toast never blocks a tap underneath it.
 */
export function playToast(
  scene: Scene,
  toast: Phaser.GameObjects.Container,
  onDone?: () => void,
): Tween {
  toast.setAlpha(0);
  const restY = toast.y;
  return scene.tweens.add({
    targets: toast,
    y: { from: restY - 18, to: restY },
    alpha: { from: 0, to: 1 },
    duration: ANIMATION_DURATIONS.TOAST_IN,
    ease: 'Quad.easeOut',
    onComplete: () => {
      scene.time.delayedCall(ANIMATION_DURATIONS.TOAST_HOLD, () => {
        if (!toast.scene) return;
        scene.tweens.add({
          targets: toast,
          alpha: 0,
          y: restY - 14,
          duration: ANIMATION_DURATIONS.TOAST_OUT,
          ease: 'Quad.easeIn',
          onComplete: () => {
            toast.destroy();
            onDone?.();
          },
        });
      });
    },
  });
}

// ---------------------------------------------------------------------------
// Verification
// ---------------------------------------------------------------------------

/**
 * The "verifying" heartbeat. Repeats because the wait is open-ended, but each
 * cycle is under the ceiling and it never gates input. Stop it via the slot.
 */
export function pulseVerifying(scene: Scene, slot: TweenSlot, target: GameObject): Tween {
  return slot.run(() =>
    scene.tweens.add({
      targets: target,
      alpha: { from: 1, to: 0.35 },
      scale: { from: 1, to: 0.82 },
      duration: ANIMATION_DURATIONS.VERIFY_PULSE,
      ease: 'Sine.easeInOut',
      yoyo: true,
      repeat: -1,
    }),
  );
}

export function popApproved(scene: Scene, target: GameObject): Tween {
  return scene.tweens.add({
    targets: target,
    scale: { from: 0.6, to: 1 },
    alpha: { from: 0.4, to: 1 },
    duration: ANIMATION_DURATIONS.VERIFY_APPROVED,
    ease: 'Back.easeOut',
  });
}

export function shakeRejected(scene: Scene, target: GameObject & { x: number }): Tween {
  const restX = target.x;
  return scene.tweens.add({
    targets: target,
    x: { from: restX - 7, to: restX + 7 },
    duration: ANIMATION_DURATIONS.VERIFY_REJECTED / 4,
    ease: 'Sine.easeInOut',
    yoyo: true,
    repeat: 1,
    onComplete: () => {
      target.x = restX;
    },
  });
}

/** One flash as the clock crosses into the warning band. */
export function flashTimerWarning(scene: Scene, target: GameObject): Tween {
  return scene.tweens.add({
    targets: target,
    scale: { from: 1.18, to: 1 },
    duration: ANIMATION_DURATIONS.TIMER_WARN_FLASH,
    ease: 'Cubic.easeOut',
  });
}

// ---------------------------------------------------------------------------
// End of hunt
// ---------------------------------------------------------------------------

/** The hunt-finished flourish: the HUD settling before the results panel takes over. */
export function huntFinishedSequence(scene: Scene, panel: GameObject): Tween {
  return scene.tweens.add({
    targets: panel,
    alpha: { from: 0, to: 1 },
    scale: { from: 0.92, to: 1 },
    duration: ANIMATION_DURATIONS.HUNT_FINISHED,
    ease: 'Cubic.easeOut',
  });
}

/**
 * Stagger the leaderboard rows in. The per-row delay is derived rather than
 * fixed so that ten rows finish in the same budget as three: the whole reveal
 * always lands inside LEADERBOARD_REVEAL.
 */
export function leaderboardStagger(rowCount: number): number {
  if (rowCount <= 1) return 0;
  const budget = ANIMATION_DURATIONS.LEADERBOARD_REVEAL - ANIMATION_DURATIONS.LEADERBOARD_ROW;
  return Math.max(0, Math.floor(budget / (rowCount - 1)));
}

export function revealLeaderboard(
  scene: Scene,
  rows: Phaser.GameObjects.Container[],
): Tween[] {
  const stagger = leaderboardStagger(rows.length);
  return rows.map((row, index) => {
    const restX = row.x;
    return scene.tweens.add({
      targets: row,
      alpha: { from: 0, to: 1 },
      x: { from: restX - 18, to: restX },
      duration: ANIMATION_DURATIONS.LEADERBOARD_ROW,
      delay: index * stagger,
      ease: 'Quad.easeOut',
    });
  });
}
