/// <reference types="node" />
/**
 * Headless balance harness: `npm run sim:balance` (from the repo root).
 *
 * Runs the real Sim at maximum speed (no rendering) through its public input (handleEvent): continuous
 * runs (no rounds) per viewer-pool scenario, measured in 5-minute windows (leaderboard.windowSec).
 *
 * Options:
 *   --runs 3               continuous runs per scenario (seed, seed+1, ...)
 *   --minutes 30           length of each run
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
  /** 3 % of viewers send one Doughnut (30 coins) = Shield. */
  doughnut: { giftId: GIFT_MAP.shield, coins: catalogGiftByName('Doughnut')?.coins ?? 30 },
  mid: { giftId: GIFT_MAP.spikeShot, coins: 100 },
  whale500: { giftId: GIFT_MAP.magnet, coins: 500 },
  whale1000: { giftId: GIFT_MAP.blackHole, coins: 1000 },
};
const LIKES_PER_SEC = 20;

interface Args { runs: number; minutes: number; pools: number[]; label: string; seed: number; overrides: Record<string, unknown> }

function parseArgs(argv: string[]): Args {
  const a: Args = { runs: 3, minutes: 30, pools: [20, 50, 100], label: 'latest', seed: 1, overrides: {} };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i], v = argv[i + 1];
    if (k === '--runs') a.runs = Number(v), i++;
    else if (k === '--minutes') a.minutes = Number(v), i++;
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

type Role = 'none' | 'rose' | 'doughnut' | 'mid' | 'whale';

interface Scheduled { at: number; fn: () => void }

/** Seconds after the whale's single 1000-coin gift at which its mass is sampled. */
export const WHALE_CHECKPOINTS = [0, 30, 60, 120, 180, 300, 600];

export interface ScenarioResult {
  pool: number;
  runs: number;
  minutes: number;
  /** Visible crown changes per 5 minutes, every change including to and from "No king yet". */
  crownChangesPer5Min: number;
  /** Average top-3 kill counts per window. */
  topKills: number[];
  /** Kills of each window's top killer / all player kills (summed over windows). */
  topKillerShare: number;
  medianNonGifterLifeSec: number;
  p25NonGifterLifeSec: number;
  medianRoseLifeSec: number;
  /** Share of the run time the whale is in the live top 3 by mass. */
  whaleTop3Share: number;
  /** Share of the 5 minutes after the whale's Black Hole during which the whale is King. */
  whaleKingShareAfterBH: number;
  /** Whale mass (mean over runs; 0 when dead) at WHALE_CHECKPOINTS seconds after its 1000-coin gift. */
  whaleMassAfterGift: number[];
  /** Runs in which the whale had died by each checkpoint (at least once). */
  whaleDeadBy: number[];
  /** Median mass of the alive real players at the same checkpoints (reference). */
  medianPlayerMass: number[];
  killsPer5Min: number;
  /** TOP PLAYERS panels shown per run (one per window; a panel waits while a storm is on). */
  panelsPerRun: number;
  /** Info only (accepted by design, no target): lowest pellet count outside / during storms. */
  lowestPelletsCalm: number;
  lowestPelletsStorm: number;
  avgQueuePeak: number;
}

const quantile = (xs: number[], q: number) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const pos = (s.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
};

interface RunStats {
  crownChanges: number;
  windowKills: number[][]; // per window: kills per killer (sorted desc)
  nonGifterLives: number[];
  roseLives: number[];
  whaleTop3Sec: number;
  whaleKingSec: number;
  whaleAfterSec: number;
  whaleMass: number[];
  whaleDead: boolean[];
  playerMass: number[];
  kills: number;
  panels: number;
  lowestCalm: number;
  lowestStorm: number;
  queuePeak: number;
}

