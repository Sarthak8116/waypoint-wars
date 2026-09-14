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
import { gotoReady } from './lib/hydrated.mjs';
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


/** Force a "we could not check it" verdict, then a good one, and compare XP. */
async function heldVerdictCostsNothing(browser) {
  console.log('\na verifier outage');
  const context = await browser.newContext({ viewport: { width: 430, height: 900 } });
  const page = await context.newPage();

  const verification = {
    landmarkMatch: false,
    requiredActionCompleted: false,
    answerCorrect: false,
    confidence: 0,
    reason: 'The verification provider failed to return a judgement.',
    mocked: false,
  };
  const zeroed = {
    checkpointCompletion: 0, correctObservation: 0, speedBonus: 0, noHintBonus: 0,
    hiddenDetailBonus: 0, incorrectPenalty: 0, hintPenalty: 0, routeCompletionBonus: 0, total: 0,
  };

  let call = 0;
  await page.route('**/api/verify', async (route) => {
    call += 1;
    const held = {
      outcome: 'needs-review', verification, withinRadius: true, distanceMeters: 5,
      xpDelta: 0, xpBreakdown: zeroed,
      message: "We couldn't check that photo just now — nothing was counted against you.",
    };
    const approved = {
      ...held,
      outcome: 'approved',
      verification: {
        ...verification, landmarkMatch: true, requiredActionCompleted: true,
        answerCorrect: true, confidence: 0.9, reason: 'Looks right.',
      },
    };
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(call === 1 ? held : approved),
    });
  });

  await gotoReady(page, `${BASE}/play?demo=1`);
  await page.waitForSelector('button:has-text("Start hunt")', { timeout: 40_000 });
  await page.locator('button:has-text("Start hunt")').click();
  await page.locator('button:has-text("Walk there")').click();
  await page.waitForSelector("text=/You're here/i", { timeout: 90_000 });

  const question = ((await page.locator('h3').first().textContent()) ?? '').trim();
  const answer = await page.evaluate(async (q) => {
    const r = await fetch('/hunts/pittsburgh.json').then((x) => x.json());
    const cps = Array.isArray(r.checkpoints) ? r.checkpoints : Object.values(r.checkpoints ?? {});
    return cps.find((c) => c.observationQuestion === q)?.acceptedAnswers?.[0] ?? null;
  }, question);

  await page.setInputFiles('input[type="file"]', PHOTO_PATH).catch(() => {});
  await page.waitForTimeout(1000);
  await page.locator('input[placeholder="Your answer"]').fill(answer ?? '');
  await page.locator('button:has-text("Submit")').first().click();
  await page.waitForTimeout(3500);

  const heldBody = await page.locator('body').innerText();
  check(
    'an outage is held, not rejected',
    /Not sure yet/i.test(heldBody) && !/Not accepted/i.test(heldBody),
  );
  check('and says nothing was charged', /nothing charged/i.test(heldBody));

  await page.setInputFiles('input[type="file"]', PHOTO_PATH).catch(() => {});
  await page.waitForTimeout(900);
  await page.locator('button:has-text("Submit")').first().click();
  await page.waitForSelector('text=/photo not verified|Verified|simulated/i', { timeout: 60_000 });
  await page.waitForTimeout(1000);

  const doneBody = await page.locator('body').innerText();
  const xp = Number((doneBody.match(/\+(\d+)\s*XP/) ?? [0, 0])[1]);
  check('the retry scores as though nothing went wrong', xp === 225, `${xp} XP`);
  check('no wrong-answer penalty in the breakdown', !/Wrong answers/i.test(doneBody));

  await context.close();
}

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
    // ?demo=1 skips the location gate; gotoReady waits for hydration.
    await gotoReady(page, `${BASE}/play?demo=1`);
    await page.waitForSelector('button:has-text("Start hunt")', { timeout: 20_000 });

    // Demo Mode, because that is the path the actual demo uses.
    await page.locator('button:has-text("Demo Mode")').click();
    await page.locator('button:has-text("Start hunt")').click();
    await page.waitForTimeout(1500);

    // Progress moved out of a per-sheet "CLUE 1 OF 5" label and into the
    // always-visible strip. This suite exits 2 against a live Gemini key, so
    // nobody had run it since the redesign and it had been stale ever since.
    check('hunt started', (await page.locator('text=/Checkpoint 1 of/i').count()) > 0);

    const totalText = (await page.locator('text=/Checkpoint 1 of/i').first().textContent()) ?? '';
    const total = Number(totalText.match(/of\s+(\d+)/i)?.[1] ?? 0);
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

        /**
         * This suite only runs against a server with no GEMINI_API_KEY, so
         * every verdict here comes from the labelled mock. A mock that
         * approves a photo it never looked at must not be reported as
         * "Verified" — that is the silent degradation this project's rules
         * exist to prevent, and it was doing exactly that under a lime hero.
         */
        const claimsVerified = /(^|\n)\s*VERIFIED\s*(\n|$)/i.test(body);
        check('a simulated check is not called verification', !claimsVerified);
        check('and says what it actually was', /simulated|not verified/i.test(body));
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
      /**
       * The finish hero is a bare number with "TOTAL XP" beneath it, so the
       * old `text=/ XP$/` matched the LABEL and parsed to zero — a full,
       * correct 1250-point run reported as 0 XP. Read the whole screen and
       * take the number that precedes the label.
       */
      const finishText = await page.locator('body').innerText();
      const xp = Number(
        (finishText.match(/(\d[\d,]*)\s*\n?\s*total xp/i) ??
          finishText.match(/(\d[\d,]*)\s*XP/i) ??
          [])[1]?.replace(/,/g, '') ?? 0,
      );
      check('final XP is greater than zero', xp > 0, `${xp} XP`);
      await page.screenshot({ path: resolve(SHOT_DIR, '7-solo-complete.png') });
    }

    check('no page errors during the whole run', errors.length === 0, errors.slice(0, 2).join(' ; '));

    /**
     * A verifier outage must cost the player nothing.
     *
     * The one case that cannot be provoked honestly — it needs a rate limit or
     * a timeout — so the verify call is intercepted. Everything else is the
     * real app: real state machine, real scoring, real screens.
     *
     * The proof is the XP on the retry. A clean first-time solve scores 225;
     * if the held submission had been treated as a rejection the retry would
     * score 210, because VERIFICATION_FAILED records an attempt worth -15.
     * "> 0" would pass on the broken build, so the exact figure is asserted.
     */
    await heldVerdictCostsNothing(browser);
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
