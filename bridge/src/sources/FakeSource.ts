import { GIFT_ABILITIES, GIFT_MAP, devGifts, findGift } from '@typejoin/shared';
import type { EventSource, RawSink, RawSourceEvent, RawUser, SourceStatusListener } from './EventSource';
import { fakeAvatarUrl } from './fakeAvatar';

const ADJ = [
  'Happy', 'Sleepy', 'Turbo', 'Mega', 'Tiny', 'Lucky', 'Spicy', 'Cosmic', 'Sneaky', 'Wild',
  'Golden', 'Silent', 'Crazy', 'Funky', 'Mighty', 'Fuzzy', 'Brave', 'Shiny', 'Salty', 'Neon',
];
const NOUN = [
  'Panda', 'Tiger', 'Potato', 'Ninja', 'Dragon', 'Muffin', 'Rocket', 'Pixel', 'Otter', 'Falcon',
  'Noodle', 'Wizard', 'Cactus', 'Shark', 'Mango', 'Comet', 'Koala', 'Taco', 'Viper', 'Bubble',
];
const EXTRA = ['ayla.x', 'kamran_07', 'leyla♡', 'Nurlan', 'zehra.official', 'Émile', 'sofia_l', 'Ömer'];

/**
 * Weighted random picker for background gifts (cheap gifts are common). Same coin-tier weights as before; within a
 * tier the weight is split over the catalog gifts in it, but ability gifts keep the full tier weight so abilities
 * still show up as often as they did with the placeholder catalog. Gifts above 1000 coins are only picked when
 * they are mapped to an ability.
 */
const tierWeight = (coins: number) => coins <= 1 ? 40 : coins <= 5 ? 22 : coins <= 10 ? 15
  : coins <= 30 ? 12 : coins <= 100 ? 7 : coins <= 500 ? 3 : 1.5;
const tierOf = (coins: number) => [1, 5, 10, 30, 100, 500, 1000].find((t) => coins <= t) ?? Infinity;
const abilityIds = new Set(GIFT_ABILITIES.map((a) => GIFT_MAP[a]));
const GIFT_WEIGHTS: Record<number, number> = {};
{
  const pool = devGifts().filter((g) => g.coinsPerUnit > 0 && (g.coinsPerUnit <= 1000 || abilityIds.has(g.giftId)));
  const perTier = new Map<number, number>();
  for (const g of pool) if (!abilityIds.has(g.giftId)) perTier.set(tierOf(g.coinsPerUnit), (perTier.get(tierOf(g.coinsPerUnit)) ?? 0) + 1);
  for (const g of pool) {
    const w = tierWeight(g.coinsPerUnit);
    GIFT_WEIGHTS[g.giftId] = abilityIds.has(g.giftId) ? w : w / (perTier.get(tierOf(g.coinsPerUnit)) ?? 1);
  }
}

export interface FakeRates {
  /** Background join messages per minute. */
  joinPerMin: number;
  /** Background likes per second (all users combined). */
  likesPerSec: number;
  /** Background gifts per minute. */
  giftsPerMin: number;
}

const TICK_MS = 100;

export class FakeSource implements EventSource {
  readonly name = 'fake';
  readonly state = 'live' as const;
  onStatus(_listener: SourceStatusListener): void {
    // Always live.
  }
  readonly users: RawUser[] = [];
  rates: FakeRates = { joinPerMin: 0, likesPerSec: 0, giftsPerMin: 0 };
  /** Dev only: give fake viewers generated illustrated avatars (FAKE_AVATARS=0 or the dev panel turns it off). */
  fakeAvatars = process.env.FAKE_AVATARS !== '0';

  private sink: RawSink | null = null;
  private timer: NodeJS.Timeout | null = null;
  private pending = new Set<NodeJS.Timeout>();
  private seq = 0;
  private streakSeq = 0;

  async start(sink: RawSink): Promise<void> {
    this.sink = sink;
    this.timer = setInterval(() => this.backgroundTick(), TICK_MS);
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    for (const t of this.pending) clearTimeout(t);
    this.pending.clear();
    this.timer = null;
    this.sink = null;
  }

  // ---------- dev-panel commands ----------

  /** N brand-new fake viewers type "join". */
  addViewers(n: number): RawUser[] {
    const out: RawUser[] = [];
    for (let i = 0; i < Math.min(500, Math.max(0, n)); i++) {
      const u = this.createUser();
      out.push(u);
      // Stagger slightly so it looks like a real chat burst.
      this.later(i * 40 + Math.random() * 200, () => this.emit({ type: 'chat', text: this.joinText(), ...u }));
    }
    return out;
  }

  /** Every known fake viewer types "join" again (useful during the join window). */
  rejoinAll(): void {
    this.users.forEach((u, i) => {
      this.later(i * 30 + Math.random() * 400, () => this.emit({ type: 'chat', text: this.joinText(), ...u }));
    });
  }

  likeBurst(total: number, userId?: string): void {
    let left = Math.min(100_000, Math.max(0, Math.floor(total)));
    let delay = 0;
    while (left > 0) {
      const count = Math.min(left, 1 + Math.floor(Math.random() * 15));
      left -= count;
      const u = userId ? this.getUser(userId) : this.randomUser();
      this.later(delay, () => this.emit({ type: 'like', count, ...u }));
      delay += 15;
    }
  }

