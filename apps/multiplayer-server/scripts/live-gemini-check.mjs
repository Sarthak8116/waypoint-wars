/**
 * First real execution of the Gemini path (DECISIONS.md D16).
 * Sends a genuine image and asserts the structured-JSON contract holds.
 */
import { config as loadEnv } from 'dotenv';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
loadEnv({ path: resolve(root, '.env') });
loadEnv({ path: resolve(root, '.env.local'), override: true });

const { createVerificationProvider } = await import('@ww/verification');

// A small real JPEG (solid colour) — enough to prove the API round-trips and
// returns our schema. It is NOT a landmark, so landmarkMatch should be false:
// a `true` here would mean the model is rubber-stamping, which is worth knowing.
const JPEG_B64 =
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a' +
  'HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIy' +
  'MjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAAgACADASIA' +
  'AhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQA' +
  'AAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3' +
  'ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWm' +
  'p6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/9oADAMB' +
  'AAIRAxEAPwD3+iiigAooooAKKKKACiiigD//2Q==';

const provider = createVerificationProvider();
console.log('provider selected:', provider.constructor?.name ?? 'unknown');

const started = Date.now();
try {
  const result = await provider.verify({
    checkpointName: 'Smithfield Street Bridge',
    imageBase64: JPEG_B64,
    mimeType: 'image/jpeg',
    landmarkDescription:
      'A long steel through-truss bridge whose top and bottom chords curve apart then together (lens/eye profile); pale blue-and-beige paint; a stone Gothic-Revival portal arch at the entrance.',
    randomizedInstruction: 'Hold up three fingers in the lower-right corner of the frame',
    observationQuestion: 'What everyday shape does each side truss resemble?',
    acceptedAnswers: ['lens', 'eye', 'oval', 'almond', 'lenticular'],
  });

  const ms = Date.now() - started;
  console.log(`\nround-trip: ${ms}ms`);
  console.log(JSON.stringify(result, null, 2));

  const checks = [
    ['returned an object', typeof result === 'object' && result !== null],
    ['mocked === false (real API used)', result.mocked === false],
    ['landmarkMatch is boolean', typeof result.landmarkMatch === 'boolean'],
    ['requiredActionCompleted is boolean', typeof result.requiredActionCompleted === 'boolean'],
    ['answerCorrect is boolean', typeof result.answerCorrect === 'boolean'],
    ['confidence is 0..1', typeof result.confidence === 'number' && result.confidence >= 0 && result.confidence <= 1],
    ['reason is a non-empty string', typeof result.reason === 'string' && result.reason.length > 0],
    ['did NOT rubber-stamp a non-landmark', result.landmarkMatch === false],
    // THE CHECK THAT MATTERS. Without it this script reported 8/8 while every
    // call was 404ing on a retired model: the provider degrades to a
    // confidence-0 "could not reach Gemini" verdict, which satisfies every
    // shape assertion above. Assert the model actually judged the image.
    // Distinguish the three failure shapes, because they mean different things:
    //   rate limited -> the code is fine, the quota is spent (transient)
    //   unreachable  -> the model id or the network is wrong (broken)
    //   a judgement  -> working
    [
      'reason is a real judgement, not an error fallback',
      typeof result.reason === 'string' &&
        !/could not reach|nothing was judged|unavailable|timed out|rate limited/i.test(result.reason),
    ],
  ];

  console.log('');
  let failed = 0;
  for (const [name, ok] of checks) {
    console.log(`  ${ok ? '✓' : '✖'} ${name}`);
    if (!ok) failed++;
  }
  console.log(`\n${checks.length - failed}/${checks.length} checks passed`);
  process.exit(failed ? 1 : 0);
} catch (err) {
  console.error('\n✖ LIVE GEMINI CALL FAILED');
  console.error('  ', err?.message ?? err);
  if (err?.status) console.error('   status:', err.status);
  process.exit(1);
}
