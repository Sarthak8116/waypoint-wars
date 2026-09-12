/**
 * A COMPLETE solo hunt, driven in a real browser.
 *
 * Solo is the simplest demo path and the least verified: it is a React hook,
 * so none of the server-side e2e suites touch it. Every step below has been
 * checked in isolation and never in sequence — arrival detection, the
 * randomized instruction, the camera input, verification, the reveal, and the
 * advance to the next clue.
 *
 * The photo is injected straight into the file input, which is exactly what
 * `<input type="file" capture="environment">` receives from a phone camera.
 *
 *   pnpm --filter @ww/web check:solo     (web on :3000, server on :2567)
 */

import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = process.env.WEB_URL ?? 'http://localhost:3000';
const API = process.env.API_URL ?? 'http://localhost:2567';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../..');
const SHOT_DIR = resolve(repoRoot, '.screenshots');
mkdirSync(SHOT_DIR, { recursive: true });

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? '✓' : '✖'} ${name}${detail ? ` — ${detail}` : ''}`);
  return ok;
};

/** A real 1x1 JPEG on disk — what the file input actually receives. */
const JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==',
  'base64',
);
const PHOTO_PATH = resolve(SHOT_DIR, 'submission.jpg');
writeFileSync(PHOTO_PATH, JPEG);

async function main() {
  console.log('\nSolo hunt, complete, in a browser\n' + '─'.repeat(64));

  // The harness needs the answers; the page is never sent them.
  const content = await fetch(`${BASE}/hunts/pittsburgh.json`).then((r) => r.json());
  const byId = new Map(content.checkpoints.map((c) => [c.id, c]));

  const health = await fetch(`${API}/health`).then((r) => r.json()).catch(() => null);
  console.log(`  server: ${health ? `gemini=${health.integrations.gemini}` : 'UNREACHABLE'}`);

  // This harness submits a 1x1 blank JPEG. The MOCK provider approves on a
  // correct answer; LIVE Gemini looks at pixels and rightly refuses — which is
  // the feature working, not a failure. Boot the server with GEMINI_API_KEY=
  // empty to run this suite.
  if (health?.integrations?.gemini === 'live') {
    console.log('\n  ⚠ Gemini is LIVE. A blank test photo cannot pass real verification.');
    console.log('    Boot the server with `GEMINI_API_KEY= npx tsx src/index.ts` and re-run.');
    console.log('    (Rejection with a live model is verified separately — see');
    console.log('     .screenshots/12-live-rejection.png.)\n');
    process.exit(2);
  }

  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 430, height: 900 },
    permissions: ['geolocation'],
    geolocation: { latitude: 40.4406, longitude: -80.0045 },
  });

  const errors = [];
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/favicon|openstreetmap/i.test(m.text())) {
      errors.push(`console: ${m.text().slice(0, 140)}`);
    }
  });

  try {
    await page.goto(`${BASE}/play`, { waitUntil: 'networkidle', timeout: 30_000 });
    await page.waitForSelector('button:has-text("Start hunt")', { timeout: 20_000 });

    // Demo Mode, because that is the path the actual demo uses.
    await page.locator('button:has-text("Demo Mode")').click();
    await page.locator('button:has-text("Start hunt")').click();
    await page.waitForTimeout(1500);

    check('hunt started', (await page.locator('text=/CLUE 1 OF/i').count()) > 0);

    const totalText = (await page.locator('text=/CLUE 1 OF/i').first().textContent()) ?? '';
    const total = Number(totalText.match(/OF\s+(\d+)/i)?.[1] ?? 0);
    check('a route with checkpoints was assigned', total > 0, `${total} stops`);

    let solved = 0;

    for (let step = 0; step < total; step++) {
      // Walk. Demo Mode moves at 25x, so this is seconds, not minutes.
      const walk = page.locator('button:has-text("Walk there")');
      if (await walk.count()) await walk.click();

      // Wait for arrival — the challenge panel replaces the clue panel.
      await page
        .waitForSelector("text=/You're here/i", { timeout: 45_000 })
        .catch(() => {});

      const arrived = (await page.locator("text=/You're here/i").count()) > 0;
      if (!arrived) {
        check(`step ${step + 1}: arrived at the checkpoint`, false, 'never entered the radius');
        break;
      }

      // The randomized instruction must appear ON ARRIVAL, not before.
      if (step === 0) {
        const instr = await page.locator('text=/REQUIRED IN THIS PHOTO/i').count();
        check('randomized instruction appears on arrival', instr > 0);
        await page.screenshot({ path: resolve(SHOT_DIR, '5-solo-challenge.png') });
      }

      // Which checkpoint is this? Read the question, match it to content.
      const question = (await page.locator('h3').first().textContent()) ?? '';
      const match = [...byId.values()].find((c) => c.observationQuestion === question.trim());
      const answer = match?.acceptedAnswers?.[0] ?? '';

      // Submit the photo the way a phone would.
      await page.setInputFiles('input[type="file"]', PHOTO_PATH);
      await page.waitForTimeout(900);
      await page.locator('input[placeholder="Your answer"]').fill(answer);
      await page.locator('button:has-text("Submit")').click();

      // Approved -> the reveal panel offers "Next clue".
      const ok = await page
        .waitForSelector('button:has-text("Next clue")', { timeout: 60_000 })
        .then(() => true)
        .catch(() => false);

      if (!ok) {
        const msg = (await page.locator('body').textContent()) ?? '';
        const rejected = /not what we're looking for|did not match/i.test(msg);
        check(
          `step ${step + 1}: submission approved`,
          false,
          rejected ? 'rejected' : 'no verdict returned',
        );
        break;
      }

      if (step === 0) {
        // The reveal flips the whole surface to the light register: a
        // full-bleed accent hero with the XP, then the history in ink.
        const heroXp = await page.locator('text=/^\\+\\d+ XP$/').count();
        const body = await page.locator('body').innerText();
        const hasHistory = body.length > 400;
        check('the historical reveal is shown after approval', heroXp > 0 && hasHistory);
        await page.screenshot({ path: resolve(SHOT_DIR, '6-solo-reveal.png') });
      }

      solved += 1;
      await page.locator('button:has-text("Next clue")').click();
      await page.waitForTimeout(800);
    }

    check('every checkpoint solved', solved === total, `${solved}/${total}`);

    const finished = await page
      .waitForSelector('text=/Hunt complete/i', { timeout: 20_000 })
      .then(() => true)
      .catch(() => false);

    if (!finished) {
      // Say WHAT is on screen instead, or this failure is unactionable.
      const visible = (await page.locator('body').innerText()).replace(/\n+/g, ' | ').slice(0, 260);
      await page.screenshot({ path: resolve(SHOT_DIR, 'debug-solo-stuck.png') });
      console.log(`      on screen instead: ${visible}`);
    }
    check('hunt reached the completion screen', finished);

    if (finished) {
      const xpText = (await page.locator('text=/ XP$/').first().textContent()) ?? '';
      const xp = Number(xpText.replace(/[^\d]/g, ''));
      check('final XP is greater than zero', xp > 0, `${xp} XP`);
      await page.screenshot({ path: resolve(SHOT_DIR, '7-solo-complete.png') });
    }

    check('no page errors during the whole run', errors.length === 0, errors.slice(0, 2).join(' ; '));
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
  console.log('\n✓ a full solo hunt plays through in a browser\n');
}

main().catch((err) => {
  console.error('\n✖ solo run crashed:', err?.message ?? err);
  process.exit(1);
});
