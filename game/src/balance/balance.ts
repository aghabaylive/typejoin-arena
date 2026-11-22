/// <reference types="node" />
/**
 * Headless balance harness: `npm run sim:balance` (from the repo root).
 *
 * Runs the real Sim at maximum speed (no rendering) through its public input (handleEvent) for a
 * number of rounds per viewer-pool scenario and reports dominance / survival metrics.
 *
 * Options:
 *   --rounds 20            rounds per scenario
 *   --pools 20,50,100      viewer pool sizes
 *   --label after          JSON goes to docs/balance/<label>.json
 *   --set contact.rate=0.4 config override (repeatable; dotted path, numeric value)
 *   --seed 1
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GIFT_MAP, catalogGiftByName, type GameEvent } from '@typejoin/shared';
import { Sim } from '../sim/Sim';
import { makeRng } from '../sim/util';

const DT = 1 / 60;

/**
 * Gift mix, with the same coin values as before (1 / 100 / 500 / 1000). Rose is the real catalog Rose (now the
 * Dash gift). The 100/500/1000-coin roles send the gifts mapped to Spike shot / Magnet / Black hole in
 * shared/gift-map.json, so the abilities fire exactly as they did with the placeholder ids.
 */
const ROSE_ID = catalogGiftByName('Rose')?.id ?? GIFT_MAP.dash;
const MIX = {
  rose: { giftId: ROSE_ID, coins: 1 },
  mid: { giftId: GIFT_MAP.spikeShot, coins: 100 },
  whale500: { giftId: GIFT_MAP.magnet, coins: 500 },
  whale1000: { giftId: GIFT_MAP.blackHole, coins: 1000 },
};
const LIKES_PER_SEC = 20;

interface Args { rounds: number; pools: number[]; label: string; seed: number; overrides: Record<string, unknown> }

function parseArgs(argv: string[]): Args {
  const a: Args = { rounds: 20, pools: [20, 50, 100], label: 'latest', seed: 1, overrides: {} };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i], v = argv[i + 1];
    if (k === '--rounds') a.rounds = Number(v), i++;
    else if (k === '--pools') a.pools = v.split(',').map(Number), i++;
    else if (k === '--label') a.label = v, i++;
    else if (k === '--seed') a.seed = Number(v), i++;
    else if (k === '--set') {
      const [path, val] = v.split('=');
      let o = a.overrides as Record<string, unknown>;
      const parts = path.split('.');
      for (const p of parts.slice(0, -1)) o = (o[p] ??= {}) as Record<string, unknown>;
      o[parts[parts.length - 1]] = Number(val);
      i++;
    }
  }
  return a;
}

type Role = 'none' | 'rose' | 'mid' | 'whale';

interface Scheduled { at: number; fn: () => void }

export interface ScenarioResult {
  pool: number;
  rounds: number;
  topKills: number[];
  topKillerShare: number;
  medianNonGifterLifeSec: number;
  p25NonGifterLifeSec: number;
  kingChangesPerRound: number;
  lowestPelletsPlay: number;
  lowestPelletsStorm: number;
  /** Where the lowest play-phase pellet count happened. */
  lowestPelletsPlayAt: string;
  /** Share of rounds the whale (1000-coin gifter) finishes in the live top 3 by mass. */
  whaleTop3Rate: number;
  /** Share of the round time after the whale's 1000-coin gift during which the whale is King. */
  whaleKingShare: number;
  medianRoseLifeSec: number;
  avgKillsPerRound: number;
  avgQueuePeak?: number;
}

const quantile = (xs: number[], q: number) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const pos = (s.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
};

