/**
 * Waypoint Wars multiplayer + API server.
 *
 * Responsibilities:
 *   - Colyseus rooms (authoritative game state)  [P7]
 *   - Photo verification proxy, so GEMINI_API_KEY never reaches a browser [P5]
 *   - Health endpoint used by the web app to show connection status [P1]
 */

/**
 * Env loading, deliberately explicit.
 *
 * `import 'dotenv/config'` reads `.env` relative to the PROCESS CWD, which for
 * a pnpm workspace script is this package directory — not the repo root, and
 * not `.env.local`. That silently produced a server reporting `gemini: mocked`
 * while a perfectly good key sat in the root `.env.local`. Load both, rooted
 * at the workspace, with `.env.local` winning.
 */
import { config as loadEnv } from 'dotenv';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
loadEnv({ path: resolve(repoRoot, '.env') });
// `override` so .env.local beats an earlier .env, matching Next.js's precedence.
loadEnv({ path: resolve(repoRoot, '.env.local'), override: true });

import http from 'node:http';
import express, { type Express } from 'express';
import cors from 'cors';
import { Server as ColyseusServer } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';

import { huntStore } from './hunt-store.js';
import { ensureSeeded } from './seed.js';
import { HuntRoom } from './rooms/HuntRoom.js';
import { isValidRoomCode, roomCodes } from './rooms/room-codes.js';

const PORT = Number(process.env.PORT ?? 2567);

/** Colyseus room name clients pass to `create` / `joinById`. */
export const HUNT_ROOM_NAME = 'hunt';

// Content is loaded once, at boot, into the in-memory store (DECISIONS.md D3).
ensureSeeded({ logger: console });

// Explicit annotation: pnpm's nested layout makes the inferred Express type
// unnameable across package boundaries (TS2742).
const app: Express = express();

app.use(cors());
// Photo submissions are base64 data URLs, so the default 100kb limit is far too small.
app.use(express.json({ limit: '12mb' }));

/**
 * Reports which integrations are live vs. mocked. The web app surfaces this
 * so a mock is never mistaken for the real thing during a demo.
 */
app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'waypoint-wars-server',
    time: new Date().toISOString(),
    integrations: {
      gemini: process.env.GEMINI_API_KEY ? 'live' : 'mocked',
      mongo: process.env.MONGODB_URI ? 'live' : 'in-memory',
      elevenlabs: process.env.ELEVENLABS_API_KEY ? 'live' : 'disabled',
      querit: process.env.QUERIT_API_KEY ? 'live' : 'mocked',
    },
  });
});

/**
 * The hunt content bundle for the multiplayer client.
 *
 * Every checkpoint here has been through `toPublicCheckpoint`, so
 * `acceptedAnswers`, `hint`, `hints`, `historicalReveal`, `hiddenDetail` and
 * `sources` are absent — they would otherwise be readable from the network tab,
 * and the game would be over (DECISIONS.md D8). The reveal arrives only in the
 * `submission_result` the room sends AFTER it approves a submission.
 *
 * This endpoint is map and clue CONTENT. It says nothing about which route any
 * player drew: assignment lives in the room and is never published.
 */
app.get('/api/hunt', (req, res) => {
  ensureSeeded();
  const huntId = typeof req.query['huntId'] === 'string' ? req.query['huntId'] : undefined;
  const bundle = huntStore.toPublicBundle(huntId);
  if (!bundle) {
    res.status(404).json({ error: 'No hunt content is loaded.' });
    return;
  }
  res.json(bundle);
});

/**
 * Resolve a six-character join code to a Colyseus room id.
 *
 * The code is generated server-side, so a joining client cannot know the room
 * id in advance; this is the lookup that turns "type these six characters" into
 * `client.joinById(roomId)`.
 */
app.get('/api/rooms/:code', (req, res) => {
  const code = String(req.params['code'] ?? '').toUpperCase();
  if (!isValidRoomCode(code)) {
    res.status(400).json({ error: 'Invalid room code.' });
    return;
  }
  const roomId = roomCodes.roomIdFor(code);
  if (!roomId) {
    res.status(404).json({ error: 'No live room with that code.' });
    return;
  }
  res.json({ code, roomId });
});

const server = http.createServer(app);

/**
 * Colyseus shares the Express http server rather than binding its own port, so
 * `/health` and the websocket endpoint live behind one origin and one CORS
 * policy.
 */
const gameServer = new ColyseusServer({
  transport: new WebSocketTransport({ server }),
});

gameServer.define(HUNT_ROOM_NAME, HuntRoom);

/**
 * Listen only when this file is the process entry point, so importing `app` in
 * a test does not bind a port.
 */
const invokedDirectly =
  process.argv[1] !== undefined &&
  import.meta.url === new URL(`file://${process.argv[1]}`).href;

if (invokedDirectly) {
  void gameServer.listen(PORT).then(() => {
    const gemini = process.env.GEMINI_API_KEY ? 'LIVE' : 'MOCKED';
    console.log(`[waypoint-wars] server listening on http://localhost:${PORT}`);
    console.log(`[waypoint-wars] gemini verification: ${gemini}`);
    console.log(`[waypoint-wars] colyseus room "${HUNT_ROOM_NAME}" registered`);
  });
}

export { app, server, gameServer };
