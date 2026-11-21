/**
 * PLACEHOLDER gift catalog. These ids are NOT real TikTok gift ids.
 * FakeSource sends exactly these ids and the game's config maps some of them
 * to abilities. When the real TikTok source is added, replace the ids here
 * (or remap them in game/src/config.ts).
 */
export interface GiftDef {
  giftId: number;
  giftName: string;
  coinsPerUnit: number;
  /** TikTok-style streakable gift (sends cumulative repeat counts). */
  streakable: boolean;
}

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

export function findGift(giftId: number): GiftDef | undefined {
  return PLACEHOLDER_GIFTS.find((g) => g.giftId === giftId);
}
