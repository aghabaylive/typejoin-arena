import { describe, it, expect } from 'vitest';
import type { GameEvent } from '@typejoin/shared';
import { PLACEHOLDER_GIFT_IDS } from '@typejoin/shared';
import { Sim } from './Sim';
import { CONFIG, crowdScaleTarget, pelletTarget, radiusForMass } from '../config';

const DT = 1 / 60;
const { cx, cy } = CONFIG.arena;

/** A quiet sim: no pellets, bots, spikes or decay, already in the play phase. */
function quietSim(extra: Parameters<typeof makeSim>[0] = {}) {
  const sim = makeSim(extra);
  sim.debugSetPhase('play');
  sim.balls.length = 0;
  sim.pellets.length = 0;
  return sim;
}
function makeSim(over: Record<string, unknown> = {}) {
  return new Sim({
    seed: 1,
    config: {
      pellets: { target: 0, perPlayer: 0 },
      bots: { minBalls: 0 },
      spikes: { count: 0 },
      ball: { decayPerSec: 0 },
      ...over,
    } as never,
  });
}
const ev = (e: Partial<GameEvent> & { type: GameEvent['type'] }): GameEvent =>
  ({ userId: 'u1', nickname: 'User 1', ts: 0, ...e }) as GameEvent;

/** Keep balls still so a test isolates one rule. */
function freeze(sim: Sim) {
  for (const b of sim.balls) {
    b.aiNextThink = Infinity;
    b.aiDx = b.aiDy = 0;
    b.vx = b.vy = 0;
  }
}

describe('contact rule', () => {
  it('one mouth each: big vs small both bite, loss = rate * min(other mass, 4 * own ref) * dt, gain half', () => {
    const sim = quietSim();
    const a = sim.debugSpawn({ ownerId: 'A', mass: 1000, x: cx, y: cy });
    const b = sim.debugSpawn({ ownerId: 'B', mass: 100, x: cx + 60, y: cy });
    freeze(sim);
    sim.contacts(DT);
    const R = CONFIG.contact.rate;
    const lossB = Math.min(100, R * Math.min(1000, 4 * 100) * DT); // capped attacker mass
    const lossA = Math.min(1000, R * 100 * DT);
    expect(b.mass).toBeCloseTo(100 - lossB + 0.5 * lossA, 9);
    expect(a.mass).toBeCloseTo(1000 - lossA + 0.5 * lossB, 9);
    // The other half spills as pellets (conserved once flushed).
    expect(b.spillAcc + a.spillAcc).toBeCloseTo(0.5 * (lossA + lossB), 9);
  });

  it('equal masses lose the same amount', () => {
    const sim = quietSim();
    const a = sim.debugSpawn({ ownerId: 'A', mass: 200, x: cx - 30, y: cy });
    const b = sim.debugSpawn({ ownerId: 'B', mass: 200, x: cx + 30, y: cy });
    freeze(sim);
    sim.contacts(DT);
    expect(a.mass).toBeCloseTo(b.mass, 9);
    expect(a.mass).toBeCloseTo(200 - CONFIG.contact.rate * 200 * DT * 0.5, 9);
  });

  it('attacker mass is capped at 4x the victim: even a huge ball needs >= 1 / (rate * 4) s to kill', () => {
    const minKill = 1 / (CONFIG.contact.rate * CONFIG.contact.maxAttackerRatio);
    for (const huge of [500, 25000, 1e6]) {
      const sim = quietSim();
      sim.debugSpawn({ ownerId: 'A', mass: huge, x: cx, y: cy });
      const b = sim.debugSpawn({ ownerId: 'B', mass: 20, x: cx + 5, y: cy });
      freeze(sim);
      let ticks = 0;
      while (sim.ballsOf('B').length && ticks < 1200) {
        b.x = cx + 5; // stay in contact
        b.y = cy;
        sim.step(DT);
        ticks++;
      }
      expect(sim.ballsOf('B').length).toBe(0);
      expect(ticks * DT).toBeGreaterThanOrEqual(minKill * 0.95);
      expect(ticks * DT).toBeLessThan(minKill * 1.5); // linear drain: the cap uses the mass at fight start
      expect(sim.players.get('A')!.kills).toBe(1);
    }
  });

  it('marks the eater for the swallow animation', () => {
    const sim = quietSim();
    const a = sim.debugSpawn({ ownerId: 'A', mass: 5000, x: cx, y: cy });
    const b = sim.debugSpawn({ ownerId: 'B', mass: 20, x: cx + 5, y: cy });
    freeze(sim);
    sim.step(DT);
    expect(b.swallowerId).toBe(a.id);
    expect(a.swallowerId).toBe(0);
    expect(b.contactRef).toBe(20);
  });

  it('loss is capped by the victim mass', () => {
    const sim = quietSim();
    sim.debugSpawn({ ownerId: 'A', mass: 100000, x: cx, y: cy });
    const b = sim.debugSpawn({ ownerId: 'B', mass: 5, x: cx + 10, y: cy });
    freeze(sim);
    sim.contacts(DT);
    expect(b.mass).toBeGreaterThanOrEqual(0);
  });

  it('spawn protection and shields block damage in both directions', () => {
    const sim = quietSim();
    const a = sim.debugSpawn({ ownerId: 'A', mass: 1000, x: cx, y: cy });
    const b = sim.debugSpawn({ ownerId: 'B', mass: 50, x: cx + 40, y: cy, protectedSec: 3 });
    freeze(sim);
    sim.contacts(DT);
    expect(a.mass).toBe(1000);
    expect(b.mass).toBe(50);
  });

  it('no damage during the join window', () => {
    const sim = makeSim();
    expect(sim.phase).toBe('join');
    const a = sim.debugSpawn({ ownerId: 'A', mass: 1000, x: cx, y: cy });
    const b = sim.debugSpawn({ ownerId: 'B', mass: 50, x: cx + 40, y: cy });
    sim.contacts(DT);
    expect(a.mass).toBe(1000);
    expect(b.mass).toBe(50);
  });
});

