import sharp from 'sharp';

/**
 * Avatar proxy: GET /avatar?url=<TikTok CDN image url>
 *
 * - Only https URLs on TikTok CDN hostnames (allowlist, suffix match on a dot boundary). Everything else is
 *   rejected before any network request, so the bridge cannot be used to reach internal hosts (SSRF).
 * - Redirects are followed manually (max 3) and every hop is re-checked against the allowlist.
 * - The image is resized to 128x128 (cover) and cached in memory (LRU).
 * - Any failure -> 404, and the game falls back to initials.
 */

export const AVATAR_HOST_SUFFIXES = [
  'tiktokcdn.com',
  'tiktokcdn-us.com',
  'tiktokcdn-eu.com',
  'ibyteimg.com',
  'byteimg.com',
  'muscdn.com',
];

export function isAllowedAvatarUrl(raw: string, suffixes: string[] = AVATAR_HOST_SUFFIXES): URL | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:') return null;
  if (u.username || u.password) return null;
  if (u.port && u.port !== '443') return null;
  const host = u.hostname.toLowerCase().replace(/\.$/, '');
  // No IP literals (v4 or v6), only real CDN hostnames.
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.startsWith('[') || host.includes(':')) return null;
  if (!suffixes.some((s) => host === s || host.endsWith(`.${s}`))) return null;
  return u;
}

/** Tiny LRU (Map keeps insertion order; re-insert on hit). */
export class LruCache<V> {
  private map = new Map<string, V>();
  constructor(private max: number) {}
  get(k: string): V | undefined {
    const v = this.map.get(k);
    if (v === undefined) return undefined;
    this.map.delete(k);
    this.map.set(k, v);
    return v;
  }
  set(k: string, v: V): void {
    this.map.delete(k);
    this.map.set(k, v);
    while (this.map.size > this.max) this.map.delete(this.map.keys().next().value!);
  }
  get size(): number {
    return this.map.size;
  }
}

export interface AvatarProxyOptions {
  size?: number;
  cacheEntries?: number;
  maxBytes?: number;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export class AvatarProxy {
  private cache: LruCache<Buffer>;
  private inflight = new Map<string, Promise<Buffer | null>>();
  private size: number;
  private maxBytes: number;
  private timeoutMs: number;
  private fetchImpl: typeof fetch;
  stats = { hits: 0, misses: 0, rejected: 0, failed: 0 };

  constructor(o: AvatarProxyOptions = {}) {
    this.size = o.size ?? 128;
    this.cache = new LruCache(o.cacheEntries ?? 500);
    this.maxBytes = o.maxBytes ?? 4 * 1024 * 1024;
    this.timeoutMs = o.timeoutMs ?? 6000;
    this.fetchImpl = o.fetchImpl ?? fetch;
  }

  /** Resized image bytes (webp), or null for any rejection / failure. */
  async get(rawUrl: string): Promise<Buffer | null> {
    const url = isAllowedAvatarUrl(rawUrl);
    if (!url) {
      this.stats.rejected++;
      return null;
    }
    const key = url.toString();
    const hit = this.cache.get(key);
    if (hit) {
      this.stats.hits++;
      return hit;
    }
    this.stats.misses++;
    let p = this.inflight.get(key);
    if (!p) {
      p = this.load(url).finally(() => this.inflight.delete(key));
      this.inflight.set(key, p);
    }
    const out = await p;
    if (out) this.cache.set(key, out);
    else this.stats.failed++;
    return out;
  }

  private async load(start: URL): Promise<Buffer | null> {
    try {
      let url = start;
      for (let hop = 0; hop < 4; hop++) {
        const res = await this.fetchImpl(url, { redirect: 'manual', signal: AbortSignal.timeout(this.timeoutMs) });
        if (res.status >= 300 && res.status < 400) {
          const next = isAllowedAvatarUrl(new URL(res.headers.get('location') ?? '', url).toString());
          if (!next) return null; // redirect leaves the allowlist
          url = next;
          continue;
        }
        if (!res.ok) return null;
        if (!(res.headers.get('content-type') ?? '').startsWith('image/')) return null;
        const len = Number(res.headers.get('content-length') ?? 0);
        if (len > this.maxBytes) return null;
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.length > this.maxBytes) return null;
        return await sharp(buf, { limitInputPixels: 4096 * 4096 }).resize(this.size, this.size, { fit: 'cover' }).webp({ quality: 82 }).toBuffer();
      }
      return null;
    } catch {
      return null;
    }
  }
}
