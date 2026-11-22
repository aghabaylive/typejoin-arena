/** Axis-aligned name-tag box (center x/y, size) for one ball. */
export interface TagBox {
  id: number;
  mass: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A ball body (circle) that a smaller ball's tag must not cover. */
export interface BodyCircle {
  id: number;
  mass: number;
  x: number;
  y: number;
  r: number;
}

const overlaps = (a: TagBox, b: TagBox) =>
  Math.abs(a.x - b.x) * 2 < a.w + b.w && Math.abs(a.y - b.y) * 2 < a.h + b.h;

/** Rect (tag) vs circle (ball body); the circle is shrunk a little so grazing the rim does not count. */
const coversBody = (t: TagBox, c: BodyCircle) => {
  const dx = Math.max(Math.abs(t.x - c.x) - t.w / 2, 0);
  const dy = Math.max(Math.abs(t.y - c.y) - t.h / 2, 0);
  const r = c.r * 0.85;
  return dx * dx + dy * dy < r * r;
};

const bigger = (a: { mass: number; id: number }, b: { mass: number; id: number }) =>
  a.mass > b.mass || (a.mass === b.mass && a.id < b.id);

/**
 * Tags that must fade (mass decides; ties -> lower id wins):
 * - a tag that overlaps the tag of any BIGGER ball, and
 * - a tag that would sit on top of a BIGGER ball's picture (text is never drawn over a profile picture).
 * The biggest ball's tag is therefore always fully visible.
 */
export function fadedTags(tags: TagBox[], bodies: BodyCircle[] = []): Set<number> {
  const order = [...tags].sort((a, b) => b.mass - a.mass || a.id - b.id);
  const faded = new Set<number>();
  for (let i = 0; i < order.length; i++) {
    const t = order[i];
    let hidden = false;
    for (let j = 0; j < i && !hidden; j++) if (overlaps(t, order[j])) hidden = true;
    for (const b of bodies) {
      if (hidden) break;
      if (b.id !== t.id && bigger(b, t) && coversBody(t, b)) hidden = true;
    }
    if (hidden) faded.add(t.id);
  }
  return faded;
}
