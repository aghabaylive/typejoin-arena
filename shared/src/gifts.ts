/**
 * Gifts.
 *
 * - shared/gift-catalog.json: the real TikTok gift list (id, name, coins, icon), fetched from a live room with
 *   `npm run gifts:fetch -- <username>`. Icons are stored locally in game/public/gifts/.
 * - shared/gift-map.json: which gift id triggers which ability. Every other gift just adds mass.
 * - PLACEHOLDER_GIFTS: stand-ins for ability ids that are not (yet) real catalog gifts, so they stay testable.
 */
import catalogJson from '../gift-catalog.json';
import giftMapJson from '../gift-map.json';

export interface GiftDef {
  giftId: number;
  giftName: string;
  coinsPerUnit: number;
  /** TikTok-style streakable gift (sends cumulative repeat counts). */
  streakable: boolean;
  /** Local icon path relative to the game's public dir (e.g. "gifts/5655.png"); empty = placeholder. */
  icon?: string;
}

export interface CatalogGift {
  id: number;
  name: string;
  coins: number;
  /** Original TikTok CDN url (reference only; never loaded at runtime). */
  imageUrl: string;
  /** Local copy, relative to game/public (e.g. "gifts/5655.png"). */
  icon: string;
  streakable: boolean;
}

export interface GiftCatalog {
  fetchedAt: string | null;
  gifts: CatalogGift[];
}

export type GiftAbility = 'dash' | 'shield' | 'spikeShot' | 'magnet' | 'blackHole';
export const GIFT_ABILITIES: GiftAbility[] = ['dash', 'shield', 'spikeShot', 'magnet', 'blackHole'];

export const GIFT_CATALOG = catalogJson as GiftCatalog;
/** ability -> giftId (shared/gift-map.json). */
export const GIFT_MAP = giftMapJson as Record<GiftAbility, number>;

/** Placeholder ids (NOT real TikTok ids), used only where gift-map.json still points at them. */
export const PLACEHOLDER_GIFT_IDS = {
  rose: 9001,
  dash: 9005,
  shield: 9030,
  spikeShot: 9100,
  magnet: 9500,
  blackHole: 9999,
  heart: 9010,
} as const;

export const PLACEHOLDER_GIFTS: GiftDef[] = [
  { giftId: PLACEHOLDER_GIFT_IDS.rose, giftName: 'Rose', coinsPerUnit: 1, streakable: true },
  { giftId: PLACEHOLDER_GIFT_IDS.dash, giftName: 'Rocket Boots', coinsPerUnit: 5, streakable: true },
  { giftId: PLACEHOLDER_GIFT_IDS.heart, giftName: 'Big Heart', coinsPerUnit: 10, streakable: true },
  { giftId: PLACEHOLDER_GIFT_IDS.shield, giftName: 'Shield', coinsPerUnit: 30, streakable: false },
  { giftId: PLACEHOLDER_GIFT_IDS.spikeShot, giftName: 'Spike Shot', coinsPerUnit: 100, streakable: false },
  { giftId: PLACEHOLDER_GIFT_IDS.magnet, giftName: 'Magnet', coinsPerUnit: 500, streakable: false },
  { giftId: PLACEHOLDER_GIFT_IDS.blackHole, giftName: 'Black Hole', coinsPerUnit: 1000, streakable: false },
];

const toDef = (g: CatalogGift): GiftDef => ({ giftId: g.id, giftName: g.name, coinsPerUnit: g.coins, streakable: g.streakable, icon: g.icon });

export function catalogGift(giftId: number): CatalogGift | undefined {
  return GIFT_CATALOG.gifts.find((g) => g.id === giftId);
}

export function catalogGiftByName(name: string): CatalogGift | undefined {
  const n = name.trim().toLowerCase();
  return GIFT_CATALOG.gifts.find((g) => g.name.trim().toLowerCase() === n);
}

/** Catalog gift first, else a placeholder stand-in. */
export function findGift(giftId: number): GiftDef | undefined {
  const c = catalogGift(giftId);
  if (c) return toDef(c);
  return PLACEHOLDER_GIFTS.find((g) => g.giftId === giftId);
}

/** Abilities whose mapped gift id is not in the catalog (still a placeholder or a typo). */
export function missingMappedGifts(): { ability: GiftAbility; giftId: number }[] {
  return GIFT_ABILITIES.filter((a) => !catalogGift(GIFT_MAP[a])).map((ability) => ({ ability, giftId: GIFT_MAP[ability] }));
}

/**
 * Gifts the dev panel / FakeSource can send: the whole catalog (real ids, names, prices), plus placeholder
 * stand-ins for mapped ability ids that are missing from the catalog, so every ability stays testable.
 * Falls back to the placeholder list if no catalog has been fetched yet.
 */
export function devGifts(): GiftDef[] {
  if (!GIFT_CATALOG.gifts.length) return PLACEHOLDER_GIFTS;
  const extra = missingMappedGifts()
    .map((m) => PLACEHOLDER_GIFTS.find((p) => p.giftId === m.giftId) ?? { giftId: m.giftId, giftName: `${m.ability} (placeholder)`, coinsPerUnit: 0, streakable: false })
    .map((d) => ({ ...d, giftName: d.giftName.includes('placeholder') ? d.giftName : `${d.giftName} (placeholder)` }));
  return [...GIFT_CATALOG.gifts.map(toDef), ...extra];
}
