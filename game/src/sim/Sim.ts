import type { GameEvent } from '@typejoin/shared';
import { CONFIG, crowdScaleTarget, pelletTarget, radiusForMass, speedForMass, type AbilityId, type Config } from '../config';
import { think } from './ai';
import { Leaderboard } from './leaderboard';
import type {
  Ball, Pellet, PelletKind, Phase, Player, Projectile, QueuedGift, RoundResults, SimEvent, Spike, Temperament,
} from './types';
import { PointGrid, clamp, deepMerge, makeRng, type DeepPartial } from './util';

export interface SimOptions {
  seed?: number;
  config?: DeepPartial<Config>;
}

interface PendingShot {
  senderId: string;
  fireAt: number;
}

/**
 * The whole game simulation. Pure logic, no rendering. Advance with step(1/60).
 * Feed live events with handleEvent(). Renderer reads the public state and drains events().
 */
export class Sim {
  readonly cfg: Config;
  readonly rand: () => number;
  time = 0;

  balls: Ball[] = [];
  pellets: Pellet[] = [];
  spikes: Spike[] = [];
  projectiles: Projectile[] = [];
  readonly players = new Map<string, Player>();
  readonly leaderboard: Leaderboard;

  phase: Phase = 'join';
  phaseEndsAt = 0;
  roundNo = 0;
  feastProgress = 0;
  feastUntil = 0;
  kingOwner: string | null = null;
  lastResults: RoundResults | null = null;
  /** Uniform radius multiplier for crowding (1 = normal, never below crowding.minScale). */
  sizeScale = 1;

  private events: SimEvent[] = [];
  private nextId = 1;
  private botSeq = 0;
  private nextBotAt = 0;
  private pelletAcc = 0;
  private feastAcc = 0;
  private feastWasActive = false;
  private pendingShots: PendingShot[] = [];
  private pelletGrid: PointGrid<Pellet>;
  private ballIndex = new Map<number, Ball>();

  constructor(opts: SimOptions = {}) {
    this.cfg = deepMerge(CONFIG, opts.config);
    this.rand = makeRng(opts.seed ?? 12345);
    this.leaderboard = new Leaderboard(this.cfg);
    this.pelletGrid = new PointGrid<Pellet>(64);
    this.startRound();
  }

  // ======================= public helpers =======================

  drainEvents(): SimEvent[] {
    const e = this.events;
    this.events = [];
    return e;
  }

  ballById(id: number): Ball | undefined {
    return this.ballIndex.get(id);
  }

  ballsOf(ownerId: string): Ball[] {
    return this.balls.filter((b) => b.ownerId === ownerId);
  }

  ownerMass(ownerId: string): number {
    let m = 0;
    for (const b of this.balls) if (b.ownerId === ownerId) m += b.mass;
    return m;
  }

  largestBallOf(ownerId: string): Ball | undefined {
    let best: Ball | undefined;
    for (const b of this.balls) if (b.ownerId === ownerId && (!best || b.mass > best.mass)) best = b;
    return best;
  }

  /** A ball that currently can neither deal nor take damage. */
  isHarmless(b: Ball): boolean {
    if (b.protectedUntil > this.time) return true;
    const p = this.players.get(b.ownerId);
    return !!p && p.shieldUntil > this.time;
  }

  combatEnabled(): boolean {
    return this.phase === 'play' || this.phase === 'storm';
  }

  stormActive(): boolean {
    return this.phase === 'storm';
  }

  phaseTimeLeft(): number {
    return Math.max(0, this.phaseEndsAt - this.time);
  }

  /** Current safe-zone radius (full arena outside the storm). */
  safeRadius(): number {
    const R = this.cfg.arena.radius;
    if (this.phase !== 'storm') return R;
    const dur = this.cfg.round.stormSec;
    const t = clamp(1 - this.phaseTimeLeft() / dur, 0, 1);
    const e = t * t * (3 - 2 * t); // smoothstep
    return R * (1 - (1 - this.cfg.round.stormMinRadiusFrac) * e);
  }

  feastActive(): boolean {
    return this.feastUntil > this.time;
  }

  /** Live ranking of real players by total mass. */
  topOwners(n: number): { ownerId: string; nickname: string; avatarUrl?: string; mass: number }[] {
    const totals = new Map<string, number>();
    for (const b of this.balls) if (!b.isBot) totals.set(b.ownerId, (totals.get(b.ownerId) ?? 0) + b.mass);
    return [...totals.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, n)
      .map(([ownerId, mass]) => {
        const p = this.players.get(ownerId)!;
        return { ownerId, nickname: p.nickname, avatarUrl: p.avatarUrl, mass };
      });
  }

  nearestPellet(x: number, y: number): Pellet | undefined {
    let best: Pellet | undefined;
    let bd = Infinity;
    for (const p of this.pellets) {
      if (p.eaten) continue;
      const d = (p.x - x) ** 2 + (p.y - y) ** 2;
      if (d < bd) {
        bd = d;
        best = p;
      }
    }
    return best;
  }

  nearestSmallerBall(b: Ball): Ball | undefined {
    let best: Ball | undefined;
    let bd = Infinity;
    for (const o of this.balls) {
      if (o.ownerId === b.ownerId || o.mass >= b.mass || this.isHarmless(o)) continue;
      const d = (o.x - b.x) ** 2 + (o.y - b.y) ** 2;
      if (d < bd) {
        bd = d;
        best = o;
      }
    }
    return best;
  }

  siblingOf(b: Ball): Ball | undefined {
    let best: Ball | undefined;
    let bd = Infinity;
    for (const o of this.balls) {
      if (o === b || o.ownerId !== b.ownerId) continue;
      const d = (o.x - b.x) ** 2 + (o.y - b.y) ** 2;
      if (d < bd) {
        bd = d;
        best = o;
      }
    }
    return best;
  }

  /** Drawn + collision radius for a mass, including the crowding scale. Rules still use mass. */
  radiusFor(mass: number): number {
    return radiusForMass(mass, this.cfg) * this.sizeScale;
  }

