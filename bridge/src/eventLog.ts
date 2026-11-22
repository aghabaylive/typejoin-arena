import { createWriteStream, mkdirSync, type WriteStream } from 'node:fs';
import { resolve } from 'node:path';
import type { GameEvent } from '@typejoin/shared';

/**
 * Appends every normalized event as one JSON line to <dir>/events-YYYY-MM-DD.jsonl (local date).
 * Extra fields: "src" (source name) and, for events dropped by moderation, "dropped": "banned".
 */
export class EventLog {
  private day = '';
  private stream: WriteStream | null = null;

  constructor(private dir: string, private source: string) {
    mkdirSync(dir, { recursive: true });
  }

  write(e: GameEvent, extra: Record<string, unknown> = {}): void {
    const d = new Date(e.ts);
    const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    if (day !== this.day) {
      this.stream?.end();
      this.stream = createWriteStream(resolve(this.dir, `events-${day}.jsonl`), { flags: 'a' });
      this.stream.on('error', (err) => console.error('[event-log] write failed', err));
      this.day = day;
    }
    this.stream!.write(JSON.stringify({ ...e, src: this.source, ...extra }) + '\n');
  }

  close(): Promise<void> {
    return new Promise((r) => (this.stream ? this.stream.end(r) : r()));
  }
}
