/**
 * Normalized events streamed from the bridge to the game.
 * Every event source (FakeSource now, TikTokSource later) is converted into
 * exactly these shapes by the bridge before it reaches the game.
 */

export interface BaseEvent {
  /** Stable unique id of the viewer (TikTok uniqueId / userId later). */
  userId: string;
  /** Display name. */
  nickname: string;
  /** Profile picture URL. Optional; the game falls back to initials. */
  avatarUrl?: string;
  /** Unix epoch milliseconds when the bridge received the event. */
  ts: number;
}

export interface JoinEvent extends BaseEvent {
  type: 'join';
}

export interface ChatEvent extends BaseEvent {
  type: 'chat';
  text: string;
}

export interface LikeEvent extends BaseEvent {
  type: 'like';
  /** Number of likes in this batch. */
  count: number;
}

export interface GiftEvent extends BaseEvent {
  type: 'gift';
  giftId: number;
  giftName: string;
  coinsPerUnit: number;
  /**
   * Units NEW since the previous update of the same streak.
   * The bridge guarantees each unit is delivered exactly once.
   */
  units: number;
}

export interface FollowEvent extends BaseEvent {
  type: 'follow';
}

export interface ShareEvent extends BaseEvent {
  type: 'share';
}

export type GameEvent =
  | JoinEvent
  | ChatEvent
  | LikeEvent
  | GiftEvent
  | FollowEvent
  | ShareEvent;

export type GameEventType = GameEvent['type'];

/** Envelope for messages sent over the bridge WebSocket. */
export type BridgeMessage =
  | { kind: 'hello'; source: string; version: 1 }
  | { kind: 'event'; event: GameEvent };

export const BRIDGE_DEFAULT_PORT = 8787;

export function isGameEvent(x: unknown): x is GameEvent {
  if (!x || typeof x !== 'object') return false;
  const e = x as Record<string, unknown>;
  return (
    typeof e.type === 'string' &&
    typeof e.userId === 'string' &&
    typeof e.nickname === 'string' &&
    typeof e.ts === 'number'
  );
}
