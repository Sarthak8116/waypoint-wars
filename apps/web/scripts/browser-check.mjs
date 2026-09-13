/**
 * Browser smoke check — does the app actually RENDER?
 *
 * Every other check in this repo is an HTTP status code or a unit test. None
 * of them can see a blank page. That gap is not theoretical: `import Phaser
 * from 'phaser'` typechecked, passed 53 tests, built clean, and resolved to
 * `undefined` at runtime — the HUD would simply never have appeared on stage.
 *
 * This drives a real headless Chromium and asserts the things a screenshot
 * would show you:
 *   - the MapLibre canvas exists and has non-zero size
 *   - the Phaser canvas mounts on top of it
 *   - the curated content reached the page (not the labeled placeholder)
 *   - no uncaught exceptions or failed requests
 *
 *   pnpm --filter @ww/web check:browser        (web must be running on :3000)
 */

import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Screenshots land here so a human can actually look at the thing. */
const SHOT_DIR = process.env.SHOT_DIR ?? resolve(dirname(fileURLToPath(import.meta.url)), '../../../.screenshots');
mkdirSync(SHOT_DIR, { recursive: true });
const shot = async (page, name) => {
  const file = resolve(SHOT_DIR, `${name}.png`);
  await page.screenshot({ path: file });
  console.log(`      saved ${file}`);
};

