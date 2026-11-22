import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { catalogGiftByName } from '@typejoin/shared';
import { mapTikTok, type TikTokKind } from '../src/sources/tiktokMap';
import { describeTikTokError } from '../src/sources/TikTokSource';
import { Normalizer } from '../src/normalize';
import type { RawSourceEvent } from '../src/sources/EventSource';

// SYNTHETIC payloads shaped like tiktok-live-connector 2.5.0 decoded messages (see _note in the file).
const fx = JSON.parse(readFileSync(new URL('./fixtures/tiktok-samples.synthetic.json', import.meta.url), 'utf8'));
const map = (kind: TikTokKind, list: unknown[]) => list.map((d) => mapTikTok(kind, d as Record<string, unknown>));
const norm = () => new Normalizer({ joinAliases: ['join', 'j'], now: () => 1000 });
const run = (raws: (RawSourceEvent | null)[]) => {
  const n = norm();
  return raws.filter((r): r is RawSourceEvent => !!r).flatMap((r) => n.normalize(r));
};

describe('TikTok payload mapping', () => {
  it('chat: stable userId, nickname and avatar; join aliases go through the normalizer', () => {
    const raws = map('chat', fx.chat);
    expect(raws[0]).toMatchObject({
      type: 'chat', text: 'join', userId: '7300000000000000001', nickname: 'Viewer One',
      avatarUrl: 'https://p16-sign-va.tiktokcdn.com/tos-maliva-avt-0068/a1~c5_100x100.webp',
    });
    const out = run(raws);
    expect(out.map((e) => e.type)).toEqual(['join', 'chat', 'join']);
    // Variant user shape: id + displayId (empty nickname) + mUrls.
    expect(out[2]).toMatchObject({ userId: '7300000000000000003', nickname: 'viewer_three', avatarUrl: 'https://p16-sign-va.tiktokcdn.com/a3~c5_100x100.jpeg' });
  });

  it('createTime is read in ms or seconds', () => {
    const [a, , c] = map('chat', fx.chat);
    expect(a!.sourceTs).toBe(1763770800000);
    expect(c!.sourceTs).toBe(1763770801000);
  });

  it('like: per-message like delta (likeCount), not the room total; zero is dropped', () => {
    const raws = map('like', fx.like);
    expect(raws[0]).toMatchObject({ type: 'like', count: 15 });
    expect(raws[1]).toBeNull();
    expect(run(raws)).toEqual([expect.objectContaining({ type: 'like', count: 15 })]);
  });

  it('gift streak: units are new units only, the duplicate final packet and a late packet add nothing', () => {
    const out = run(map('gift', fx.giftStreak));
    expect(out.map((e) => (e.type === 'gift' ? e.units : -1))).toEqual([1, 2, 2]);
    const total = out.reduce((s, e) => s + (e.type === 'gift' ? e.units : 0), 0);
    expect(total).toBe(5);
    const rose = catalogGiftByName('Rose')!;
    expect(out[0]).toMatchObject({ type: 'gift', giftId: rose.id, giftName: 'Rose', coinsPerUnit: rose.coins, userId: '7300000000000000001' });
  });

  it('a new streak (new groupId) from the same user counts again', () => {
    const out = run([...map('gift', fx.giftStreak), ...map('gift', fx.giftSecondStreakSameUser)]);
    expect(out.reduce((s, e) => s + (e.type === 'gift' ? e.units : 0), 0)).toBe(7);
  });

  it('non-streak gift: counted once even when the packet is re-delivered; coins from the catalog', () => {
    const out = run(map('gift', fx.giftSingle));
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ type: 'gift', giftName: 'Galaxy', coinsPerUnit: catalogGiftByName('Galaxy')!.coins, units: 1 });
  });

  it('gift missing from the catalog falls back to the payload name and diamond count', () => {
    const out = run(map('gift', fx.giftUnknown));
    expect(out[0]).toMatchObject({ giftId: 99999999, giftName: 'Mystery', coinsPerUnit: 7, units: 2 });
  });

  it('follow and share', () => {
    expect(run(map('follow', fx.follow))[0]).toMatchObject({ type: 'follow', userId: '7300000000000000002' });
    expect(run(map('share', fx.share))[0]).toMatchObject({ type: 'share', userId: '7300000000000000003' });
  });

  it('payloads without a usable user or content are ignored', () => {
    expect(map('chat', fx.malformed)).toEqual([null, null, null]);
  });
});

describe('TikTok error classification', () => {
  it('tells signing, rate limit and offline errors apart', () => {
    const mk = (name: string, message: string) => Object.assign(new Error(message), { name });
    expect(describeTikTokError(mk('SignatureMissingTokensError', 'This endpoint requires a Business plan')).kind).toBe('signing');
    expect(describeTikTokError(new Error('Error connecting to WebSocket with message: illegal secret key')).kind).toBe('signing');
    expect(describeTikTokError(mk('SignatureRateLimitError', 'Too many requests')).kind).toBe('rateLimit');
    expect(describeTikTokError(new Error('HTTP 429')).kind).toBe('rateLimit');
    expect(describeTikTokError(mk('UserOfflineError', 'The requested user is not live')).kind).toBe('offline');
    expect(describeTikTokError(new Error('socket hang up')).kind).toBe('other');
  });
});
