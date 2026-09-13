'use client';

/**
 * Multiplayer lobby — create a room or join by six-character code / QR.
 *
 * The QR encodes a plain URL, because joining must work for someone who has
 * never seen the app: scan, browser opens, they're in. No install step.
 *
 * Host and player see genuinely different screens. A player never sees room
 * configuration or a disabled Start button — controls they cannot use are
 * absent, not greyed out, because a greyed-out control reads as "broken".
 */

import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import type { GameMode } from '@ww/shared';
import { useRoom } from '@/lib/RoomProvider';
import { loadHuntBundle, type HuntBundle } from '@/lib/huntData';
import BackButton from '@/components/BackButton';

const HUNT_ID = 'hunt_three_rivers_run';

export default function LobbyPage() {
  return (
    <Suspense
      fallback={
        <main className="wrap stack">
          <div>
            <BackButton label="Home" />
          </div>
          <div className="card">
            <p className="caret" style={{ margin: 0, fontWeight: 800 }}>
              Opening the lobby
            </p>
          </div>
        </main>
      }
    >
      <Lobby />
    </Suspense>
  );
}

function Lobby() {
  const params = useSearchParams();
  const router = useRouter();
  const room = useRoom();
  const { view } = room;

  const [name, setName] = useState('');
  const [code, setCode] = useState(params.get('code')?.toUpperCase() ?? '');
  const [mode, setMode] = useState<GameMode>('individual-race');
  const [team, setTeam] = useState('');
  const [qr, setQr] = useState<string | null>(null);
  const [bundle, setBundle] = useState<HuntBundle | null>(null);
  const [copied, setCopied] = useState(false);

  /**
   * One-shot guards.
   *
   * `view.phase` is driven by the server and does not flip to 'connecting'
   * within the same tick as the click, so disabling on phase alone still
   * allows a double-tap to open two rooms. Local busy state closes that gap;
   * the server reply (or an error) clears it.
   */
  const [busy, setBusy] = useState<null | 'create' | 'join' | 'start'>(null);
  const busyRef = useRef(busy);
  busyRef.current = busy;

  useEffect(() => {
    void loadHuntBundle().then(setBundle);
  }, []);

  // Clear the guard once the server has answered either way.
  useEffect(() => {
    if (view.code || view.error) setBusy(null);
  }, [view.code, view.error]);

  // Render the join QR once a room exists.
  useEffect(() => {
    if (!view.code) {
      setQr(null);
      return;
    }
    const url = `${window.location.origin}/lobby?code=${view.code}`;
    void import('qrcode').then(async (QR) => {
      setQr(
        await QR.toDataURL(url, {
          width: 280,
          margin: 1,
          color: { dark: '#0b1020', light: '#eef2ff' },
        }),
      );
    });
  }, [view.code]);

  // Once the host starts, everyone moves to the race screen.
  useEffect(() => {
    // router.push, NOT window.location — a hard reload would drop the socket.
    if (view.phase === 'running') router.push('/race');
  }, [view.phase, router]);

  const handleCreate = useCallback(() => {
    if (busyRef.current) return;
    setBusy('create');
    void room.createRoom(
      name.trim() || 'Host',
      mode,
      HUNT_ID,
      mode === 'team-race' ? team.trim() || undefined : undefined,
    );
  }, [room, name, mode, team]);

  const handleJoin = useCallback(() => {
    if (busyRef.current) return;
    setBusy('join');
    void room.joinRoom(code.trim(), name.trim() || 'Player', team.trim() || undefined);
  }, [room, code, name, team]);

  const handleStart = useCallback(() => {
    if (busyRef.current) return;
    setBusy('start');
    room.startHunt();
  }, [room]);

  const share = useCallback(async () => {
    if (!view.code) return;
    const url = `${window.location.origin}/lobby?code=${view.code}`;
    // Native share where it exists (phones), clipboard everywhere else.
    if (typeof navigator !== 'undefined' && navigator.share) {
      try {
        await navigator.share({ title: 'Waypoint Wars', text: `Join my hunt: ${view.code}`, url });
        return;
      } catch {
        // Cancelled or unsupported — fall through to clipboard.
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }, [view.code]);

  // --- In a room -----------------------------------------------------------
  if (view.code) {
    return (
      <main className="wrap stack">
        <div>
          <BackButton label="Leave room" confirm="Leave this room?" onLeave={room.leaveRoom} />
        </div>

        <div>
          <p className="label" style={{ color: 'var(--cyan)', marginBottom: 10 }}>
            {view.isHost ? 'Share this code' : 'You are in'}
          </p>
          <h1 className="display mono" style={{ fontSize: 64, letterSpacing: '0.08em' }}>
            {view.code}
          </h1>
        </div>

        <button className="btn btn-cyan btn-block" onClick={() => void share()}>
          {copied ? '✓ Link copied' : 'Copy join link'}
        </button>

        {qr && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={qr}
            alt={`QR code to join room ${view.code}`}
            style={{
              width: 220,
              maxWidth: '100%',
              borderRadius: 'var(--r-card)',
              display: 'block',
              margin: '4px auto',
              border: '3px solid var(--border)',
            }}
          />
        )}

        <section className="card">
          <p className="label dim" style={{ marginBottom: 12 }}>
            {1 + view.opponents.length} in the room
          </p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <span className="pill pill-lime">
              You{view.isHost ? ' · host' : ''}
              {team.trim() ? ` · ${team.trim()}` : ''}
            </span>
            {view.opponents.map((o) => (
              <span key={o.playerId} className="pill">
                {o.name}
              </span>
            ))}
          </div>
          {view.opponents.length === 0 && (
            <p className="dim" style={{ fontSize: 14, margin: '12px 0 0' }}>
              Nobody else yet. Send them the code above.
            </p>
          )}
        </section>

        {bundle?.hunt.startLocation && (
          <section className="card" style={{ borderColor: 'var(--yellow)' }}>
            <p className="label" style={{ color: 'var(--yellow)', marginBottom: 8 }}>
              ★ Everyone starts here
            </p>
            <h3 style={{ marginBottom: 6 }}>{bundle.hunt.startLocation.name}</h3>
            {bundle.hunt.startLocation.instructions && (
              <p className="muted" style={{ fontSize: 15, margin: 0 }}>
                {bundle.hunt.startLocation.instructions}
              </p>
            )}
            <p className="dim" style={{ fontSize: 14, margin: '10px 0 0' }}>
              You&apos;ll each get a different first clue from this spot, and you all
              finish in the same place.
            </p>
          </section>
        )}

        {/* Host-only, and genuinely absent for players rather than disabled. */}
        {view.isHost ? (
          <button
            className="btn btn-lime btn-block"
            onClick={handleStart}
            disabled={busy === 'start'}
            style={{ minHeight: 68, fontSize: 20 }}
          >
            {busy === 'start' ? 'Starting…' : 'Start hunt'}
          </button>
        ) : (
          <div className="card" style={{ textAlign: 'center' }}>
            <p className="caret" style={{ margin: 0, fontWeight: 800 }}>
              Waiting for the host to start
            </p>
          </div>
        )}

        {view.lastMessage && (
          <p className="dim" style={{ fontSize: 13, margin: 0 }}>
            {view.lastMessage}
          </p>
        )}
      </main>
    );
  }

  // --- Create or join ------------------------------------------------------
  return (
    <main className="wrap stack">
      <div>
        <BackButton label="Home" />
      </div>

      <div>
        <p className="label" style={{ color: 'var(--pink)', marginBottom: 10 }}>
          Play together
        </p>
        <h1 className="display" style={{ fontSize: 46 }}>
          Multiplayer
        </h1>
        <p className="muted" style={{ marginTop: 10, marginBottom: 0 }}>
          Everyone walks a different route. Everyone finishes in the same place.
        </p>
      </div>

      <input
        className="field"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Your name"
        maxLength={20}
        aria-label="Your name"
      />

      {/* Joining first: most people arrive here with a code in hand. */}
      <section className="card stack" style={{ gap: 12 }}>
        <p className="label dim" style={{ margin: 0 }}>
          Join with a code
        </p>
        <input
          className="field mono"
          style={{
            textTransform: 'uppercase',
            letterSpacing: '0.3em',
            fontSize: 22,
            textAlign: 'center',
          }}
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
          onKeyDown={(e) => e.key === 'Enter' && code.length === 6 && handleJoin()}
          placeholder="ABC234"
          maxLength={6}
          aria-label="Room code"
        />
        {/* Optional, and harmless outside a team room: the server ignores
            teamName unless the host chose Teams. Shown unconditionally
            because the joiner cannot know the room's mode before joining. */}
        <input
          className="field"
          value={team}
          onChange={(e) => setTeam(e.target.value)}
          placeholder="Team name (optional)"
          maxLength={20}
          aria-label="Team name"
        />
        <p className="dim" style={{ fontSize: 13, margin: '-4px 0 0' }}>
          In a team room, everyone typing the same name shares one route and one
          score. Leave it blank to play on your own.
        </p>
        <button
          className="btn btn-cyan btn-block"
          onClick={handleJoin}
          disabled={code.length !== 6 || busy !== null}
        >
          {busy === 'join' ? 'Joining…' : 'Join room'}
        </button>
      </section>

      <section className="card stack" style={{ gap: 12 }}>
        <p className="label dim" style={{ margin: 0 }}>
          Or host one
        </p>
        <div style={{ display: 'flex', gap: 8 }}>
          {(['individual-race', 'team-race'] as GameMode[]).map((m) => (
            <button
              key={m}
              className={`btn${mode === m ? ' btn-yellow' : ' btn-ghost'}`}
              style={{ flex: 1, fontSize: 14 }}
              onClick={() => setMode(m)}
              aria-pressed={mode === m}
            >
              {m === 'individual-race' ? 'Individual' : 'Teams'}
            </button>
          ))}
        </div>
        {mode === 'team-race' && (
          <>
            <input
              className="field"
              value={team}
              onChange={(e) => setTeam(e.target.value)}
              placeholder="Your team name"
              maxLength={20}
              aria-label="Your team name"
            />
            <p className="dim" style={{ fontSize: 13, margin: '-4px 0 0' }}>
              Teammates join with this exact name. Everyone else who joins with a
              different name forms their own team.
            </p>
          </>
        )}
        <button
          className="btn btn-pink btn-block"
          onClick={handleCreate}
          disabled={busy !== null}
        >
          {busy === 'create' ? 'Creating…' : 'Create room'}
        </button>
      </section>

      {view.error && (
        <div className="card" style={{ borderColor: 'var(--pink)' }}>
          <p style={{ color: 'var(--pink)', margin: '0 0 12px', fontSize: 15 }}>{view.error}</p>
          <a className="btn btn-lime btn-block" href="/play?demo=1">
            Play the Pittsburgh demo instead
          </a>
        </div>
      )}
    </main>
  );
}
