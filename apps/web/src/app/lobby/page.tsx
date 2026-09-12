'use client';

/**
 * Multiplayer lobby — create a room or join by six-character code / QR.
 *
 * The QR encodes a plain URL, because joining must work for someone who has
 * never seen the app: scan, browser opens, they're in. No install step.
 */

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import type { GameMode } from '@ww/shared';
import { useRoom } from '@/lib/RoomProvider';
import { loadHuntBundle, type HuntBundle } from '@/lib/huntData';

const HUNT_ID = 'hunt_three_rivers_run';

export default function LobbyPage() {
  return (
    <Suspense fallback={<main className="wrap stack"><p className="muted">Loading…</p></main>}>
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
  const [qr, setQr] = useState<string | null>(null);
  const [bundle, setBundle] = useState<HuntBundle | null>(null);

  useEffect(() => {
    void loadHuntBundle().then(setBundle);
  }, []);

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
    void room.createRoom(name.trim() || 'Host', mode, HUNT_ID);
  }, [room, name, mode]);

  const handleJoin = useCallback(() => {
    void room.joinRoom(code.trim(), name.trim() || 'Player');
  }, [room, code, name]);


  // --- In a room, waiting for the host ------------------------------------
  if (view.code) {
    return (
      <main className="wrap stack">
        <p className="label" style={{ color: 'var(--cyan)', marginBottom: 10 }}>
          {view.isHost ? 'Share this code' : 'Waiting for the host'}
        </p>
        <h1 className="display mono" style={{ fontSize: 56, letterSpacing: '0.06em' }}>
          {view.code}
        </h1>
        <p className="muted" style={{ marginTop: 12 }}>
          {view.isHost
            ? 'Anyone can scan the code below — no app, no install.'
            : 'You are in. The host starts when everyone has joined.'}
        </p>

        {qr && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={qr}
            alt={`QR code to join room ${view.code}`}
            style={{
              width: 260,
              maxWidth: '100%',
              borderRadius: 'var(--r-card)',
              display: 'block',
              margin: '18px 0',
              border: '3px solid var(--border)',
            }}
          />
        )}

        {bundle?.hunt.startLocation && (
          <div className="card" style={{ marginBottom: 16, borderColor: 'var(--yellow)' }}>
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
          </div>
        )}

        <div className="card" style={{ marginBottom: 16 }}>
          <p className="muted" style={{ margin: '0 0 8px', fontSize: 12, letterSpacing: '0.08em' }}>
            PLAYERS
          </p>
          <p style={{ margin: 0 }}>
            You{view.isHost ? ' (host)' : ''}
            {view.opponents.map((o) => (
              <span key={o.playerId}> · {o.name}</span>
            ))}
          </p>
        </div>

        {view.isHost && (
          <button className="btn btn-lime btn-block" onClick={room.startHunt}>
            Start hunt
          </button>
        )}

        {view.lastMessage && <p className="muted" style={{ fontSize: 13 }}>{view.lastMessage}</p>}
      </main>
    );
  }

  // --- Create or join ------------------------------------------------------
  return (
    <main className="wrap stack">
      <p className="label" style={{ color: 'var(--pink)', marginBottom: 10 }}>Play together</p>
      <h1 className="display" style={{ fontSize: 46 }}>Multiplayer</h1>
      <p className="muted" style={{ marginTop: 0 }}>
        Everyone walks a different route. Everyone finishes in the same place.
      </p>

      <input
        className="field"
        style={{ marginBottom: 12 }}
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Your name"
        maxLength={20}
      />

      <section className="card" style={{ marginBottom: 16 }}>
        <p className="muted" style={{ margin: '0 0 10px', fontSize: 12, letterSpacing: '0.08em' }}>
          CREATE A ROOM
        </p>
        <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
          {(['individual-race', 'team-race'] as GameMode[]).map((m) => (
            <button
              key={m}
              className={`btn${mode === m ? ' btn-yellow' : ' btn-ghost'}`}
              style={{ flex: 1, fontSize: 14 }}
              onClick={() => setMode(m)}
            >
              {m === 'individual-race' ? 'Individual' : 'Teams'}
            </button>
          ))}
        </div>
        <button
          className="btn btn-pink btn-block"
          onClick={handleCreate}
          disabled={view.phase === 'connecting'}
        >
          {view.phase === 'connecting' ? 'Connecting…' : 'Create room'}
        </button>
      </section>

      <section className="card">
        <p className="muted" style={{ margin: '0 0 10px', fontSize: 12, letterSpacing: '0.08em' }}>
          JOIN WITH A CODE
        </p>
        <input
          className="field mono"
          style={{
            marginBottom: 12,
            textTransform: 'uppercase',
            letterSpacing: '0.3em',
            fontSize: 22,
            textAlign: 'center',
          }}
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          placeholder="ABC234"
          maxLength={6}
        />
        <button
          className="btn btn-cyan btn-block"
          onClick={handleJoin}
          disabled={code.length !== 6 || view.phase === 'connecting'}
        >
          Join room
        </button>
      </section>

      {view.error && (
        <p style={{ color: 'var(--bad)', fontSize: 14 }}>
          {view.error}. Is the server running? (<code>pnpm dev</code>)
        </p>
      )}
    </main>
  );
}