describe('eating and revenge', () => {
  it('kills, credits the killer, sets revenge and enforces the rejoin cooldown', () => {
    const sim = quietSim();
    sim.debugSpawn({ ownerId: 'A', mass: 1000, x: cx, y: cy });
    sim.handleEvent(ev({ type: 'join', userId: 'B', nickname: 'B' }));
    const b = sim.ballsOf('B')[0];
    b.protectedUntil = 0;
    b.x = cx + 20;
    b.y = cy;
    freeze(sim);
    for (let i = 0; i < 400 && sim.ballsOf('B').length; i++) {
      b.x = cx + 20; // keep the victim in contact (push separation would free it)
      b.y = cy;
      sim.step(DT);
    }
    expect(sim.ballsOf('B').length).toBe(0);
    const eaten = sim.drainEvents().find((e) => e.type === 'eaten');
    expect(eaten && eaten.type === 'eaten' && eaten.killerOwner).toBe('A');
    expect(sim.players.get('A')!.kills).toBe(1);
    const victim = sim.players.get('B')!;
    expect(victim.revengeTarget).toBe('A');
    expect(victim.revengeUntil).toBeCloseTo(sim.time + 60, 5);
    // Rejoin is blocked for 5 s.
    sim.handleEvent(ev({ type: 'join', userId: 'B', nickname: 'B' }));
    expect(sim.ballsOf('B').length).toBe(0);
    for (let i = 0; i < 5 * 60 + 2; i++) sim.step(DT);
    sim.handleEvent(ev({ type: 'join', userId: 'B', nickname: 'B' }));
    expect(sim.ballsOf('B').length).toBe(1);
    // Spike shot from B targets the revenge target A.
    expect(sim.spikeShotTarget('B')?.ownerId).toBe('A');
  });

  it('one ball per user', () => {
    const sim = quietSim();
    sim.handleEvent(ev({ type: 'join' }));
    sim.handleEvent(ev({ type: 'join' }));
    expect(sim.ballsOf('u1').length).toBe(1);
    expect(sim.ballsOf('u1')[0].mass).toBe(20);
  });
});

