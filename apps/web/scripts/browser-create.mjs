/**
 * Generating a hunt for a real city, through the UI.
 *
 * "Create a hunt anywhere" is the product's whole claim and the only major
 * flow with no suite. It is also the flow most exposed to the outside world —
 * Nominatim, Overpass and Gemini all have to answer — so this asserts what
 * must be true regardless of what they say, not what a good day looks like.
 *
 * The distinction matters. Content quality depends on a Gemini quota this
 * project does not control: on a healthy key every clue is written prose, and
 * on an exhausted one they come back as labelled "[DRAFT] Find <name>"
 * placeholders. BOTH are acceptable outcomes. What is never acceptable is the
 * page presenting placeholders as though they were finished writing — so the
 * assertion is "if it degraded, it said so", which holds either way.
 *
 *   pnpm --filter @ww/web check:create
 */

import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gotoReady, clickAndExpect, isHeadlessGlNoise } from './lib/hydrated.mjs';

const BASE = process.env.WEB_URL ?? 'http://localhost:3000';
/** Deliberately not Pittsburgh: the seeded city could pass from cache. */
const CITY = process.env.CREATE_CITY ?? 'Savannah, Georgia';

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
    console.log(`\n/create — ${CITY}`);
    const page = await browser.newPage({ viewport: { width: 430, height: 900 } });
    page.on('pageerror', (e) => {
      if (!isHeadlessGlNoise(e)) errors.push(String(e));
    });

    await gotoReady(page, `${BASE}/create`);
    await page.locator('input.field').first().fill(CITY);

    /**
     * Confirm the build STARTED before waiting four minutes for it to finish.
     *
     * /create is a heavy page and this click can land before React has
     * attached its handler, in which case nothing happens and the run then
     * blames the generator for a timeout it never caused. The staged progress
     * text can only appear because the click landed.
     */
    const started = await clickAndExpect(
      page,
      'button:has-text("Build the hunt")',
      'text=/finding landmarks|matching them to routes|writing clues/i',
    );
    check('the build starts when asked', started);

    // Geocode + Overpass + one model call per stop. Slow, and allowed to be.
    const built =
      started &&
      (await page
        .waitForSelector('text=/Publish this hunt/i', { timeout: 240_000 })
        .then(() => true)
        .catch(() => false));
    check('a hunt is built from a city name', built);
    if (!built) throw new Error('generation did not finish');

    const body = await page.locator('body').innerText();

    check('the city it resolved is shown', new RegExp(CITY.split(',')[0], 'i').test(body), CITY.split(',')[0]);
    check('it reports how many landmarks it found', /\d+\s*landmarks? found/i.test(body),
      (body.match(/\d+\s*landmarks? found/i) ?? [''])[0]);
    check('every route is listed with its length', (body.match(/\d+\s*stops?\s*·\s*\d+m/gi) ?? []).length >= 2,
      (body.match(/\d+\s*stops?\s*·\s*\d+m/gi) ?? []).slice(0, 3).join(', '));
    check('a shared start and finish are named', /START/i.test(body) && /FINISH/i.test(body));

    /**
     * The honesty assertion, and the reason this suite exists.
     *
     * Placeholder clues are a legitimate degraded state. Silent ones are not.
     */
    const hasDrafts = /\[DRAFT\]/i.test(body);
    const admits =
      /review before publishing/i.test(body) ||
      /placeholder/i.test(body) ||
      /wasn't confident/i.test(body) ||
      /rate.?limited/i.test(body);
    check(
      hasDrafts ? 'placeholder clues are declared, not hidden' : 'finished clues, and the draft state is still flagged',
      admits,
      hasDrafts ? 'degraded, and says so' : 'clean run',
    );

    /**
     * Same shape as the draft assertion: a hunt containing somewhere people
     * should not be sent is a legitimate thing for an older or unfiltered
     * server to return — silently rendering it as a normal stop is not.
     */
    const names = await page.$$eval('body', () => {
      const t = document.body.innerText;
      return /police|sheriff|customs|border protection|immigration|correctional|prison|military|embassy|consulate|hospital|school/i.test(t);
    });
    if (names) {
      check(
        'an unsuitable stop is called out, not rendered as normal',
        /Do not send people here/i.test(body),
        'flagged',
      );
    } else {
      check('no unsuitable stops to call out', true, 'clean');
    }

    // Nothing is published without a person choosing to.
    check('publishing is a deliberate act', /Publish this hunt/i.test(body));
    check('you can walk it before publishing', /Play it now, solo/i.test(body));

    check('no page errors', errors.length === 0, errors[0] ?? '');
    await page.screenshot({ path: resolve(SHOT_DIR, '14-create.png'), fullPage: true });
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
  console.log('\n✓ a hunt can be built for a city it has never seen');
}

await main();
