/**
 * ALL tunable numbers live here. The simulation and renderer read only from this object.
 * Units: px, seconds, mass.
 */
import { PLACEHOLDER_GIFT_IDS } from '@typejoin/shared';

export type AbilityId = 'dash' | 'shield' | 'spikeShot' | 'magnet' | 'blackHole';

export const CONFIG = {
  sim: {
    hz: 60,
    /** Max sim steps per rendered frame (avoids spiral of death after tab switch). */
    maxStepsPerFrame: 5,
  },

  canvas: { width: 1080, height: 1920 },

  arena: {
    cx: 540,
    cy: 806,
    radius: 400, // diameter 800
  },

  ball: {
    startMass: 20,
    radiusBase: 28,
    radiusLogScale: 20,
    radiusLogDiv: 10, // radius = min(maxRadius, base + scale * ln(mass/div + 1))
    maxRadius: 200,
    speedBase: 260,
    speedExp: -0.15, // speed = speedBase * mass^speedExp
    decayAboveMass: 500,
    decayPerSec: 0.001, // 0.1 % of mass / s
    /** Steering responsiveness (1/s). Higher = snappier turns. */
    accel: 6,
    spawnProtectionSec: 3,
    rejoinCooldownSec: 5,
    /** Mass below which a ball counts as eaten. */
    deadMass: 1e-6,
  },

  massTiers: [
    // ring color by mass (checked top-down)
    { min: 10000, color: 0xffc83d, name: 'gold' },
    { min: 5000, color: 0xb05bff, name: 'purple' },
    { min: 1000, color: 0x3d9bff, name: 'blue' },
    { min: 100, color: 0x3dff7a, name: 'green' },
    { min: 0, color: 0xffffff, name: 'white' },
  ],

  ai: {
    fleeRatio: 1.25, // flee balls >= 1.25x own mass
    chaseRatio: 0.8, // chase balls <= 0.8x own mass
    sightBase: 180,
    sightPerRadius: 3, // sight = sightBase + sightPerRadius * radius
    bold: { chaseMul: 1.35, fleeMul: 0.7 },
    cautious: { chaseMul: 0.75, fleeMul: 1.35 },
    boldChance: 0.5,
    /** AI re-decides every N seconds (staggered per ball) for perf + less jitter. */
    thinkIntervalSec: 0.15,
    wanderChangeSec: [1.2, 3.0] as [number, number],
    wallAvoidMargin: 60,
    /** Balls heavier than the spike threshold steer around spikes within this extra distance. */
    spikeAvoidMargin: 40,
  },

  contact: {
    /** Each tick: B.loss = min(B.mass, rate * A.mass * dt). */
    rate: 0.6,
    /** Fraction of the loss that the attacker gains. The rest spills as pellets. */
    gainFraction: 0.5,
    /** Soft separation strength (fraction of overlap resolved per second). */
    pushStrength: 3,
    /** Max spill pellets spawned per ball per tick. */
    maxSpillPelletsPerTick: 2,
    /** Spill pellets scatter this far from the contact point. */
    spillScatter: 30,
  },

  pellets: {
    target: 150,
    value: 1,
    radius: 7,
    /** Hard cap including spill pellets; beyond it spill mass merges into existing pellets. */
    maxTotal: 700,
    respawnPerSec: 150,
  },

  spikes: {
    count: 4,
    radius: 26,
    splitAboveMass: 1000,
    splitPieces: 4,
    remergeSec: 12,
    /** Pieces that have not touched after remergeSec are forced together this much later. */
    forceMergeAfterSec: 3,
    respawnSec: 10,
    maxPiecesPerOwner: 16,
    splitImpulse: 420,
  },

  likes: {
    massPerLike: 1,
    maxPerSecPerUser: 20,
    feastLikes: 3000,
    feastSec: 10,
    feastPelletsPerSec: 45,
    feastPelletValue: 2,
  },

  social: {
    followMass: 50,
    shareMass: 50,
  },

  gifts: {
    massPerCoin: 25, // mass = coinsPerUnit * units * massPerCoin
    /** giftId -> ability. Placeholder ids shared with FakeSource. */
    abilities: {
      [PLACEHOLDER_GIFT_IDS.dash]: 'dash',
      [PLACEHOLDER_GIFT_IDS.shield]: 'shield',
      [PLACEHOLDER_GIFT_IDS.spikeShot]: 'spikeShot',
      [PLACEHOLDER_GIFT_IDS.magnet]: 'magnet',
      [PLACEHOLDER_GIFT_IDS.blackHole]: 'blackHole',
    } as Record<number, AbilityId>,
  },

  abilities: {
    maxDurationSec: 60,
    dash: { sec: 3, speedMul: 3 },
    shield: { sec: 10 },
    spikeShot: {
      speed: 950,
      radius: 30,
      splitAboveMass: 1000,
      lossFraction: 0.3,
      /** Delay between consecutive shots when one gift has several units. */
      staggerSec: 0.35,
      maxLifeSec: 4,
    },
    magnet: { sec: 8, range: 400, ballMassRatio: 1 / 3, pelletPull: 520, ballPull: 260 },
    blackHole: { sec: 5, range: 350, ballMassRatio: 0.5, pelletPull: 900, ballPull: 620 },
  },

  /** Gift legend rows (right side). Order = display order. */
  legend: [
    { ability: 'dash', label: 'Dash', giftId: PLACEHOLDER_GIFT_IDS.dash, coins: 5, color: 0x3dd6ff, glyph: '»' },
    { ability: 'shield', label: 'Shield', giftId: PLACEHOLDER_GIFT_IDS.shield, coins: 30, color: 0x3dff9b, glyph: '◈' },
    { ability: 'spikeShot', label: 'Spike shot', giftId: PLACEHOLDER_GIFT_IDS.spikeShot, coins: 100, color: 0xff5b5b, glyph: '✸' },
    { ability: 'magnet', label: 'Magnet', giftId: PLACEHOLDER_GIFT_IDS.magnet, coins: 500, color: 0xb05bff, glyph: '∩' },
    { ability: 'blackHole', label: 'Black hole', giftId: PLACEHOLDER_GIFT_IDS.blackHole, coins: 1000, color: 0xffc83d, glyph: '●' },
  ] as { ability: AbilityId; label: string; giftId: number; coins: number; color: number; glyph: string }[],

  round: {
    joinSec: 10,
    playSec: 150,
    stormSec: 60,
    resultsSec: 15,
    stormMinRadiusFrac: 0.5,
    stormDamagePerSec: 0.05, // 5 % of mass / s outside the safe zone
    finalCountdownSec: 10,
  },

  bots: {
    minBalls: 8,
    /** Seconds between bot spawns while below minBalls. */
    spawnIntervalSec: 0.5,
  },

  leaderboard: {
    placePoints: [10, 7, 5],
    top10Points: 2,
    pointsPerKill: 1,
    showTop: 5,
  },

  revenge: { sec: 60 },

  render: {
    bg: 0x0a1230,
    hexSize: 46,
    hexColor: 0x1b2a5c,
    rimColor: 0x4fb4ff,
    stormColor: 0xff3b4a,
    minFont: 36,
    fontFamily: 'Arial Black, Arial, Helvetica, sans-serif',
    /** Layout bands (px in the 1080x1920 canvas). */
    hudTop: 288, // 15 %
    hudBottom: 403, // 21 %
    arenaBottom: 1210, // 63 %
    legendTop: 1210,
    legendBottom: 1690, // 88 %
    legendX: 600,
    legendRight: 1010,
    legendIcon: 88,
    wobbleAmp: 0.08,
    showMassBelowName: true,
  },

  net: {
    /** Overridable with ?bridge=ws://host:port */
    bridgeUrl: 'ws://localhost:8787',
    /** Avatars are fetched through the bridge's future proxy: `${avatarProxy}${encodeURIComponent(url)}` */
    avatarProxy: 'http://localhost:8787/avatar?url=',
  },
};

export type Config = typeof CONFIG;

export function radiusForMass(mass: number, c: Config = CONFIG): number {
  const b = c.ball;
  return Math.min(b.maxRadius, b.radiusBase + b.radiusLogScale * Math.log(Math.max(0, mass) / b.radiusLogDiv + 1));
}

export function speedForMass(mass: number, c: Config = CONFIG): number {
  return c.ball.speedBase * Math.pow(Math.max(1, mass), c.ball.speedExp);
}

export function tierColor(mass: number, c: Config = CONFIG): number {
  for (const t of c.massTiers) if (mass >= t.min) return t.color;
  return 0xffffff;
}
