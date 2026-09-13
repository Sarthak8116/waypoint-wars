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
  /**
   * networkidle is the best signal that a page is ready for input, and it is
   * not always reachable. Map pages stream tiles continuously, so under load —
   * two browsers plus a local dev server on one machine — the 500ms of quiet
   * it waits for may never arrive, and the run fails on navigation with
   * nothing wrong with the page.
   *
   * That happened: check:browser timed out on /creator while other suites ran,
   * then passed 50/50 alone moments later. A harness that reports a working
   * product as broken is the failure mode this whole file exists to prevent,
   * so fall back to "DOM is ready, give it a beat" rather than giving up.
   */
  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30_000 });
  } catch {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await page.waitForTimeout(2500);
  }
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

/**
 * Interactive elements a screen reader cannot name.
 *
 * Found by accident: the replay's transport controls were "❚❚" and "↺" with
 * no accessible name, which made them unreadable AND untestable — there was
 * no way to target one from outside, so a broken control could not have been
 * noticed. The two problems have one fix, which is why this is worth
 * asserting rather than filing away.
 *
 * A placeholder counts as a name here. It is not ideal, but it is announced,
 * and holding an internal tool to a stricter bar than that would produce
 * noise rather than fixes.
 */
export async function unnamedControls(page) {
  return page.evaluate(() => {
    const symbolsOnly = (t) => !t || !/[a-z0-9]/i.test(t);
    const out = [];

    for (const el of document.querySelectorAll('button, a[href], input, select, textarea')) {
      const style = getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') continue;

      const tag = el.tagName.toLowerCase();
      const named =
        el.getAttribute('aria-label') ||
        el.getAttribute('aria-labelledby') ||
        (el.id && document.querySelector(`label[for="${el.id}"]`)) ||
        el.closest('label') ||
        el.getAttribute('placeholder') ||
        el.getAttribute('title');

      if (tag === 'input' || tag === 'select' || tag === 'textarea') {
        if (!named) out.push(`${tag}[${el.getAttribute('type') ?? 'text'}] value="${String(el.value ?? '').slice(0, 16)}"`);
        continue;
      }
      if (!named && symbolsOnly((el.textContent || '').trim())) {
        out.push(`${tag} "${(el.textContent || '').trim().slice(0, 12)}"`);
      }
    }

    for (const img of document.querySelectorAll('img')) {
      if (!img.getAttribute('alt')) out.push(`img src="${(img.getAttribute('src') ?? '').slice(0, 24)}"`);
    }
    return out;
  });
}