describe('gifts', () => {
  const gift = (units: number, giftId: number = PLACEHOLDER_GIFT_IDS.rose, coinsPerUnit = 1) =>
    ev({ type: 'gift', giftId, giftName: 'g', coinsPerUnit, units } as never);

  it('mass = coins * units * 5 per delivered update, summed over a streak without double counting', () => {
    const sim = quietSim();
    sim.handleEvent(ev({ type: 'join' }));
    // Bridge delivers a 1 -> 4 -> 7 streak as deltas 1, 3, 3.
    for (const u of [1, 3, 3]) sim.handleEvent(gift(u, PLACEHOLDER_GIFT_IDS.rose, 1));
    expect(sim.ownerMass('u1')).toBe(20 + 7 * 5);
  });

  it('a gift from a user without a ball auto-joins them, then applies the gift', () => {
    const sim = quietSim();
    sim.handleEvent(gift(2, PLACEHOLDER_GIFT_IDS.dash, 5));
    expect(sim.ballsOf('u1').length).toBe(1);
    expect(sim.ownerMass('u1')).toBe(20 + 5 * 2 * 5);
    const p = sim.players.get('u1')!;
    expect(p.gifted).toBe(true);
    expect(p.dashUntil).toBeCloseTo(sim.time + 2 * 3, 5); // each unit counts
  });

  it('gifts during the rejoin cooldown are queued, then auto-join and apply', () => {
    const sim = quietSim();
    sim.debugSpawn({ ownerId: 'u1', mass: 20, x: cx, y: cy });
    sim.players.get('u1')!.rejoinAt = sim.time + 5;
    sim.balls.length = 0; // pretend it was just eaten
    sim.handleEvent(gift(4));
    expect(sim.ballsOf('u1').length).toBe(0);
    const q = sim.drainEvents().find((e) => e.type === 'giftQueued');
    expect(q && q.type === 'giftQueued' && q.when).toBe('respawn');
    for (let i = 0; i < 5 * 60 + 2; i++) sim.step(DT);
    expect(sim.ballsOf('u1').length).toBe(1);
    expect(sim.ownerMass('u1')).toBeCloseTo(20 + 4 * 5, 5);
  });

  it('gifts during results are applied in the next round', () => {
    const sim = quietSim();
    sim.debugSetPhase('results');
    sim.drainEvents();
    sim.handleEvent(gift(1, PLACEHOLDER_GIFT_IDS.shield, 30));
    const q = sim.drainEvents().find((e) => e.type === 'giftQueued');
    expect(q && q.type === 'giftQueued' && `@${q.nickname}: ${q.what} ready ${q.when}`).toBe('@User 1: Shield ready nextRound');
    sim.players.get('u1')!.carryGifts = [];
    sim.handleEvent(gift(3));
    for (let i = 0; i < CONFIG.round.resultsSec * 60 + 2; i++) sim.step(DT);
    expect(sim.phase).toBe('join');
    expect(sim.ownerMass('u1')).toBe(20 + 3 * 5);
  });

  it('shield and magnet extend (capped at 60 s); spike shots count every unit', () => {
    const sim = quietSim();
    sim.handleEvent(ev({ type: 'join' }));
    sim.debugSpawn({ ownerId: 'K', mass: 5000, x: cx + 300, y: cy });
    sim.handleEvent(gift(1, PLACEHOLDER_GIFT_IDS.shield, 30));
    sim.handleEvent(gift(1, PLACEHOLDER_GIFT_IDS.shield, 30));
    const p = sim.players.get('u1')!;
    expect(p.shieldUntil).toBeCloseTo(sim.time + 20, 5);
    sim.handleEvent(gift(20, PLACEHOLDER_GIFT_IDS.magnet, 500));
    expect(p.magnetUntil).toBeCloseTo(sim.time + 60, 5);
    sim.handleEvent(gift(3, PLACEHOLDER_GIFT_IDS.spikeShot, 100));
    let fired = 0;
    for (let i = 0; i < 120; i++) {
      const before = sim.projectiles.length;
      sim.step(DT);
      fired += Math.max(0, sim.projectiles.length - before);
    }
    const hits = sim.drainEvents().filter((e) => e.type === 'spikeShotHit').length;
    expect(fired + 0).toBeGreaterThanOrEqual(1);
    expect(hits + sim.projectiles.length).toBe(3);
  });

  it('dash is capped at 10 s; black hole gives 5 s + 2 s per extra unit, capped at 10 s', () => {
    const sim = quietSim();
    sim.handleEvent(ev({ type: 'join' }));
    const p = sim.players.get('u1')!;
    sim.handleEvent(gift(2, PLACEHOLDER_GIFT_IDS.dash, 5));
    expect(p.dashUntil).toBeCloseTo(sim.time + 6, 5);
    sim.handleEvent(gift(10, PLACEHOLDER_GIFT_IDS.dash, 5));
    expect(p.dashUntil).toBeCloseTo(sim.time + 10, 5);
    sim.handleEvent(gift(1, PLACEHOLDER_GIFT_IDS.blackHole, 1000));
    expect(p.blackHoleUntil).toBeCloseTo(sim.time + 5, 5);
    sim.handleEvent(gift(1, PLACEHOLDER_GIFT_IDS.blackHole, 1000));
    expect(p.blackHoleUntil).toBeCloseTo(sim.time + 10, 5);
    p.blackHoleUntil = 0;
    sim.handleEvent(gift(2, PLACEHOLDER_GIFT_IDS.blackHole, 1000));
    expect(p.blackHoleUntil).toBeCloseTo(sim.time + 7, 5);
    p.blackHoleUntil = 0;
    sim.handleEvent(gift(10, PLACEHOLDER_GIFT_IDS.blackHole, 1000));
    expect(p.blackHoleUntil).toBeCloseTo(sim.time + 10, 5);
    // Shield and magnet keep the 60 s cap.
    sim.handleEvent(gift(10, PLACEHOLDER_GIFT_IDS.shield, 30));
    expect(p.shieldUntil).toBeCloseTo(sim.time + 60, 5);
  });

  it('likes: +1 mass each, max 20 per second per user; all likes fill the feast meter', () => {
    const sim = quietSim();
    sim.handleEvent(ev({ type: 'join' }));
    sim.handleEvent(ev({ type: 'like', count: 15 } as never));
    sim.handleEvent(ev({ type: 'like', count: 15 } as never));
    expect(sim.ownerMass('u1')).toBe(40);
    sim.handleEvent(ev({ type: 'like', userId: 'nobody', count: 2970 } as never));
    sim.step(DT);
    expect(sim.feastActive()).toBe(true);
  });

  it('follow and share give +50 once per round', () => {
    const sim = quietSim();
    sim.handleEvent(ev({ type: 'join' }));
    sim.handleEvent(ev({ type: 'follow' }));
    sim.handleEvent(ev({ type: 'follow' }));
    sim.handleEvent(ev({ type: 'share' }));
    expect(sim.ownerMass('u1')).toBe(120);
  });
});