  /** Real (non-bot) players that currently have at least one ball. */
  realPlayerCount(): number {
    const s = new Set<string>();
    for (const b of this.balls) if (!b.isBot) s.add(b.ownerId);
    return s.size;
  }

  pelletTarget(): number {
    return pelletTarget(this.realPlayerCount(), this.cfg);
  }

  // ======================= events from the bridge =======================

  handleEvent(e: GameEvent): void {
    switch (e.type) {
      case 'join':
        return this.onJoin(e.userId, e.nickname, e.avatarUrl);
      case 'gift':
        return this.onGift(e.userId, e.nickname, e.avatarUrl, {
          giftId: e.giftId, coinsPerUnit: e.coinsPerUnit, units: e.units,
        }, e.giftName);
      case 'like':
        return this.onLike(e.userId, e.nickname, e.avatarUrl, e.count);
      case 'follow':
      case 'share':
        return this.onSocial(e.userId, e.nickname, e.avatarUrl, e.type);
      case 'chat':
        this.touchPlayer(e.userId, e.nickname, e.avatarUrl);
        return;
    }
  }

  private touchPlayer(userId: string, nickname: string, avatarUrl?: string): Player {
    let p = this.players.get(userId);
    if (!p) {
      p = this.newPlayer(userId, nickname, avatarUrl, false);
      this.players.set(userId, p);
    } else {
      p.nickname = nickname || p.nickname;
      if (avatarUrl) p.avatarUrl = avatarUrl;
    }
    return p;
  }

  private newPlayer(userId: string, nickname: string, avatarUrl: string | undefined, isBot: boolean): Player {
    return {
      userId, nickname, avatarUrl, isBot,
      kills: 0, gifted: false, followUsed: false, shareUsed: false,
      rejoinAt: 0, revengeTarget: null, revengeUntil: 0,
      likeWindowStart: -1, likeWindowCount: 0,
      shieldUntil: 0, magnetUntil: 0, dashUntil: 0, blackHoleUntil: 0, dashTargetId: null,
      pendingAbilities: [], pendingGifts: [], carryGifts: [], queuedJoin: false, everJoinedThisRound: false,
    };
  }

  private onJoin(userId: string, nickname: string, avatarUrl?: string): void {
    const p = this.touchPlayer(userId, nickname, avatarUrl);
    if (this.phase === 'results') {
      p.queuedJoin = true;
      return;
    }
    if (this.ownerMass(userId) > 0 || this.ballsOf(userId).length > 0) return;
    if (this.time < p.rejoinAt) return; // rejoin cooldown after being eaten
    this.spawnPlayerBall(p);
  }

  private onGift(userId: string, nickname: string, avatarUrl: string | undefined, g: QueuedGift, giftName?: string): void {
    const p = this.touchPlayer(userId, nickname, avatarUrl);
    if (!(g.units > 0)) return;
    if (this.phase === 'results') {
      p.carryGifts.push(g); // applied at the start of the next round; never lost
      this.emitQueued(p, g, giftName, 'nextRound');
      return;
    }
    if (this.ballsOf(userId).length === 0) {
      if (this.time < p.rejoinAt) {
        p.pendingGifts.push(g); // auto-join as soon as the cooldown ends
        this.emitQueued(p, g, giftName, 'respawn');
        return;
      }
      this.spawnPlayerBall(p);
    }
    this.applyGift(p, g, giftName);
  }

  /** Lets the sender see that a gift sent while they cannot play right now was registered. */
  private emitQueued(p: Player, g: QueuedGift, giftName: string | undefined, when: 'nextRound' | 'respawn'): void {
    const ability = this.cfg.gifts.abilities[g.giftId];
    const row = ability ? this.cfg.legend.find((l) => l.ability === ability) : undefined;
    const what = row?.label ?? giftName ?? 'Gift';
    this.emit({ type: 'giftQueued', ownerId: p.userId, nickname: p.nickname, what, when });
  }

  /** Mass + ability. Requires the player to have a ball. */
  applyGift(p: Player, g: QueuedGift, giftName?: string): void {
    const mass = g.coinsPerUnit * g.units * this.cfg.gifts.massPerCoin;
    const b = this.largestBallOf(p.userId);
    if (!b) return;
    b.mass += mass;
    b.radius = this.radiusFor(b.mass);
    p.gifted = true;
    this.emit({ type: 'gift', ownerId: p.userId, mass, giftName });
    const ability = this.cfg.gifts.abilities[g.giftId];
    if (ability) {
      if (this.combatEnabled()) this.activateAbility(p, ability, g.units);
      else p.pendingAbilities.push({ ability, units: g.units });
    }
  }

  private onLike(userId: string, nickname: string, avatarUrl: string | undefined, count: number): void {
    const p = this.touchPlayer(userId, nickname, avatarUrl);
    const n = Math.max(0, Math.floor(count));
    this.feastProgress += n;
    const b = this.largestBallOf(userId);
    if (!b || this.phase === 'results') return;
    if (this.time - p.likeWindowStart >= 1 || p.likeWindowStart < 0) {
      p.likeWindowStart = this.time;
      p.likeWindowCount = 0;
    }
    const allowed = Math.min(n, this.cfg.likes.maxPerSecPerUser - p.likeWindowCount);
    if (allowed <= 0) return;
    p.likeWindowCount += allowed;
    b.mass += allowed * this.cfg.likes.massPerLike;
    b.radius = this.radiusFor(b.mass);
  }

  private onSocial(userId: string, nickname: string, avatarUrl: string | undefined, kind: 'follow' | 'share'): void {
    const p = this.touchPlayer(userId, nickname, avatarUrl);
    const b = this.largestBallOf(userId);
    if (!b || this.phase === 'results') return;
    if (kind === 'follow') {
      if (p.followUsed) return;
      p.followUsed = true;
      b.mass += this.cfg.social.followMass;
    } else {
      if (p.shareUsed) return;
      p.shareUsed = true;
      b.mass += this.cfg.social.shareMass;
    }
    b.radius = this.radiusFor(b.mass);
  }

