import type { SourceState } from '@typejoin/shared';

/**
 * Raw events as produced by an event source, BEFORE normalization.
 * The shape intentionally mirrors what a TikTok LIVE connector delivers
 * (e.g. cumulative gift repeat counts) so a TikTokSource is a drop-in.
 */
export interface RawUser {
  userId: string;
  nickname: string;
  avatarUrl?: string;
  /** When the platform created the event (TikTok createTime, ms). Used only for delay stats. */
  sourceTs?: number;
}

export type RawSourceEvent =
  | ({ type: 'chat'; text: string } & RawUser)
  | ({ type: 'like'; count: number } & RawUser)
  | ({
      type: 'gift';
      giftId: number;
      giftName: string;
      coinsPerUnit: number;
      /**
       * Identifies one streak (combo). All updates of the same streak share it.
       * Non-streak gifts use a unique id per gift.
       */
      streakId: string;
      /** CUMULATIVE count in the streak so far (TikTok repeat_count semantics). */
      repeatCount: number;
      /** True on the final packet of a streak (may be delivered more than once). */
      repeatEnd: boolean;
    } & RawUser)
  | ({ type: 'follow' } & RawUser)
  | ({ type: 'share' } & RawUser);

export type RawSink = (e: RawSourceEvent) => void;

export type SourceStatusListener = (state: SourceState, detail?: string) => void;

/**
 * Anything that produces live-stream events. Implementations:
 *  - FakeSource (now): driven by the /dev panel and background timers.
 *  - TikTokSource (later): wraps a TikTok LIVE connection.
 */
export interface EventSource {
  readonly name: string;
  /** Current connection state (FakeSource: always 'live'). */
  readonly state: SourceState;
  /** Called on every state change (connecting / live / reconnecting / ended). */
  onStatus(listener: SourceStatusListener): void;
  start(sink: RawSink): Promise<void>;
  stop(): Promise<void>;
}
