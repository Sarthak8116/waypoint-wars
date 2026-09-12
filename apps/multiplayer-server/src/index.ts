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

/**
 * Precedence: real environment > .env.local > .env
 *
 * `override: true` is needed so `.env.local` beats `.env`, but on its own it
 * also clobbers variables set on the command line — so `GEMINI_API_KEY= pnpm
 * start` or `PORT=9999 pnpm start` would be silently ignored, which is
 * astonishing and cost real debugging time. Snapshot what the process was
 * actually given, then put it back on top.
 */
const explicitEnv = new Map(
  Object.entries(process.env).filter(([, v]) => v !== undefined) as Array<[string, string]>,
);

loadEnv({ path: resolve(repoRoot, '.env') });
loadEnv({ path: resolve(repoRoot, '.env.local'), override: true });

for (const [key, value] of explicitEnv) process.env[key] = value;

import http from 'node:http';
import express, { type Express } from 'express';
import cors from 'cors';
import { Server as ColyseusServer } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';

import { huntStore } from './hunt-store.js';
import { initRepository, validateHuntBundle, type HuntRepository } from './persistence/index.js';
import { verifySubmission } from '@ww/verification';
import { generateHunt, PlacesError } from '@ww/content';
import { haversineMeters } from '@ww/shared';
import { getVerificationProvider, allowPhotoless } from './verification-provider.js';
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
/**
 * Persistence. Created eagerly at module load so every route can use it;
 * `createRepository` never throws — a failed Mongo connection falls back to
 * file storage rather than preventing boot.
 */
const repository: HuntRepository = await initRepository({
  mongoUri: process.env.MONGODB_URI,
  mongoDb: process.env.MONGODB_DB,
  repoRoot,
});

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
      // Reports what ACTUALLY connected, not what was configured — a Mongo
      // URI that failed falls back to file storage, and the badge must say so.
      storage: repository.kind,
      elevenlabs: process.env.ELEVENLABS_API_KEY ? 'live' : 'disabled',
      querit: process.env.QUERIT_API_KEY ? 'live' : 'mocked',
      // Advertised so the client can offer the photoless Demo Mode path ONLY
      // where the server would actually accept it. Without this the race
      // screen would enable a button that always fails.
      photoless: allowPhotoless() ? 'enabled' : 'disabled',
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

// ---------------------------------------------------------------------------
// Solo verification
// ---------------------------------------------------------------------------

/**
 * Verify a SOLO submission. The multiplayer path does not use this — the room
 * owns that, because only the room knows whose turn it is and what their active
 * checkpoint is (D15).
 *
 * This endpoint exists so the Gemini key never reaches the browser. Without it
 * the solo page degrades to answer-only checking, which looks like it works and
 * silently never calls the model.
 *
 * SECURITY NOTE, stated plainly: solo mode is inherently client-trusting. There
 * is no server-side run state, so a solo player could submit checkpoints out of
 * order or replay one. What IS enforced here:
 *   - the checkpoint is looked up from the SERVER's content, never taken from
 *     the request body, so accepted answers and the reveal cannot be supplied
 *     by the client
 *   - the geofence is checked server-side against those real coordinates
 *   - XP comes from the hunt engine, not from anything the client sent
 * Solo XP is a personal record, not a competitive ranking, so that trade is
 * acceptable. Multiplayer XP is fully authoritative.
 */
