/**
 * Full-race end-to-end: two players complete EVERY checkpoint and finish.
 *
 * The existing e2e proves a room forms and one submission is judged. This
 * proves the thing actually promised in the pitch — two players walk different
 * routes to completion, converge on the same finish, and get a leaderboard.
 * That had never been executed before this script.
 *
 * Runs against the MOCK provider (no GEMINI_API_KEY in the server's env), so a
 * full race costs zero API quota. The mock still runs the real deterministic
 * answer matcher, so wrong answers still fail — see mock-provider.ts.
 *
 *   pnpm --filter @ww/multiplayer-server e2e:full
 */

import { Client } from 'colyseus.js';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const WS = process.env.WS_URL ?? 'ws://localhost:2567';
const API = process.env.API_URL ?? 'http://localhost:2567';

const here = dirname(fileURLToPath(import.meta.url));
const bundle = JSON.parse(
  readFileSync(resolve(here, '../../../data/pittsburgh-hunts.json'), 'utf8'),
);

/** id -> full checkpoint, so the harness knows the answers the client never sees. */
const byId = new Map(bundle.checkpoints.map((c) => [c.id, c]));

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? '✓' : '✖'} ${name}${detail ? ` — ${detail}` : ''}`);
  return ok;
};

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const TINY_JPEG = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==';

/** Drives one player through their whole route. */
class Runner {
  constructor(room, label) {
    this.room = room;
    this.label = label;
    this.log = [];
    this.checkpoint = null;
    this.finished = false;
    this.visited = [];

    room.onMessage('*', (type, payload) => {
      this.log.push({ type, payload });
      if (type === 'hunt_started') this.checkpoint = payload.firstCheckpoint;
      if (type === 'checkpoint_unlocked') this.checkpoint = payload.checkpoint;
      if (type === 'hunt_finished') this.finished = true;
    });
  }

  get xp() {
    return this.room.state.players.get(this.room.sessionId)?.xp ?? 0;
  }

  get index() {
    return this.room.state.players.get(this.room.sessionId)?.checkpointIndex ?? 0;
  }

  /** Walk to the active checkpoint, get the instruction, answer correctly. */
  async solveOne() {
    const cp = this.checkpoint;
    if (!cp) return { ok: false, why: 'no active checkpoint' };

    const full = byId.get(cp.id);
    if (!full) return { ok: false, why: `harness has no content for ${cp.id}` };

    this.visited.push(cp.id);

    // Arrive: the geofence is what unlocks the instruction.
    this.room.send('update_location', {
      latitude: cp.latitude,
      longitude: cp.longitude,
      accuracyMeters: 5,
    });
    await wait(350);

    this.room.send('request_instruction', { checkpointId: cp.id });
    await wait(350);

    const instruction =
      [...this.log].reverse().find((m) => m.type === 'instruction_issued')?.payload?.instruction ??
      '';

    const before = this.index;
    this.room.send('submit_checkpoint', {
      submission: {
        checkpointId: cp.id,
        image: TINY_JPEG,
        latitude: cp.latitude,
        longitude: cp.longitude,
        // The harness knows the answer; the client was never sent it.
        observationAnswer: full.acceptedAnswers[0],
        randomizedInstruction: instruction,
        submittedAt: Date.now(),
      },
    });

    // Wait for the index to advance rather than sleeping a fixed time.
    for (let i = 0; i < 30; i++) {
      await wait(200);
      if (this.index > before || this.finished) break;
    }

    const verdict = [...this.log].reverse().find((m) => m.type === 'submission_result')?.payload
      ?.verdict;
    return { ok: this.index > before || this.finished, outcome: verdict?.outcome, cp: cp.id };
  }
}

async function main() {
  console.log('\nFull race — both players to the finish\n' + '─'.repeat(64));

  const health = await fetch(`${API}/health`).then((r) => r.json());
  console.log(`  gemini=${health.integrations.gemini}  storage=${health.integrations.storage}`);
  if (health.integrations.gemini === 'live') {
    console.log('  ⚠ Gemini is LIVE — this race will spend real quota.');
    console.log('    Run the server without GEMINI_API_KEY to use the deterministic mock.\n');
  }

  const hostClient = new Client(WS);
  const host = await hostClient.create('hunt', {
    playerName: 'Ava',
    mode: 'individual-race',
    huntId: bundle.hunt.id,
  });
  const a = new Runner(host, 'Ava');
  await wait(300);

  const { roomId } = await fetch(`${API}/api/rooms/${host.state.code}`).then((r) => r.json());
  const guestClient = new Client(WS);
  const guest = await guestClient.joinById(roomId, { playerName: 'Ben' });
  const b = new Runner(guest, 'Ben');
  await wait(400);

  check('two players joined', host.state.players.size === 2);

  host.send('start_hunt', {});
  await wait(800);

  check('both received a first clue', Boolean(a.checkpoint && b.checkpoint));
  check(
    'different first checkpoints',
    a.checkpoint?.id !== b.checkpoint?.id,
    `${a.checkpoint?.id} vs ${b.checkpoint?.id}`,
  );

  const total = bundle.routes[0].checkpointIds.length;
  console.log(`\n  walking ${total} checkpoints each…`);

  for (let step = 0; step < total; step++) {
    const ra = await a.solveOne();
    const rb = await b.solveOne();
    console.log(
      `    ${step + 1}/${total}  Ava ${ra.outcome ?? '-'} (${ra.cp ?? '-'})  |  Ben ${rb.outcome ?? '-'} (${rb.cp ?? '-'})`,
    );
    if (!ra.ok && !rb.ok) {
      check(`step ${step + 1} advanced`, false, `${ra.why ?? ra.outcome} / ${rb.why ?? rb.outcome}`);
      break;
    }
  }

  await wait(1200);

  console.log('');
  check('Ava finished', a.finished, `xp=${a.xp}`);
  check('Ben finished', b.finished, `xp=${b.xp}`);
  check('both earned XP', a.xp > 0 && b.xp > 0, `${a.xp} / ${b.xp}`);

  // The promise of the whole design: different routes, same last stop.
  const finish = bundle.hunt.finalDestination.id;
  check('Ava ended at the shared finish', a.visited.at(-1) === finish, a.visited.at(-1) ?? '-');
  check('Ben ended at the shared finish', b.visited.at(-1) === finish, b.visited.at(-1) ?? '-');

  const overlap = a.visited.filter((id) => id !== finish && b.visited.includes(id));
  check('routes shared no checkpoint but the finish', overlap.length === 0, overlap.join(',') || 'none');

  const board = [...a.log].reverse().find((m) => m.type === 'hunt_finished')?.payload?.entries ?? [];
  check('leaderboard delivered', board.length === 2, `${board.length} entries`);
  if (board.length) {
    const sorted = [...board].every((e, i, arr) => i === 0 || arr[i - 1].xp >= e.xp);
    check('leaderboard ordered by XP', sorted);
    console.log('');
    for (const e of board) {
      console.log(`    ${e.rank}. ${e.displayName.padEnd(8)} ${String(e.xp).padStart(5)} XP   ${e.checkpointsCompleted}/${e.totalCheckpoints}`);
    }
  }

  await host.leave();
  await guest.leave();

  console.log('\n' + '─'.repeat(64));
  const failed = results.filter((r) => !r.ok);
  console.log(`${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) {
    console.log('\nFAILED:');
    for (const f of failed) console.log(`  · ${f.name}${f.detail ? ` (${f.detail})` : ''}`);
    process.exit(1);
  }
  console.log('\n✓ a complete race runs end to end\n');
}

main().catch((err) => {
  console.error('\n✖ full race crashed:', err?.message ?? err);
  process.exit(1);
});
