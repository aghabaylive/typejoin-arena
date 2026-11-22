import type { SourceState } from '@typejoin/shared';

/**
 * Which banner the game shows over the arena (null = none). The world and the round timer stop
 * whenever a banner is shown. Connection problems win over a host pause.
 * - 'connecting' only happens before the stream has EVER gone live ("Waiting for LIVE...");
 *   after that the source reports 'reconnecting' or 'ended'.
 * - If the bridge itself is unreachable (local dev without a bridge) the game keeps running.
 */
export function overlayText(o: { bridgeOpen: boolean; sourceState: SourceState; hostPaused: boolean }): string | null {
  if (o.bridgeOpen) {
    if (o.sourceState === 'connecting') return 'Waiting for LIVE...';
    if (o.sourceState === 'reconnecting') return 'Reconnecting...';
    if (o.sourceState === 'ended') return 'LIVE ended';
  }
  if (o.hostPaused) return 'Paused, back soon';
  return null;
}
