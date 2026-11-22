/**
 * `npm run tiktok:record -- <username> [seconds]`: connects to a live room and saves a few decoded sample
 * payloads per event type to bridge/test/fixtures/tiktok-samples.json (used as unit-test fixtures).
 * Viewer names, ids and avatar urls are replaced with placeholders before saving.
 */
import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ControlEvent, TikTokLiveConnection, WebcastEvent } from 'tiktok-live-connector';

const OUT = resolve(dirname(fileURLToPath(import.meta.url)), '../../test/fixtures/tiktok-samples.raw.json');
const username = (process.argv[2] ?? '').replace(/^@/, '');
const seconds = Number(process.argv[3] ?? 60);
if (!username) {
  console.error('Usage: npm run tiktok:record -- <username> [seconds]');
  process.exit(1);
}
const samples: Record<string, unknown[]> = {};
const counts: Record<string, number> = {};
/** Anonymize: consistent fake ids per real id, fake names, placeholder avatar urls, non-join chat text removed. */
const ids = new Map<string, string>();
const fakeId = (real: string) => {
  if (!ids.has(real)) ids.set(real, String(7000000000000000000n + BigInt(ids.size + 1)));
  return ids.get(real)!;
};
const JOIN = /^\s*(j|join)\W*$/i;
function anonymize(o: unknown, key = ''): unknown {
  if (Array.isArray(o)) return o.map((x) => anonymize(x, key));
  if (o && typeof o === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(o)) out[k] = anonymize(v, k);
    return out;
  }
  if (typeof o === 'bigint') o = o.toString();
  if (typeof o !== 'string') return o;
  if (['userId', 'id', 'idStr', 'secUid', 'uniqueId', 'displayId'].includes(key) && /\S/.test(o) && key !== 'giftId') return key === 'uniqueId' || key === 'displayId' ? `viewer_${fakeId(o).slice(-3)}` : fakeId(o);
  if (key === 'nickname') return `Viewer ${fakeId(o).slice(-3)}`;
  if (key === 'comment') return JOIN.test(o) ? o : 'hello';
  if (/^https?:\/\//.test(o) && /avt|avatar|aweme|profile/i.test(o)) return 'https://p16-sign-va.tiktokcdn.com/tos-maliva-avt-0068/placeholder~c5_100x100.jpeg';
  return o;
}
const keep = (type: string, max: number) => (data: unknown) => {
  counts[type] = (counts[type] ?? 0) + 1;
  const list = (samples[type] ??= []);
  if (list.length < max) list.push(anonymize(JSON.parse(JSON.stringify(data, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)))));
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
