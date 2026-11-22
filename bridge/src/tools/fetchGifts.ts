/**
 * `npm run gifts:fetch -- <tiktokUsername>`
 *
 * Fetches the gift list of a room that is LIVE right now (tiktok-live-connector v2: fetchAvailableGifts),
 * writes shared/gift-catalog.json (sorted by coins) and downloads every icon once into
 * game/public/gifts/<id>.<ext>, so the game never loads gift images from TikTok at runtime.
 */
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TikTokLiveConnection } from 'tiktok-live-connector';
import type { CatalogGift, GiftCatalog } from '@typejoin/shared';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const CATALOG = resolve(ROOT, 'shared/gift-catalog.json');
const ICON_DIR = resolve(ROOT, 'game/public/gifts');

type RawGift = {
  id?: number | string;
  name?: string;
  diamond_count?: number;
  type?: number;
  image?: { url_list?: string[] };
  icon?: { url_list?: string[] };
};

/** v2 returns `any`: depending on the endpoint it is the array itself or wrapped in { gifts } / { data: { gifts } }. */
function giftArray(res: unknown): RawGift[] {
  if (Array.isArray(res)) return res as RawGift[];
  const r = res as { gifts?: unknown; data?: { gifts?: unknown } } | null;
  if (r && Array.isArray(r.gifts)) return r.gifts as RawGift[];
  if (r && r.data && Array.isArray(r.data.gifts)) return r.data.gifts as RawGift[];
  throw new Error(`Unexpected gift list shape: ${JSON.stringify(res)?.slice(0, 200)}`);
}

function extFor(url: string, contentType: string | null): string {
  const fromType = contentType?.includes('png') ? '.png' : contentType?.includes('webp') ? '.webp'
    : contentType?.includes('jpeg') ? '.jpg' : contentType?.includes('gif') ? '.gif' : '';
  if (fromType) return fromType;
  const e = extname(new URL(url).pathname).toLowerCase();
  return ['.png', '.webp', '.jpg', '.jpeg', '.gif'].includes(e) ? e : '.png';
}

async function downloadIcon(id: number, url: string): Promise<string | null> {
  const existing = readdirSync(ICON_DIR).find((f) => f.startsWith(`${id}.`));
  if (existing) return existing; // downloaded once; never again
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const file = `${id}${extFor(url, res.headers.get('content-type'))}`;
  writeFileSync(resolve(ICON_DIR, file), Buffer.from(await res.arrayBuffer()));
  return file;
}

async function fetchGiftListDirect(roomId: string): Promise<unknown> {
  const params = new URLSearchParams({
    aid: '1988', app_name: 'tiktok_web', device_platform: 'web', app_language: 'en-US', browser_language: 'en-US',
    browser_platform: 'MacIntel', browser_name: 'Mozilla', cookie_enabled: 'true', room_id: roomId,
  });
  const res = await fetch(`https://webcast.tiktok.com/webcast/gift/list/?${params}`, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36' },
  });
  if (!res.ok) throw new Error(`gift list HTTP ${res.status}`);
  const text = await res.text();
  if (!text.trim()) throw new Error('gift list endpoint returned an empty body (request rejected)');
  return JSON.parse(text);
}

async function main(): Promise<void> {
  const username = (process.argv[2] ?? '').replace(/^@/, '').trim();
  if (!username) {
    console.error('Usage: npm run gifts:fetch -- <tiktokUsername>   (the account must be LIVE right now)');
    process.exit(1);
  }
  console.log(`Fetching the gift list from @${username}'s live room...`);
  const connection = new TikTokLiveConnection(username, {});
  let raw: RawGift[];
  try {
    if (!(await connection.fetchIsLive())) {
      console.error(`@${username} is not live right now. The gift list can only be read from a live room.`);
      process.exit(1);
    }
    const roomId = await connection.fetchRoomId(); // v2: binds connection.roomId, needed by fetchAvailableGifts
    console.log(`room ${roomId}`);
    try {
      raw = giftArray(await connection.fetchAvailableGifts());
    } catch (err) {
      // v2 signs this request through Euler Stream, which needs a paid plan (SIGN_API_KEY). Without one,
      // fall back to TikTok's public webcast gift-list endpoint for the same room (what v1 called).
      console.warn(`library gift fetch failed (${(err as Error).message.split('\n')[0].slice(0, 120)})`);
      console.warn('falling back to TikTok\'s webcast gift list endpoint...');
      raw = giftArray(await fetchGiftListDirect(roomId));
    }
  } catch (err) {
    console.error(`Could not fetch gifts from @${username}. Is the account live right now?\n`, err);
    process.exit(1);
  }

  const byId = new Map<number, CatalogGift>();
  for (const g of raw) {
    const id = Number(g.id);
    const imageUrl = g.image?.url_list?.[0] ?? g.icon?.url_list?.[0] ?? '';
    if (!Number.isFinite(id) || !g.name || byId.has(id)) continue;
    byId.set(id, { id, name: g.name.trim(), coins: Number(g.diamond_count ?? 0), imageUrl, icon: '', streakable: g.type === 1 });
  }
  const gifts = [...byId.values()].sort((a, b) => a.coins - b.coins || a.name.localeCompare(b.name) || a.id - b.id);
  if (!gifts.length) {
    console.error('The room returned no gifts.');
    process.exit(1);
  }

  mkdirSync(ICON_DIR, { recursive: true });
  let failed = 0;
  for (const g of gifts) {
    if (!g.imageUrl) continue;
    try {
      const file = await downloadIcon(g.id, g.imageUrl);
      if (file) g.icon = `gifts/${file}`;
    } catch (err) {
      failed++;
      console.warn(`  icon for ${g.id} ${g.name} failed: ${(err as Error).message}`);
    }
  }

  const catalog: GiftCatalog = { fetchedAt: new Date().toISOString(), gifts };
  writeFileSync(CATALOG, JSON.stringify(catalog, null, 2) + '\n');

  const w = Math.max(4, ...gifts.map((g) => g.name.length));
  console.log(`\n${'id'.padStart(8)}  ${'name'.padEnd(w)}  coins`);
  for (const g of gifts) console.log(`${String(g.id).padStart(8)}  ${g.name.padEnd(w)}  ${g.coins}`);
  console.log(`\n${gifts.length} gifts -> ${CATALOG}`);
  console.log(`icons -> ${ICON_DIR} (${gifts.filter((g) => g.icon).length} saved${failed ? `, ${failed} failed` : ''})`);
  process.exit(0); // the connection may keep sockets open
}

main();
