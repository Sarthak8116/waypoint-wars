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
    page.on('pageerror', (e) => errors.push(String(e)));

    const clueOf = async () =>
      ((await page.locator('[data-testid="clue"]').first().textContent().catch(() => '')) ?? '').trim();

    await page.goto(`${BASE}/lobby`, { waitUntil: 'domcontentloaded' });
    await page.locator('input[aria-label="Your name"]').fill('Ava');
    await page.locator('button:has-text("Create room")').click();
    await page.waitForSelector('h1.mono', { timeout: 30_000 });
    await page.locator('button:has-text("Start hunt")').click();
    await page.waitForURL(/\/race/, { timeout: 30_000 });

    // The first clue arrives by targeted message; give the server a beat.
    await page.waitForTimeout(5000);
    const before = await clueOf();
    check('in a race with a clue', before.length > 0, before.slice(0, 40));

    await page.reload({ waitUntil: 'domcontentloaded' });
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
    await page.goto(`${BASE}/race`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(5000);
    const afterLeave = await page.locator('body').innerText();
    check('a deliberate exit stays exited', /Not in a room/i.test(afterLeave));

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
