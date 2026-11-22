import type { AbilityId } from '../config';

export type Temperament = 'bold' | 'cautious';
export type Phase = 'join' | 'play' | 'storm' | 'results';
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
  // round-scoped
  kills: number;
  gifted: boolean;
  followUsed: boolean;
  shareUsed: boolean;
  rejoinAt: number;
  revengeTarget: string | null;
  revengeUntil: number;
  likeWindowStart: number;
  likeWindowCount: number;
  /** Owner-level ability timers (apply to all of the owner's pieces). */
  shieldUntil: number;
  magnetUntil: number;
  dashUntil: number;
  blackHoleUntil: number;
  dashTargetId: number | null;
  /** Abilities waiting for the play phase. */
  pendingAbilities: { ability: AbilityId; units: number }[];
  /** Gifts waiting for the player to (re)spawn (rejoin cooldown). */
  pendingGifts: QueuedGift[];
  /** Gifts / join sent during results: applied at the next round's start. */
  carryGifts: QueuedGift[];
  queuedJoin: boolean;
  everJoinedThisRound: boolean;
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

export interface RoundResults {
  roundNo: number;
  king: TitleEntry | null;
  killer: TitleEntry | null;
  bestFree: TitleEntry | null;
  top: LeaderRow[];
}

export type SimEvent =
  | { type: 'phase'; phase: Phase; roundNo: number }
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
  | { type: 'giftQueued'; ownerId: string; nickname: string; what: string; when: 'nextRound' | 'respawn' }
  | { type: 'results'; results: RoundResults };