describe('spikes', () => {
  it('splits a ball > 1000 into 4, respawns the spike after 10 s and re-merges after 12 s', () => {
    const sim = makeSim({ spikes: { count: 1 } });
    sim.debugSetPhase('play');
    sim.balls.length = 0;
    const spike = sim.spikes[0];
    const b = sim.debugSpawn({ ownerId: 'big', mass: 2000, x: spike.x, y: spike.y });
    sim.step(DT);
    const pieces = sim.ballsOf('big');
    expect(pieces.length).toBe(4);
    for (const p of pieces) expect(p.mass).toBeCloseTo(500, 0);
    expect(spike.active).toBe(false);
    expect(b.mergeAt).toBeGreaterThan(0);
    for (let i = 0; i < 10 * 60 + 2; i++) sim.step(DT);
    expect(spike.active).toBe(true);
    for (let i = 0; i < 6 * 60; i++) sim.step(DT);
    const merged = sim.ballsOf('big');
    expect(merged.length).toBe(1);
    expect(merged[0].mass).toBeGreaterThan(1900);
  });

  it('small balls pass over spikes unaffected', () => {
    const sim = makeSim({ spikes: { count: 1 } });
    sim.debugSetPhase('play');
    sim.balls.length = 0;
    const s = sim.spikes[0];
    sim.debugSpawn({ ownerId: 'small', mass: 900, x: s.x, y: s.y });
    sim.step(DT);
    expect(sim.ballsOf('small').length).toBe(1);
    expect(s.active).toBe(true);
  });

  it('spike shot: splits a target > 1000, otherwise removes 30 %', () => {
    const sim = quietSim();
    const big = sim.debugSpawn({ ownerId: 'big', mass: 4000, x: cx, y: cy });
    sim.spikeShotHit(big, big.x, big.y);
    expect(sim.ballsOf('big').length).toBe(4);
    const small = sim.debugSpawn({ ownerId: 'small', mass: 500, x: cx - 300, y: cy });
    sim.spikeShotHit(small, small.x, small.y);
    expect(small.mass).toBeCloseTo(350, 9);
  });
});

describe('storm', () => {
  it('a ball outside the safe zone loses 5 % per second, inside it does not', () => {
    const sim = quietSim();
    sim.debugSetPhase('storm');
    for (let i = 0; i < CONFIG.round.stormSec * 60 - 30; i++) sim.step(DT);
    expect(sim.safeRadius()).toBeLessThan(CONFIG.arena.radius * 0.52);
    const out = sim.debugSpawn({ ownerId: 'out', mass: 100, x: cx + 330, y: cy });
    const inn = sim.debugSpawn({ ownerId: 'in', mass: 100, x: cx - 330, y: cy });
    inn.x = cx; // well inside
    freeze(sim);
    sim.step(DT);
    expect(out.mass).toBeCloseTo(100 * (1 - 0.05 * DT), 6);
    expect(inn.mass).toBe(100);
  });

  it('the safe zone shrinks smoothly from 100 % to 50 %', () => {
    const sim = quietSim();
    sim.debugSetPhase('storm');
    const R = CONFIG.arena.radius;
    expect(sim.safeRadius()).toBeCloseTo(R, 5);
    let prev = sim.safeRadius();
    for (let i = 0; i < CONFIG.round.stormSec * 60 - 1; i++) {
      sim.step(DT);
      const r = sim.safeRadius();
      expect(r).toBeLessThanOrEqual(prev + 1e-9);
      expect(prev - r).toBeLessThan(1);
      prev = r;
    }
    expect(prev).toBeCloseTo(R * 0.5, 0);
  });
});