  // ======================= abilities =======================

  activateAbility(p: Player, ability: AbilityId, units: number): void {
    const a = this.cfg.abilities;
    const extend = (until: number, add: number, maxSec = a.maxDurationSec) =>
      Math.min(this.time + maxSec, Math.max(until, this.time) + add);
    switch (ability) {
      case 'dash':
        p.dashUntil = extend(p.dashUntil, a.dash.sec * units, a.dash.maxSec);
        p.dashTargetId = null;
        break;
      case 'shield':
        p.shieldUntil = extend(p.shieldUntil, a.shield.sec * units);
        break;
      case 'magnet':
        p.magnetUntil = extend(p.magnetUntil, a.magnet.sec * units);
        break;
      case 'blackHole':
        p.blackHoleUntil = extend(
          p.blackHoleUntil, a.blackHole.sec + a.blackHole.secPerExtraUnit * Math.max(0, units - 1), a.blackHole.maxSec);
        break;
      case 'spikeShot': {
        // Each unit is one shot, fired in sequence after any shots still queued for this sender.
        let base = this.time;
        for (const s of this.pendingShots) if (s.senderId === p.userId) base = Math.max(base, s.fireAt + a.spikeShot.staggerSec);
        for (let i = 0; i < units; i++) this.pendingShots.push({ senderId: p.userId, fireAt: base + i * a.spikeShot.staggerSec });
        break;
      }
    }
    this.emit({ type: 'ability', ability, ownerId: p.userId, nickname: p.nickname, units });
  }

  /** Target for a spike shot: revenge target, else the King, else the biggest other ball. */
  spikeShotTarget(senderId: string): Ball | undefined {
    const p = this.players.get(senderId);
    if (p?.revengeTarget && p.revengeUntil > this.time) {
      const b = this.largestBallOf(p.revengeTarget);
      if (b) return b;
    }
    if (this.kingOwner && this.kingOwner !== senderId) {
      const b = this.largestBallOf(this.kingOwner);
      if (b) return b;
    }
    let best: Ball | undefined;
    for (const b of this.balls) if (b.ownerId !== senderId && (!best || b.mass > best.mass)) best = b;
    return best;
  }

  private fireSpikeShot(senderId: string): void {
    const target = this.spikeShotTarget(senderId);
    if (!target) return;
    const { cx, cy, radius } = this.cfg.arena;
    const ang = Math.atan2(target.y - cy, target.x - cx) + Math.PI + (this.rand() - 0.5) * (Math.PI / 1.5);
    const x = cx + Math.cos(ang) * radius, y = cy + Math.sin(ang) * radius;
    const d = Math.hypot(target.x - x, target.y - y) || 1;
    const s = this.cfg.abilities.spikeShot.speed;
    this.projectiles.push({
      id: this.nextId++, senderId, targetBallId: target.id, x, y,
      vx: ((target.x - x) / d) * s, vy: ((target.y - y) / d) * s, born: this.time, alive: true,
    });
  }

  // ======================= spawning =======================

  private findSpawnPoint(radius: number): { x: number; y: number } {
    const { cx, cy } = this.cfg.arena;
    const R = Math.max(10, this.safeRadius() - radius - 4);
    let best = { x: cx, y: cy };
    let bestScore = -Infinity;
    const myMass = this.cfg.ball.startMass;
    for (let i = 0; i < 40; i++) {
      const a = this.rand() * Math.PI * 2;
      const r = Math.sqrt(this.rand()) * R;
      const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
      let score = 1e9;
      for (const b of this.balls) {
        const gap = Math.hypot(b.x - x, b.y - y) - b.radius - radius;
        // Keep well away from bigger balls; smaller ones only matter for overlap.
        const s = b.mass >= myMass ? gap - b.radius * 0.5 : gap * 2;
        if (s < score) score = s;
      }
      for (const s of this.spikes) {
        if (!s.active) continue;
        const gap = Math.hypot(s.x - x, s.y - y) - this.cfg.spikes.radius - radius;
        if (gap < score) score = gap;
      }
      if (score > bestScore) {
        bestScore = score;
        best = { x, y };
      }
    }
    return best;
  }

  private makeBall(ownerId: string, isBot: boolean, mass: number, x: number, y: number, temperament?: Temperament): Ball {
    const b: Ball = {
      id: this.nextId++, ownerId, isBot, mass, radius: this.radiusFor(mass),
      x, y, px: x, py: y, vx: 0, vy: 0,
      temperament: temperament ?? (this.rand() < this.cfg.ai.boldChance ? 'bold' : 'cautious'),
      spawnedAt: this.time, protectedUntil: this.time + this.cfg.ball.spawnProtectionSec, mergeAt: 0,
      aiMode: 'wander', aiDx: 0, aiDy: 0, aiNextThink: this.time + this.rand() * this.cfg.ai.thinkIntervalSec,
      wanderAngle: this.rand() * Math.PI * 2, wanderUntil: 0,
      inContact: false, lastDamagerOwner: null, lastDamagedAt: -1, spillAcc: 0, spillX: x, spillY: y, massBefore: mass,
      contactRef: mass, contactRefAt: -1, swallowerId: 0,
    };
    this.balls.push(b);
    this.ballIndex.set(b.id, b);
    return b;
  }

  spawnPlayerBall(p: Player): Ball {
    const r = this.radiusFor(this.cfg.ball.startMass);
    const pt = this.findSpawnPoint(r);
    const b = this.makeBall(p.userId, p.isBot, this.cfg.ball.startMass, pt.x, pt.y);
    p.everJoinedThisRound = true;
    this.emit({ type: 'spawn', ballId: b.id, ownerId: p.userId, isBot: p.isBot });
    if (!p.isBot) this.trimBots();
    // Gifts that waited for this spawn.
    if (p.pendingGifts.length) {
      const q = p.pendingGifts;
      p.pendingGifts = [];
      for (const g of q) this.applyGift(p, g);
    }
    return b;
  }

