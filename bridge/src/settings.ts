import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { parseLegendMode, type LegendMode } from '@typejoin/shared';

/**
 * Host settings that must survive a restart (local JSON file, gitignored: data/settings.json).
 * Written atomically (tmp file + rename). A missing or unreadable file means "no saved choice".
 */
export class Settings {
  private legendMode: LegendMode | null = null;

  constructor(private file: string) {
    if (!existsSync(file)) return;
    try {
      const data = JSON.parse(readFileSync(file, 'utf8')) as { legend?: unknown };
      this.legendMode = parseLegendMode(data.legend);
    } catch (err) {
      console.error(`[settings] could not read ${file}; using defaults`, err);
    }
  }

  /** In-game gift legend chosen in the host panel ("full" = ON, "off" = OFF); null = game's config default. */
  get legend(): LegendMode | null {
    return this.legendMode;
  }

  setLegend(mode: LegendMode): void {
    this.legendMode = mode;
    this.save();
  }

  private save(): void {
    mkdirSync(dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify({ legend: this.legendMode }, null, 2) + '\n');
    renameSync(tmp, this.file);
  }
}
