/**
 * `npm run tiktok:record -- <username> [seconds]`: connects to a live room and saves a few decoded sample
 * payloads per event type to bridge/test/fixtures/tiktok-samples.json (used as unit-test fixtures).
 * Payloads are anonymized before saving (see anonymize.ts).
 */
import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ControlEvent, TikTokLiveConnection, WebcastEvent } from 'tiktok-live-connector';
import { Anonymizer } from './anonymize';

const OUT = resolve(dirname(fileURLToPath(import.meta.url)), '../../test/fixtures/tiktok-samples.raw.json');
const username = (process.argv[2] ?? '').replace(/^@/, '');
const seconds = Number(process.argv[3] ?? 60);
if (!username) {
  console.error('Usage: npm run tiktok:record -- <username> [seconds]');
  process.exit(1);
}
const anonymizer = new Anonymizer();
const samples: Record<string, unknown[]> = {};
const counts: Record<string, number> = {};
const keep = (type: string, max: number) => (data: unknown) => {
  counts[type] = (counts[type] ?? 0) + 1;
  const list = (samples[type] ??= []);
  if (list.length >= max) return;
  const plain = JSON.parse(JSON.stringify(data, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)));
  list.push(anonymizer.anonymize(plain));
};
const conn = new TikTokLiveConnection(username, process.env.SIGN_API_KEY ? { signApiKey: process.env.SIGN_API_KEY } : {});
conn.on(WebcastEvent.CHAT, keep('chat', 8));
conn.on(WebcastEvent.LIKE, keep('like', 6));
conn.on(WebcastEvent.GIFT, keep('gift', 60));
conn.on(WebcastEvent.FOLLOW, keep('follow', 4));
conn.on(WebcastEvent.SHARE, keep('share', 4));
conn.on(WebcastEvent.SOCIAL, keep('social', 4));
conn.on(WebcastEvent.STREAM_END, keep('streamEnd', 2));
conn.on(ControlEvent.DISCONNECTED, (d: unknown) => console.log('disconnected', JSON.stringify(d)));
conn.on(ControlEvent.ERROR, (e: unknown) => console.log('error', String((e as { info?: unknown }).info ?? e)));
try {
  const state = await conn.connect();
  console.log('connected to room', state.roomId);
} catch (err) {
  console.error('connect failed:', (err as Error).message);
  process.exit(1);
}
await new Promise((r) => setTimeout(r, seconds * 1000));
writeFileSync(OUT, JSON.stringify(samples, null, 2));
console.log('counts', JSON.stringify(counts), '->', OUT);
await conn.disconnect();
process.exit(0);
