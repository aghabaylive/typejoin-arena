import { describe, it, expect } from 'vitest';
import { overlayText } from './overlay';

const o = (sourceState: 'connecting' | 'live' | 'reconnecting' | 'ended', hostPaused = false, bridgeOpen = true) =>
  overlayText({ bridgeOpen, sourceState, hostPaused });

describe('overlay banner', () => {
  it('before the stream has ever gone live: "Waiting for LIVE..."', () => {
    expect(o('connecting')).toBe('Waiting for LIVE...');
  });
  it('after it was live: "Reconnecting..." / "LIVE ended"', () => {
    expect(o('reconnecting')).toBe('Reconnecting...');
    expect(o('ended')).toBe('LIVE ended');
  });
  it('host pause shows "Paused, back soon"; connection problems take priority', () => {
    expect(o('live', true)).toBe('Paused, back soon');
    expect(o('reconnecting', true)).toBe('Reconnecting...');
    expect(o('live')).toBeNull();
  });
  it('no bridge (local dev): no connection banner, host pause still shown', () => {
    expect(o('connecting', false, false)).toBeNull();
    expect(o('connecting', true, false)).toBe('Paused, back soon');
  });
});
