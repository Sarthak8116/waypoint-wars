/**
 * Contract tests — the regressions that actually happened tonight.
 *
 * Every bug found during this build shared a shape: two sides of a boundary
 * disagreed, typecheck passed on both sides independently, and a sensible
 * fallback hid the failure at runtime. Unit tests could not catch any of them
 * because each side was internally correct.
 *
 * These tests assert the boundary itself.
 */

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readdirSync, statSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../..');
const serverIndex = readFileSync(resolve(here, 'index.ts'), 'utf8');

/** Every `.ts`/`.tsx` file under a directory. */
function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.next' || entry.startsWith('.')) continue;
    const full = resolve(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

describe('client -> server route contract', () => {
  /**
   * THE BUG: `/play` POSTed to `/api/verify`, which did not exist. It 404'd,
   * a catch swallowed it, and solo mode silently fell back to answer-only
   * checking while appearing to verify photos with Gemini. Both sides
   * typechecked. Nothing failed.
   */
  it('every API path the web app calls is served by this server', () => {
    const webSrc = resolve(repoRoot, 'apps/web/src');
    const files = walk(webSrc);

    // Collect `${API_URL}/api/...` and bare `/api/...` fetch targets.
    const called = new Set<string>();
    for (const file of files) {
      const src = readFileSync(file, 'utf8');
      // Capture the whole path INCLUDING `${...}` interpolations, then turn
      // each interpolation into a `:param` segment. Truncating at the `${`
      // instead yields "/api/rooms/" and produces a bogus failure.
      for (const m of src.matchAll(/fetch\(\s*[`'"][^`'"]*?(\/api\/(?:\$\{[^}]*\}|[A-Za-z0-9/_.-])*)/g)) {
        const path = m[1];
        if (path) {
          called.add(path.replace(/\$\{[^}]*\}/g, ':param').replace(/\/$/, ''));
        }
      }
    }

    expect(called.size, 'expected the web app to call at least one API route').toBeGreaterThan(0);

    // Express route patterns this server registers.
    const registered = [...serverIndex.matchAll(/app\.(?:get|post|put|delete)\('([^']+)'/g)].map(
      (m) => m[1] as string,
    );

    const matches = (callPath: string): boolean =>
      registered.some((route) => {
        // Compare segment by segment so `/api/rooms/:code` matches a concrete code.
        const r = route.split('/').filter(Boolean);
        const c = callPath.split('/').filter(Boolean);
        if (r.length !== c.length) return false;
        return r.every((seg, i) => seg.startsWith(':') || seg === c[i]);
      });

    const missing = [...called].filter((p) => !matches(p));

    expect(
      missing,
      `the web app calls these paths but the server does not serve them:\n  ${missing.join('\n  ')}\nRegistered:\n  ${registered.join('\n  ')}`,
    ).toEqual([]);
  });
});

describe('public content contract', () => {
  /**
   * THE RULE: `toPublicCheckpoint` strips answers and reveals. If someone adds
   * a field to `Checkpoint` and forgets the projection, the answers ship to the
   * browser and the game is over. This asserts against the real content file.
   */
  it('the curated bundle never exposes answers or reveals through the public shape', async () => {
    const { toPublicCheckpoint } = await import('@ww/shared');
    const bundle = JSON.parse(
      readFileSync(resolve(repoRoot, 'data/pittsburgh-hunts.json'), 'utf8'),
    ) as { checkpoints: Array<Record<string, unknown>> };

    const forbidden = [
      'acceptedAnswers',
      'historicalReveal',
      'hiddenDetail',
      'hint',
      'hints',
      'landmarkDescription',
      'sources',
    ];

    for (const checkpoint of bundle.checkpoints) {
      const publicShape = toPublicCheckpoint(checkpoint as never);
      const serialized = JSON.stringify(publicShape);
      for (const field of forbidden) {
        expect(
          serialized.includes(`"${field}"`),
          `${String(checkpoint['id'])} leaks ${field} through toPublicCheckpoint`,
        ).toBe(false);
      }
    }
  });
});

describe('hunt content invariants', () => {
  const bundle = JSON.parse(
    readFileSync(resolve(repoRoot, 'data/pittsburgh-hunts.json'), 'utf8'),
  ) as {
    hunt: { finalDestination: { id: string } };
    routes: Array<{ id: string; checkpointIds: string[] }>;
    checkpoints: Array<{ id: string }>;
  };

  /**
   * THE BUG THIS PREVENTS: the engine infers the shared finish as the LAST
   * checkpoint id. If routes disagree, `assignRoutes` throws — inside a live
   * room, with players in it. That is a mid-demo crash, not a validation error.
   */
  it('every route ends at the hunt final destination', () => {
    for (const route of bundle.routes) {
      expect(route.checkpointIds.at(-1), `route ${route.id}`).toBe(bundle.hunt.finalDestination.id);
    }
  });

  it('every route has the same number of checkpoints', () => {
    const lengths = new Set(bundle.routes.map((r) => r.checkpointIds.length));
    expect([...lengths]).toHaveLength(1);
  });

  it('every referenced checkpoint exists', () => {
    const ids = new Set(bundle.checkpoints.map((c) => c.id));
    for (const route of bundle.routes) {
      for (const id of route.checkpointIds) {
        expect(ids.has(id), `route ${route.id} references missing checkpoint ${id}`).toBe(true);
      }
    }
  });

  /**
   * Overlap between routes is ALLOWED — in a small town or a dense cluster,
   * forcing disjoint sets would push players somewhere boring just to keep
   * them apart. What must hold is that no two routes are IDENTICAL, because
   * then nobody has anything different to compare at the finish.
   */
  it('no two routes are identical', () => {
    for (const a of bundle.routes) {
      for (const b of bundle.routes) {
        if (a.id >= b.id) continue;
        const sa = new Set(a.checkpointIds);
        const identical = b.checkpointIds.every((id) => sa.has(id));
        expect(identical, `${a.id} and ${b.id} are the same route`).toBe(false);
      }
    }
  });

  it('every route contributes at least one stop the others do not have', () => {
    const finish = bundle.hunt.finalDestination.id;
    for (const route of bundle.routes) {
      const others = new Set(
        bundle.routes.filter((r) => r.id !== route.id).flatMap((r) => r.checkpointIds),
      );
      const unique = route.checkpointIds.filter((id) => id !== finish && !others.has(id));
      expect(unique.length, `${route.id} has no exclusive discovery`).toBeGreaterThan(0);
    }
  });
});

describe('environment loading', () => {
  /**
   * THE BUG: `import 'dotenv/config'` resolves `.env` against the process CWD,
   * which for a pnpm workspace script is the package directory — never the repo
   * root, and never `.env.local`. The server reported `gemini: mocked` with a
   * valid key on disk for hours.
   */
  it('loads env from the repo root, not the package directory', () => {
    expect(serverIndex).toMatch(/\.env\.local/);
    expect(serverIndex).toMatch(/repoRoot/);
    // Match an actual import statement at the start of a line, not a mention
    // of the pattern inside a doc comment explaining why it is wrong.
    const bareDotenvImport = /^\s*import\s+['"]dotenv\/config['"]/m.test(serverIndex);
    expect(
      bareDotenvImport,
      "bare dotenv/config resolves against the package cwd and will miss the root .env.local",
    ).toBe(false);
  });

  /**
   * /health must report what ACTUALLY connected. It used to read the env var,
   * so a failed Mongo connection that silently fell back to file storage would
   * still have badged itself as live.
   */
  it('health reports the real storage backend, not the configured one', () => {
    expect(serverIndex).toMatch(/storage:\s*repository\.kind/);
    expect(
      /mongo:\s*process\.env\.MONGODB_URI/.test(serverIndex),
      'health must not infer storage from the env var',
    ).toBe(false);
  });
});