function runOnce(pool: number, minutes: number, seed: number, overrides: Record<string, unknown>): RunStats {
  const sim = new Sim({ seed, config: overrides as never });
  const rand = makeRng(seed * 7919 + pool);
  const windowSec = sim.cfg.leaderboard.windowSec;
  const endAt = minutes * 60;
  const windows = Math.ceil(endAt / windowSec);
  const ids = Array.from({ length: pool }, (_, i) => `v${i}`);
  const ev = (e: Record<string, unknown>) => sim.handleEvent({ ts: 0, nickname: String(e.userId), ...e } as GameEvent);
  const gift = (userId: string, giftId: number, coinsPerUnit: number, units: number) =>
    ev({ type: 'gift', userId, giftId, giftName: String(giftId), coinsPerUnit, units });

  let queue: Scheduled[] = [];
  const at = (t: number, fn: () => void) => queue.push({ at: t, fn });

  const roles = new Map<string, Role>();
  const lifeStart = new Map<string, number>();
  const st: RunStats = {
    crownChanges: 0, windowKills: [], nonGifterLives: [], roseLives: [], whaleTop3Sec: 0, whaleKingSec: 0, whaleAfterSec: 0,
    whaleMass: [], whaleDead: [], playerMass: [], kills: 0, panels: 0, lowestCalm: Infinity, lowestStorm: Infinity, queuePeak: 0,
  };
  let winKills = new Map<string, number>();
  let whaleId = '';
  let whaleHoleAt = Infinity;
  let whaleDied = false;
  let nextCheckpoint = 0;
  let likeAcc = 0;
  let nextSample = 0;

  // Roles are fixed for the whole run (a viewer's habits do not change every 5 minutes).
  const shuffled = [...ids].sort(() => rand() - 0.5);
  const nRose = Math.round(pool * 0.1), nMid = Math.round(pool * 0.04), nDough = Math.round(pool * 0.03);
  shuffled.forEach((id, i) => {
    const role: Role = i === 0 ? 'whale' : i <= nRose ? 'rose' : i <= nRose + nMid ? 'mid'
      : i <= nRose + nMid + nDough ? 'doughnut' : 'none';
    roles.set(id, role);
    if (role === 'whale') whaleId = id;
    // Viewers arrive during the first 2 minutes and type join.
    at(rand() * 120, () => ev({ type: 'join', userId: id }));
    // Small gifters send once per window, at a random moment.
    for (let w = 0; w < windows; w++) {
      const when = () => w * windowSec + rand() * windowSec;
      if (role === 'rose') at(when(), () => gift(id, MIX.rose.giftId, MIX.rose.coins, 1 + Math.floor(rand() * 5)));
      if (role === 'mid') at(when(), () => gift(id, MIX.mid.giftId, MIX.mid.coins, 1));
      if (role === 'doughnut') at(when(), () => gift(id, MIX.doughnut.giftId, MIX.doughnut.coins, 1));
    }
    if (role === 'whale') {
      at(60 + rand() * 180, () => gift(id, MIX.whale500.giftId, MIX.whale500.coins, 1));
      // A single 1000-coin gift (Black Hole), then nothing: does decay bring the whale back down?
      at(300 + rand() * 120, () => {
        whaleHoleAt = sim.time;
        gift(id, MIX.whale1000.giftId, MIX.whale1000.coins, 1);
      });
    }
  });

  while (sim.time < endAt) {
    if (queue.length) {
      const due = queue.filter((s) => s.at <= sim.time);
      if (due.length) {
        queue = queue.filter((s) => s.at > sim.time);
        for (const s of due) s.fn();
      }
    }
    likeAcc += LIKES_PER_SEC * DT;
    while (likeAcc >= 5) {
      likeAcc -= 5;
      ev({ type: 'like', userId: ids[Math.floor(rand() * pool)], count: 5 });
    }
    sim.step(DT);
    for (const e of sim.drainEvents()) {
      if (e.type === 'spawn' && !e.isBot && roles.has(e.ownerId) && !lifeStart.has(e.ownerId)) lifeStart.set(e.ownerId, sim.time);
      else if (e.type === 'eaten' && e.final) {
        const start = lifeStart.get(e.ownerId);
        if (start !== undefined) {
          if (roles.get(e.ownerId) === 'none') st.nonGifterLives.push(sim.time - start);
          else if (roles.get(e.ownerId) === 'rose') st.roseLives.push(sim.time - start);
          lifeStart.delete(e.ownerId);
        }
        if (e.ownerId === whaleId && sim.time >= whaleHoleAt) whaleDied = true;
        if (e.killerOwner && roles.has(e.killerOwner)) {
          winKills.set(e.killerOwner, (winKills.get(e.killerOwner) ?? 0) + 1);
          st.kills++;
        }
        // Viewer reaction: 30 % leave for 2-6 minutes, the rest type join again after 5-30 s.
        if (roles.has(e.ownerId)) {
          const id = e.ownerId;
          const back = rand() < 0.3 ? 120 + rand() * 240 : 5.05 + rand() * 25;
          at(sim.time + back, () => ev({ type: 'join', userId: id }));
        }
      } else if (e.type === 'kingChanged') st.crownChanges++;
      else if (e.type === 'leaderboard') st.panels++;
    }
    // Window boundaries for kill stats (fixed 5-minute buckets).
    if (Math.floor(sim.time / windowSec) > st.windowKills.length && st.windowKills.length < windows) {
      st.windowKills.push([...winKills.values()].sort((a, b) => b - a));
      winKills = new Map();
    }
    if (sim.stormActive()) st.lowestStorm = Math.min(st.lowestStorm, sim.pellets.length);
    else st.lowestCalm = Math.min(st.lowestCalm, sim.pellets.length);
    st.queuePeak = Math.max(st.queuePeak, sim.joinQueue.length);
    // Once per second: whale standing.
    if (sim.time >= nextSample) {
      nextSample += 1;
      if (sim.topOwners(3).some((o) => o.ownerId === whaleId)) st.whaleTop3Sec += 1;
      if (sim.time > whaleHoleAt && sim.time <= whaleHoleAt + 300) {
        st.whaleAfterSec += 1;
        if (sim.kingOwner === whaleId) st.whaleKingSec += 1;
      }
    }
    // Whale mass curve after the 1000-coin gift.
    if (nextCheckpoint < WHALE_CHECKPOINTS.length && sim.time >= whaleHoleAt + WHALE_CHECKPOINTS[nextCheckpoint]) {
      st.whaleMass.push(sim.ownerMass(whaleId));
      st.whaleDead.push(whaleDied);
      const alive = sim.topOwners(Infinity).map((o) => o.mass);
      st.playerMass.push(quantile(alive, 0.5));
      nextCheckpoint++;
    }
  }
  if (winKills.size || st.windowKills.length < windows) st.windowKills.push([...winKills.values()].sort((a, b) => b - a));
  for (const [id, t] of lifeStart) {
    // censored at the end of the run
    if (roles.get(id) === 'none') st.nonGifterLives.push(endAt - t);
    else if (roles.get(id) === 'rose') st.roseLives.push(endAt - t);
  }
  return st;
}