  /** Test/debug helper: place a ball directly. */
  debugSpawn(o: { ownerId: string; mass: number; x: number; y: number; protectedSec?: number; isBot?: boolean; nickname?: string }): Ball {
    let p = this.players.get(o.ownerId);
    if (!p) {
      p = this.newPlayer(o.ownerId, o.nickname ?? o.ownerId, undefined, !!o.isBot);
      this.players.set(o.ownerId, p);
    }
    p.everJoinedThisRound = true;
    const b = this.makeBall(o.ownerId, p.isBot, o.mass, o.x, o.y);
    b.protectedUntil = this.time + (o.protectedSec ?? 0);
    return b;
  }

  /** Test/debug helper: jump to a phase (runs its enter logic). */
  debugSetPhase(phase: Phase): void {
    this.enterPhase(phase);
  }

  private spawnBot(): void {
    const id = `bot:${++this.botSeq}`;
    const p = this.newPlayer(id, '', undefined, true);
    this.players.set(id, p);
    this.spawnPlayerBall(p);
  }

  /** Remove bots while there are more balls than the bot floor requires. */
  private trimBots(): void {
    while (this.balls.length > this.cfg.bots.minBalls) {
      let victim: Ball | undefined;
      for (const b of this.balls) if (b.isBot && (!victim || b.mass < victim.mass)) victim = b;
      if (!victim) return;
      this.emit({ type: 'botLeft', ballId: victim.id, x: victim.x, y: victim.y });
      this.removeBall(victim);
      this.players.delete(victim.ownerId);
    }
  }

  private spawnPellet(kind: PelletKind, value: number, x?: number, y?: number, vx = 0, vy = 0): Pellet | undefined {
    if (this.pellets.length >= this.cfg.pellets.maxTotal) return undefined;
    if (x === undefined || y === undefined) {
      const { cx, cy } = this.cfg.arena;
      const R = this.safeRadius() - 12;
      const a = this.rand() * Math.PI * 2;
      const r = Math.sqrt(this.rand()) * R;
      x = cx + Math.cos(a) * r;
      y = cy + Math.sin(a) * r;
    }
    const p: Pellet = { id: this.nextId++, x, y, vx, vy, value, kind, born: this.time, eaten: false };
    this.pellets.push(p);
    return p;
  }

  private placeSpike(s: Spike): void {
    const { cx, cy, radius } = this.cfg.arena;
    let best = { x: cx, y: cy }, bestScore = -Infinity;
    for (let i = 0; i < 30; i++) {
      const a = this.rand() * Math.PI * 2;
      const r = (0.25 + 0.6 * Math.sqrt(this.rand())) * (radius - 60);
      const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
      let score = 1e9;
      for (const b of this.balls) score = Math.min(score, Math.hypot(b.x - x, b.y - y) - b.radius);
      for (const o of this.spikes) if (o !== s && o.active) score = Math.min(score, Math.hypot(o.x - x, o.y - y) * 0.5);
      if (score > bestScore) {
        bestScore = score;
        best = { x, y };
      }
    }
    s.x = best.x;
    s.y = best.y;
    s.active = true;
  }

  // ======================= round flow =======================

  private startRound(): void {
    this.roundNo++;
    for (const b of this.balls) this.ballIndex.delete(b.id);
    this.balls = [];
    this.pellets = [];
    this.projectiles = [];
    this.pendingShots = [];
    this.kingOwner = null;
    this.feastUntil = 0;
    // Bots are recreated per round.
    for (const [id, p] of this.players) if (p.isBot) this.players.delete(id);
    for (const p of this.players.values()) {
      const carry = [...p.carryGifts, ...p.pendingGifts];
      const queued = p.queuedJoin;
      Object.assign(p, {
        kills: 0, gifted: false, followUsed: false, shareUsed: false, rejoinAt: 0,
        revengeTarget: null, revengeUntil: 0, likeWindowStart: -1, likeWindowCount: 0,
        shieldUntil: 0, magnetUntil: 0, dashUntil: 0, blackHoleUntil: 0, dashTargetId: null,
        pendingAbilities: [], pendingGifts: [], carryGifts: [], queuedJoin: false, everJoinedThisRound: false,
      } satisfies Partial<Player>);
      p.pendingGifts = carry;
      if (queued || carry.length) p.queuedJoin = true;
    }
    this.spikes = [];
    for (let i = 0; i < this.cfg.spikes.count; i++) {
      const s: Spike = { id: this.nextId++, x: 0, y: 0, active: false, respawnAt: 0 };
      this.spikes.push(s);
      this.placeSpike(s);
    }
    this.sizeScale = 1;
    for (let i = 0; i < this.cfg.pellets.target; i++) this.spawnPellet('normal', this.cfg.pellets.value);
    this.enterPhase('join');
    for (const p of [...this.players.values()]) {
      if (p.queuedJoin) {
        p.queuedJoin = false;
        this.spawnPlayerBall(p); // applies pending (carried) gifts too
      }
    }
  }

  private enterPhase(phase: Phase): void {
    const r = this.cfg.round;
    this.phase = phase;
    const dur = phase === 'join' ? r.joinSec : phase === 'play' ? r.playSec : phase === 'storm' ? r.stormSec : r.resultsSec;
    this.phaseEndsAt = this.time + dur;
    if (phase === 'play' || phase === 'storm') {
      for (const p of this.players.values()) {
        const q = p.pendingAbilities;
        p.pendingAbilities = [];
        for (const a of q) this.activateAbility(p, a.ability, a.units);
      }
    }
    if (phase === 'results') this.finishRound();
    this.emit({ type: 'phase', phase, roundNo: this.roundNo });
  }

