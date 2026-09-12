/**
 * Pre-demo smoke check.
 *
 * Run this immediately before presenting. It verifies the things that have
 * actually broken during this build — not the things that are easy to check.
 * A passing `pnpm build` proved nothing three separate times tonight:
 * Phaser resolved to undefined at runtime, the Gemini key never loaded, and a
 * retired model 404'd behind a graceful fallback. All with green tests.
 *
 *   pnpm demo:check          (web on :3000 and server on :2567 must be up)
 */

const WEB = process.env.WEB_URL ?? 'http://localhost:3000';
const API = process.env.API_URL ?? 'http://localhost:2567';

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? '✓' : '✖'} ${name}${detail ? ` — ${detail}` : ''}`);
  return ok;
};

async function get(url, opts = {}) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000), ...opts });
    return { ok: res.ok, status: res.status, res };
  } catch (err) {
    return { ok: false, status: 0, error: err?.message ?? String(err) };
  }
}

async function main() {
  console.log('\nPre-demo check\n' + '─'.repeat(62));

  // --- 1. Both processes up ----------------------------------------------
  console.log('\nProcesses');
  const health = await get(`${API}/health`);
  if (!check('server responding', health.ok, health.error ?? `status ${health.status}`)) {
    console.log('\n  Start it:  pnpm dev\n');
    process.exit(1);
  }
  const h = await health.res.json();

  const web = await get(WEB);
  if (!check('web app responding', web.ok, web.error ?? `status ${web.status}`)) {
    console.log('\n  Start it:  pnpm dev\n');
    process.exit(1);
  }

  // --- 2. Integrations: is anything silently mocked? ----------------------
  console.log('\nIntegrations');
  check(
    'Gemini is LIVE (not mocked)',
    h.integrations.gemini === 'live',
    h.integrations.gemini,
  );
  console.log(`    storage=${h.integrations.storage}  elevenlabs=${h.integrations.elevenlabs}  querit=${h.integrations.querit}`);

  // --- 3. Every demo route serves ----------------------------------------
  console.log('\nRoutes');
  for (const path of ['/', '/play', '/demo', '/lobby', '/race', '/creator']) {
    const r = await get(`${WEB}${path}`);
    check(`${path} serves`, r.ok, r.error ?? `status ${r.status}`);
  }

  // --- 4. Content is the curated hunt, not the placeholder ----------------
  console.log('\nContent');
  const content = await get(`${WEB}/hunts/pittsburgh.json`);
  if (check('curated content published to web', content.ok, content.error ?? `status ${content.status}`)) {
    const bundle = await content.res.json();
    check('is the real hunt, NOT the placeholder', bundle.hunt?.id !== 'fallback-hunt', bundle.hunt?.title ?? '');
    check('three routes', bundle.routes?.length === 3, `${bundle.routes?.length} routes`);

    const finishes = new Set(bundle.routes?.map((r) => r.checkpointIds.at(-1)));
    check('all routes share one finish', finishes.size === 1, [...finishes].join(', '));

    const lengths = new Set(bundle.routes?.map((r) => r.checkpointIds.length));
    check('all routes are the same length', lengths.size === 1, `${[...lengths].join(', ')} stops`);
  }

  // --- 5. Public API leaks nothing ---------------------------------------
  console.log('\nLeak check');
  const pub = await get(`${API}/api/hunt`);
  if (check('/api/hunt serves', pub.ok, pub.error ?? `status ${pub.status}`)) {
    const raw = JSON.stringify(await pub.res.json());
    for (const field of ['acceptedAnswers', 'historicalReveal', 'hiddenDetail', 'landmarkDescription']) {
      check(`no ${field} in the public bundle`, !raw.includes(`"${field}"`));
    }
  }

  // --- 6. The live Gemini path actually judges ---------------------------
  if (h.integrations.gemini === 'live') {
    console.log('\nGemini');
    console.log('    (run `pnpm --filter @ww/multiplayer-server check:gemini` for the full round-trip)');
  } else {
    console.log('\nGemini');
    console.log('    ⚠ MOCKED. Photo verification will not use the real model.');
    console.log('    Put GEMINI_API_KEY in .env.local at the repo root, then restart the server.');
  }

  // --- summary ------------------------------------------------------------
  console.log('\n' + '─'.repeat(62));
  const failed = results.filter((r) => !r.ok);
  console.log(`${results.length - failed.length}/${results.length} checks passed`);

  if (failed.length) {
    console.log('\nFAILED:');
    for (const f of failed) console.log(`  · ${f.name}${f.detail ? ` (${f.detail})` : ''}`);
    console.log('');
    process.exit(1);
  }

  console.log('\n✓ ready to demo\n');
  console.log('  /demo   the three-minute pitch — three routes converging');
  console.log('  /play   a full solo run');
  console.log('  /lobby  multiplayer, two browser windows\n');
}

main().catch((err) => {
  console.error('\n✖ check crashed:', err?.message ?? err);
  process.exit(1);
});