  /**
   * Send a gift. Streakable gifts are delivered TikTok-style: several updates with
   * cumulative repeatCount, a final repeatEnd packet, and a duplicate of that final
   * packet (the bridge must not double count it).
   */
  gift(giftId: number, units = 1, userId?: string): boolean {
    const def = findGift(giftId);
    if (!def) return false;
    const u = userId ? this.getUser(userId) : this.randomUser();
    const total = Math.max(1, Math.floor(units));
    const streakId = `fake-${u.userId}-${giftId}-${++this.streakSeq}`;
    const mk = (repeatCount: number, repeatEnd: boolean): RawSourceEvent => ({
      type: 'gift',
      giftId: def.giftId,
      giftName: def.giftName,
      coinsPerUnit: def.coinsPerUnit,
      streakId,
      repeatCount,
      repeatEnd,
      ...u,
    });
    if (!def.streakable || total === 1) {
      this.emit(mk(total, true));
      this.later(250, () => this.emit(mk(total, true))); // duplicate final packet
      return true;
    }
    let count = 0;
    let delay = 0;
    while (count < total) {
      count = Math.min(total, count + 1 + Math.floor(Math.random() * 3));
      const c = count;
      this.later(delay, () => this.emit(mk(c, false)));
      delay += 220;
    }
    this.later(delay + 200, () => this.emit(mk(total, true)));
    this.later(delay + 500, () => this.emit(mk(total, true))); // duplicate final packet
    return true;
  }

  follow(userId?: string): void {
    this.emit({ type: 'follow', ...(userId ? this.getUser(userId) : this.randomUser()) });
  }

  share(userId?: string): void {
    this.emit({ type: 'share', ...(userId ? this.getUser(userId) : this.randomUser()) });
  }

  chat(text: string, userId?: string): void {
    this.emit({ type: 'chat', text, ...(userId ? this.getUser(userId) : this.randomUser()) });
  }

  setRates(r: Partial<FakeRates>): void {
    const clamp = (v: unknown, max: number, cur: number) =>
      typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(0, v)) : cur;
    this.rates = {
      joinPerMin: clamp(r.joinPerMin, 600, this.rates.joinPerMin),
      likesPerSec: clamp(r.likesPerSec, 500, this.rates.likesPerSec),
      giftsPerMin: clamp(r.giftsPerMin, 300, this.rates.giftsPerMin),
    };
  }

  // ---------- internals ----------

  private backgroundTick(): void {
    const dt = TICK_MS / 1000;
    if (Math.random() < (this.rates.joinPerMin / 60) * dt) {
      // Mix of new viewers and returning viewers re-typing join (needed after being eaten).
      const u = this.users.length > 0 && Math.random() < 0.45 ? this.randomUser() : this.createUser();
      this.emit({ type: 'chat', text: this.joinText(), ...u });
    }
    if (this.users.length > 0) {
      let likes = poisson(this.rates.likesPerSec * dt);
      while (likes > 0) {
        const c = Math.min(likes, 1 + Math.floor(Math.random() * 15));
        likes -= c;
        this.emit({ type: 'like', count: c, ...this.randomUser() });
      }
      if (Math.random() < (this.rates.giftsPerMin / 60) * dt) {
        const giftId = weightedPick(GIFT_WEIGHTS);
        const def = findGift(giftId)!;
        const units = def.streakable && Math.random() < 0.5 ? 2 + Math.floor(Math.random() * 9) : 1;
        this.gift(giftId, units);
      }
      if (Math.random() < 0.6 * dt) {
        const lines = ['lol', 'go go go', 'who is winning?', 'nice', '🔥🔥🔥', 'eat him!', 'gg'];
        this.chat(lines[Math.floor(Math.random() * lines.length)]);
      }
    }
  }

  private joinText(): string {
    const r = Math.random();
    return r < 0.6 ? 'join' : r < 0.8 ? 'j' : r < 0.9 ? 'JOIN!' : 'Join';
  }

  private createUser(): RawUser {
    const n = ++this.seq;
    const nickname = Math.random() < 0.15
      ? `${EXTRA[Math.floor(Math.random() * EXTRA.length)]}${n}`
      : `${ADJ[Math.floor(Math.random() * ADJ.length)]}${NOUN[Math.floor(Math.random() * NOUN.length)]}${n % 100}`;
    const u: RawUser = { userId: `fake_${n}`, nickname }; // no avatar: game uses initials
    this.users.push(u);
    return u;
  }

  private randomUser(): RawUser {
    if (this.users.length === 0) return this.createUser();
    return this.users[Math.floor(Math.random() * this.users.length)];
  }

  private getUser(userId: string): RawUser {
    return this.users.find((u) => u.userId === userId) ?? this.randomUser();
  }

  private emit(e: RawSourceEvent): void {
    this.sink?.(this.fakeAvatars && !e.avatarUrl ? { ...e, avatarUrl: fakeAvatarUrl(e.userId) } : e);
  }

  private later(ms: number, fn: () => void): void {
    if (ms <= 0) return fn();
    const t = setTimeout(() => {
      this.pending.delete(t);
      fn();
    }, ms);
    this.pending.add(t);
  }
}

function poisson(lambda: number): number {
  if (lambda <= 0) return 0;
  if (lambda > 30) return Math.max(0, Math.round(lambda + Math.sqrt(lambda) * gauss()));
  const L = Math.exp(-lambda);
  let k = 0;
  let p = 1;
  do {
    k++;
    p *= Math.random();
  } while (p > L);
  return k - 1;
}

function gauss(): number {
  return Math.sqrt(-2 * Math.log(Math.random() || 1e-9)) * Math.cos(2 * Math.PI * Math.random());
}

function weightedPick(weights: Record<number, number>): number {
  const entries = Object.entries(weights);
  const total = entries.reduce((s, [, w]) => s + w, 0);
  let r = Math.random() * total;
  for (const [k, w] of entries) {
    r -= w;
    if (r <= 0) return Number(k);
  }
  return Number(entries[entries.length - 1][0]);
}