describe('round loop', () => {
  it('join 10 s -> play 2:30 -> storm 1:00 -> results 15 s -> fresh round', () => {
    const sim = new Sim({ seed: 3 });
    const phases: string[] = [sim.phase];
    sim.handleEvent(ev({ type: 'join', userId: 'p1', nickname: 'P1' }));
    sim.handleEvent(ev({ type: 'gift', userId: 'p2', nickname: 'P2', giftId: PLACEHOLDER_GIFT_IDS.rose, giftName: 'Rose', coinsPerUnit: 1, units: 1 } as never));
    const R = CONFIG.round;
    const at: Record<string, number> = {};
    const total = R.joinSec + R.playSec + R.stormSec + R.resultsSec + 1;
    for (let i = 0; i < total * 60; i++) {
      sim.step(DT);
      if (sim.phase !== phases[phases.length - 1]) {
        phases.push(sim.phase);
        at[sim.phase + phases.length] = sim.time;
      }
      if (sim.phase === 'results' && !sim.lastResults) throw new Error('no results');
    }
    expect(phases).toEqual(['join', 'play', 'storm', 'results', 'join']);
    expect(sim.roundNo).toBe(2);
    expect(at.play2).toBeCloseTo(R.joinSec, 1);
    expect(at.storm3).toBeCloseTo(R.joinSec + R.playSec, 1);
    expect(at.results4).toBeCloseTo(R.joinSec + R.playSec + R.stormSec, 1);
    expect(at.join5).toBeCloseTo(R.joinSec + R.playSec + R.stormSec + R.resultsSec, 1);
    // New round: no real players carried over (they must type join again), only bots.
    expect(sim.balls.every((b) => b.isBot)).toBe(true);
    expect(sim.lastResults!.roundNo).toBe(1);
  });

  it('results: titles exclude bots; best free player excludes gifters; leaderboard points', () => {
    const sim = quietSim();
    sim.debugSpawn({ ownerId: 'bot:x', mass: 99999, x: cx, y: cy, isBot: true });
    sim.debugSpawn({ ownerId: 'rich', mass: 100, x: cx - 300, y: cy });
    sim.players.get('rich')!.gifted = true;
    sim.handleEvent(ev({ type: 'gift', userId: 'rich', nickname: 'rich', giftId: PLACEHOLDER_GIFT_IDS.rose, giftName: 'Rose', coinsPerUnit: 1, units: 100 } as never));
    sim.debugSpawn({ ownerId: 'free', mass: 300, x: cx + 300, y: cy });
    sim.players.get('free')!.kills = 2;
    sim.debugSetPhase('results');
    const r = sim.lastResults!;
    expect(r.king?.userId).toBe('rich');
    expect(r.killer?.userId).toBe('free');
    expect(r.bestFree?.userId).toBe('free');
    expect(sim.leaderboard.points('rich')).toBe(10);
    expect(sim.leaderboard.points('free')).toBe(7 + 2);
    expect(r.top.some((t) => t.userId.startsWith('bot'))).toBe(false);
  });

  it('bots fill up to 8 balls and leave as real players join', () => {
    const sim = new Sim({ seed: 9 });
    for (let i = 0; i < 300; i++) sim.step(DT);
    expect(sim.balls.length).toBe(8);
    expect(sim.balls.every((b) => b.isBot)).toBe(true);
    for (let i = 0; i < 5; i++) sim.handleEvent(ev({ type: 'join', userId: `r${i}`, nickname: `R${i}` }));
    expect(sim.balls.length).toBe(8);
    expect(sim.balls.filter((b) => !b.isBot).length).toBe(5);
    for (let i = 5; i < 12; i++) sim.handleEvent(ev({ type: 'join', userId: `r${i}`, nickname: `R${i}` }));
    expect(sim.balls.filter((b) => b.isBot).length).toBe(0);
    expect(sim.balls.length).toBe(12);
  });
});

