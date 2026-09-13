/**
 * Team mode, through the actual UI.
 *
 * This exists because Teams was a button that did nothing. The server
 * implements team-race correctly and has unit tests for it, but the browser
 * never sent `teamName`, so `resolveTeam` created a fresh team per player and
 * every "team" was a team of one. The mode was reachable from the lobby, it
 * looked like it worked, and no check touched it.
 *
 * The two claims worth proving are opposites, so both are asserted:
 *   - teammates get the SAME route
 *   - a different team gets a DIFFERENT one
 *
 *   pnpm --filter @ww/web check:teams
 */

import { chromium } from 'playwright';
import { gotoReady, clickAndExpect } from './lib/hydrated.mjs';
import { mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = process.env.WEB_URL ?? 'http://localhost:3000';

const here = dirname(fileURLToPath(import.meta.url));
const SHOT_DIR = resolve(here, '../../..', '.screenshots');
mkdirSync(SHOT_DIR, { recursive: true });

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? '✓' : '✖'} ${name}${detail ? ` — ${detail}` : ''}`);
  return ok;
};

const clueOf = async (page) =>
  ((await page.locator('[data-testid="clue"]').first().textContent().catch(() => '')) ?? '').trim();

async function main() {
  const browser = await chromium.launch();
  const errors = [];

  /** Each player gets their own context — separate storage, separate socket. */
  async function open(path) {
    const ctx = await browser.newContext({ viewport: { width: 430, height: 900 } });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(String(e)));
    await gotoReady(page, `${BASE}${path}`);
    return page;
  }

  try {
    console.log('\nteam-race');

    const host = await open('/lobby');
    await host.locator('input[aria-label="Your name"]').fill('Ava');
    // Confirm the mode toggle actually took: the team-name field only exists
    // in team-race, so its absence means the click was swallowed.
    check(
      'the Teams toggle responds',
      await clickAndExpect(host, 'button:has-text("Teams")', 'input[aria-label="Your team name"]'),
    );
    await host.locator('input[aria-label="Your team name"]').fill('Rivers');
    await host.locator('button:has-text("Create room")').click();

    await host.waitForSelector('h1.mono', { timeout: 30_000 });
    const code = (await host.locator('h1.mono').first().textContent())?.trim() ?? '';
    check('team room created', /^[A-Z0-9]{6}$/.test(code), code);

    // Ben joins Ava's team. Bea forms her own.
    const mate = await open(`/lobby?code=${code}`);
    await mate.locator('input[aria-label="Your name"]').fill('Ben');
    await mate.locator('input[aria-label="Team name"]').fill('Rivers');
    await mate.locator('button:has-text("Join room")').click();
    await mate.waitForSelector('text=/Waiting for the host/i', { timeout: 30_000 });

    const rival = await open(`/lobby?code=${code}`);
    await rival.locator('input[aria-label="Your name"]').fill('Bea');
    await rival.locator('input[aria-label="Team name"]').fill('Bridges');
    await rival.locator('button:has-text("Join room")').click();
    await rival.waitForSelector('text=/Waiting for the host/i', { timeout: 30_000 });
    check('two teams joined', true);

    await host.waitForTimeout(1200);
    await host.locator('button:has-text("Start hunt")').click();
    await Promise.all([
      host.waitForURL(/\/race/, { timeout: 30_000 }),
      mate.waitForURL(/\/race/, { timeout: 30_000 }),
      rival.waitForURL(/\/race/, { timeout: 30_000 }),
    ]);
    check('everyone reached the race screen', true);

    // The server sends the first clue over a targeted message; give it a beat.
    await host.waitForTimeout(5000);
    const [a, b, c] = [await clueOf(host), await clueOf(mate), await clueOf(rival)];

    check('host received a clue', a.length > 0, a.slice(0, 40));
    check('teammates share one route', a !== '' && a === b, `${a.slice(0, 28)} | ${b.slice(0, 28)}`);
    check('a rival team walks a different one', c !== '' && c !== a, c.slice(0, 40));
    check('no page errors', errors.length === 0, errors[0] ?? '');

    await host.screenshot({ path: resolve(SHOT_DIR, '10-team-host.png') });
  } finally {
    await browser.close();
  }

  const passed = results.filter((r) => r.ok).length;
  console.log(`\n${'─'.repeat(64)}\n${passed}/${results.length} checks passed`);
  if (passed < results.length) {
    console.log('\nFAILED:');
    for (const r of results.filter((x) => !x.ok)) console.log(`  · ${r.name}${r.detail ? ` (${r.detail})` : ''}`);
    process.exit(1);
  }
  console.log('\n✓ teams share a route, rivals do not');
}

await main();
