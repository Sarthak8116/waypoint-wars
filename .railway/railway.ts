import { defineRailway, project, service } from 'railway/iac';

/**
 * Railway deployment for the Colyseus room server.
 *
 * Only the SERVER lives here. The Next.js web app goes to Vercel — Colyseus
 * holds open WebSockets and keeps room state in memory, which needs a
 * long-lived process rather than per-request functions.
 *
 * The build runs at the MONOREPO ROOT, not in apps/multiplayer-server: pnpm
 * workspaces resolve `@ww/*` from the root lockfile, so installing inside the
 * package directory would fail to find them.
 *
 * PORT is injected by Railway and read via `process.env.PORT ?? 2567`.
 *
 * SECRETS ARE DECLARED BUT NEVER WRITTEN HERE. Railway's IaC is
 * authoritative — a variable this file omits is DELETED on apply — but the
 * file is committed to a public repo, so the value cannot live in it.
 *
 * So the key is declared and its value read from the local environment at
 * apply time. Run an apply with the key available:
 *
 *   GEMINI_API_KEY=$(grep '^GEMINI_API_KEY=' .env.local | cut -d= -f2-) \
 *     railway config apply
 *
 * This project already leaked one key into a committed .env.example. The rule
 * that prevents a repeat is simple: a secret's value never enters a tracked
 * file, no matter how convenient.
 */
export default defineRailway(() => {
  const geminiKey = process.env['GEMINI_API_KEY'];
  if (!geminiKey) {
    throw new Error(
      'GEMINI_API_KEY is not set. Applying without it would delete the key on ' +
        'Railway and leave photo verification silently mocked in production.',
    );
  }

  const server = service('waypoint-server', {
    build: 'corepack enable && pnpm install --frozen-lockfile',
    start: 'pnpm --filter @ww/multiplayer-server start',
    env: { GEMINI_API_KEY: geminiKey },
  });

  return project('waypoint-wars', { resources: [server] });
});
