/**
 * Waypoint Wars multiplayer + API server.
 *
 * Responsibilities:
 *   - Colyseus rooms (authoritative game state)  [P7]
 *   - Photo verification proxy, so GEMINI_API_KEY never reaches a browser [P5]
 *   - Health endpoint used by the web app to show connection status [P1]
 */

import 'dotenv/config';
import http from 'node:http';
import express from 'express';
import cors from 'cors';

const PORT = Number(process.env.PORT ?? 2567);

const app = express();

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

const server = http.createServer(app);

server.listen(PORT, () => {
  const gemini = process.env.GEMINI_API_KEY ? 'LIVE' : 'MOCKED';
  console.log(`[waypoint-wars] server listening on http://localhost:${PORT}`);
  console.log(`[waypoint-wars] gemini verification: ${gemini}`);
});

export { app, server };
