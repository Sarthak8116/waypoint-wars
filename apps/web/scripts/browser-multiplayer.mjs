/**
 * Two real browsers playing each other, through the actual UI.
 *
 * The server e2e suites prove the PROTOCOL. They say nothing about the React
 * client: the lobby, the QR/code join, `useHuntRoom`'s message handling, the
 * race screen, or the RoomProvider that keeps the socket alive across
 * navigation. Solo's client turned out to be catastrophically broken while
 * looking perfect, so this half deserves the same scrutiny.
 *
 *   pnpm --filter @ww/web check:multiplayer   (web :3000, server :2567)
 */

import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = process.env.WEB_URL ?? 'http://localhost:3000';
const API = process.env.API_URL ?? 'http://localhost:2567';

const here = dirname(fileURLToPath(import.meta.url));
const SHOT_DIR = resolve(here, '../../..', '.screenshots');
mkdirSync(SHOT_DIR, { recursive: true });

const PHOTO_PATH = resolve(SHOT_DIR, 'submission.jpg');
writeFileSync(
  PHOTO_PATH,
  Buffer.from(
    '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==',
    'base64',
  ),
);

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? '✓' : '✖'} ${name}${detail ? ` — ${detail}` : ''}`);
  return ok;
};

async function newPlayer(browser, label) {
  const context = await browser.newContext({
    viewport: { width: 430, height: 900 },
    permissions: ['geolocation'],
    geolocation: { latitude: 40.4406, longitude: -80.0045 },
  });
  const errors = [];
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(`${label} pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/favicon|openstreetmap/i.test(m.text())) {
      errors.push(`${label} console: ${m.text().slice(0, 130)}`);
    }
  });
  return { page, context, errors, label };
}

/**
 * The clue text, specifically — not whatever happens to be on screen.
 * A naive body-text fallback grabbed the OpenStreetMap attribution and made
 * two different clues compare equal, which would have passed a meaningless
 * assertion.
 */
async function currentClue(page) {
  // A stable hook, not visible copy. Matching on the label text broke twice
  // during redesigns and each time looked like a product regression.
  const clue = page.locator('[data-testid="clue"]').first();
  if (await clue.count()) {
    const text = (await clue.textContent().catch(() => null))?.trim() ?? '';
    if (text) return text;
  }
  // Arrived screens show the observation question instead of the clue.
  const q = await page.locator('h3').first().textContent().catch(() => null);
  return (q ?? '').trim();
}

