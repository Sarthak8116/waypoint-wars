/**
 * The creator's two unverified journeys.
 *
 *   1. MAP EDITING — click to add a checkpoint, drag a marker to move it.
 *      Reviewed but never exercised; the agent that built it could not run a
 *      browser.
 *   2. PREVIEW ROUND-TRIP — write a draft to localStorage in /creator, then
 *      walk it in /play. Both sides import the same exported key, but a
 *      round-trip across two files and a navigation has never actually run,
 *      and that is precisely where everything else tonight broke.
 *
 *   pnpm --filter @ww/web check:creator
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

/** Count the markers MapLibre has placed for checkpoints. */
const markerCount = (page) =>
  page.evaluate(() => document.querySelectorAll('.maplibregl-marker').length);

async function main() {
  console.log('\nCreator: map editing + preview round-trip\n' + '─'.repeat(64));

  const browser = await chromium.launch();
  // Desktop: the creator is an internal desktop tool.
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/favicon|openstreetmap/i.test(m.text())) {
      errors.push(`console: ${m.text().slice(0, 140)}`);
    }
  });

  try {
    await page.goto(`${BASE}/creator`, { waitUntil: 'networkidle', timeout: 30_000 });
    await page.waitForTimeout(3000);

    // The hunt title is an input VALUE, not page text.
    const titleLoaded = await page.evaluate(() =>
      [...document.querySelectorAll('input')].some((i) => /Three Rivers Run/i.test(i.value)),
    );
    check('creator loaded the curated content', titleLoaded);

    const before = await markerCount(page);
    check('checkpoints are plotted as markers', before > 0, `${before} markers`);

    // --- click the map to add a checkpoint --------------------------------
    const mapBox = await page.locator('.creator-map').boundingBox();
    if (!mapBox) throw new Error('map container not found');

    // Somewhere empty-ish in the lower-left of the map.
    const clickX = mapBox.x + mapBox.width * 0.25;
    const clickY = mapBox.y + mapBox.height * 0.75;
    await page.mouse.click(clickX, clickY);
    await page.waitForTimeout(1200);

    const afterAdd = await markerCount(page);
    check('clicking the map added a checkpoint', afterAdd === before + 1, `${before} -> ${afterAdd}`);

    // --- drag a marker ----------------------------------------------------
    const marker = page.locator('.maplibregl-marker').last();
    const box = await marker.boundingBox();
    if (box) {
      const from = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
      const to = { x: from.x + 90, y: from.y - 60 };

      await page.mouse.move(from.x, from.y);
      await page.mouse.down();
      // Several small steps: a single jump is often ignored as a click.
      for (let i = 1; i <= 8; i++) {
        await page.mouse.move(from.x + ((to.x - from.x) * i) / 8, from.y + ((to.y - from.y) * i) / 8);
        await page.waitForTimeout(40);
      }
      await page.mouse.up();
      await page.waitForTimeout(1000);

      const moved = await marker.boundingBox();
      const dx = Math.abs((moved?.x ?? from.x) - box.x);
      check('a marker can be dragged to a new position', dx > 30, `moved ${Math.round(dx)}px`);
    } else {
      check('a marker can be dragged to a new position', false, 'no marker bounding box');
    }

    check('marker count unchanged by dragging', (await markerCount(page)) === afterAdd);
    await page.screenshot({ path: resolve(SHOT_DIR, '10-creator-edited.png') });

    // --- validation must react to a half-finished checkpoint --------------
    const validationText = await page.locator('h2:has-text("Validation"), h3:has-text("Validation")').count();
    check('validation panel present', validationText > 0);

    // --- the validation gate must BLOCK an incomplete draft ---------------
    // The checkpoint just added by clicking has empty content, so Preview and
    // Publish must both refuse. This is the gate doing its job.
    const blockedPreview = page.locator('button:has-text("Preview")').first();
    const blocked = (await blockedPreview.count()) > 0 && !(await blockedPreview.isEnabled());
    check('an incomplete checkpoint blocks Preview', blocked);

    // --- PREVIEW ROUND-TRIP ----------------------------------------------
    // Start from a clean draft. The autosave in localStorage survives a
    // reload by design, so it has to be cleared explicitly.
    await page.evaluate(() => {
      try {
        window.localStorage.clear();
      } catch {
        /* private mode */
      }
    });
    await page.goto(`${BASE}/creator`, { waitUntil: 'networkidle', timeout: 30_000 });
    await page.waitForTimeout(3000);

    const previewBtn = page.locator('button:has-text("Preview")');
    const enabled = (await previewBtn.count()) > 0 && (await previewBtn.first().isEnabled());
    check('Preview is available on a valid draft', enabled);

    if (enabled) {
      // Preview opens /play in a new tab; capture it.
      const [previewPage] = await Promise.all([
        context.waitForEvent('page', { timeout: 15_000 }).catch(() => null),
        previewBtn.first().click(),
      ]);

      // Whether it opened a tab or navigated, the KEY must be written.
      await page.waitForTimeout(1200);
      const stored = await page.evaluate(() => {
        try {
          const raw = window.localStorage.getItem('ww.creator.preview');
          if (!raw) return null;
          const b = JSON.parse(raw);
          return { hunt: b?.hunt?.title, routes: b?.routes?.length, checkpoints: b?.checkpoints?.length };
        } catch {
          return null;
        }
      });
      check('the draft was written to the preview key', Boolean(stored), JSON.stringify(stored));

      if (previewPage) {
        await previewPage.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {});
        await previewPage.waitForTimeout(2500);
        const url = previewPage.url();
        check('Preview opened the play screen', /\/play/.test(url), url);

        const started = await previewPage.locator('button:has-text("Start hunt")').count();
        check('the previewed draft is playable', started > 0);
        await previewPage.screenshot({ path: resolve(SHOT_DIR, '11-creator-preview.png') });
        await previewPage.close();
      }

      // And the banner must offer a way back out.
      // NOT networkidle: MapLibre streams tiles continuously, so the network
      // never goes idle on this page and the wait times out.
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(3000);
      const banner = await page.locator('text=/Previewing draft/i').count();
      check('a "previewing draft" indicator is shown after reload', banner > 0);

      const clearBtn = page.locator('button:has-text("Clear")');
      if (await clearBtn.count()) {
        await clearBtn.first().click();
        await page.waitForTimeout(800);
        const cleared = await page.evaluate(() => {
          try {
            return window.localStorage.getItem('ww.creator.preview') === null;
          } catch {
            return false;
          }
        });
        check('Clear removes the preview so /play returns to published content', cleared);
      } else {
        check('Clear control exists', false, 'no Clear button beside the banner');
      }
    }

    check('no page errors', errors.length === 0, errors.slice(0, 2).join(' ; '));
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
  console.log('\n✓ the creator edits and previews\n');
}

main().catch((err) => {
  console.error('\n✖ creator check crashed:', err?.message ?? err);
  process.exit(1);
});
