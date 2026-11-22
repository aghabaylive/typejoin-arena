import { describe, it, expect } from 'vitest';
import { fadedTags, type BodyCircle, type TagBox } from './tagLayout';

const tag = (id: number, mass: number, x: number, y: number, w = 200, h = 46): TagBox => ({ id, mass, x, y, w, h });

describe('name tag overlap', () => {
  it('no overlap: nothing fades', () => {
    expect(fadedTags([tag(1, 100, 0, 0), tag(2, 50, 300, 0), tag(3, 20, 0, 100)]).size).toBe(0);
  });

  it('the bigger ball keeps its tag fully visible; the smaller one fades', () => {
    const f = fadedTags([tag(1, 50, 0, 0), tag(2, 500, 100, 10)]);
    expect([...f]).toEqual([1]);
  });

  it('fades every tag that overlaps any bigger tag (even a faded one)', () => {
    // 3 overlaps only 2; 2 overlaps 1 -> both 2 and 3 fade, 1 stays.
    const f = fadedTags([tag(1, 1000, 0, 0), tag(2, 500, 150, 0), tag(3, 100, 300, 0)]);
    expect([...f].sort()).toEqual([2, 3]);
  });

  it('touching edges do not count; equal mass: lower id wins', () => {
    expect(fadedTags([tag(1, 10, 0, 0), tag(2, 5, 200, 0)]).size).toBe(0);
    expect([...fadedTags([tag(7, 10, 0, 0), tag(3, 10, 50, 0)])]).toEqual([7]);
  });

  it("a smaller ball's tag fades when it would cover a bigger ball's picture", () => {
    const big: BodyCircle = { id: 1, mass: 5000, x: 0, y: 0, r: 120 };
    const small: BodyCircle = { id: 2, mass: 50, x: 0, y: 60, r: 30 };
    expect([...fadedTags([tag(2, 50, 0, 90)], [big, small])]).toEqual([2]);
    // far below the big ball: stays visible; a tag never fades because of its own ball
    expect(fadedTags([tag(2, 50, 0, 400)], [big, small]).size).toBe(0);
    expect(fadedTags([tag(1, 5000, 0, 130)], [big]).size).toBe(0);
    // a bigger ball's tag may sit over a smaller ball's picture
    expect(fadedTags([tag(1, 5000, 0, 60)], [big, small]).size).toBe(0);
  });
});