  private finishRound(): void {
    const totals = new Map<string, number>();
    for (const b of this.balls) if (!b.isBot) totals.set(b.ownerId, (totals.get(b.ownerId) ?? 0) + b.mass);
    const entry = (userId: string, value: number) => {
      const p = this.players.get(userId)!;
      return { userId, nickname: p.nickname, avatarUrl: p.avatarUrl, value };
    };
    const ranked = [...totals.entries()].sort((a, b) => b[1] - a[1]);
    const king = ranked[0] ? entry(ranked[0][0], ranked[0][1]) : null;
    let killer: RoundResults['killer'] = null;
    for (const p of this.players.values()) {
      if (p.isBot || p.kills <= 0) continue;
      if (!killer || p.kills > killer.value) killer = entry(p.userId, p.kills);
    }
    const free = ranked.find(([id]) => !this.players.get(id)!.gifted);
    const bestFree = free ? entry(free[0], free[1]) : null;
    const realPlayers = [...this.players.values()].filter((p) => !p.isBot && p.everJoinedThisRound);
    this.leaderboard.addRound(ranked.map(([id]) => this.players.get(id)!), realPlayers);
    this.lastResults = { roundNo: this.roundNo, king, killer, bestFree, top: this.leaderboard.top(this.cfg.leaderboard.showTop) };
    // Gifts still waiting for a respawn carry into the next round.
    for (const p of this.players.values()) {
      if (p.pendingGifts.length) {
        p.carryGifts.push(...p.pendingGifts);
        p.pendingGifts = [];
      }
    }
    this.emit({ type: 'results', results: this.lastResults });
  }

  // ======================= main step =======================

  step(dt = 1 / this.cfg.sim.hz): void {
    this.time += dt;
    for (const b of this.balls) {
      b.px = b.x;
      b.py = b.y;
      b.massBefore = b.mass;
      b.inContact = false;
      b.swallowerId = 0;
    }

    if (this.time >= this.phaseEndsAt) {
      if (this.phase === 'join') this.enterPhase('play');
      else if (this.phase === 'play') this.enterPhase('storm');
      else if (this.phase === 'storm') this.enterPhase('results');
      else this.startRound();
    }
    if (this.phase === 'results') return; // world is frozen behind the results screen

    this.processQueues();
    this.updateSizeScale(dt);
    this.pelletGrid.rebuild(this.pellets);
    this.moveBalls(dt);
    this.applyFieldAbilities(dt);
    this.movePellets(dt);
    this.pelletGrid.rebuild(this.pellets);
    this.eatPellets();
    this.contacts(dt);
    this.spikeCollisions();
    this.updateProjectiles(dt);
    this.massEffects(dt);
    this.flushSpill();
    this.removeDead();
    this.mergePieces();
    this.respawnPellets(dt);
    this.updateKing();
  }

  private processQueues(): void {
    // Gifts that waited for a rejoin cooldown: auto-join now.
    for (const p of this.players.values()) {
      if (p.pendingGifts.length && this.time >= p.rejoinAt && this.ballsOf(p.userId).length === 0) {
        this.spawnPlayerBall(p);
      }
    }
    // Staggered spike shots.
    if (this.pendingShots.length && this.combatEnabled()) {
      const due = this.pendingShots.filter((s) => s.fireAt <= this.time);
      if (due.length) {
        this.pendingShots = this.pendingShots.filter((s) => s.fireAt > this.time);
        for (const s of due) this.fireSpikeShot(s.senderId);
      }
    }
    // Bots keep the arena lively.
    if (this.balls.length < this.cfg.bots.minBalls && this.time >= this.nextBotAt) {
      this.spawnBot();
      this.nextBotAt = this.time + this.cfg.bots.spawnIntervalSec;
    }
    // Feast trigger.
    while (this.feastProgress >= this.cfg.likes.feastLikes) {
      this.feastProgress -= this.cfg.likes.feastLikes;
      const wasActive = this.feastActive();
      this.feastUntil = Math.max(this.feastUntil, this.time) + this.cfg.likes.feastSec;
      if (!wasActive) this.emit({ type: 'feast', active: true });
    }
  }

  /** Crowding: shrink every radius uniformly (and smoothly) when balls cover too much of the arena. */
  updateSizeScale(dt: number): void {
    let area = 0;
    for (const b of this.balls) {
      const r = radiusForMass(b.mass, this.cfg);
      area += Math.PI * r * r;
    }
    const target = crowdScaleTarget(area, this.cfg);
    const k = 1 - Math.exp(-this.cfg.crowding.smoothPerSec * dt);
    this.sizeScale += (target - this.sizeScale) * k;
    if (Math.abs(target - this.sizeScale) < 1e-4) this.sizeScale = target;
    for (const b of this.balls) b.radius = this.radiusFor(b.mass);
  }

  private moveBalls(dt: number): void {
    const c = this.cfg;
    const accel = Math.min(1, c.ball.accel * dt);
    for (const b of this.balls) {
      if (this.time >= b.aiNextThink) {
        think(this, b);
        b.aiNextThink = this.time + c.ai.thinkIntervalSec;
      }
      const p = this.players.get(b.ownerId);
      let speed = speedForMass(b.mass, c);
      if (p && p.dashUntil > this.time) speed *= c.abilities.dash.speedMul;
      const tx = b.aiDx * speed, ty = b.aiDy * speed;
      b.vx += (tx - b.vx) * accel;
      b.vy += (ty - b.vy) * accel;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      this.constrain(b);
    }
  }

  private constrain(b: Ball): void {
    const { cx, cy, radius } = this.cfg.arena;
    const dx = b.x - cx, dy = b.y - cy;
    const d = Math.hypot(dx, dy);
    const lim = Math.max(0, radius - b.radius);
    if (d > lim && d > 0) {
      const nx = dx / d, ny = dy / d;
      b.x = cx + nx * lim;
      b.y = cy + ny * lim;
      const vn = b.vx * nx + b.vy * ny;
      if (vn > 0) {
        b.vx -= vn * nx;
        b.vy -= vn * ny;
      }
    }
  }

