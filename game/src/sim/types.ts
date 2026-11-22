import type { AbilityId } from '../config';

export type Temperament = 'bold' | 'cautious';
/** The arena runs nonstop; 'storm' while the periodic storm event is active. */
export type Phase = 'play' | 'storm';
/** Periodic storm: calm -> warn ("STORM INCOMING") -> shrink -> hold -> expand -> calm. */
export type StormStage = 'calm' | 'warn' | 'shrink' | 'hold' | 'expand';
export type AiMode = 'flee' | 'chase' | 'pellet' | 'wander' | 'dash' | 'storm' | 'merge';

export interface Ball {
  id: number;
  ownerId: string;
  isBot: boolean;
  mass: number;
  radius: number;
  x: number;
  y: number;
  /** Position at the start of the last step (render interpolation). */
  px: number;
  py: number;
  vx: number;
  vy: number;
  temperament: Temperament;
  spawnedAt: number;
  protectedUntil: number;
  /** Split pieces: time after which they may re-merge (0 = not split). */
  mergeAt: number;
  // AI
  aiMode: AiMode;
  aiDx: number;
  aiDy: number;
  aiNextThink: number;
  wanderAngle: number;
  wanderUntil: number;
  // per-tick contact bookkeeping
  inContact: boolean;
  lastDamagerOwner: string | null;
  lastDamagedAt: number;
  spillAcc: number;
  spillX: number;
  spillY: number;
  /** Mass at the start of the current step (for effects of eaten balls). */
  massBefore: number;
  /** Mass when the current fight started (caps contact loss so a kill takes >= ~0.4 s). */
  contactRef: number;
  /** Sim time of the last tick this ball was in a damaging contact (-1 = never). */
  contactRefAt: number;
  /** Ball id of the bigger ball currently eating this one (0 = none). Drives the swallow animation. */
  swallowerId: number;
  /** Ball id this ball is currently eating (one mouth at a time; 0 = none). */
  mouthId: number;
  /** After a kill the ball digests until this time: it deals no damage (takes damage normally). */
  digestUntil: number;
  /** Ball id of the last ball that damaged this one most (gets the digestion on a kill). */
  lastDamagerBall: number;
}

export interface QueuedGift {
  giftId: number;
  coinsPerUnit: number;
  units: number;
}

export interface Player {
  userId: string;
  nickname: string;
  avatarUrl?: string;
  isBot: boolean;
  // per scoring window (leaderboard.windowSec)
  kills: number;
  followUsed: boolean;
  shareUsed: boolean;
  /** Had a ball at some point in the current window (gets kill points). */
  activeInWindow: boolean;
  /** Biggest mass this window while not boosted by a gift in the same life ("best free player"). */
  freePeak: number;
  /** Sent a gift during the current life (reset on spawn). */
  giftedThisLife: boolean;
  rejoinAt: number;
  revengeTarget: string | null;
  revengeUntil: number;
  likeWindowStart: number;
  /** Like mass granted in the current 1 s window (capped by likes.maxMassPerSecPerUser). */
  likeWindowMass: number;
  /** Total like mass (drives the "+1 heart" feedback on each whole point). */
  likeMass: number;
  /** Owner-level ability timers (apply to all of the owner's pieces). */
  shieldUntil: number;
  magnetUntil: number;
  dashUntil: number;
  blackHoleUntil: number;
  dashTargetId: number | null;
  /** Gifts waiting for the player to (re)spawn (rejoin cooldown / arena full). */
  pendingGifts: QueuedGift[];
}

export type PelletKind = 'normal' | 'spill' | 'feast';

export interface Pellet {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  value: number;
  kind: PelletKind;
  born: number;
  eaten: boolean;
}

export interface Spike {
  id: number;
  x: number;
  y: number;
  active: boolean;
  respawnAt: number;
}

export interface Projectile {
  id: number;
  senderId: string;
  targetBallId: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  born: number;
  alive: boolean;
}

export interface TitleEntry {
  userId: string;
  nickname: string;
  avatarUrl?: string;
  value: number;
}

export interface LeaderRow {
  userId: string;
  nickname: string;
  avatarUrl?: string;
  points: number;
}

/** The non-blocking "TOP PLAYERS" panel shown at the end of each scoring window. */
export interface LeaderPanel {
  windowNo: number;
  /** Current King; value = mass, reignSec = time on the throne so far. */
  king: (TitleEntry & { reignSec: number }) | null;
  /** Top killers of the window (value = kills), most first; only players with at least one kill. */
  killers: TitleEntry[];
  /** Biggest free (non-gift-boosted) player of the window; value = peak mass. */
  bestFree: TitleEntry | null;
}

export type SimEvent =
  | { type: 'storm'; stage: StormStage }
  | { type: 'spawn'; ballId: number; ownerId: string; isBot: boolean }
  | { type: 'botLeft'; ballId: number; x: number; y: number }
  | { type: 'eaten'; ballId: number; ownerId: string; killerOwner: string | null; x: number; y: number; radius: number; mass: number; final: boolean }
  | { type: 'split'; ownerId: string; x: number; y: number; radius: number; mass: number }
  | { type: 'merge'; ownerId: string; ballId: number }
  | { type: 'ability'; ability: AbilityId; ownerId: string; nickname: string; units: number }
  | { type: 'spikeShotHit'; targetOwner: string; x: number; y: number; blocked: boolean; split: boolean }
  | { type: 'kingChanged'; from: string | null; to: string | null }
  | { type: 'feast'; active: boolean }
  | { type: 'gift'; ownerId: string; mass: number; giftName?: string }
  | { type: 'giftQueued'; ownerId: string; nickname: string; what: string; when: 'respawn' | 'spawn' }
  | { type: 'likeHeart'; ownerId: string; ballId: number }
  | { type: 'leaderboard'; panel: LeaderPanel };