export function runScenario(pool: number, runs: number, minutes: number, seed: number, overrides: Record<string, unknown>): ScenarioResult {
  const all = Array.from({ length: runs }, (_, i) => runOnce(pool, minutes, seed + i, overrides));
  const avg = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / (xs.length || 1);
  const windows = all.flatMap((r) => r.windowKills);
  const totalKills = windows.reduce((s, w) => s + w.reduce((a, b) => a + b, 0), 0);
  const topKiller = windows.reduce((s, w) => s + (w[0] ?? 0), 0);
  const per5 = (n: number) => n / (runs * minutes / 5);
  const runSec = minutes * 60;
  return {
    pool,
    runs,
    minutes,
    crownChangesPer5Min: +per5(all.reduce((s, r) => s + r.crownChanges, 0)).toFixed(2),
    topKills: [0, 1, 2].map((k) => +avg(windows.map((w) => w[k] ?? 0)).toFixed(1)),
    topKillerShare: +(totalKills ? topKiller / totalKills : 0).toFixed(3),
    medianNonGifterLifeSec: +quantile(all.flatMap((r) => r.nonGifterLives), 0.5).toFixed(1),
    p25NonGifterLifeSec: +quantile(all.flatMap((r) => r.nonGifterLives), 0.25).toFixed(1),
    medianRoseLifeSec: +quantile(all.flatMap((r) => r.roseLives), 0.5).toFixed(1),
    whaleTop3Share: +(avg(all.map((r) => r.whaleTop3Sec)) / runSec).toFixed(3),
    whaleKingShareAfterBH: +(all.reduce((s, r) => s + r.whaleKingSec, 0) / (all.reduce((s, r) => s + r.whaleAfterSec, 0) || 1)).toFixed(3),
    whaleMassAfterGift: WHALE_CHECKPOINTS.map((_, i) => Math.round(avg(all.map((r) => r.whaleMass[i] ?? 0)))),
    whaleDeadBy: WHALE_CHECKPOINTS.map((_, i) => all.filter((r) => r.whaleDead[i]).length),
    medianPlayerMass: WHALE_CHECKPOINTS.map((_, i) => Math.round(avg(all.map((r) => r.playerMass[i] ?? 0)))),
    killsPer5Min: +per5(all.reduce((s, r) => s + r.kills, 0)).toFixed(1),
    panelsPerRun: +avg(all.map((r) => r.panels)).toFixed(1),
    lowestPelletsCalm: Math.min(...all.map((r) => r.lowestCalm)),
    lowestPelletsStorm: Math.min(...all.map((r) => r.lowestStorm)),
    avgQueuePeak: +avg(all.map((r) => r.queuePeak)).toFixed(1),
  };
}