describe('one mouth at a time + digestion', () => {
  /** Hold balls in place (push separation would move them apart). */
  const hold = (sim: Sim, spots: [ReturnType<Sim['debugSpawn']>, number, number][]) => {
    for (const [b, x, y] of spots) if (sim.ballById(b.id)) {
      b.x = x;
      b.y = y;
    }
    freeze(sim);
  };

  it('damages only the longest-overlapping contact; others only push', () => {
    const sim = quietSim();
    const a = sim.debugSpawn({ ownerId: 'A', mass: 1000, x: cx, y: cy });
    const b = sim.debugSpawn({ ownerId: 'B', mass: 20, x: cx + 40, y: cy });
    freeze(sim);
    sim.contacts(DT); // A-B overlap starts first
    const c = sim.debugSpawn({ ownerId: 'C', mass: 20, x: cx - 40, y: cy });
    for (let i = 0; i < 5; i++) {
      hold(sim, [[a, cx, cy], [b, cx + 40, cy], [c, cx - 40, cy]]);
      sim.step(DT);
    }
    expect(a.mouthId).toBe(b.id);
    expect(b.mass).toBeLessThan(20);
    expect(c.mass).toBeGreaterThanOrEqual(20); // C is not eaten (it even gains by biting A)
  });

  it('keeps the target until contact breaks, then switches', () => {
    const sim = quietSim();
    const a = sim.debugSpawn({ ownerId: 'A', mass: 1000, x: cx, y: cy });
    const b = sim.debugSpawn({ ownerId: 'B', mass: 900, x: cx + 60, y: cy }); // survives a few ticks
    freeze(sim);
    sim.contacts(DT);
    const c = sim.debugSpawn({ ownerId: 'C', mass: 20, x: cx - 40, y: cy });
    hold(sim, [[a, cx, cy], [b, cx + 60, cy], [c, cx - 40, cy]]);
    sim.step(DT);
    expect(a.mouthId).toBe(b.id);
    hold(sim, [[a, cx, cy], [b, cx + 280, cy], [c, cx - 40, cy]]); // B leaves (no overlap at 280)
    sim.step(DT);
    expect(a.mouthId).toBe(c.id);
  });

  it('after a kill the eater digests: deals no damage for digestSec but still takes damage', () => {
    const sim = quietSim();
    const a = sim.debugSpawn({ ownerId: 'A', mass: 1000, x: cx, y: cy });
    const b = sim.debugSpawn({ ownerId: 'B', mass: 20, x: cx + 40, y: cy });
    freeze(sim);
    sim.contacts(DT);
    const c = sim.debugSpawn({ ownerId: 'C', mass: 20, x: cx - 40, y: cy });
    let t = 0;
    while (sim.ballsOf('B').length && t++ < 400) {
      hold(sim, [[a, cx, cy], [b, cx + 40, cy], [c, cx - 40, cy]]);
      sim.step(DT);
    }
    expect(sim.ballsOf('B').length).toBe(0);
    const killedAt = sim.time;
    expect(a.digestUntil).toBeCloseTo(killedAt + CONFIG.contact.digestSec, 6);
    const cMass = c.mass, aMass = a.mass;
    while (sim.time < killedAt + CONFIG.contact.digestSec - 2 * DT) {
      hold(sim, [[a, cx, cy], [c, cx - 40, cy]]);
      sim.step(DT);
    }
    expect(c.mass).toBeGreaterThan(cMass); // C was not damaged, it kept biting A
    expect(a.mass).toBeLessThan(aMass); // A took damage while digesting
    for (let i = 0; i < 10; i++) {
      hold(sim, [[a, cx, cy], [c, cx - 40, cy]]);
      sim.step(DT);
    }
    const cBefore = c.mass;
    for (let i = 0; i < 10; i++) {
      hold(sim, [[a, cx, cy], [c, cx - 40, cy]]);
      sim.step(DT);
    }
    expect(a.mouthId).toBe(c.id);
    expect(c.mass).toBeLessThan(cBefore); // digestion over: A eats again
  });
});

