import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export interface BanEntry {
  userId: string;
  nickname: string;
  bannedAt: string;
}

/**
 * Persistent ban list (local JSON file). Banned users' events are dropped by the bridge before they reach
 * the game, so they can never join or rejoin. Written atomically (tmp file + rename).
 */
export class BanList {
  private bans = new Map<string, BanEntry>();

  constructor(private file: string) {
    if (existsSync(file)) {
      try {
        const data = JSON.parse(readFileSync(file, 'utf8')) as { bans?: BanEntry[] };
        for (const b of data.bans ?? []) if (b && typeof b.userId === 'string') this.bans.set(b.userId, b);
      } catch (err) {
        console.error(`[bans] could not read ${file}; starting empty and NOT overwriting it until a change`, err);
      }
    }
  }

  has(userId: string): boolean {
    return this.bans.has(userId);
  }

  ban(userId: string, nickname: string): BanEntry {
    const e = this.bans.get(userId) ?? { userId, nickname, bannedAt: new Date().toISOString() };
    this.bans.set(userId, e);
    this.save();
    return e;
  }

  unban(userId: string): boolean {
    const had = this.bans.delete(userId);
    if (had) this.save();
    return had;
  }

  list(): BanEntry[] {
    return [...this.bans.values()];
  }

  private save(): void {
    mkdirSync(dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify({ bans: this.list() }, null, 2) + '\n');
    renameSync(tmp, this.file);
  }
}

/** Lowercase, strip accents and non-letters/digits, undo common digit substitutions. */
export function foldName(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[0134578@$]/g, (c) => ({ '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '8': 'b', '@': 'a', '$': 's' })[c]!)
    .replace(/[^\p{L}\p{N}]/gu, '');
}

/** Nickname word filter: a nickname containing any listed word is shown as "player". */
export class NameFilter {
  private words: string[];
  constructor(words: string[], readonly replacement = 'player') {
    this.words = words.map(foldName).filter((w) => w.length >= 2);
  }
  matches(nickname: string): boolean {
    const f = foldName(nickname);
    return this.words.some((w) => f.includes(w));
  }
  apply(nickname: string): string {
    return this.matches(nickname) ? this.replacement : nickname;
  }
  get size(): number {
    return this.words.length;
  }
}

/** Words from a JSON file ({ "words": [...] }) plus the NAME_FILTER env var (comma separated). */
export function loadNameFilter(file: string, env = process.env.NAME_FILTER): NameFilter {
  let words: string[] = [];
  if (existsSync(file)) {
    try {
      words = (JSON.parse(readFileSync(file, 'utf8')) as { words?: string[] }).words ?? [];
    } catch (err) {
      console.error(`[name-filter] could not read ${file}`, err);
    }
  }
  if (env) words.push(...env.split(','));
  return new NameFilter(words.map((w) => w.trim()).filter(Boolean));
}
