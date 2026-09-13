'use client';


/**
 * Where a reconnection token is parked across a page reload.
 *
 * The server already holds a dropped player's seat, XP and route position for
 * a reconnection window, and re-sends their active checkpoint when they come
 * back. None of that could ever fire from the browser: nothing survived a
 * refresh, so `reconnect()` was never called and the seat expired unused.
 * Measured in production — refreshing mid-race showed "Not in a room" while
 * the server was still holding the place.
 *
 * sessionStorage, not localStorage, and deliberately: the token belongs to
 * THIS tab. A second tab opening the same room should join as itself rather
 * than silently stealing a seat, and the token must not outlive the browser
 * session.
 */
const RECONNECT_KEY = 'ww:reconnect';

interface StoredSession {
  token: string;
  isHost: boolean;
}

function rememberSession(value: StoredSession | null): void {
  try {
    if (value) window.sessionStorage.setItem(RECONNECT_KEY, JSON.stringify(value));
    else window.sessionStorage.removeItem(RECONNECT_KEY);
  } catch {
    // Private window or blocked storage. Reconnect simply will not be offered.
  }
}

function recallSession(): StoredSession | null {
  try {
    const raw = window.sessionStorage.getItem(RECONNECT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredSession>;
    return typeof parsed.token === 'string' ? { token: parsed.token, isHost: parsed.isHost === true } : null;
  } catch {
    return null;
  }
}

/**
 * Colyseus client binding.
 *
 * The server is authoritative for everything that scores: XP, progress, hints,
 * route assignment, the leaderboard. This hook NEVER computes those. It sends
 * intents (ClientMessage) and renders whatever comes back (ServerMessage).
 *
 * If you find yourself adding a calculation here, it belongs on the server.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Client, type Room } from 'colyseus.js';
import type { XpBreakdown,
  ApproximateRegion,
  GameMode,
  LeaderboardEntry,
  ServerMessage,
} from '@ww/shared';
import type { HistoricalSource, PublicCheckpoint } from '@ww/shared';

const WS_URL = process.env.NEXT_PUBLIC_MULTIPLAYER_URL ?? 'ws://localhost:2567';
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:2567';

export type RoomPhase = 'idle' | 'connecting' | 'lobby' | 'running' | 'finished' | 'error';

export interface OpponentView {
  playerId: string;
  name: string;
  checkpointIndex: number;
  totalCheckpoints: number;
  xp: number;
  region: ApproximateRegion | null;
  connected: boolean;
  hintsUsed: number;
}

export interface RoomView {
  phase: RoomPhase;
  code: string | null;
  /**
   * The SCORING entity id — a team id in team-race, a player id otherwise.
   *
   * Deliberately not the Colyseus sessionId. Leaderboard entries are keyed by
   * `run.entityId`, so matching them against a sessionId never matched, and
   * the multiplayer end screen's "You won / You finished" hero never appeared
   * for anybody.
   */
  selfId: string | null;
  /**
   * This player's server-side `player_xxxxxxxx` id.
   *
   * Server messages (`player_progress`, `player_region`) are keyed by this,
   * while replicated state was being read by sessionId. The two id spaces
   * never met: progress from your own client was mistaken for an opponent and
   * rendered as a raw id, and no region message ever matched an opponent — so
   * "you can see roughly where your rivals are" had never once worked.
   */
  selfPlayerId: string | null;
  isHost: boolean;
  checkpoint: PublicCheckpoint | null;
  checkpointIndex: number;
  totalCheckpoints: number;
  xp: number;
  instruction: string | null;
  hint: string | null;
  opponents: OpponentView[];
  leaderboard: LeaderboardEntry[];
  lastMessage: string | null;
  /**
   * The history earned by the last approved submission.
   *
   * The server has always sent this on `submission_result` — the code calls
   * it "the earned payload", attached only on approval so that failing on
   * purpose cannot harvest the history without walking the route. The
   * multiplayer client kept `verdict.message` and threw the rest away, so a
   * player who solved a checkpoint got a one-line toast while a solo player
   * got the landmark, its story and its sources. Multiplayer is the pitch,
   * and multiplayer never delivered the reward the game is built around.
   */
  lastReveal: {
    name: string;
    historicalReveal: string;
    sources: HistoricalSource[];
    hiddenDetail?: string;
  } | null;
  /** XP from that same submission, for the reward panel's headline. */
  lastAward: number | null;
  /** The eight components behind that number. Sent with every verdict. */
  lastBreakdown: XpBreakdown | null;
  /** True when the photo could not be judged — never dressed up as verified. */
  lastDegraded: boolean;
  /**
   * True when the verdict came from the labelled mock rather than a model.
   *
   * Distinct from degraded: the verifier answered, it just was not looking at
   * the photo. That is what runs with no GEMINI_API_KEY, and it was being
   * presented as "Verified".
   */
  lastMocked: boolean;
  error: string | null;
}