async function main() {
  console.log('\nMultiplayer through two real browsers\n' + '─'.repeat(64));

  const content = await fetch(`${BASE}/hunts/pittsburgh.json`).then((r) => r.json());
  const byQuestion = new Map(content.checkpoints.map((c) => [c.observationQuestion, c]));

  const health = await fetch(`${API}/health`).then((r) => r.json()).catch(() => null);
  console.log(`  server: ${health ? `gemini=${health.integrations.gemini}` : 'UNREACHABLE'}`);
  if (!health) process.exit(1);

  const browser = await chromium.launch();
  const host = await newPlayer(browser, 'host');
  const guest = await newPlayer(browser, 'guest');

  try {
    // --- host creates a room --------------------------------------------
    await host.page.goto(`${BASE}/lobby`, { waitUntil: 'networkidle', timeout: 30_000 });
    await host.page.locator('input[placeholder="Your name"]').fill('Ada');
    await host.page.locator('button:has-text("Create room")').click();

    // The room code IS the display heading — six mono characters, no prefix.
    const codeShown = await host.page
      .waitForSelector('h1.mono', { timeout: 20_000 })
      .then(() => true)
      .catch(() => false);
    check('host created a room', codeShown);

    const heading = (await host.page.locator('h1.mono').first().textContent()) ?? '';
    const code = heading.trim().match(/^[A-Z0-9]{6}$/)?.[0] ?? '';
    check('a six-character code is displayed', code.length === 6, code);

    const qr = await host.page.locator('img[alt*="QR"]').count();
    check('QR code rendered', qr > 0);
    await host.page.screenshot({ path: resolve(SHOT_DIR, '8-lobby-qr.png') });

    // --- guest joins by typing the code ----------------------------------
    await guest.page.goto(`${BASE}/lobby`, { waitUntil: 'networkidle', timeout: 30_000 });
    await guest.page.locator('input[placeholder="Your name"]').fill('Bram');
    await guest.page.locator('input[placeholder="ABC234"]').fill(code);
    await guest.page.locator('button:has-text("Join room")').click();

    const joined = await guest.page
      .waitForSelector(`text=${code}`, { timeout: 20_000 })
      .then(() => true)
      .catch(() => false);
    check('guest joined with the code', joined);

    // --- host starts; BOTH must navigate to /race ------------------------
    await host.page.locator('button:has-text("Start hunt")').click();

    const hostRaced = await host.page
      .waitForURL('**/race', { timeout: 20_000 })
      .then(() => true)
      .catch(() => false);
    const guestRaced = await guest.page
      .waitForURL('**/race', { timeout: 20_000 })
      .then(() => true)
      .catch(() => false);

    check('host moved to the race screen', hostRaced);
    // The guest never clicks anything — this is driven by the server message.
    check('guest moved to the race screen too', guestRaced);

    await host.page.waitForTimeout(2500);
    await guest.page.waitForTimeout(500);

    // The socket must have survived the route change (RoomProvider).
    const hostStuck = await host.page.locator('text=/Not in a room/i').count();
    const guestStuck = await guest.page.locator('text=/Not in a room/i').count();
    check('host kept its connection across navigation', hostStuck === 0);
    check('guest kept its connection across navigation', guestStuck === 0);

    const hostPrompt = await currentClue(host.page);
    const guestPrompt = await currentClue(guest.page);
    check('host received a clue', hostPrompt.length > 0, hostPrompt.slice(0, 40));
    check('guest received a clue', guestPrompt.length > 0, guestPrompt.slice(0, 40));
    check(
      'the two players got DIFFERENT clues',
      hostPrompt !== guestPrompt,
      `${hostPrompt.slice(0, 24)} vs ${guestPrompt.slice(0, 24)}`,
    );

    await host.page.screenshot({ path: resolve(SHOT_DIR, '9-race-host.png') });

    // --- host solves one checkpoint through the UI -----------------------
    // The race screen defaults to REAL GPS, so simulated walking has to be
    // switched on first; only then does the "Walk there" control appear.
    const demoBtn = host.page.locator('button:has-text("Use demo location")');
    if (await demoBtn.count()) {
      await demoBtn.click();
      await host.page.waitForTimeout(800);
    }
    const walk = host.page.locator('button:has-text("Walk there")');
    check('Demo Mode offers a walk control on the race screen', (await walk.count()) > 0);
    if (await walk.count()) await walk.click();

    const arrived = await host.page
      .waitForSelector("text=/You're here/i", { timeout: 60_000 })
      .then(() => true)
      .catch(() => false);
    check('host arrived at its checkpoint', arrived);

    if (arrived) {
      // The client deliberately waits for a location fix to land server-side
      // before asking (the geofence is what authorises the instruction), so
      // this is not instantaneous. Wait for it rather than sampling too early.
      const gotInstruction = await host.page
        .waitForSelector('text=/REQUIRED IN THIS PHOTO/i', { timeout: 15_000 })
        .then(() => true)
        .catch(() => false);
      check('server-issued instruction shown on arrival', gotInstruction);

      const q = (await host.page.locator('h3').first().textContent()) ?? '';
      const answer = byQuestion.get(q.trim())?.acceptedAnswers?.[0] ?? '';

      await host.page.setInputFiles('input[type="file"]', PHOTO_PATH);
      await host.page.waitForTimeout(800);
      await host.page.locator('input[placeholder="Your answer"]').fill(answer);
      await host.page.locator('button:has-text("Submit")').click();
      await host.page.waitForTimeout(4000);

      // Progress must have moved on the SERVER, so the guest sees it.
      const guestSeesOpponent = await guest.page
        .locator('text=/Ada/')
        .count()
        .catch(() => 0);
      check('guest can see the opponent on their screen', guestSeesOpponent > 0);

      const bodyHost = await host.page.locator('body').innerText();
      const advanced = /Checkpoint 2 of|You're here/i.test(bodyHost);
      check('host advanced past the first checkpoint', advanced, bodyHost.slice(0, 60).replace(/\n/g, ' | '));
    }

    const allErrors = [...host.errors, ...guest.errors];
    check('no page errors in either browser', allErrors.length === 0, allErrors.slice(0, 2).join(' ; '));
  } finally {
    await browser.close();
  }

  console.log('\n' + '─'.repeat(64));
  const failed = results.filter((r) => !r.ok);
  console.log(`${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) {
    console.log('\nFAILED:');
    for (const f of failed) console.log(`  · ${f.name}${f.detail ? ` (${f.detail})` : ''}`);
    process.exit(1);
  }
  console.log('\n✓ two browsers can play each other\n');
}

main().catch((err) => {
  console.error('\n✖ multiplayer browser check crashed:', err?.message ?? err);
  process.exit(1);
});
