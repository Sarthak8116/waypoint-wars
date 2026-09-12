'use client';

/**
 * Holds the Colyseus connection above the router.
 *
 * Why this exists: the lobby and the race are separate routes, but they share
 * one live WebSocket. If the connection lived inside a page component it would
 * be torn down the moment the player navigated from /lobby to /race — they'd
 * silently drop out of the room they just joined, mid-demo.
 *
 * Mounting the hook in the root layout means client-side navigation keeps the
 * socket alive. A hard reload (typing a URL, refreshing) still drops it, which
 * is why /race shows a "not in a room" state rather than pretending.
 */

import { createContext, useContext, type ReactNode } from 'react';
import { useHuntRoom } from './useHuntRoom';

type RoomApi = ReturnType<typeof useHuntRoom>;

const RoomContext = createContext<RoomApi | null>(null);

export function RoomProvider({ children }: { children: ReactNode }) {
  const room = useHuntRoom();
  return <RoomContext.Provider value={room}>{children}</RoomContext.Provider>;
}

export function useRoom(): RoomApi {
  const ctx = useContext(RoomContext);
  if (!ctx) throw new Error('useRoom must be used inside <RoomProvider>');
  return ctx;
}