describe('alive cap + queue', () => {
  let sim: Sim;
  const gift = (userId: string, units: number, giftId: number = PLACEHOLDER_GIFT_IDS.shield, coinsPerUnit = 30) =>
    sim.handleEvent(ev({ type: 'gift', userId, nickname: userId, giftId, giftName: 'g', coinsPerUnit, units } as never));
  const join = (userId: string) => sim.handleEvent(ev({ type: 'join', userId, nickname: userId }));

  it('joins beyond the cap wait in FIFO order; a freed slot spawns the next', () => {
    sim = quietSim({ queue: { maxAlive: 2 } });
    for (const u of ['u1', 'u2', 'u3', 'u4']) join(u);
    expect(sim.balls.map((b) => b.ownerId)).toEqual(['u1', 'u2']);
    expect(sim.queueView()).toEqual({ length: 2, next: ['u3', 'u4'] });
    join('u3'); // typing join again keeps the place
    expect(sim.joinQueue).toEqual(['u3', 'u4']);
    sim.ballsOf('u1')[0].mass = 0;
    sim.step(DT); // u1 removed
    sim.step(DT); // slot freed -> u3 spawns
    expect(sim.ballsOf('u3').length).toBe(1);
    expect(sim.joinQueue).toEqual(['u4']);
  });

  it('a gift from a queued user moves them to the front and applies when they spawn (never lost)', () => {
    sim = quietSim({ queue: { maxAlive: 1 } });
    for (const u of ['u1', 'u2', 'u3']) join(u);
    sim.drainEvents();
    gift('u3', 2);
    gift('u3', 1);
    expect(sim.joinQueue).toEqual(['u3', 'u2']);
    const toast = sim.drainEvents().find((e) => e.type === 'giftQueued');
    expect(toast && toast.type === 'giftQueued' && toast.when).toBe('spawn');
    // A gift from someone not even queued yet also goes to the front.
    gift('u4', 1, PLACEHOLDER_GIFT_IDS.rose, 1);
    expect(sim.joinQueue).toEqual(['u4', 'u3', 'u2']);
    sim.ballsOf('u1')[0].mass = 0;
    sim.step(DT);
    sim.step(DT);
    expect(sim.ballsOf('u4').length).toBe(1);
    expect(sim.ownerMass('u4')).toBeCloseTo(20 + 1 * 5, 6);
    sim.ballsOf('u4')[0].mass = 0;
    sim.step(DT);
    sim.step(DT);
    expect(sim.ballsOf('u3').length).toBe(1);
    expect(sim.ownerMass('u3')).toBeCloseTo(20 + 3 * 30 * 5, 6);
    expect(sim.players.get('u3')!.shieldUntil).toBeGreaterThan(sim.time + 25); // both shields: 30 s
  });

  it('queued players (and their gifts) carry into the next round', () => {
    sim = quietSim({ queue: { maxAlive: 1 } });
    join('u1');
    join('u2');
    gift('u3', 1);
    expect(sim.joinQueue).toEqual(['u3', 'u2']);
    sim.debugSetPhase('results');
    for (let i = 0; i < CONFIG.round.resultsSec * 60 + 2; i++) sim.step(DT);
    expect(sim.phase).toBe('join');
    expect(sim.ballsOf('u3').length).toBe(1); // gifter first
    expect(sim.ownerMass('u3')).toBeCloseTo(20 + 30 * 5, 6);
    expect(sim.joinQueue).toEqual(['u2']);
  });
});

describe('storm field range', () => {
  it('magnet and black hole ranges scale with the safe radius', () => {
    const sim = quietSim();
    expect(sim.fieldRange(350)).toBeCloseTo(350, 9);
    sim.debugSetPhase('storm');
    for (let i = 0; i < CONFIG.round.stormSec * 60 - 1; i++) sim.step(DT);
    const k = sim.safeRadius() / CONFIG.arena.radius;
    expect(k).toBeCloseTo(0.5, 2);
    expect(sim.fieldRange(CONFIG.abilities.blackHole.range)).toBeCloseTo(CONFIG.abilities.blackHole.range * k, 9);
  });

  it('a pellet beyond the shrunk range is no longer pulled', () => {
    const pull = (storm: boolean) => {
      const sim = quietSim();
      if (storm) {
        sim.debugSetPhase('storm');
        for (let i = 0; i < CONFIG.round.stormSec * 60 - 1; i++) sim.step(DT);
      }
      sim.debugSpawn({ ownerId: 'h', mass: 100, x: cx, y: cy });
      sim.players.get('h')!.blackHoleUntil = sim.time + 5;
      sim.pellets.push({ id: 99999, x: cx + 250, y: cy, vx: 0, vy: 0, value: 1, kind: 'normal', born: 0, eaten: false });
      freeze(sim);
      sim.step(DT);
      return cx + 250 - sim.pellets.find((p) => p.id === 99999)!.x;
    };
    expect(pull(false)).toBeGreaterThan(1);
    expect(pull(true)).toBe(0);
  });
});