const BASE = process.env.WEB_URL ?? 'http://localhost:3000';

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? '✓' : '✖'} ${name}${detail ? ` — ${detail}` : ''}`);
  return ok;
};

/** Console errors we do not control and that do not affect the demo. */
const IGNORABLE = [
  /favicon/i,
  /net::ERR_INTERNET_DISCONNECTED/i,
  // OSM tiles are third-party; a throttled tile is not an app failure.
  /tile\.openstreetmap\.org/i,
  /Failed to load resource.*openstreetmap/i,
];

async function openPage(browser, path, { geolocation = true, width = 430 } = {}) {
  const context = await browser.newContext({
    // Phone-sized: this is a mobile app. Width is overridable so the overflow
    // sweep can check narrow devices without a second helper.
    viewport: { width, height: 900 },
    ...(geolocation
      ? {
          permissions: ['geolocation'],
          geolocation: { latitude: 40.4406, longitude: -80.0045 },
        }
      : {}),
  });

  const errors = [];
  const page = await context.newPage();
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  page.on('console', (msg) => {
    if (msg.type() === 'error' && !IGNORABLE.some((re) => re.test(msg.text()))) {
      errors.push(`console: ${msg.text().slice(0, 160)}`);
    }
  });

  await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle', timeout: 30_000 });
  return { page, context, errors };
}

/** Wait for a canvas with real pixel dimensions, not just a DOM node. */
async function canvasCount(page, timeoutMs = 15_000) {
  try {
    await page.waitForFunction(
      () => document.querySelectorAll('canvas').length > 0,
      undefined,
      { timeout: timeoutMs },
    );
  } catch {
    /* fall through — the assertion below reports it */
  }
  return page.evaluate(() =>
    [...document.querySelectorAll('canvas')].map((c) => ({
      w: c.width,
      h: c.height,
      cls: c.className || '(none)',
    })),
  );
}

async function main() {
  console.log('\nBrowser render check (headless Chromium)\n' + '─'.repeat(64));

  const browser = await chromium.launch();

  try {
    // --- no page may scroll horizontally at phone width -------------------
    // A grid item defaults to min-width:auto and refuses to shrink below its
    // content; the creator overflowed by 30px that way. Invisible to every
    // other check in this repo.
    // 430px is a large phone. 320px is an iPhone SE, and the narrowest width
    // worth supporting — a layout that survives 430 can still break there, and
    // a judge handed a phone is not going to rotate it to make the app work.
    for (const width of [430, 360, 320]) {
      console.log(`\nhorizontal overflow @${width}px`);
      for (const path of ['/', '/play?demo=1', '/demo', '/lobby', '/create', '/creator']) {
        const { page, context } = await openPage(browser, path, { width });
        await page.waitForTimeout(1200);
        const o = await page.evaluate(() => ({
          scroll: document.body.scrollWidth,
          view: window.innerWidth,
        }));
        check(
          `${path} does not scroll sideways @${width}`,
          o.scroll <= o.view + 1,
          `${o.scroll} vs ${o.view}`,
        );
        await context.close();
      }
    }

    // --- home ------------------------------------------------------------
    console.log('\n/');
    {
      const { page, context, errors } = await openPage(browser, '/');
      const title = await page.title();
      check('home renders', (await page.locator('h1').count()) > 0, title);
      // The landing page leads with what a PLAYER can do. Diagnostics moved
      // behind a toggle, so assert the CTAs first and the pills second.
      check(
        'join-a-hunt CTA present',
        (await page.locator('button:has-text("Join a hunt")').count()) > 0,
      );
      check(
        'one-click demo CTA present',
        (await page.locator('a:has-text("Start Pittsburgh demo")').count()) > 0,
      );

      /**
       * The join box is the landing page's primary call to action and had no
       * coverage at all. It must reach the lobby WITH the code carried over —
       * a player who retypes their code because the box was decorative has
       * already had a worse first thirty seconds than they needed to.
       */
      await page.locator('input[aria-label="Room code"]').fill('ABC234');
      await page.locator('button:has-text("Join a hunt")').click();
      await page.waitForURL(/\/lobby/, { timeout: 15_000 }).catch(() => {});
      check('join box reaches the lobby', /\/lobby/.test(page.url()), page.url());
      const carried = await page
        .locator('input[aria-label="Room code"]')
        .inputValue()
        .catch(() => '');
      check('the code is carried over, not retyped', carried === 'ABC234', carried);
      await page.goBack({ waitUntil: 'domcontentloaded' });
      await page.locator('button:has-text("Status")').click().catch(() => {});
      await page.waitForTimeout(1500);
      const badges = await page.locator('.pill').allTextContents();
      check('integration pills rendered behind Status', badges.length > 0, badges.join(' · ').slice(0, 80));
      check('no page errors', errors.length === 0, errors[0] ?? '');
      await shot(page, '1-home');
      await context.close();
    }

    // --- the pitch page --------------------------------------------------
    console.log('\n/demo');
    {
      const { page, context, errors } = await openPage(browser, '/demo');
      const canvases = await canvasCount(page);
      check('map canvas mounted', canvases.length > 0, `${canvases.length} canvas element(s)`);
      const sized = canvases.filter((c) => c.w > 0 && c.h > 0);
      check('canvas has real pixel dimensions', sized.length > 0, sized.map((c) => `${c.w}x${c.h}`).join(', '));

      const banner = await page.locator('text=/Demo Mode/i').count();
      check('Demo Mode is visibly labeled', banner > 0);

      const placeholder = await page.locator('text=/Placeholder content/i').count();
      check('serving CURATED content, not the placeholder', placeholder === 0);

      check('no page errors', errors.length === 0, errors[0] ?? '');
      await shot(page, '2-demo-replay');
      await context.close();
    }

    // --- the solo hunt: map + PHASER -------------------------------------
    console.log('\n/play?demo=1');
    {
      const { page, context, errors } = await openPage(browser, '/play?demo=1');

      // The route is picked at random, so wait for whichever route label lands.
      await page.waitForSelector('button:has-text("Start hunt")', { timeout: 20_000 }).catch(() => {});
      check('solo start screen rendered', (await page.locator('button:has-text("Start hunt")').count()) > 0);

      const before = await canvasCount(page);
      check('map canvas mounted', before.length > 0, `${before.length} canvas`);

      // Start the hunt in Demo Mode — this is the path the demo actually uses.
      await page.locator('button:has-text("Demo Mode")').click().catch(() => {});
      await page.locator('button:has-text("Start hunt")').click().catch(() => {});
      await page.waitForTimeout(3500);

      const after = await canvasCount(page);
      // THE PHASER CHECK. MapLibre draws one canvas; Phaser adds its own.
      check(
        'Phaser HUD canvas mounted on top of the map',
        after.length >= 2,
        after.map((c) => `${c.w}x${c.h}`).join(' | '),
      );

      // Progress is now a persistent React strip ("Checkpoint 1 of 3") rather
      // than a per-sheet "CLUE 1 OF 3" label, so it must be visible on every
      // in-play screen — that is the point of moving it.
      const progressVisible = await page.locator('text=/Checkpoint 1 of/i').count();
      check('progress is shown after starting', progressVisible > 0);

      check('no page errors', errors.length === 0, errors.slice(0, 2).join(' ; '));
      await shot(page, '3-play-hud');
      await context.close();
    }

    // --- lobby + creator render at all -----------------------------------
    for (const path of ['/lobby', '/creator']) {
      console.log(`\n${path}`);
      const { page, context, errors } = await openPage(browser, path);
      const hasContent = (await page.locator('h1, h2').count()) > 0;
      check('renders', hasContent);
      check('no page errors', errors.length === 0, errors[0] ?? '');
      await shot(page, `4${path.replace('/', '-')}`);
      await context.close();
    }
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
  console.log('\n✓ the app renders\n');
}

main().catch((err) => {
  console.error('\n✖ browser check crashed:', err?.message ?? err);
  process.exit(1);
});
