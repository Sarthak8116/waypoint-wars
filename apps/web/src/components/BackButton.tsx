'use client';

/**
 * A way out of every screen.
 *
 * Several screens here are full-bleed maps with no browser chrome to fall back
 * on, and one of them (the race) holds a live WebSocket. Leaving needs to be
 * possible and, where it forfeits something, deliberate.
 */

import { useRouter } from 'next/navigation';
import { useState } from 'react';

export interface BackButtonProps {
  /** Where to go. Defaults to the home screen. */
  href?: string;
  label?: string;
  /**
   * Ask before leaving. Use on screens where going back loses progress — a
   * hunt in flight, a race with other people waiting.
   */
  confirm?: string;
  /** Float over a map rather than sit in the page flow. */
  floating?: boolean;
  /**
   * Run just before navigating away, once the player has confirmed.
   *
   * Used to forget a room's reconnection token: walking out deliberately must
   * not leave a token that pulls the player straight back in on their next
   * visit.
   */
  onLeave?: () => void;
}

export default function BackButton({
  href = '/',
  label = 'Back',
  confirm,
  floating = false,
  onLeave,
}: BackButtonProps) {
  const router = useRouter();
  const [asking, setAsking] = useState(false);

  const leave = () => {
    onLeave?.();
    router.push(href);
  };

  const onClick = () => {
    if (confirm && !asking) {
      setAsking(true);
      // Re-arm rather than trapping the player in a confirm state forever.
      setTimeout(() => setAsking(false), 4000);
      return;
    }
    leave();
  };

  const button = (
    <button
      className={`btn ${asking ? 'btn-pink' : 'btn-ghost'}`}
      onClick={onClick}
      style={{
        minHeight: 44,
        padding: '0 14px',
        fontSize: 14,
        // Floating sits over a map and must not swallow map drags around it.
        ...(floating ? { background: 'var(--panel)', borderColor: 'var(--border)' } : {}),
      }}
      aria-label={asking ? confirm : label}
    >
      {asking ? confirm : `← ${label}`}
    </button>
  );

  if (!floating) return button;

  return (
    <div
      style={{
        position: 'absolute',
        top: 'max(12px, env(safe-area-inset-top))',
        left: 12,
        zIndex: 45,
      }}
    >
      {button}
    </div>
  );
}
