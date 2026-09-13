'use client';

/**
 * Always-on progress: where you are, what you've scored, who's ahead.
 *
 * The Phaser HUD renders a version of this too, but Phaser is a canvas overlay
 * that can fail to mount (it has, in production — see DECISIONS.md), and on a
 * narrow phone its top-left cluster competes with the Back button. Progress is
 * the thing that sells the multiplayer mechanic, so it is also rendered in
 * React, inside the bottom sheet, where it is always on screen and cannot
 * collide with anything.
 */

export interface OpponentProgress {
  playerId: string;
  name: string;
  checkpointIndex: number;
  totalCheckpoints: number;
  /**
   * Their score.
   *
   * The thing the leaderboard actually ranks on, and the last field
   * OpponentView carried that nothing rendered. Checkpoints completed is not
   * standing: a rival on the same checkpoint with more XP is ahead of you,
   * and a pill showing only "2/5" said you were level when you were not.
   */
  xp?: number;
  /**
   * How many hints they have taken.
   *
   * Race information, not trivia: a hint costs 45 XP, so a rival who has
   * taken two is 90 down on you at the same checkpoint. The old opponent
   * strip showed this as a 💡 and I dropped it when replacing that strip
   * with this component — a regression of my own making.
   */
  hintsUsed?: number;
  /**
   * False while they are inside their reconnection window.
   *
   * The server has always tracked this and the client has always carried it,
   * and nothing ever showed it — so a rival whose laptop closed sat frozen at
   * "0/5" and read as merely slow. Losing to someone who has left is a
   * different race from losing to someone who is stuck.
   */
  connected?: boolean;
}

export interface ProgressBarProps {
  /** Zero-based index of the checkpoint currently being worked on. */
  index: number;
  total: number;
  xp: number;
  opponents?: OpponentProgress[];
  /** Shown as a pill on the right — "Demo Mode", "Placeholder content". */
  notice?: string;
  noticeTone?: 'info' | 'warn';
}

export default function ProgressBar({
  index,
  total,
  xp,
  opponents = [],
  notice,
  noticeTone = 'info',
}: ProgressBarProps) {
  const safeTotal = Math.max(total, 1);

  return (
    <div
      style={{
        borderBottom: '2px solid var(--border)',
        paddingBottom: 12,
        marginBottom: 14,
      }}
    >
      <div>
        <div
          style={{
            display: 'flex',
            alignItems: 'baseline',
            justifyContent: 'space-between',
            gap: 10,
            marginBottom: 8,
          }}
        >
          <span className="label" style={{ color: 'var(--cyan)' }}>
            Checkpoint {Math.min(index + 1, safeTotal)} of {safeTotal}
          </span>
          <span style={{ fontWeight: 900, color: 'var(--lime)', fontSize: 17 }}>{xp} XP</span>
        </div>

        {/* Segment strip — one block per checkpoint, filled as they're cleared. */}
        <div style={{ display: 'flex', gap: 4 }}>
          {Array.from({ length: safeTotal }, (_, i) => (
            <span
              key={i}
              style={{
                flex: 1,
                height: 7,
                borderRadius: 4,
                background:
                  i < index ? 'var(--lime)' : i === index ? 'var(--yellow)' : 'var(--border)',
              }}
            />
          ))}
        </div>

        {opponents.length > 0 && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
            {opponents.map((o) => {
              const gone = o.connected === false;
              return (
                <span
                  key={o.playerId}
                  className="pill"
                  style={{
                    fontSize: 11,
                    padding: '3px 9px',
                    opacity: gone ? 0.5 : 1,
                  }}
                  title={gone ? `${o.name} has dropped out` : undefined}
                >
                  {o.name}{' '}
                  <span style={{ opacity: 0.72 }}>
                    {gone ? 'offline' : `${o.checkpointIndex}/${o.totalCheckpoints || safeTotal}`}
                  </span>
                  {/* The unit matters. Beside "2/5", a bare lime number reads
                      as a second progress figure rather than a score. */}
                  {!gone && o.xp !== undefined && (
                    <span style={{ marginLeft: 5, color: 'var(--lime)', fontWeight: 800 }}>
                      {o.xp} XP
                    </span>
                  )}
                  {!gone && (o.hintsUsed ?? 0) > 0 && (
                    <span
                      style={{ marginLeft: 4 }}
                      title={`${o.name} has taken ${o.hintsUsed} hint${
                        o.hintsUsed === 1 ? '' : 's'
                      }`}
                    >
                      💡{o.hintsUsed! > 1 ? o.hintsUsed : ''}
                    </span>
                  )}
                </span>
              );
            })}
          </div>
        )}
      </div>

      {notice && (
        <div style={{ marginTop: 10 }}>
          <span className={`pill ${noticeTone === 'warn' ? 'pill-yellow' : 'pill-cyan'}`}>
            {notice}
          </span>
        </div>
      )}
    </div>
  );
}
