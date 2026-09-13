/**
 * Surviving a page reload mid-race.
 *
 * The server already held a dropped player's seat, XP and route position for a
 * reconnection window, and re-sent their active checkpoint on return. None of
 * it could fire: the browser stored nothing, so reconnect() was never called
 * and the seat expired unused. Measured in production — refreshing mid-race
 * showed "Not in a room" while the server was still holding the place.
 *
 * Both directions matter, so both are asserted:
 *   - an ACCIDENTAL drop (reload) returns to the same seat and clue
 *   - a DELIBERATE exit does not drag the player back in
 *
 *   pnpm --filter @ww/web check:reconnect
 */

import { chromium } from 'playwright';
import { gotoReady, isHeadlessGlNoise } from './lib/hydrated.mjs';
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

async function main() {
  const browser = await chromium.launch();
  const errors = [];

  try {
    console.log('\nreconnect after reload');

    const ctx = await browser.newContext({ viewport: { width: 430, height: 900 } });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => {
      if (!isHeadlessGlNoise(e)) errors.push(String(e));
    });

    const clueOf = async () =>
      ((await page.locator('[data-testid="clue"]').first().textContent().catch(() => '')) ?? '').trim();

    await gotoReady(page, `${BASE}/lobby`);
    await page.locator('input[aria-label="Your name"]').fill('Ava');
    await page.locator('button:has-text("Create room")').click();
    await page.waitForSelector('h1.mono', { timeout: 30_000 });
    await page.locator('button:has-text("Start hunt")').click();
    await page.waitForURL(/\/race/, { timeout: 30_000 });

    // The first clue arrives by targeted message; give the server a beat.
    await page.waitForTimeout(5000);
    const before = await clueOf();
    check('in a race with a clue', before.length > 0, before.slice(0, 40));

    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(7000);
    const after = await clueOf();
    const body = await page.locator('body').innerText();

    check('reload does not strand the player', !/Not in a room/i.test(body));
    check('the same seat and clue come back', before !== '' && before === after, after.slice(0, 40));
    await page.screenshot({ path: resolve(SHOT_DIR, '11-after-reload.png') });

    // Walking out on purpose is not a dropped connection.
    await page.locator('button:has-text("Leave")').click();
    await page.waitForTimeout(400);
    await page.locator('button:has-text("Leave the race?")').click();
    await page.waitForTimeout(1500);
    await gotoReady(page, `${BASE}/race`);
    await page.waitForTimeout(5000);
    const afterLeave = await page.locator('body').innerText();
    check('a deliberate exit stays exited', /Not in a room/i.test(afterLeave));

    // ------------------------------------------------------ the host leaves
    /**
     * A closed laptop must not end everyone else's game.
     *
     * The host is just a player with a start button — nothing about the room
     * depends on them staying — but that had never been demonstrated, and it
     * is a realistic way for a demo to go wrong. The second half matters too:
     * the server has always tracked `connected` and the client has always
     * carried it, and until now nothing rendered it, so a rival who walked
     * away sat frozen at "0/5" and read as merely slow.
     */
    console.log('\nthe host leaves mid-race');

    const mk = async () => {
      const c = await browser.newContext({ viewport: { width: 430, height: 900 } });
      const pg = await c.newPage();
      pg.on('pageerror', (e) => {
        if (!isHeadlessGlNoise(e)) errors.push(String(e));
      });
      return pg;
    };

    const host = await mk();
    await gotoReady(host, `${BASE}/lobby`);
    await host.locator('input[aria-label="Your name"]').fill('Ava');
    await host.locator('button:has-text("Create room")').click();
    await host.waitForSelector('h1.mono', { timeout: 40_000 });
    const roomCode = (await host.locator('h1.mono').first().textContent())?.trim() ?? '';

    const guest = await mk();
    await gotoReady(guest, `${BASE}/lobby?code=${roomCode}`);
    await guest.locator('input[aria-label="Your name"]').fill('Ben');
    await guest.locator('button:has-text("Join room")').click();
    await guest.waitForSelector('text=/Waiting for the host/i', { timeout: 40_000 });
    await host.waitForTimeout(1200);
    await host.locator('button:has-text("Start hunt")').click();
    await Promise.all([
      host.waitForURL(/\/race/, { timeout: 40_000 }),
      guest.waitForURL(/\/race/, { timeout: 40_000 }),
    ]);
    await guest.waitForTimeout(5000);

    const clueBefore = ((await guest.locator('[data-testid="clue"]').first().textContent().catch(() => '')) ?? '').trim();
    check('the guest is racing', clueBefore.length > 0, clueBefore.slice(0, 32));

    await host.context().close();

    let offline = false;
    for (let i = 0; i < 5 && !offline; i++) {
      await guest.waitForTimeout(5000);
      offline = /offline/i.test(await guest.locator('body').innerText());
    }
    const afterHost = await guest.locator('body').innerText();

    check('the guest is not thrown out with the host', !/Not in a room/i.test(afterHost));
    check('the guest can still play', /Walk there|Use demo location|Submit|You.re here/i.test(afterHost));
    check('the departed rival is shown as offline, not merely slow', offline);

    check('no page errors', errors.length === 0, errors[0] ?? '');
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
  console.log('\n✓ a reload returns to the same seat; leaving means leaving');
}

await main();
