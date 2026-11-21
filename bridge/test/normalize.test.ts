import { describe, it, expect } from 'vitest';
import { GiftStreakTracker, Normalizer } from '../src/normalize';
import type { RawSourceEvent } from '../src/sources/EventSource';

const user = { userId: 'u1', nickname: 'User One' };
const gift = (streakId: string, repeatCount: number, repeatEnd: boolean): RawSourceEvent => ({
  type: 'gift', giftId: 9001, giftName: 'Rose', coinsPerUnit: 1, streakId, repeatCount, repeatEnd, ...user,
});

describe('GiftStreakTracker', () => {
  it('reports deltas of cumulative counts', () => {
    const t = new GiftStreakTracker();
    expect(t.delta('s', 1, false)).toBe(1);
    expect(t.delta('s', 4, false)).toBe(3);
    expect(t.delta('s', 7, true)).toBe(3);
  });
  it('never double counts duplicate or out-of-order packets', () => {
    const t = new GiftStreakTracker();
    expect(t.delta('s', 5, false)).toBe(5);
    expect(t.delta('s', 3, false)).toBe(0); // late packet
    expect(t.delta('s', 5, true)).toBe(0); // end with same count
    expect(t.delta('s', 5, true)).toBe(0); // duplicate end
  });
  it('keeps separate streaks apart', () => {
    const t = new GiftStreakTracker();
    expect(t.delta('a', 2, true)).toBe(2);
    expect(t.delta('b', 2, true)).toBe(2);
  });
});

describe('Normalizer', () => {
  const n = () => new Normalizer({ joinAliases: ['join', 'j'], now: () => 1000 });

  it('turns join aliases into join events', () => {
    const norm = n();
    for (const text of ['join', 'J', ' JOIN! ', 'Join.']) {
      expect(norm.normalize({ type: 'chat', text, ...user })[0].type).toBe('join');
    }
    expect(norm.normalize({ type: 'chat', text: 'joining soon', ...user })[0].type).toBe('chat');
  });

  it('emits gift units summing to the streak total exactly once', () => {
    const norm = n();
    const packets = [gift('x', 1, false), gift('x', 3, false), gift('x', 3, false), gift('x', 6, true), gift('x', 6, true)];
    const out = packets.flatMap((p) => norm.normalize(p));
    const units = out.reduce((s, e) => s + (e.type === 'gift' ? e.units : 0), 0);
    expect(units).toBe(6);
    expect(out.every((e) => e.type === 'gift' && e.units > 0 && e.ts === 1000)).toBe(true);
  });
});
