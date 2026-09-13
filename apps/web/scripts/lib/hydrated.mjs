/**
 * Waiting for React to actually be listening.
 *
 * Playwright's actionability checks see a button that is visible and enabled
 * and click it. They cannot see whether React has attached its handler yet, so
 * against a cold `next dev` build — which compiles on first request — a click
 * lands on server-rendered markup and does nothing. The run then fails far
 * from the cause, on a selector that only appears as a result of that click.
 *
 * Against the production build hydration is fast enough that this never
 * surfaced, so every suite passed on Vercel while three failed locally. That
 * is a bad property for checks whose entire job is to be trusted — and
 * check:finish can ONLY run locally, so local has to work.
 */

/** Navigate and wait until the page can respond to input. */
export async function gotoReady(page, url, settleMs = 1500) {
  await page.goto(url, { waitUntil: 'networkidle', timeout: 60_000 });
  await page.waitForTimeout(settleMs);
}

/**
 * Click, then confirm it landed — retrying once if it did not.
 *
 * `expectSelector` must be something that can only appear BECAUSE of the
 * click, so a click swallowed by an unhydrated page is caught here rather than
 * three steps later.
 */
export async function clickAndExpect(page, clickSelector, expectSelector, timeoutMs = 20_000) {
  for (let attempt = 0; attempt < 2; attempt++) {
    await page.locator(clickSelector).first().click().catch(() => {});
    const landed = await page
      .waitForSelector(expectSelector, { timeout: attempt === 0 ? 6_000 : timeoutMs })
      .then(() => true)
      .catch(() => false);
    if (landed) return true;
  }
  return false;
}

/**
 * True for errors that come from running WebGL without a GPU.
 *
 * MapLibre and Phaser each take a context; two browsers doubles it, and the
 * headless software backend gives up. It is an artifact of the harness, never
 * something a player on real hardware hits. Matched by exact class so a
 * genuine page error is still a failure.
 */
export function isHeadlessGlNoise(text) {
  return /Framebuffer status|WebGL context was lost|GL Driver Message/i.test(String(text));
}