describe('crowding', () => {
  const arenaArea = Math.PI * CONFIG.arena.radius ** 2;
  it('scale target: 1 up to 40 % coverage, sqrt(limit / area) above, never below 0.5', () => {
    expect(crowdScaleTarget(0)).toBe(1);
    expect(crowdScaleTarget(0.4 * arenaArea)).toBe(1);
    expect(crowdScaleTarget(0.8 * arenaArea)).toBeCloseTo(Math.SQRT1_2, 9);
    expect(crowdScaleTarget(1.5 * arenaArea)).toBeCloseTo(Math.sqrt(0.4 / 1.5), 9);
    expect(crowdScaleTarget(10 * arenaArea)).toBe(0.5);
  });

  it('scale target can be measured against a smaller zone (the storm safe zone)', () => {
    const zone = 200;
    const zoneArea = Math.PI * zone * zone;
    expect(crowdScaleTarget(0.4 * zoneArea, CONFIG, zone)).toBe(1);
    expect(crowdScaleTarget(0.8 * zoneArea, CONFIG, zone)).toBeCloseTo(Math.SQRT1_2, 9);
    expect(crowdScaleTarget(5 * zoneArea, CONFIG, zone)).toBe(0.5);
    // The same balls that fit the full arena are crowded in the small zone.
    expect(crowdScaleTarget(0.8 * zoneArea)).toBe(1);
  });

  it('during the storm the size scale follows the safe zone area, not the arena', () => {
    const place = (sim: Sim) => {
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        sim.debugSpawn({ ownerId: `s${i}`, mass: 100, x: cx + Math.cos(a) * 120, y: cy + Math.sin(a) * 120, protectedSec: 999 });
      }
      freeze(sim);
    };
    const area = 6 * Math.PI * radiusForMass(100) ** 2;
    // Play: 6 balls cover ~22 % of the arena -> no shrink.
    const play = quietSim();
    place(play);
    for (let i = 0; i < 180; i++) play.step(DT);
    expect(crowdScaleTarget(area)).toBe(1);
    expect(play.sizeScale).toBe(1);
    // Late storm: the same balls cover ~87 % of the safe zone -> shrink towards sqrt(0.4 / 0.87).
    const storm = quietSim();
    storm.debugSetPhase('storm');
    for (let i = 0; i < CONFIG.round.stormSec * 60 - 240; i++) storm.step(DT);
    place(storm);
    for (let i = 0; i < 180; i++) storm.step(DT);
    const target = crowdScaleTarget(area, CONFIG, storm.safeRadius());
    expect(target).toBeLessThan(0.75);
    expect(target).toBeGreaterThanOrEqual(0.5);
    expect(storm.sizeScale).toBeLessThan(0.8);
    expect(storm.sizeScale).toBeCloseTo(target, 1);
    for (const b of storm.balls) expect(b.mass).toBe(100); // rules still use mass
  });

  it('100 balls shrink smoothly towards the target; radius scales, mass does not', () => {
    const sim = quietSim();
    for (let i = 0; i < 100; i++) {
      const a = (i / 100) * Math.PI * 2;
      sim.debugSpawn({ ownerId: `p${i}`, mass: 200, x: cx + Math.cos(a) * 300, y: cy + Math.sin(a) * 300, protectedSec: 999 });
    }
    freeze(sim);
    const target = crowdScaleTarget(100 * Math.PI * radiusForMass(200) ** 2);
    expect(target).toBeLessThan(1);
    let prev = sim.sizeScale;
    for (let i = 0; i < 300; i++) {
      sim.step(DT);
      expect(prev - sim.sizeScale).toBeLessThan(0.05); // smooth
      expect(sim.sizeScale).toBeGreaterThanOrEqual(0.5);
      prev = sim.sizeScale;
    }
    expect(sim.sizeScale).toBeCloseTo(target, 2);
    const b = sim.balls[0];
    expect(b.mass).toBe(200);
    expect(b.radius).toBeCloseTo(radiusForMass(200) * sim.sizeScale, 9);
  });
});

describe('pellets', () => {
  it('target = 150 + 2 * players, max 400', () => {
    expect(pelletTarget(0)).toBe(150);
    expect(pelletTarget(10)).toBe(170);
    expect(pelletTarget(100)).toBe(350);
    expect(pelletTarget(125)).toBe(400);
    expect(pelletTarget(500)).toBe(400);
  });

  it('respawn fills up to the player-dependent target (bots do not count)', () => {
    const sim = new Sim({ seed: 2, config: { bots: { minBalls: 0 }, spikes: { count: 0 } } as never });
    sim.debugSetPhase('play');
    for (let i = 0; i < 50; i++) sim.handleEvent(ev({ type: 'join', userId: `r${i}`, nickname: `R${i}` }));
    sim.debugSpawn({ ownerId: 'bot:1', mass: 20, x: cx, y: cy, isBot: true, protectedSec: 999 });
    expect(sim.pelletTarget()).toBe(250);
  });
});

describe('formulas', () => {
  it('radius and speed', () => {
    expect(radiusForMass(10)).toBeCloseTo(28 + 20 * Math.log(2), 9);
    expect(radiusForMass(1e9)).toBe(200);
  });
});
