import { describe, it, expect } from 'vitest';
import { parseLegendMode } from '@typejoin/shared';

describe('legend mode (host panel toggle)', () => {
  it('accepts only "full" and "off"', () => {
    expect(parseLegendMode('full')).toBe('full');
    expect(parseLegendMode('off')).toBe('off');
    for (const x of ['OFF', 'on', '', null, undefined, 1, {}]) expect(parseLegendMode(x)).toBeNull();
  });
});