function table(head: string[], rows: string[][]): string {
  const w = head.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));
  const line = (cells: string[]) => '| ' + cells.map((c, i) => c.padEnd(w[i])).join(' | ') + ' |';
  return [line(head), '|' + w.map((n) => '-'.repeat(n + 2)).join('|') + '|', ...rows.map(line)].join('\n');
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const results: ScenarioResult[] = [];
  const t0 = Date.now();
  for (const pool of args.pools) results.push(runScenario(pool, args.runs, args.minutes, args.seed, args.overrides));
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  const pct = (x: number) => `${(x * 100).toFixed(0)}%`;
  console.log(`\nbalance: ${args.runs} x ${args.minutes} min continuous per scenario, seed ${args.seed}, overrides ${JSON.stringify(args.overrides)} (${secs}s)`);
  console.log(table(
    ['viewers', 'crown chg/5 min', 'top-3 kills/window', 'top killer share', 'life median non-gift', 'p25', 'life median Rose', 'whale top 3', 'whale King 5 min after BH', 'kills/5 min', 'panels/run', 'min pellets calm / storm (info)'],
    results.map((r) => [
      String(r.pool), String(r.crownChangesPer5Min), r.topKills.join(' / '), pct(r.topKillerShare), `${r.medianNonGifterLifeSec}s`,
      `${r.p25NonGifterLifeSec}s`, `${r.medianRoseLifeSec}s`, pct(r.whaleTop3Share), pct(r.whaleKingShareAfterBH),
      String(r.killsPer5Min), String(r.panelsPerRun), `${r.lowestPelletsCalm} / ${r.lowestPelletsStorm}`,
    ]),
  ));
  console.log(`\nwhale mass after its single 1000-coin gift (mean over runs; 0 = dead; deaths so far in brackets) vs median alive player:`);
  console.log(table(
    ['viewers', ...WHALE_CHECKPOINTS.map((s) => `+${s >= 60 ? `${s / 60}m` : `${s}s`}`)],
    results.map((r) => [String(r.pool), ...r.whaleMassAfterGift.map((m, i) => `${m} [${r.whaleDeadBy[i]}] / ${r.medianPlayerMass[i]}`)]),
  ));
  const out = resolve(dirname(fileURLToPath(import.meta.url)), '../../../docs/balance', `${args.label}.json`);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify({ label: args.label, date: new Date().toISOString(), runs: args.runs, minutes: args.minutes, seed: args.seed, overrides: args.overrides, results }, null, 2) + '\n');
  console.log(`saved ${out}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) main();
