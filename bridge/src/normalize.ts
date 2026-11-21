import type { GameEvent } from '@typejoin/shared';
import type { RawSourceEvent } from './sources/EventSource';

interface StreakState {
  seen: number;
  ended: boolean;
  touched: number;
}

/**
 * Converts cumulative gift streak counts into per-update deltas.
 * Guarantees: every unit is reported exactly once, even if updates are
 * duplicated, arrive out of order, or repeatEnd is delivered twice.
 */
export class GiftStreakTracker {
  private streaks = new Map<string, StreakState>();
  constructor(private memoryMs = 120_000) {}

  /** Returns the number of NEW units in this update (0 = nothing to emit). */
  delta(streakId: string, repeatCount: number, repeatEnd: boolean, now = Date.now()): number {
    this.gc(now);
    const st = this.streaks.get(streakId) ?? { seen: 0, ended: false, touched: now };
    const count = Math.max(0, Math.floor(repeatCount));
    const d = Math.max(0, count - st.seen);
    st.seen = Math.max(st.seen, count);
    st.ended = st.ended || repeatEnd;
    st.touched = now;
    this.streaks.set(streakId, st);
    return d;
  }

  get size(): number {
    return this.streaks.size;
  }

  private gc(now: number): void {
    if (this.streaks.size < 256) return;
    for (const [k, v] of this.streaks) {
      if (now - v.touched > this.memoryMs) this.streaks.delete(k);
    }
  }
}

export interface NormalizerOptions {
  joinAliases: string[];
  streakMemoryMs?: number;
  now?: () => number;
}

export function normalizeChatText(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[\s!?.,:;'"`~*_\-]+/g, '');
}

/** Raw source events -> normalized game events. */
export class Normalizer {
  private streaks: GiftStreakTracker;
  private aliases: Set<string>;
  private now: () => number;

  constructor(opts: NormalizerOptions) {
    this.aliases = new Set(opts.joinAliases.map(normalizeChatText));
    this.streaks = new GiftStreakTracker(opts.streakMemoryMs);
    this.now = opts.now ?? Date.now;
  }

  normalize(raw: RawSourceEvent): GameEvent[] {
    const ts = this.now();
    const base = {
      userId: String(raw.userId),
      nickname: raw.nickname || String(raw.userId),
      ...(raw.avatarUrl ? { avatarUrl: raw.avatarUrl } : {}),
      ts,
    };
    switch (raw.type) {
      case 'chat': {
        if (this.aliases.has(normalizeChatText(raw.text))) return [{ ...base, type: 'join' }];
        return [{ ...base, type: 'chat', text: raw.text }];
      }
      case 'like': {
        const count = Math.max(0, Math.floor(raw.count));
        return count > 0 ? [{ ...base, type: 'like', count }] : [];
      }
      case 'gift': {
        const units = this.streaks.delta(raw.streakId, raw.repeatCount, raw.repeatEnd, ts);
        if (units <= 0) return [];
        return [
          {
            ...base,
            type: 'gift',
            giftId: raw.giftId,
            giftName: raw.giftName,
            coinsPerUnit: raw.coinsPerUnit,
            units,
          },
        ];
      }
      case 'follow':
        return [{ ...base, type: 'follow' }];
      case 'share':
        return [{ ...base, type: 'share' }];
    }
  }
}
