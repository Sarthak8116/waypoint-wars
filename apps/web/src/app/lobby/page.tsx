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

const HUNT_ID = 'hunt_three_rivers_run';

export default function LobbyPage() {
  return (
    <Suspense fallback={<main className="wrap"><p className="muted">Loading…</p></main>}>
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

  const input: React.CSSProperties = {
    width: '100%',
    minHeight: 48,
    padding: '0 14px',
    borderRadius: 12,
    border: '1px solid var(--line)',
    background: 'var(--surface-2)',
    color: 'var(--text)',
    fontSize: 16,
    marginBottom: 10,
  };

  // --- In a room, waiting for the host ------------------------------------
  if (view.code) {
    return (
      <main className="wrap">
        <h1 style={{ fontSize: 26, marginBottom: 4 }}>Room {view.code}</h1>
        <p className="muted" style={{ marginTop: 0 }}>
          {view.isHost ? 'Share this code or QR, then start.' : 'Waiting for the host to start…'}
        </p>

        {qr && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={qr}
            alt={`QR code to join room ${view.code}`}
            style={{ width: 240, maxWidth: '100%', borderRadius: 14, display: 'block', margin: '16px 0' }}
          />
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
          <button className="btn primary" style={{ width: '100%' }} onClick={room.startHunt}>
            Start hunt
          </button>
        )}

        {view.lastMessage && <p className="muted" style={{ fontSize: 13 }}>{view.lastMessage}</p>}
      </main>
    );
  }

  // --- Create or join ------------------------------------------------------
  return (
    <main className="wrap">
      <h1 style={{ fontSize: 28, marginBottom: 4 }}>Multiplayer</h1>
      <p className="muted" style={{ marginTop: 0 }}>
        Everyone walks a different route. Everyone finishes in the same place.
      </p>

      <input
        style={input}
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
              className={`btn${mode === m ? ' primary' : ''}`}
              style={{ flex: 1, fontSize: 14 }}
              onClick={() => setMode(m)}
            >
              {m === 'individual-race' ? 'Individual' : 'Teams'}
            </button>
          ))}
        </div>
        <button
          className="btn primary"
          style={{ width: '100%' }}
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
          style={{ ...input, textTransform: 'uppercase', letterSpacing: '0.25em', fontWeight: 700 }}
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          placeholder="ABC234"
          maxLength={6}
        />
        <button
          className="btn"
          style={{ width: '100%' }}
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