const initialView: RoomView = {
  phase: 'idle',
  code: null,
  selfId: null,
  selfPlayerId: null,
  isHost: false,
  checkpoint: null,
  checkpointIndex: 0,
  totalCheckpoints: 0,
  xp: 0,
  instruction: null,
  hint: null,
  opponents: [],
  leaderboard: [],
  lastMessage: null,
  lastReveal: null,
  lastAward: null,
  lastBreakdown: null,
  lastDegraded: false,
  lastMocked: false,
  error: null,
};

export function useHuntRoom() {
  const [view, setView] = useState<RoomView>(initialView);
  const roomRef = useRef<Room | null>(null);

  /** Every server message funnels through here. */
  const handle = useCallback((msg: ServerMessage) => {
    setView((v) => {
      switch (msg.type) {
        case 'hunt_started':
          return { ...v, phase: 'running', checkpoint: msg.firstCheckpoint, checkpointIndex: 0 };

        case 'checkpoint_unlocked':
          return {
            ...v,
            checkpoint: msg.checkpoint,
            checkpointIndex: msg.index,
            instruction: null,
            hint: null,
            lastMessage: null,
          };

        case 'submission_result':
          return {
            ...v,
            lastMessage: msg.verdict.message,
            // XP still comes from score_update; never trust a local sum.
            // xpDelta here is only the headline on the reward panel.
            ...(msg.verdict.outcome === 'approved' && msg.verdict.reveal
              ? {
                  lastReveal: msg.verdict.reveal,
                  lastAward: msg.verdict.xpDelta,
                  lastBreakdown: msg.verdict.xpBreakdown,
                  lastDegraded: msg.verdict.verification?.landmarkMatch === false,
                  lastMocked: msg.verdict.verification?.mocked === true,
                }
              : {}),
          };

        case 'hint_issued':
          return { ...v, hint: msg.hint };

        case 'instruction_issued':
          return { ...v, instruction: msg.instruction };

        case 'score_update':
          return msg.playerId === v.selfPlayerId
            ? { ...v, xp: msg.xp }
            : {
                ...v,
                opponents: v.opponents.map((o) =>
                  o.playerId === msg.playerId ? { ...o, xp: msg.xp } : o,
                ),
              };

        case 'player_progress': {
          if (msg.playerId === v.selfPlayerId) {
            return { ...v, checkpointIndex: msg.checkpointIndex, totalCheckpoints: msg.totalCheckpoints };
          }
          /**
           * Update only. This used to APPEND an opponent when the id was
           * unknown, and the id was always unknown — sessionId-keyed state
           * versus player-id-keyed messages — so every client added a phantom
           * rival named after its own raw id, itself included. Replicated
           * state is the complete roster; a message can refine it, never
           * invent a row.
           */
          return {
            ...v,
            opponents: v.opponents.map((o) =>
              o.playerId === msg.playerId
                ? { ...o, checkpointIndex: msg.checkpointIndex, totalCheckpoints: msg.totalCheckpoints }
                : o,
            ),
          };
        }

        case 'player_region':
          return {
            ...v,
            opponents: v.opponents.map((o) =>
              o.playerId === msg.playerId ? { ...o, region: msg.region } : o,
            ),
          };

        case 'leaderboard':
          return { ...v, leaderboard: msg.entries };

        case 'hunt_finished':
          return { ...v, phase: 'finished', leaderboard: msg.entries };

        case 'error':
          return { ...v, lastMessage: msg.message };

        default:
          return v;
      }
    });
  }, []);

  const attach = useCallback(
    (room: Room, isHost: boolean) => {
      roomRef.current = room;
      rememberSession({ token: room.reconnectionToken, isHost });

      setView((v) => ({
        ...v,
        phase: 'lobby',
        // Deliberately NOT read here. Colyseus delivers the first state patch
        // asynchronously, so `room.state.code` is empty at this instant —
        // reading it now pinned `code` to null forever and the lobby never
        // left the create/join screen. `onStateChange` below fills it in.
        code: null,
        selfId: null,
        selfPlayerId: null,
        isHost,
        error: null,
      }));

      /**
       * Mirror the replicated fields the lobby and race screens need.
       *
       * This is the ONLY place shared state is read. Everything private —
       * clues, hints, instructions, verdicts, reveals — arrives by targeted
       * message and is handled above, never from here.
       */
      room.onStateChange((state) => {
        /**
         * The replicated shape, as this client reads it.
         *
         * `id`, `teamId` and `region` were missing from this type, which is
         * precisely why the id mismatch survived: the client could not see the
         * fields the server keys its messages and its leaderboard by, so it
         * used the sessionId it could see, and nothing ever matched.
         */
        const s = state as unknown as {
          code?: string;
          players?: Map<
            string,
            {
              /** Server-side `player_xxxxxxxx`. What server messages carry. */
              id: string;
              sessionId: string;
              /** '' in individual-race. The scoring entity in team-race. */
              teamId: string;
              name: string;
              xp: number;
              checkpointIndex: number;
              totalCheckpoints: number;
              connected: boolean;
              hintsUsed: number;
              region?: {
                hasRegion: boolean;
                latitude: number;
                longitude: number;
                radiusMeters: number;
              };
            }
          >;
        };

        setView((v) => {
          const opponents: OpponentView[] = [];
          let xp = v.xp;
          let totalCheckpoints = v.totalCheckpoints;

          let selfId = v.selfId;
          let selfPlayerId = v.selfPlayerId;

          s.players?.forEach((p) => {
            // Identity still comes from the sessionId — it is the only thing
            // that identifies THIS connection. Everything downstream is keyed
            // by the server's own ids from here on.
            if (p.sessionId === room.sessionId) {
              xp = p.xp ?? xp;
              totalCheckpoints = p.totalCheckpoints || totalCheckpoints;
              selfPlayerId = p.id || selfPlayerId;
              // Teams score as one entity, so that is what the leaderboard
              // keys on and what "is this me?" has to compare against.
              selfId = p.teamId || p.id || selfId;
              return;
            }

            opponents.push({
              playerId: p.id,
              name: p.name,
              checkpointIndex: p.checkpointIndex ?? 0,
              totalCheckpoints: p.totalCheckpoints ?? 0,
              xp: p.xp ?? 0,
              /**
               * Read from replicated state, NOT from the player_region
               * message. The message is fire-and-forget and broadcastExcept,
               * so a late joiner or a reconnecting player would never receive
               * one for a rival who had already stopped moving. State always
               * carries the current region.
               */
              region: p.region?.hasRegion
                ? {
                    center: { latitude: p.region.latitude, longitude: p.region.longitude },
                    radiusMeters: p.region.radiusMeters,
                  }
                : null,
              connected: p.connected ?? true,
              hintsUsed: p.hintsUsed ?? 0,
            });
          });

          return { ...v, code: s.code ?? v.code, xp, totalCheckpoints, opponents, selfId, selfPlayerId };
        });
      });

      // Colyseus delivers typed messages by name; the payload is our union.
      room.onMessage('*', (type, payload) => {
        if (typeof type === 'string' && payload && typeof payload === 'object') {
          handle({ ...(payload as object), type } as ServerMessage);
        }
      });

      room.onError((_code, message) => {
        setView((v) => ({ ...v, phase: 'error', error: message ?? 'Room error' }));
      });

      room.onLeave(() => {
        setView((v) => (v.phase === 'finished' ? v : { ...v, phase: 'error', error: 'Disconnected' }));
      });
    },
    [handle],
  );

  const createRoom = useCallback(
    /**
     * @param teamName Ignored by the server outside `team-race`. Inside it,
     *   players sending the SAME name share one route, one XP total and one
     *   leaderboard entry — that matching is the whole team mechanic, and it
     *   never worked from the browser because this argument did not exist.
     *   Omitted, every player silently became a team of one.
     */
    async (playerName: string, mode: GameMode, huntId: string, teamName?: string) => {
      setView((v) => ({ ...v, phase: 'connecting', error: null }));
      try {
        const client = new Client(WS_URL);
        const room = await client.create('hunt', { playerName, mode, huntId, teamName });
        attach(room, true);
        return room;
      } catch (err) {
        setView((v) => ({
          ...v,
          phase: 'error',
          error: err instanceof Error ? err.message : 'Could not create room',
        }));
        return null;
      }
    },
    [attach],
  );

  const joinRoom = useCallback(
    async (code: string, playerName: string, teamName?: string) => {
      setView((v) => ({ ...v, phase: 'connecting', error: null }));
      try {
        // The six-character code is NOT the Colyseus roomId — the server keeps
        // its own code->roomId map so codes can stay short and unambiguous.
        // Resolve it over HTTP first, then join by the real id.
        const res = await fetch(`${API_URL}/api/rooms/${code.toUpperCase()}`);
        if (!res.ok) {
          setView((v) => ({
            ...v,
            phase: 'error',
            error: res.status === 404 ? `No room with code ${code.toUpperCase()}` : 'Invalid code',
          }));
          return null;
        }

        const { roomId } = (await res.json()) as { roomId: string };
        const client = new Client(WS_URL);
        const room = await client.joinById(roomId, { playerName, teamName });
        attach(room, false);
        return room;
      } catch (err) {
        setView((v) => ({
          ...v,
          phase: 'error',
          error: err instanceof Error ? err.message : 'Could not join that room',
        }));
        return null;
      }
    },
    [attach],
  );

  const send = useCallback((type: string, payload: Record<string, unknown> = {}) => {
    roomRef.current?.send(type, payload);
  }, []);

  /**
   * Rejoin the room this tab was in before the page reloaded.
   *
   * Runs once, before anything else can create or join. A failure is silent
   * and expected: the window closes after RECONNECTION_WINDOW_SECONDS, and a
   * stale token is the normal state of affairs on a fresh visit.
   */
  useEffect(() => {
    if (roomRef.current) return;
    const stored = recallSession();
    if (!stored) return;

    let cancelled = false;
    void (async () => {
      try {
        const room = await new Client(WS_URL).reconnect(stored.token);
        if (cancelled) {
          void room.leave();
          return;
        }
        attach(room, stored.isHost);
      } catch {
        // Seat expired, room gone, or server restarted. Clear it so the next
        // mount does not retry a token that can never work.
        rememberSession(null);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [attach]);

  useEffect(
    () => () => {
      void roomRef.current?.leave();
      roomRef.current = null;
    },
    [],
  );

  /**
   * Leave for good.
   *
   * Distinct from a dropped connection: this forgets the token, so the player
   * is not silently pulled back into a room they chose to walk out of.
   */
  const leaveRoom = useCallback(() => {
    rememberSession(null);
    void roomRef.current?.leave();
    roomRef.current = null;
    setView(initialView);
  }, []);

  return {
    view,
    createRoom,
    joinRoom,
    leaveRoom,
    startHunt: useCallback(() => send('start_hunt'), [send]),
    updateLocation: useCallback(
      (latitude: number, longitude: number, accuracyMeters?: number) =>
        send('update_location', { latitude, longitude, accuracyMeters }),
      [send],
    ),
    requestInstruction: useCallback(
      (checkpointId: string) => send('request_instruction', { checkpointId }),
      [send],
    ),
    requestHint: useCallback((checkpointId: string) => send('request_hint', { checkpointId }), [send]),
    submitCheckpoint: useCallback(
      (submission: Record<string, unknown>) => send('submit_checkpoint', { submission }),
      [send],
    ),
    setShareLocation: useCallback((enabled: boolean) => send('set_share_location', { enabled }), [send]),
  };
}
