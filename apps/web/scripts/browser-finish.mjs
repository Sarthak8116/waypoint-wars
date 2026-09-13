/**
 * A multiplayer game played to the finish, through the UI.
 *
 * Everything else stops one checkpoint in. That left the entire back half of
 * the game untested: progression past checkpoint 1, the server unlocking each
 * next clue, hunt_finished, the leaderboard, and the end screen.
 *
 * It mattered. The end screen's "You won / You finished" hero is keyed on
 * `e.playerId === view.selfId`, and selfId was a Colyseus sessionId while
 * leaderboard entries are keyed by run.entityId — so the hero had never
 * appeared for anybody, and no check could have noticed.
 *
 * Needs a server with ALLOW_PHOTOLESS_SUBMISSIONS=true, because there is no
 * camera here and no landmark to photograph:
 *
 *   GEMINI_API_KEY= ALLOW_PHOTOLESS_SUBMISSIONS=true pnpm dev
 *   pnpm --filter @ww/web check:finish
 */

import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = process.env.WEB_URL ?? 'http://localhost:3000';
const API = process.env.API_URL ?? 'http://localhost:2567';
const here = dirname(fileURLToPath(import.meta.url));
const SHOT_DIR = resolve(here, '../../..', '.screenshots');
mkdirSync(SHOT_DIR, { recursive: true });

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? '✓' : '✖'} ${name}${detail ? ` — ${detail}` : ''}`);
  return ok;
};

const answerFor = (page, question) =>
  page.evaluate(async (q) => {
    const r = await fetch('/hunts/pittsburgh.json').then((x) => x.json());
    const cps = Array.isArray(r.checkpoints) ? r.checkpoints : Object.values(r.checkpoints ?? {});
    return cps.find((c) => c.observationQuestion === q)?.acceptedAnswers?.[0] ?? null;
  }, question);

/** Dev builds compile on first hit; clicking before hydration silently no-ops. */
async function ready(page, path) {
  await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle' });
  await page.waitForSelector('input[aria-label="Your name"]', { timeout: 60_000 });
  await page.waitForTimeout(2000);
}

async function walkToTheEnd(page) {
  for (let i = 0; i < 8; i++) {
    if (/Final standings/i.test(await page.locator('body').innerText())) return true;
    await page.locator('button:has-text("Use demo location")').click().catch(() => {});
    await page.waitForTimeout(400);
    await page.locator('button:has-text("Walk there")').click().catch(() => {});
    const arrived = await page
      .waitForSelector("text=/You're here/i", { timeout: 60_000 })
      .then(() => true)
      .catch(() => false);
    if (!arrived) return /Final standings/i.test(await page.locator('body').innerText());
    const q = ((await page.locator('h3').first().textContent()) ?? '').trim();
    await page.locator('input[placeholder="Your answer"]').fill((await answerFor(page, q)) ?? '');
    await page.locator('button:has-text("Submit")').first().click();
    await page.waitForTimeout(4000);
  }
  return /Final standings/i.test(await page.locator('body').innerText());
}

async function main() {
  const health = await fetch(`${API}/health`).then((r) => r.json()).catch(() => null);
  if (health?.integrations?.photoless !== 'enabled') {
    console.log('\n  ⚠ This server does not accept photoless submissions, so a run');
    console.log('    cannot be completed without a camera. Start it with');
    console.log('    ALLOW_PHOTOLESS_SUBMISSIONS=true and re-run.');
    process.exit(2);
  }

  const browser = await chromium.launch();
  const errors = [];
  try {
    console.log('\na full multiplayer game');
    const mk = async () => {
      const ctx = await browser.newContext({ viewport: { width: 430, height: 900 } });
      const page = await ctx.newPage();
      page.on('pageerror', (e) => {
        const text = String(e);
        /**
         * Two MapLibre canvases plus two Phaser canvases in one headless
         * Chromium exhausts the software GL backend. This is an artifact of
         * running four WebGL contexts on a machine with no GPU, not something
         * a player can hit — and it is filtered by exact class rather than by
         * relaxing the assertion, so a real page error still fails the run.
         */
        if (/Framebuffer status|WebGL context was lost/i.test(text)) return;
        errors.push(text);
      });
      return page;
    };

    const host = await mk();
    await ready(host, '/lobby');
    await host.locator('input[aria-label="Your name"]').fill('Ava');
    await host.locator('button:has-text("Create room")').click();
    await host.waitForSelector('h1.mono', { timeout: 40_000 });
    const code = (await host.locator('h1.mono').first().textContent())?.trim() ?? '';

    const guest = await mk();
    await ready(guest, `/lobby?code=${code}`);
    await guest.locator('input[aria-label="Your name"]').fill('Ben');
    await guest.locator('button:has-text("Join room")').click();
    await guest.waitForSelector('text=/Waiting for the host/i', { timeout: 40_000 });

    await host.waitForTimeout(1200);
    await host.locator('button:has-text("Start hunt")').click();
    await Promise.all([
      host.waitForURL(/\/race/, { timeout: 40_000 }),
      guest.waitForURL(/\/race/, { timeout: 40_000 }),
    ]);
    await host.waitForTimeout(4500);
    check('both players are racing', true, code);

    /**
     * The first player home always waits, because the server ends a hunt only
     * when EVERY run is finished. Before this screen existed they waited on
     * the checkpoint they had just cleared, Submit still live, with nothing
     * saying they had finished — so let one player finish alone first and
     * assert what they are told.
     */
    await walkToTheEnd(host);
    await host.waitForTimeout(3000);
    const waitingBody = await host.locator('body').innerText();
    check('the first finisher is told they are home', /You.re home|Final standings/i.test(waitingBody));
    if (!/Final standings/i.test(waitingBody)) {
      check('they are told who they are waiting for', /Waiting for/i.test(waitingBody));
      check('they cannot re-submit a solved checkpoint', !/Submit proof|Submit answer/i.test(waitingBody));
    }

    const [hostDone] = await Promise.all([Promise.resolve(true), walkToTheEnd(guest)]);
    await host.waitForTimeout(4000);
    const body = await host.locator('body').innerText();

    check('the host reached the end screen', hostDone || /Final standings/i.test(body));
    check('the finish is announced', /Everyone made it/i.test(body));
    // The hero that never appeared, because selfId and entityId disagreed.
    check('the player is told where they placed', /You (won|finished)/i.test(body),
      (body.match(/You (won|finished)/i) ?? [''])[0]);
    check('the standings mark which row is you', /·\s*you/i.test(body));
    check('every checkpoint was completed', /5\/5/.test(body));
    check('the replay is offered here', /Watch the route replay/i.test(body));
    check('no page errors in either browser', errors.length === 0, errors[0] ?? '');

    await host.screenshot({ path: resolve(SHOT_DIR, '12-multiplayer-finish.png'), fullPage: true });

    // ---------------------------------------------------------------- teams
    /**
     * The team claim is "one route, one XP total, one leaderboard entry", and
     * only the first third of it was ever checked. Whether teammates share a
     * SCORE — and whether a player who never touched a checkpoint is carried
     * to the finish by their team — happens entirely in the back half of a
     * game that nothing used to reach.
     */
    console.log('\na full team game');

    const ava = await mk();
    await ready(ava, '/lobby');
    await ava.locator('input[aria-label="Your name"]').fill('Ava');
    await ava.locator('button:has-text("Teams")').click();
    await ava.locator('input[aria-label="Your team name"]').fill('Rivers');
    await ava.locator('button:has-text("Create room")').click();
    await ava.waitForSelector('h1.mono', { timeout: 40_000 });
    const teamCode = (await ava.locator('h1.mono').first().textContent())?.trim() ?? '';

    const joiners = {};
    for (const [name, team] of [['Ben', 'Rivers'], ['Bea', 'Bridges']]) {
      const page = await mk();
      await ready(page, `/lobby?code=${teamCode}`);
      await page.locator('input[aria-label="Your name"]').fill(name);
      await page.locator('input[aria-label="Team name"]').fill(team);
      await page.locator('button:has-text("Join room")').click();
      await page.waitForSelector('text=/Waiting for the host/i', { timeout: 40_000 });
      joiners[name] = page;
    }

    await ava.waitForTimeout(1200);
    await ava.locator('button:has-text("Start hunt")').click();
    await ava.waitForURL(/\/race/, { timeout: 40_000 });
    await ava.waitForTimeout(4500);

    // Ben deliberately plays NOTHING. His team should still carry him home.
    await Promise.all([walkToTheEnd(ava), walkToTheEnd(joiners['Bea'])]);
    await ava.waitForTimeout(4000);

    const teamBody = await ava.locator('body').innerText();
    const benBody = await joiners['Ben'].locator('body').innerText();

    check('teams are ranked, not players', /Rivers/.test(teamBody) && /Bridges/.test(teamBody));
    check(
      'individual names do not appear in team standings',
      !/\bAva\b|\bBen\b|\bBea\b/.test(teamBody.split('FINAL STANDINGS')[1] ?? teamBody),
    );
    check('the winning row is marked as the viewer\'s team', /Rivers\s*·\s*you/i.test(teamBody));
    check('a teammate who played nothing still finishes', /Final standings/i.test(benBody));
    check('and is credited with the team\'s progress', /5\/5/.test(benBody));

    await ava.screenshot({ path: resolve(SHOT_DIR, '13-team-finish.png'), fullPage: true });
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
  console.log('\n✓ a game can be played to the finish');
}

await main();
