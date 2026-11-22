import type { SourceState } from '@typejoin/shared';
import { ControlEvent, TikTokLiveConnection, WebcastEvent } from 'tiktok-live-connector';
import type { EventSource, RawSink, SourceStatusListener } from './EventSource';
import { mapTikTok, type TikTokKind } from './tiktokMap';

export interface TikTokSourceOptions {
  username: string;
  /** Euler Stream key (raises signing rate limits). From the environment only; never committed. */
  signApiKey?: string;
  /** Backoff: base and cap in ms. */
  backoffBaseMs?: number;
  backoffMaxMs?: number;
  /** While the stream is over, how often to check whether it is live again. */
  endedPollMs?: number;
}

const EVENTS: [WebcastEvent, TikTokKind][] = [
  [WebcastEvent.CHAT, 'chat'],
  [WebcastEvent.LIKE, 'like'],
  [WebcastEvent.GIFT, 'gift'],
  [WebcastEvent.FOLLOW, 'follow'],
  [WebcastEvent.SHARE, 'share'],
];

/** Classify connection errors so the log says clearly what went wrong. */
export function describeTikTokError(err: unknown): { kind: 'offline' | 'signing' | 'rateLimit' | 'other'; message: string } {
  const e = err as { name?: string; message?: string; constructor?: { name?: string } };
  const name = `${e?.constructor?.name ?? ''} ${e?.name ?? ''}`;
  const msg = String(e?.message ?? err).split('\n')[0].slice(0, 300);
  if (/UserOffline/i.test(name) || /offline|not (currently )?live|LIVE has ended/i.test(msg)) return { kind: 'offline', message: msg };
  if (/RateLimit/i.test(name) || /rate.?limit|429|too many requests/i.test(msg)) return { kind: 'rateLimit', message: msg };
  if (/Sign|Signature|Premium/i.test(name) || /sign|secret key|api key|euler|business plan/i.test(msg)) return { kind: 'signing', message: msg };
  return { kind: 'other', message: msg };
}

/**
 * TikTok LIVE source (tiktok-live-connector v2). Reconnects with exponential backoff; reports state
 * changes ('connecting' -> 'live' -> 'reconnecting' / 'ended') so the game can pause and show overlays.
 */
export class TikTokSource implements EventSource {
  readonly name = 'tiktok';
  state: SourceState = 'connecting';
  stats = { connects: 0, disconnects: 0, errors: 0, lastError: '' };

  private listeners: SourceStatusListener[] = [];
  private sink: RawSink | null = null;
  private conn: TikTokLiveConnection | null = null;
  private attempt = 0;
  private timer: NodeJS.Timeout | null = null;
  private stopped = false;
  private everLive = false;

  constructor(private o: TikTokSourceOptions) {}

  onStatus(listener: SourceStatusListener): void {
    this.listeners.push(listener);
  }

  async start(sink: RawSink): Promise<void> {
    this.sink = sink;
    this.stopped = false;
    void this.connect();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    await this.dropConnection();
  }

  private setState(state: SourceState, detail?: string): void {
    const changed = state !== this.state;
    this.state = state;
    if (changed || detail) for (const l of this.listeners) l(state, detail);
  }

  private async dropConnection(): Promise<void> {
    const c = this.conn;
    this.conn = null;
    if (!c) return;
    c.removeAllListeners();
    try {
      await c.disconnect();
    } catch {
      // already closed
    }
  }

  private async connect(): Promise<void> {
    if (this.stopped) return;
    await this.dropConnection();
    const conn = new TikTokLiveConnection(this.o.username, this.o.signApiKey ? { signApiKey: this.o.signApiKey } : {});
    this.conn = conn;
    for (const [ev, kind] of EVENTS) {
      conn.on(ev, (data: unknown) => {
        if (this.conn !== conn) return;
        const raw = mapTikTok(kind, data as Record<string, unknown>);
        if (raw) this.sink?.(raw);
      });
    }
    conn.on(WebcastEvent.STREAM_END, () => {
      if (this.conn !== conn) return;
      console.log(`[tiktok] @${this.o.username}: LIVE ended`);
      this.setState('ended', 'LIVE ended');
      void this.dropConnection();
      this.schedule(this.o.endedPollMs ?? 60_000);
    });
    conn.on(ControlEvent.DISCONNECTED, (d: { code?: number; reason?: string } = {}) => {
      if (this.conn !== conn || this.stopped || this.state === 'ended') return;
      this.stats.disconnects++;
      console.warn(`[tiktok] disconnected (code ${d.code ?? '?'}${d.reason ? `, ${d.reason}` : ''}); reconnecting`);
      this.setState('reconnecting', 'connection lost');
      this.schedule(this.backoff());
    });
    conn.on(ControlEvent.ERROR, (e: { info?: unknown; exception?: unknown }) => {
      this.stats.errors++;
      const d = describeTikTokError(e?.exception ?? e?.info ?? e);
      this.stats.lastError = d.message;
      console.warn(`[tiktok] error (${d.kind}): ${String(e?.info ?? '')} ${d.message}`.trim());
    });

    this.setState(this.everLive ? 'reconnecting' : 'connecting');
    try {
      const state = await conn.connect();
      if (this.conn !== conn) return;
      this.attempt = 0;
      this.everLive = true;
      this.stats.connects++;
      console.log(`[tiktok] connected to @${this.o.username} (room ${state.roomId})`);
      this.setState('live');
    } catch (err) {
      if (this.conn !== conn) return;
      this.stats.errors++;
      const d = describeTikTokError(err);
      this.stats.lastError = d.message;
      await this.dropConnection();
      if (d.kind === 'offline') {
        console.warn(`[tiktok] @${this.o.username} is not live (${d.message}); checking again later`);
        this.setState(this.everLive ? 'ended' : 'connecting', this.everLive ? 'LIVE ended' : 'waiting for LIVE');
        this.schedule(this.o.endedPollMs ?? 60_000);
      } else if (d.kind === 'signing' || d.kind === 'rateLimit') {
        console.error(`[tiktok] ${d.kind === 'signing' ? 'SIGNING' : 'RATE LIMIT'} error from the Euler Stream sign server: ${d.message}`);
        console.error('[tiktok] the free community tier is rate limited; set SIGN_API_KEY to raise the limits. Retrying with backoff.');
        this.setState(this.everLive ? 'reconnecting' : 'connecting', d.kind);
        this.schedule(Math.max(30_000, this.backoff()));
      } else {
        console.warn(`[tiktok] connect failed: ${d.message}`);
        this.setState(this.everLive ? 'reconnecting' : 'connecting', 'connect failed');
        this.schedule(this.backoff());
      }
    }
  }

  private backoff(): number {
    const base = this.o.backoffBaseMs ?? 2000, max = this.o.backoffMaxMs ?? 60_000;
    const ms = Math.min(max, base * 2 ** this.attempt++);
    return ms * (0.8 + Math.random() * 0.4);
  }

  private schedule(ms: number): void {
    if (this.stopped) return;
    if (this.timer) clearTimeout(this.timer);
    console.log(`[tiktok] next connect attempt in ${(ms / 1000).toFixed(0)} s`);
    this.timer = setTimeout(() => void this.connect(), ms);
  }
}
