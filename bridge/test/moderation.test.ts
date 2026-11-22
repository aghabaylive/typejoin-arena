import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BanList, NameFilter, loadNameFilter } from '../src/moderation';

const tmp = () => mkdtempSync(join(tmpdir(), 'typejoin-test-'));

describe('BanList', () => {
  it('persists bans to the JSON file and reloads them', () => {
    const file = join(tmp(), 'data', 'bans.json');
    const a = new BanList(file);
    expect(a.has('7001')).toBe(false);
    a.ban('7001', 'Troll');
    a.ban('7002', 'Spammer');
    expect(a.has('7001')).toBe(true);
    const b = new BanList(file); // e.g. after a bridge restart
    expect(b.has('7001')).toBe(true);
    expect(b.list().map((x) => x.userId).sort()).toEqual(['7001', '7002']);
    expect(JSON.parse(readFileSync(file, 'utf8')).bans).toHaveLength(2);
  });

  it('ban is idempotent and unban removes it', () => {
    const file = join(tmp(), 'bans.json');
    const l = new BanList(file);
    const first = l.ban('7001', 'Troll');
    expect(l.ban('7001', 'Renamed').bannedAt).toBe(first.bannedAt);
    expect(l.list()).toHaveLength(1);
    expect(l.unban('7001')).toBe(true);
    expect(new BanList(file).has('7001')).toBe(false);
  });

  it('a corrupt file is not overwritten on load', () => {
    const file = join(tmp(), 'bans.json');
    writeFileSync(file, '{not json');
    const l = new BanList(file);
    expect(l.list()).toEqual([]);
    expect(readFileSync(file, 'utf8')).toBe('{not json');
  });
});

describe('NameFilter', () => {
  it('replaces nicknames containing a listed word with "player" (case, accents, spacing, digit tricks)', () => {
    const f = new NameFilter(['badword', 'spam']);
    for (const n of ['BadWord', 'xx_bad.word_xx', 'B4DW0RD', 'Bádwörd', 'freeSPAM123']) expect(f.apply(n), n).toBe('player');
    for (const n of ['Leyla', 'Ömer', 'nice_guy', '']) expect(f.apply(n), n).toBe(n);
  });

  it('loads words from a JSON file plus the NAME_FILTER env var', () => {
    const file = join(tmp(), 'name-filter.json');
    writeFileSync(file, JSON.stringify({ words: ['alpha'] }));
    const f = loadNameFilter(file, 'beta, gamma');
    expect(f.size).toBe(3);
    expect(f.apply('the_BETA_guy')).toBe('player');
    expect(loadNameFilter(join(tmp(), 'missing.json'), '').size).toBe(0);
  });
});