export function runScenario(pool: number, rounds: number, seed: number, overrides: Record<string, unknown>): ScenarioResult {
  const sim = new Sim({ seed, config: overrides as never });
  const rand = makeRng(seed * 7919 + pool);
  const ids = Array.from({ length: pool }, (_, i) => `v${i}`);
  const ev = (e: Record<string, unknown>) => sim.handleEvent({ ts: 0, nickname: String(e.userId), ...e } as GameEvent);
  const gift = (userId: string, giftId: number, coinsPerUnit: number, units: number) =>
    ev({ type: 'gift', userId, giftId, giftName: String(giftId), coinsPerUnit, units });

  let queue: Scheduled[] = [];
  const at = (t: number, fn: () => void) => queue.push({ at: t, fn });

  // Per-round bookkeeping.
  let roles = new Map<string, Role>();
  let lifeStart = new Map<string, number>();
  let gaveUp = new Set<string>();
  let roundKills = new Map<string, number>();
  let kingChanges = 0;
  let roundNo = 0;

  const allTopKills: number[][] = [];
  let totalKills = 0, totalTopKiller = 0;
  const nonGifterLives: number[] = [];
  const kingPerRound: number[] = [];
  let lowestPlay = Infinity, lowestStorm = Infinity;
  let lowestPlayAt = '';
  const roseLives: number[] = [];
  let whaleId = '';
  let whaleHoleAt = Infinity;
  let whaleKingSec = 0, whaleAfterSec = 0;
  let whaleTop3 = 0;
  let queuePeakSum = 0, queuePeak = 0;
  let likeAcc = 0;

  const beginRound = () => {
    roundNo++;
    queue = [];
    roles = new Map();
    lifeStart = new Map();
    gaveUp = new Set();
    roundKills = new Map();
    kingChanges = 0;
    queuePeak = 0;
    whaleHoleAt = Infinity;
    const t0 = sim.time;
    const R = sim.cfg.round;
    const end = t0 + R.joinSec + R.playSec + R.stormSec - 5;
    const shuffled = [...ids].sort(() => rand() - 0.5);
    const nRose = Math.round(pool * 0.1), nMid = Math.round(pool * 0.04);
    shuffled.forEach((id, i) => {
      const role: Role = i === 0 ? 'whale' : i <= nRose ? 'rose' : i <= nRose + nMid ? 'mid' : 'none';
      roles.set(id, role);
      if (role === 'whale') whaleId = id;
      at(t0 + rand() * (R.joinSec - 2), () => ev({ type: 'join', userId: id }));
      const when = () => t0 + rand() * (end - t0);
      if (role === 'rose') at(when(), () => gift(id, MIX.rose.giftId, MIX.rose.coins, 1 + Math.floor(rand() * 5)));
      if (role === 'mid') at(when(), () => gift(id, MIX.mid.giftId, MIX.mid.coins, 1));
      if (role === 'whale') {
        at(when(), () => gift(id, MIX.whale500.giftId, MIX.whale500.coins, 1));
        at(when(), () => {
          whaleHoleAt = sim.time;
          gift(id, MIX.whale1000.giftId, MIX.whale1000.coins, 1);
        });
      }
    });
  };

  const endRound = () => {
    const end = sim.time;
    for (const [id, t] of lifeStart) {
      // censored at round end
      if (roles.get(id) === 'none') nonGifterLives.push(end - t);
      else if (roles.get(id) === 'rose') roseLives.push(end - t);
    }
    if (sim.topOwners(3).some((o) => o.ownerId === whaleId)) whaleTop3++;
    const kills = [...roundKills.values()].sort((a, b) => b - a);
    const sum = kills.reduce((s, k) => s + k, 0);
    allTopKills.push([kills[0] ?? 0, kills[1] ?? 0, kills[2] ?? 0]);
    totalKills += sum;
    totalTopKiller += kills[0] ?? 0;
    kingPerRound.push(kingChanges);
    queuePeakSum += queuePeak;
  };

  let lastPhase = sim.phase;
  beginRound();
  while (roundNo <= rounds) {
    // Scheduled viewer actions.
    if (queue.length) {
      const due = queue.filter((s) => s.at <= sim.time);
      if (due.length) {
        queue = queue.filter((s) => s.at > sim.time);
        for (const s of due) s.fn();
      }
    }
    // Steady likes (not during results).
    if (sim.phase !== 'results') {
      likeAcc += LIKES_PER_SEC * DT;
      while (likeAcc >= 5) {
        likeAcc -= 5;
        ev({ type: 'like', userId: ids[Math.floor(rand() * pool)], count: 5 });
      }
    }
    sim.step(DT);
    for (const e of sim.drainEvents()) {
      if (e.type === 'spawn' && !e.isBot && roles.has(e.ownerId) && !lifeStart.has(e.ownerId)) lifeStart.set(e.ownerId, sim.time);
      else if (e.type === 'eaten' && e.final) {
        const start = lifeStart.get(e.ownerId);
        if (start !== undefined) {
          if (roles.get(e.ownerId) === 'none') nonGifterLives.push(sim.time - start);
          else if (roles.get(e.ownerId) === 'rose') roseLives.push(sim.time - start);
          lifeStart.delete(e.ownerId);
        }
        if (e.killerOwner) roundKills.set(e.killerOwner, (roundKills.get(e.killerOwner) ?? 0) + 1);
        // Viewer reaction: 30 % give up for this round, the rest type join again after 5-30 s.
        if (roles.has(e.ownerId) && sim.combatEnabled()) {
          if (rand() < 0.3) gaveUp.add(e.ownerId);
          else {
            const id = e.ownerId;
            at(sim.time + 5.05 + rand() * 25, () => {
              if (sim.combatEnabled() && !gaveUp.has(id)) ev({ type: 'join', userId: id });
            });
          }
        }
      } else if (e.type === 'kingChanged' && e.from && e.to && sim.combatEnabled()) kingChanges++;
    }
    if (sim.combatEnabled()) {
      if (sim.phase === 'play' && sim.pellets.length < lowestPlay) {
        lowestPlay = sim.pellets.length;
        lowestPlayAt = `play ${sim.phaseTimeLeft().toFixed(0)}s left, ${sim.balls.length} balls`;
      }
      if (sim.phase === 'storm') lowestStorm = Math.min(lowestStorm, sim.pellets.length);
      const q = (sim as unknown as { joinQueue?: unknown[] }).joinQueue;
      if (q) queuePeak = Math.max(queuePeak, q.length);
    }
    // Whale crown time after the 1000-coin gift (until the round ends).
    if (sim.phase !== 'results' && sim.time > whaleHoleAt) {
      whaleAfterSec += DT;
      if (sim.kingOwner === whaleId) whaleKingSec += DT;
    }
    if (sim.phase !== lastPhase) {
      // Lifetime counts combat time: lives that began in the join window start when play starts.
      if (sim.phase === 'play') for (const id of lifeStart.keys()) lifeStart.set(id, sim.time);
      if (sim.phase === 'results') endRound();
      if (sim.phase === 'join' && lastPhase === 'results') beginRound();
      lastPhase = sim.phase;
    }
  }

  const avg = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / (xs.length || 1);
  const top = [0, 1, 2].map((k) => avg(allTopKills.map((r) => r[k])));
  return {
    pool,
    rounds,
    topKills: top.map((x) => +x.toFixed(1)),
    topKillerShare: +(totalKills ? totalTopKiller / totalKills : 0).toFixed(3),
    medianNonGifterLifeSec: +quantile(nonGifterLives, 0.5).toFixed(1),
    p25NonGifterLifeSec: +quantile(nonGifterLives, 0.25).toFixed(1),
    kingChangesPerRound: +avg(kingPerRound).toFixed(2),
    lowestPelletsPlay: lowestPlay === Infinity ? 0 : lowestPlay,
    lowestPelletsStorm: lowestStorm === Infinity ? 0 : lowestStorm,
    lowestPelletsPlayAt: lowestPlayAt,
    whaleTop3Rate: +(whaleTop3 / rounds).toFixed(3),
    whaleKingShare: +(whaleAfterSec ? whaleKingSec / whaleAfterSec : 0).toFixed(3),
    medianRoseLifeSec: +quantile(roseLives, 0.5).toFixed(1),
    avgKillsPerRound: +(totalKills / rounds).toFixed(1),
    avgQueuePeak: +(queuePeakSum / rounds).toFixed(1),
  };
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const results: ScenarioResult[] = [];
  const t0 = Date.now();
  for (const pool of args.pools) results.push(runScenario(pool, args.rounds, args.seed, args.overrides));
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  const pct = (x: number) => `${(x * 100).toFixed(0)}%`;
  const head = ['viewers', 'top-3 kills', 'top killer share', 'life median non-gift', 'p25', 'life median Rose', 'King chg/round', 'whale top 3', 'whale King after BH', 'min pellets play', 'min pellets storm', 'kills/round'];
  const rows = results.map((r) => [
    String(r.pool), r.topKills.join(' / '), pct(r.topKillerShare), `${r.medianNonGifterLifeSec}s`, `${r.p25NonGifterLifeSec}s`,
    `${r.medianRoseLifeSec}s`, String(r.kingChangesPerRound), pct(r.whaleTop3Rate), pct(r.whaleKingShare),
    String(r.lowestPelletsPlay), String(r.lowestPelletsStorm), String(r.avgKillsPerRound),
  ]);
  const w = head.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));
  const line = (cells: string[]) => '| ' + cells.map((c, i) => c.padEnd(w[i])).join(' | ') + ' |';
  console.log(`\nbalance: ${args.rounds} rounds/scenario, seed ${args.seed}, overrides ${JSON.stringify(args.overrides)} (${secs}s)`);
  console.log(line(head));
  console.log('|' + w.map((n) => '-'.repeat(n + 2)).join('|') + '|');
  for (const r of rows) console.log(line(r));
  const out = resolve(dirname(fileURLToPath(import.meta.url)), '../../../docs/balance', `${args.label}.json`);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify({ label: args.label, date: new Date().toISOString(), rounds: args.rounds, seed: args.seed, overrides: args.overrides, results }, null, 2) + '\n');
  console.log(`saved ${out}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) main();