app.post('/api/verify', (req, res) => {
  void (async () => {
    const body = req.body as Partial<{
      checkpointId: string;
      image: string;
      latitude: number;
      longitude: number;
      observationAnswer: string;
      randomizedInstruction: string;
      submittedAt: number;
    }>;

    if (
      typeof body?.checkpointId !== 'string' ||
      typeof body.image !== 'string' ||
      typeof body.latitude !== 'number' ||
      typeof body.longitude !== 'number'
    ) {
      res.status(400).json({ error: 'checkpointId, image, latitude and longitude are required.' });
      return;
    }

    ensureSeeded();
    const checkpoint = huntStore.getCheckpoint(body.checkpointId);
    if (!checkpoint) {
      res.status(404).json({ error: `Unknown checkpoint "${body.checkpointId}".` });
      return;
    }

    try {
      const verdict = await verifySubmission(
        {
          checkpointId: body.checkpointId,
          image: body.image,
          latitude: body.latitude,
          longitude: body.longitude,
          observationAnswer: body.observationAnswer ?? '',
          randomizedInstruction: body.randomizedInstruction ?? '',
          submittedAt: body.submittedAt ?? Date.now(),
        },
        checkpoint,
        getVerificationProvider(),
        { allowPhotoless: allowPhotoless() },
      );
      res.json(verdict);
    } catch (err) {
      console.error('[api] solo verification failed', err);
      res.status(502).json({ error: 'Verification service is unavailable.' });
    }
  })();
});

// ---------------------------------------------------------------------------
// Find a hunt near a player
// ---------------------------------------------------------------------------

/** 5 miles, the radius the user asked for. */
const NEARBY_RADIUS_METERS = 8047;

/**
 * What can this player actually walk to from where they are standing?
 *
 * GET /api/hunts/nearby?lat=&lng=
 *
 * Returns published hunts whose START (or first checkpoint, for older content
 * without one) is within five miles, nearest first. An empty list is a normal
 * answer, not an error — it means the client should offer to generate one.
 */
app.get('/api/hunts/nearby', (req, res) => {
  void (async () => {
    const lat = Number(req.query['lat']);
    const lng = Number(req.query['lng']);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      res.status(400).json({ error: 'lat and lng are required.' });
      return;
    }

    try {
      const listed = await repository.listHunts();
      const here = { latitude: lat, longitude: lng };
      const nearby: Array<{
        huntId: string;
        title: string;
        city: string;
        distanceMeters: number;
        startName?: string;
        routes: number;
      }> = [];

      for (const meta of listed) {
        const bundle = await repository.getHuntBundle(meta.id);
        if (!bundle?.hunt.published) continue;

        // Anchor on the shared start; fall back to the first checkpoint of the
        // first route for hunts authored before startLocation existed.
        const anchor = bundle.hunt.startLocation
          ? {
              latitude: bundle.hunt.startLocation.latitude,
              longitude: bundle.hunt.startLocation.longitude,
            }
          : bundle.checkpoints.find((c) => c.id === bundle.routes[0]?.checkpointIds[0]);
        if (!anchor) continue;

        const distanceMeters = Math.round(haversineMeters(here, anchor));
        if (distanceMeters > NEARBY_RADIUS_METERS) continue;

        nearby.push({
          huntId: bundle.hunt.id,
          title: bundle.hunt.title,
          city: bundle.hunt.city,
          distanceMeters,
          ...(bundle.hunt.startLocation ? { startName: bundle.hunt.startLocation.name } : {}),
          routes: bundle.routes.length,
        });
      }

      nearby.sort((a, b) => a.distanceMeters - b.distanceMeters);
      res.json({ hunts: nearby, radiusMeters: NEARBY_RADIUS_METERS });
    } catch (err) {
      console.error('[api] nearby lookup failed', err);
      res.status(500).json({ error: 'Could not look up nearby hunts.' });
    }
  })();
});

// ---------------------------------------------------------------------------
// Generate a hunt for anywhere
// ---------------------------------------------------------------------------

/**
 * Build a playable hunt from a place name.
 *
 *   POST /api/hunts/generate  { query, duration?, routeCount?, stopsPerRoute? }
 *
 * Coordinates come from OpenStreetMap; Gemini only writes the words. The
 * result is stored but NEVER auto-published: generated history is shown to a
 * human before anyone is told it as fact. The response carries a report —
 * which drafts the model was unsure about, whether routes came out balanced —
 * so the creator UI can show what needs review.
 *
 * Takes 20-40 seconds: roughly one Gemini call per unique place, sequential to
 * stay inside the per-minute limit.
 */
