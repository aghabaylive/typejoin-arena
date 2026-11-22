import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import { AvatarProxy, LruCache, isAllowedAvatarUrl } from '../src/avatarProxy';

describe('avatar allowlist (SSRF guard)', () => {
  it('accepts https TikTok CDN hosts', () => {
    for (const u of [
      'https://p16-sign-va.tiktokcdn.com/tos-maliva-avt-0068/abc~c5_100x100.jpeg?x-expires=1&x-signature=x',
      'https://p77-sign-sg.tiktokcdn.com/aweme/100x100/a.webp',
      'https://p16-sign.tiktokcdn-us.com/a.jpeg',
      'https://p16-pu-sign-useast8.tiktokcdn-us.com/a.jpeg',
      'https://p3-pc-sign.douyinpic.ibyteimg.com/a.jpeg',
      'https://tiktokcdn.com/a.png',
    ]) expect(isAllowedAvatarUrl(u), u).not.toBeNull();
  });

  it('rejects everything else', () => {
    for (const u of [
      'http://p16-sign-va.tiktokcdn.com/a.jpeg', // not https
      'https://tiktokcdn.com.evil.example/a.png', // suffix trick
      'https://eviltiktokcdn.com/a.png', // no dot boundary
      'https://evil.example/?u=tiktokcdn.com',
      'https://169.254.169.254/latest/meta-data/', // cloud metadata
      'https://127.0.0.1/a.png',
      'https://localhost/a.png',
      'https://[::1]/a.png',
      'https://p16.tiktokcdn.com:8443/a.png', // custom port
      'https://user:pw@p16.tiktokcdn.com/a.png', // credentials
      'file:///etc/passwd',
      'ftp://p16.tiktokcdn.com/a.png',
      'not a url',
      '',
    ]) expect(isAllowedAvatarUrl(u), u).toBeNull();
  });
});

describe('LruCache', () => {
  it('evicts the least recently used entry', () => {
    const c = new LruCache<number>(2);
    c.set('a', 1);
    c.set('b', 2);
    c.get('a'); // a is now newest
    c.set('c', 3);
    expect(c.get('b')).toBeUndefined();
    expect(c.get('a')).toBe(1);
    expect(c.get('c')).toBe(3);
    expect(c.size).toBe(2);
  });
});

describe('AvatarProxy', () => {
  const png = () => sharp({ create: { width: 400, height: 300, channels: 3, background: '#3a7' } }).png().toBuffer();
  const ok = async () => new Response(await png(), { status: 200, headers: { 'content-type': 'image/png' } });

  it('resizes to 128x128 webp and serves repeats from the cache', async () => {
    let calls = 0;
    const proxy = new AvatarProxy({ fetchImpl: (async () => { calls++; return ok(); }) as typeof fetch });
    const url = 'https://p16-sign-va.tiktokcdn.com/a.jpeg';
    const a = await proxy.get(url);
    const b = await proxy.get(url);
    expect(a).not.toBeNull();
    const meta = await sharp(a!).metadata();
    expect([meta.format, meta.width, meta.height]).toEqual(['webp', 128, 128]);
    expect(b).toBe(a);
    expect(calls).toBe(1);
    expect(proxy.stats.hits).toBe(1);
  });

  it('never fetches a non-allowlisted url', async () => {
    let calls = 0;
    const proxy = new AvatarProxy({ fetchImpl: (async () => { calls++; return ok(); }) as typeof fetch });
    expect(await proxy.get('https://169.254.169.254/latest/meta-data/')).toBeNull();
    expect(calls).toBe(0);
  });

  it('refuses a redirect that leaves the allowlist', async () => {
    const seen: string[] = [];
    const proxy = new AvatarProxy({
      fetchImpl: (async (u: URL) => {
        seen.push(String(u));
        return new Response(null, { status: 302, headers: { location: 'http://127.0.0.1:8080/admin' } });
      }) as unknown as typeof fetch,
    });
    expect(await proxy.get('https://p16-sign-va.tiktokcdn.com/a.jpeg')).toBeNull();
    expect(seen).toEqual(['https://p16-sign-va.tiktokcdn.com/a.jpeg']);
  });

  it('returns null for non-images, HTTP errors and oversize bodies', async () => {
    const mk = (r: () => Response) => new AvatarProxy({ maxBytes: 1000, fetchImpl: (async () => r()) as typeof fetch });
    const u = 'https://p16-sign-va.tiktokcdn.com/a.jpeg';
    expect(await mk(() => new Response('<html>', { headers: { 'content-type': 'text/html' } })).get(u)).toBeNull();
    expect(await mk(() => new Response('x', { status: 403, headers: { 'content-type': 'image/png' } })).get(u)).toBeNull();
    expect(await mk(() => new Response(new Uint8Array(5000), { headers: { 'content-type': 'image/png' } })).get(u)).toBeNull();
  });
});
