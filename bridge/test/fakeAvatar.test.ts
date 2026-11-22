import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import { fakeAvatarSvg, fakeAvatarUrl } from '../src/sources/fakeAvatar';

describe('fake avatars (dev only)', () => {
  it('are deterministic per user and differ between users', () => {
    expect(fakeAvatarSvg('fake_1')).toBe(fakeAvatarSvg('fake_1'));
    const set = new Set(Array.from({ length: 30 }, (_, i) => fakeAvatarSvg(`fake_${i}`)));
    expect(set.size).toBe(30);
  });

  it('are self-contained SVG data URIs (no network references) of a sane size', () => {
    for (let i = 0; i < 20; i++) {
      const svg = fakeAvatarSvg(`fake_${i}`);
      // The xmlns namespace URI is an identifier, not a fetch; anything else would be a network reference.
      expect(svg.replace('xmlns="http://www.w3.org/2000/svg"', '')).not.toMatch(/https?:|xlink:href|<image|<script/i);
      expect(svg.length).toBeLessThan(4000);
      expect(fakeAvatarUrl(`fake_${i}`).startsWith('data:image/svg+xml')).toBe(true);
    }
  });

  it('render as valid 128x128 images', async () => {
    const meta = await sharp(Buffer.from(fakeAvatarSvg('fake_42'))).metadata();
    expect([meta.format, meta.width, meta.height]).toEqual(['svg', 128, 128]);
    const png = await sharp(Buffer.from(fakeAvatarSvg('fake_42'))).png().toBuffer();
    expect(png.length).toBeGreaterThan(1000);
  });
});
