import { BRIDGE_DEFAULT_PORT } from '@typejoin/shared';

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
  /** Which event source to use. Only 'fake' exists in this step. */
  source: (process.env.EVENT_SOURCE ?? 'fake') as 'fake',
  /** How long a finished gift streak is remembered (dedups late/duplicate repeatEnd packets). */
  streakMemoryMs: 120_000,
  /** Events kept for the dev panel log. */
  recentEventLimit: 50,
};