  /** Magnet and black hole pulls. */
  private applyFieldAbilities(dt: number): void {
    const A = this.cfg.abilities;
    for (const p of this.players.values()) {
      const hole = p.blackHoleUntil > this.time;
      const mag = p.magnetUntil > this.time;
      if (!hole && !mag) continue;
      for (const src of this.ballsOf(p.userId)) {
        const f = hole ? A.blackHole : A.magnet;
        this.pelletGrid.query(src.x, src.y, f.range, (pl) => {
          const dx = src.x - pl.x, dy = src.y - pl.y;
          const d = Math.hypot(dx, dy);
          if (d > f.range || d < 1) return;
          const step = Math.min(d, f.pelletPull * dt * (0.5 + (1 - d / f.range)));
          pl.x += (dx / d) * step;
          pl.y += (dy / d) * step;
        });
        for (const o of this.balls) {
          if (o.ownerId === p.userId || this.isHarmless(o)) continue;
          if (o.mass >= src.mass * f.ballMassRatio) continue;
          const dx = src.x - o.x, dy = src.y - o.y;
          const d = Math.hypot(dx, dy);
          if (d > f.range + src.radius || d < 1) continue;
          const step = Math.min(d, f.ballPull * dt * (0.4 + (1 - d / (f.range + src.radius))));
          o.x += (dx / d) * step;
          o.y += (dy / d) * step;
        }
      }
    }
  }

  private movePellets(dt: number): void {
    const damp = Math.exp(-4 * dt);
    for (const p of this.pellets) {
      if (p.vx === 0 && p.vy === 0) continue;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= damp;
      p.vy *= damp;
      if (Math.abs(p.vx) + Math.abs(p.vy) < 2) p.vx = p.vy = 0;
      const { cx, cy, radius } = this.cfg.arena;
      const d = Math.hypot(p.x - cx, p.y - cy);
      if (d > radius - 8) {
        p.x = cx + ((p.x - cx) / d) * (radius - 8);
        p.y = cy + ((p.y - cy) / d) * (radius - 8);
      }
    }
  }

  private eatPellets(): void {
    let any = false;
    for (const b of this.balls) {
      this.pelletGrid.query(b.x, b.y, b.radius, (p) => {
        if (p.eaten) return;
        if ((p.x - b.x) ** 2 + (p.y - b.y) ** 2 > b.radius * b.radius) return;
        p.eaten = true;
        any = true;
        b.mass += p.value;
      });
    }
    if (any) {
      this.pellets = this.pellets.filter((p) => !p.eaten);
      for (const b of this.balls) b.radius = this.radiusFor(b.mass);
    }
  }

  /**
   * The single contact rule (eating == fighting). For each overlapping pair of different owners:
   *   B.loss = min(B.mass, rate * min(A.mass, maxAttackerRatio * B.ref) * dt), A gains gainFraction * B.loss,
   * the rest spills as pellets; and symmetrically at the same time. Plus soft separation.
   * B.ref is B's mass when the fight started (so the cap does not shrink with B and a kill takes >= ~0.4 s).
   */
  contacts(dt: number): void {
    const c = this.cfg.contact;
    const balls = this.balls;
    const n = balls.length;
    const loss = new Float64Array(n);
    const gainsFrom: { victim: number; attacker: number; amount: number; x: number; y: number }[] = [];
    const combat = this.combatEnabled();
    // Fight reference mass: kept while the ball stays in damaging contact, reset after a break.
    const refOf = (b: Ball) =>
      b.contactRefAt >= this.time - 1.5 * dt ? Math.max(b.contactRef, b.massBefore) : b.massBefore;

    for (let i = 0; i < n; i++) {
      const a = balls[i];
      for (let j = i + 1; j < n; j++) {
        const b = balls[j];
        const dx = b.x - a.x, dy = b.y - a.y;
        const rs = a.radius + b.radius;
        const d2 = dx * dx + dy * dy;
        if (d2 >= rs * rs) continue;
        const d = Math.sqrt(d2) || 0.001;
        const sameOwner = a.ownerId === b.ownerId;
        if (sameOwner && a.mergeAt > 0 && this.time >= a.mergeAt && this.time >= b.mergeAt) continue; // allowed to overlap/merge
        // Soft separation, lighter ball moves more.
        const overlap = rs - d;
        const push = Math.min(overlap, overlap * c.pushStrength * dt * (sameOwner ? 3 : 1));
        const wa = b.mass / (a.mass + b.mass), wb = 1 - wa;
        const nx = dx / d, ny = dy / d;
        a.x -= nx * push * wa;
        a.y -= ny * push * wa;
        b.x += nx * push * wb;
        b.y += ny * push * wb;
        if (sameOwner) continue;
        a.inContact = b.inContact = true;
        if (!combat || this.isHarmless(a) || this.isHarmless(b)) continue;
        const cxp = a.x + nx * (a.radius - overlap / 2), cyp = a.y + ny * (a.radius - overlap / 2);
        const refA = refOf(a), refB = refOf(b);
        const lb = Math.min(b.massBefore, c.rate * Math.min(a.massBefore, c.maxAttackerRatio * refB) * dt);
        const la = Math.min(a.massBefore, c.rate * Math.min(b.massBefore, c.maxAttackerRatio * refA) * dt);
        a.contactRef = refA;
        b.contactRef = refB;
        a.contactRefAt = b.contactRefAt = this.time;
        loss[j] += lb;
        loss[i] += la;
        gainsFrom.push({ victim: j, attacker: i, amount: lb, x: cxp, y: cyp });
        gainsFrom.push({ victim: i, attacker: j, amount: la, x: cxp, y: cyp });
      }
    }
    if (!gainsFrom.length) {
      for (const b of balls) this.constrain(b);
      return;
    }
    // Clamp total loss per ball to its mass (several attackers at once).
    const scale = new Float64Array(n);
    for (let i = 0; i < n; i++) scale[i] = loss[i] > balls[i].massBefore ? balls[i].massBefore / loss[i] : 1;
    const biggest = new Float64Array(n);
    for (const g of gainsFrom) {
      const v = balls[g.victim], a = balls[g.attacker];
      const amt = g.amount * scale[g.victim];
      if (amt <= 0) continue;
      v.mass -= amt;
      a.mass += amt * c.gainFraction;
      v.spillAcc += amt * (1 - c.gainFraction);
      v.spillX = g.x;
      v.spillY = g.y;
      if (amt > biggest[g.victim]) {
        biggest[g.victim] = amt;
        v.lastDamagerOwner = a.ownerId;
        v.lastDamagedAt = this.time;
        v.swallowerId = a.massBefore > v.massBefore ? a.id : 0;
      }
    }
    for (const b of balls) {
      if (b.mass < 0) b.mass = 0;
      b.radius = this.radiusFor(b.mass);
      this.constrain(b);
    }
  }