app.post('/api/hunts/generate', (req, res) => {
  void (async () => {
    const body = req.body as Partial<{
      query: string;
      latitude: number;
      longitude: number;
      duration: string;
      routeCount: number;
      stopsPerRoute: number;
    }>;

    /**
     * Two ways in: a place NAME, or the player's own COORDINATES.
     *
     * The coordinate path matters — a player standing somewhere unnamed, or
     * who does not know what their neighbourhood is called, can still get a
     * hunt. Nominatim reverse-geocodes "lat,lng" perfectly well.
     */
    const hasCoords =
      typeof body?.latitude === 'number' &&
      typeof body?.longitude === 'number' &&
      Number.isFinite(body.latitude) &&
      Number.isFinite(body.longitude);

    const query =
      typeof body?.query === 'string' && body.query.trim().length >= 2
        ? body.query.trim()
        : hasCoords
          ? `${body.latitude},${body.longitude}`
          : '';

    if (!query) {
      res.status(400).json({ error: 'Tell me where — a city, a landmark, or your coordinates.' });
      return;
    }

    try {
      const generated = await generateHunt({
        query,
        ...(body.duration ? { duration: body.duration as never } : {}),
        ...(typeof body.routeCount === 'number' ? { routeCount: body.routeCount } : {}),
        ...(typeof body.stopsPerRoute === 'number' ? { stopsPerRoute: body.stopsPerRoute } : {}),
      });

      const bundle = {
        hunt: generated.hunt,
        routes: generated.routes,
        checkpoints: generated.checkpoints,
      };

      // Stored so it can be reviewed and published, but `published: false`
      // keeps it out of anything a player can start.
      await repository.saveHuntBundle(bundle);
      huntStore.load(bundle);

      res.status(201).json({ ...bundle, report: generated.report });
    } catch (err) {
      if (err instanceof PlacesError) {
        const status = err.kind === 'not-found' || err.kind === 'empty' ? 404 : 503;
        res.status(status).json({ error: err.message, kind: err.kind });
        return;
      }
      console.error('[api] hunt generation failed', err);
      res.status(500).json({ error: 'Could not generate a hunt there.' });
    }
  })();
});

// ---------------------------------------------------------------------------
// Creator dashboard: publish a hunt
// ---------------------------------------------------------------------------

/**
 * Accepts a `{hunt, routes, checkpoints}` bundle from the creator dashboard.
 *
 * Validation is strict and happens BEFORE anything is written, because the
 * failure mode it prevents is discovering mid-race that three routes end at
 * different checkpoints — `assignRoutes` throws, and the room dies with
 * players in it. Rejecting at the door costs the creator a red message;
 * accepting bad content costs the demo.
 *
 * A published hunt is loaded into the live store immediately, so a creator can
 * publish and play without restarting the server.
 */
app.post('/api/hunts', (req, res) => {
  void (async () => {
    const result = validateHuntBundle(req.body);
    if (!result.ok) {
      res.status(422).json({ error: 'Hunt bundle is not valid.', details: result.errors });
      return;
    }

    try {
      await repository.saveHuntBundle(result.bundle);
      huntStore.load(result.bundle);
      res.status(201).json({
        ok: true,
        huntId: result.bundle.hunt.id,
        routes: result.bundle.routes.length,
        checkpoints: result.bundle.checkpoints.length,
        storage: repository.kind,
      });
    } catch (err) {
      console.error('[api] failed to save hunt bundle', err);
      res.status(500).json({ error: 'Could not save the hunt.' });
    }
  })();
});

/** Hunts available on this server, for the creator's open/import list. */
app.get('/api/hunts', (_req, res) => {
  void (async () => {
    try {
      res.json({ hunts: await repository.listHunts(), storage: repository.kind });
    } catch {
      res.status(500).json({ error: 'Could not list hunts.' });
    }
  })();
});

/** Completed runs for a hunt — the persistent leaderboard. */
app.get('/api/hunts/:huntId/runs', (req, res) => {
  void (async () => {
    try {
      const runs = await repository.listCompletedRuns(String(req.params['huntId']), 50);
      res.json({ runs });
    } catch {
      res.status(500).json({ error: 'Could not list runs.' });
    }
  })();
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
