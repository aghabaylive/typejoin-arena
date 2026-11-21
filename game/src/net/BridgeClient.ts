import { isGameEvent, type BridgeMessage, type GameEvent } from '@typejoin/shared';

export type BridgeStatus = 'connecting' | 'open' | 'closed';

/** WebSocket client for the bridge. Reconnects forever with backoff. */
export class BridgeClient {
  status: BridgeStatus = 'closed';
  source = '?';
  private ws: WebSocket | null = null;
  private retry = 0;
  private stopped = false;

  constructor(private url: string, private onEvent: (e: GameEvent) => void) {}

  start(): void {
    this.stopped = false;
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    this.ws?.close();
  }

  private connect(): void {
    this.status = 'connecting';
    let ws: WebSocket;
    try {
      ws = new WebSocket(this.url);
    } catch {
      return this.scheduleReconnect();
    }
    this.ws = ws;
    ws.onopen = () => {
      this.status = 'open';
      this.retry = 0;
    };
    ws.onmessage = (m) => {
      let msg: BridgeMessage;
      try {
        msg = JSON.parse(String(m.data));
      } catch {
        return;
      }
      if (msg.kind === 'hello') this.source = msg.source;
      else if (msg.kind === 'event' && isGameEvent(msg.event)) this.onEvent(msg.event);
    };
    ws.onclose = () => {
      this.status = 'closed';
      this.scheduleReconnect();
    };
    ws.onerror = () => ws.close();
  }

  private scheduleReconnect(): void {
    if (this.stopped) return;
    const delay = Math.min(5000, 300 * 2 ** this.retry++);
    setTimeout(() => this.connect(), delay);
  }
}
