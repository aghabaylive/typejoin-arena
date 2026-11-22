import { fileURLToPath } from 'node:url';
import { BRIDGE_DEFAULT_PORT } from '@typejoin/shared';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

function envList(name: string, fallback: string[]): string[] {
  const v = process.env[name];
  if (!v) return fallback;
  return v.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
}

export const BRIDGE_CONFIG = {
  host: process.env.BRIDGE_HOST ?? '127.0.0.1',
  port: Number(process.env.BRIDGE_PORT ?? BRIDGE_DEFAULT_PORT),
  /** Chat messages equal to one of these (case/punctuation-insensitive) become `join`. */
  joinAliases: envList('JOIN_ALIASES', ['join', 'j']),
  /** Event source: SOURCE=tiktok (with TIKTOK_USERNAME) or fake (default). EVENT_SOURCE is the old name. */
  source: (process.env.SOURCE ?? process.env.EVENT_SOURCE ?? 'fake') as 'fake' | 'tiktok',
  tiktokUsername: (process.env.TIKTOK_USERNAME ?? '').replace(/^@/, '').trim(),
  /** Euler Stream key for signing (optional; from the environment only, never committed). */
  signApiKey: process.env.SIGN_API_KEY || undefined,
  /** How long a finished gift streak is remembered (dedups late/duplicate repeatEnd packets). */
  streakMemoryMs: 120_000,
  /** Events kept for the dev panel log. */
  recentEventLimit: 50,
  /** Local, gitignored files. */
  banFile: process.env.BAN_FILE ?? `${ROOT}data/bans.json`,
  nameFilterFile: process.env.NAME_FILTER_FILE ?? `${ROOT}data/name-filter.json`,
  /** Host settings that survive a restart (in-game gift legend ON / OFF). */
  settingsFile: process.env.SETTINGS_FILE ?? `${ROOT}data/settings.json`,
  logDir: process.env.LOG_DIR ?? `${ROOT}logs`,
  avatarCacheEntries: 500,
};