  private flushSpill(force = false): void {
    const c = this.cfg.contact;
    for (const b of this.balls) {
      if (b.spillAcc <= 0 || (!force && b.spillAcc < 1 && b.mass > this.cfg.ball.deadMass)) continue;
      this.spill(b.spillAcc, b.spillX, b.spillY, c.maxSpillPelletsPerTick);
      b.spillAcc = 0;
    }
  }

  /** Spill `mass` as pellets around (x, y). Mass is conserved even at the pellet cap. */
  private spill(mass: number, x: number, y: number, maxPellets: number): void {
    if (mass <= 0) return;
    const n = Math.max(1, Math.min(maxPellets, Math.floor(mass)));
    const v = mass / n;
    const sc = this.cfg.contact.spillScatter;
    for (let k = 0; k < n; k++) {
      const a = this.rand() * Math.PI * 2;
      const r = this.rand() * sc;
      const sp = 60 + this.rand() * 120;
      const p = this.spawnPellet('spill', v, x + Math.cos(a) * r, y + Math.sin(a) * r, Math.cos(a) * sp, Math.sin(a) * sp);
      if (!p && this.pellets.length) this.pellets[Math.floor(this.rand() * this.pellets.length)].value += v;
    }
  }

  private spikeCollisions(): void {
    const S = this.cfg.spikes;
    for (const s of this.spikes) {
      if (!s.active) {
        if (this.time >= s.respawnAt) this.placeSpike(s);
        continue;
      }
      for (const b of [...this.balls]) {
        if (b.mass <= S.splitAboveMass || this.isHarmless(b)) continue;
        if ((b.x - s.x) ** 2 + (b.y - s.y) ** 2 >= (b.radius + S.radius) ** 2) continue;
        if (!this.split(b, S.splitPieces)) continue;
        s.active = false;
        s.respawnAt = this.time + S.respawnSec;
        break;
      }
    }
  }

  /** Split a ball into `pieces` equal pieces (same owner). Returns false if the owner is at the piece cap. */
  split(b: Ball, pieces: number): boolean {
    const S = this.cfg.spikes;
    if (this.ballsOf(b.ownerId).length + pieces - 1 > S.maxPiecesPerOwner) return false;
    const m = b.mass / pieces;
    const mergeAt = this.time + S.remergeSec;
    const startAng = this.rand() * Math.PI * 2;
    const r = this.radiusFor(m);
    this.emit({ type: 'split', ownerId: b.ownerId, x: b.x, y: b.y, radius: b.radius, mass: b.mass });
    const ox = b.x, oy = b.y;
    for (let k = 0; k < pieces; k++) {
      const a = startAng + (k / pieces) * Math.PI * 2;
      const piece = k === 0 ? b : this.makeBall(b.ownerId, b.isBot, m, ox, oy, b.temperament);
      piece.mass = m;
      piece.radius = r;
      piece.x = ox + Math.cos(a) * r * 0.9;
      piece.y = oy + Math.sin(a) * r * 0.9;
      piece.px = piece.x;
      piece.py = piece.y;
      piece.vx = Math.cos(a) * S.splitImpulse;
      piece.vy = Math.sin(a) * S.splitImpulse;
      piece.aiDx = Math.cos(a);
      piece.aiDy = Math.sin(a);
      piece.aiNextThink = this.time + 0.4;
      piece.protectedUntil = b.protectedUntil;
      piece.mergeAt = mergeAt;
      this.constrain(piece);
    }
    return true;
  }

  private updateProjectiles(dt: number): void {
    const P = this.cfg.abilities.spikeShot;
    for (const pr of this.projectiles) {
      if (!pr.alive) continue;
      let target = this.ballById(pr.targetBallId);
      if (!target) {
        target = this.spikeShotTarget(pr.senderId);
        if (target) pr.targetBallId = target.id;
      }
      if (!target || this.time - pr.born > P.maxLifeSec) {
        pr.alive = false;
        continue;
      }
      const dx = target.x - pr.x, dy = target.y - pr.y;
      const d = Math.hypot(dx, dy) || 1;
      // Homing.
      const k = Math.min(1, 10 * dt);
      pr.vx += ((dx / d) * P.speed - pr.vx) * k;
      pr.vy += ((dy / d) * P.speed - pr.vy) * k;
      pr.x += pr.vx * dt;
      pr.y += pr.vy * dt;
      if (Math.hypot(target.x - pr.x, target.y - pr.y) < target.radius + P.radius) {
        pr.alive = false;
        this.spikeShotHit(target, pr.x, pr.y);
      }
    }
    if (this.projectiles.some((p) => !p.alive)) this.projectiles = this.projectiles.filter((p) => p.alive);
  }

  /** Effect of a spike shot reaching its target. */
  spikeShotHit(target: Ball, x: number, y: number): void {
    const P = this.cfg.abilities.spikeShot;
    if (this.isHarmless(target)) {
      this.emit({ type: 'spikeShotHit', targetOwner: target.ownerId, x, y, blocked: true, split: false });
      return;
    }
    if (target.mass > P.splitAboveMass && this.split(target, this.cfg.spikes.splitPieces)) {
      this.emit({ type: 'spikeShotHit', targetOwner: target.ownerId, x, y, blocked: false, split: true });
      return;
    }
    const lost = target.mass * P.lossFraction;
    target.mass -= lost;
    target.radius = this.radiusFor(target.mass);
    this.spill(lost, target.x, target.y, 12);
    this.emit({ type: 'spikeShotHit', targetOwner: target.ownerId, x, y, blocked: false, split: false });
  }

