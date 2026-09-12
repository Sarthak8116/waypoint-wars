/**
 * Hint economics, end to end.
 *
 * "The other player uses a hint and loses XP" is a line in the demo script, and
 * it had only ever been verified in isolation: hunt-engine unit tests prove
 * `scoreCheckpoint` subtracts the penalty, and room tests prove a hint is
 * charged once. Nobody had checked that a hint taken during a real race
 * actually shows up as a lower final score on the leaderboard.
 *
 * Two players walk IDENTICAL work — same answers, same pace — and differ only
 * in that one takes hints. If the penalty does not survive to the leaderboard,
 * their scores come out equal and the demo line is a lie.
 *
 *   pnpm --filter @ww/multiplayer-server e2e:hints
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
const byId = new Map(bundle.checkpoints.map((c) => [c.id, c]));

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? '✓' : '✖'} ${name}${detail ? ` — ${detail}` : ''}`);
  return ok;
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const TINY_JPEG =
  'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==';

class Player {
  constructor(room, name, takesHints) {
    this.room = room;
    this.name = name;
    this.takesHints = takesHints;
    this.log = [];
    this.checkpoint = null;
    this.finished = false;
    this.hintsTaken = 0;

    room.onMessage('*', (type, payload) => {
      this.log.push({ type, payload });
      if (type === 'hunt_started') this.checkpoint = payload.firstCheckpoint;
      if (type === 'checkpoint_unlocked') this.checkpoint = payload.checkpoint;
      if (type === 'hunt_finished') this.finished = true;
    });
  }

  get self() {
    return this.room.state.players.get(this.room.sessionId);
  }
  get xp() {
    return this.self?.xp ?? 0;
  }
  get index() {
    return this.self?.checkpointIndex ?? 0;
  }
  get hintsUsedOnServer() {
    return this.self?.hintsUsed ?? 0;
  }

  async solve() {
    const cp = this.checkpoint;
    if (!cp) return { ok: false };
    const full = byId.get(cp.id);

    this.room.send('update_location', {
      latitude: cp.latitude,
      longitude: cp.longitude,
      accuracyMeters: 5,
    });
    await wait(300);

    if (this.takesHints) {
      const before = this.log.filter((m) => m.type === 'hint_issued').length;
      this.room.send('request_hint', { checkpointId: cp.id });
      await wait(350);
      if (this.log.filter((m) => m.type === 'hint_issued').length > before) this.hintsTaken += 1;
    }

    this.room.send('request_instruction', { checkpointId: cp.id });
    await wait(320);
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
        // IDENTICAL correctness — the only variable is the hint.
        observationAnswer: full?.acceptedAnswers?.[0] ?? '',
        randomizedInstruction: instruction,
        submittedAt: Date.now(),
      },
    });

    for (let i = 0; i < 25; i++) {
      await wait(200);
      if (this.index > before || this.finished) break;
    }

    const verdict = [...this.log].reverse().find((m) => m.type === 'submission_result')?.payload
      ?.verdict;
    return { ok: this.index > before || this.finished, breakdown: verdict?.xpBreakdown };
  }
}

async function main() {
  console.log('\nHint economics — same work, one takes hints\n' + '─'.repeat(64));

  const health = await fetch(`${API}/health`).then((r) => r.json());
  console.log(`  gemini=${health.integrations.gemini}\n`);

  const c1 = new Client(WS);
  const host = await c1.create('hunt', {
    playerName: 'Clean',
    mode: 'individual-race',
    huntId: bundle.hunt.id,
  });
  const clean = new Player(host, 'Clean', false);
  await wait(300);

  const { roomId } = await fetch(`${API}/api/rooms/${host.state.code}`).then((r) => r.json());
  const c2 = new Client(WS);
  const guest = await c2.joinById(roomId, { playerName: 'Hinter' });
  const hinter = new Player(guest, 'Hinter', true);
  await wait(400);

  host.send('start_hunt', {});
  await wait(900);

  const total = bundle.routes[0].checkpointIds.length;
  const lastBreakdowns = { clean: null, hinter: null };

  for (let step = 0; step < total; step++) {
    const a = await clean.solve();
    const b = await hinter.solve();
    if (a.breakdown) lastBreakdowns.clean = a.breakdown;
    if (b.breakdown) lastBreakdowns.hinter = b.breakdown;
    console.log(
      `    ${step + 1}/${total}  Clean ${String(clean.xp).padStart(5)} XP  |  Hinter ${String(hinter.xp).padStart(5)} XP  (hints: ${hinter.hintsTaken})`,
    );
    if (!a.ok && !b.ok) break;
  }

  await wait(1200);
  console.log('');

  check('both finished', clean.finished && hinter.finished);
  check('the hinter actually received hints', hinter.hintsTaken > 0, `${hinter.hintsTaken} hints`);
  check(
    'server counted the hints',
    hinter.hintsUsedOnServer === hinter.hintsTaken,
    `server=${hinter.hintsUsedOnServer} client=${hinter.hintsTaken}`,
  );
  check('the clean player took none', clean.hintsUsedOnServer === 0, String(clean.hintsUsedOnServer));

  // THE POINT OF THE TEST.
  check(
    'taking hints cost XP on the leaderboard',
    hinter.xp < clean.xp,
    `Clean ${clean.xp} vs Hinter ${hinter.xp} (diff ${clean.xp - hinter.xp})`,
  );

  // The penalty should be visible in the breakdown, not just the total.
  const bd = lastBreakdowns.hinter;
  if (bd) {
    check('hint penalty appears in the XP breakdown', bd.hintPenalty < 0, String(bd.hintPenalty));
    check('no-hint bonus withheld from the hinter', bd.noHintBonus === 0, String(bd.noHintBonus));
  }
  const cbd = lastBreakdowns.clean;
  if (cbd) {
    check('clean player kept the no-hint bonus', cbd.noHintBonus > 0, String(cbd.noHintBonus));
    check('clean player took no hint penalty', cbd.hintPenalty === 0, String(cbd.hintPenalty));
  }

  const board =
    [...clean.log].reverse().find((m) => m.type === 'hunt_finished')?.payload?.entries ?? [];
  if (board.length === 2) {
    const top = board.find((e) => e.rank === 1);
    check('the hint-free player ranks first', top?.displayName === 'Clean', top?.displayName ?? '-');
    console.log('');
    for (const e of board) {
      console.log(`    ${e.rank}. ${e.displayName.padEnd(8)} ${String(e.xp).padStart(5)} XP   hints=${e.hintsUsed}`);
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
  console.log('\n✓ hints cost XP, end to end\n');
}

main().catch((err) => {
  console.error('\n✖ hint test crashed:', err?.message ?? err);
  process.exit(1);
});