  /** Decay above the threshold + storm damage outside the safe zone. */
  private massEffects(dt: number): void {
    const B = this.cfg.ball;
    const storm = this.stormActive();
    const safe = this.safeRadius();
    const { cx, cy } = this.cfg.arena;
    for (const b of this.balls) {
      if (b.mass > B.decayAboveMass) b.mass -= b.mass * B.decayPerSec * dt;
      if (storm && Math.hypot(b.x - cx, b.y - cy) > safe) b.mass -= b.mass * this.cfg.round.stormDamagePerSec * dt;
      b.radius = this.radiusFor(b.mass);
    }
  }

  private removeDead(): void {
    const dead = this.balls.filter((b) => b.mass <= this.cfg.ball.deadMass);
    if (!dead.length) return;
    for (const b of dead) {
      if (b.spillAcc > 0) {
        this.spill(b.spillAcc, b.spillX, b.spillY, 3);
        b.spillAcc = 0;
      }
      this.removeBall(b);
      const final = this.ballsOf(b.ownerId).length === 0;
      const killer = b.lastDamagerOwner && this.time - b.lastDamagedAt < 0.5 ? b.lastDamagerOwner : null;
      this.emit({
        type: 'eaten', ballId: b.id, ownerId: b.ownerId, killerOwner: killer,
        x: b.x, y: b.y, radius: this.radiusFor(b.massBefore), mass: Math.max(b.massBefore, b.mass), final,
      });
      if (!final) continue;
      const victim = this.players.get(b.ownerId);
      if (victim) {
        victim.rejoinAt = this.time + this.cfg.ball.rejoinCooldownSec;
        victim.dashUntil = victim.magnetUntil = victim.blackHoleUntil = victim.shieldUntil = 0;
        if (killer) {
          victim.revengeTarget = killer;
          victim.revengeUntil = this.time + this.cfg.revenge.sec;
        }
        if (victim.isBot) this.players.delete(victim.userId);
      }
      if (killer) {
        const k = this.players.get(killer);
        if (k) k.kills++;
      }
    }
  }

  private removeBall(b: Ball): void {
    const i = this.balls.indexOf(b);
    if (i >= 0) this.balls.splice(i, 1);
    this.ballIndex.delete(b.id);
  }

  /** Split pieces re-merge after remergeSec (on contact, or forced a bit later). */
  private mergePieces(): void {
    const S = this.cfg.spikes;
    const owners = new Set<string>();
    for (const b of this.balls) if (b.mergeAt > 0 && this.time >= b.mergeAt) owners.add(b.ownerId);
    for (const owner of owners) {
      const pieces = this.ballsOf(owner).filter((b) => b.mergeAt > 0 && this.time >= b.mergeAt);
      if (pieces.length === 0) continue;
      const all = this.ballsOf(owner);
      if (all.length === 1) {
        all[0].mergeAt = 0;
        continue;
      }
      const force = pieces.some((p) => this.time >= p.mergeAt + S.forceMergeAfterSec);
      if (force) {
        const main = all.reduce((m, b) => (b.mass > m.mass ? b : m));
        let mass = 0, x = 0, y = 0;
        for (const b of all) {
          mass += b.mass;
          x += b.x * b.mass;
          y += b.y * b.mass;
        }
        for (const b of all) if (b !== main) this.removeBall(b);
        main.mass = mass;
        main.x = x / mass;
        main.y = y / mass;
        main.mergeAt = 0;
        main.radius = this.radiusFor(mass);
        this.constrain(main);
        this.emit({ type: 'merge', ownerId: owner, ballId: main.id });
        continue;
      }
      for (let i = 0; i < pieces.length; i++) {
        const a = pieces[i];
        if (!this.ballIndex.has(a.id)) continue;
        for (let j = i + 1; j < pieces.length; j++) {
          const b = pieces[j];
          if (!this.ballIndex.has(b.id)) continue;
          if (Math.hypot(a.x - b.x, a.y - b.y) > Math.max(a.radius, b.radius)) continue;
          const [big, small] = a.mass >= b.mass ? [a, b] : [b, a];
          big.x = (big.x * big.mass + small.x * small.mass) / (big.mass + small.mass);
          big.y = (big.y * big.mass + small.y * small.mass) / (big.mass + small.mass);
          big.mass += small.mass;
          big.radius = this.radiusFor(big.mass);
          this.removeBall(small);
          this.emit({ type: 'merge', ownerId: owner, ballId: big.id });
        }
      }
      const left = this.ballsOf(owner);
      if (left.length === 1) left[0].mergeAt = 0;
    }
  }

  private respawnPellets(dt: number): void {
    const P = this.cfg.pellets;
    const target = this.pelletTarget();
    let normal = 0;
    for (const p of this.pellets) if (p.kind === 'normal') normal++;
    if (normal < target) {
      this.pelletAcc += P.respawnPerSec * dt;
      while (this.pelletAcc >= 1 && normal < target) {
        this.pelletAcc -= 1;
        this.spawnPellet('normal', P.value);
        normal++;
      }
    } else this.pelletAcc = 0;
    const feast = this.feastActive();
    if (feast) {
      this.feastAcc += this.cfg.likes.feastPelletsPerSec * dt;
      while (this.feastAcc >= 1) {
        this.feastAcc -= 1;
        this.spawnPellet('feast', this.cfg.likes.feastPelletValue);
      }
    } else this.feastAcc = 0;
    if (this.feastWasActive && !feast) this.emit({ type: 'feast', active: false });
    this.feastWasActive = feast;
  }

  private updateKing(): void {
    const top = this.topOwners(1)[0];
    const cur = this.kingOwner;
    let next = cur;
    if (!top) next = null;
    else if (!cur || this.ownerMass(cur) <= 0) next = top.ownerId;
    else if (top.ownerId !== cur && top.mass > this.ownerMass(cur) * 1.02) next = top.ownerId;
    if (next !== cur) {
      this.kingOwner = next;
      this.emit({ type: 'kingChanged', from: cur, to: next });
    }
  }

  private emit(e: SimEvent): void {
    this.events.push(e);
    if (this.events.length > 2000) this.events.splice(0, this.events.length - 2000);
  }
}
