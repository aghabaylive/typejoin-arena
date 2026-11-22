import { Assets, Container, Graphics, Sprite, Text, type TextStyleOptions, type Texture } from 'pixi.js';
import { CONFIG } from '../config';
import type { Sim } from '../sim/Sim';
import type { AvatarCache } from './avatars';
import type { Textures } from './textures';
import { clip, formatMass, formatTime, label } from './text';

const RANK_COLORS = [0xffc83d, 0xd9e2f2, 0xd08a4a];

/** Top band (15-21 % of the height): timer, live top 3, Feast meter, "type join" hint. */
export class Hud {
  readonly root = new Container();
  private timer: Text;
  private hint: Text;
  private lastPhase = '';
  private hintColor = 0xffe066;
  private feastBar = new Graphics();
  private feastText: Text;
  private slots: { av: Sprite; ring: Sprite; mass: Text; rank: Text; owner: string | null; ver: number }[] = [];

  constructor(tex: Textures, private avatars: AvatarCache) {
    const R = CONFIG.render;
    const top = R.hudTop;
    const bg = new Graphics()
      .roundRect(24, top + 2, 1032, R.hudBottom - top - 4, 22)
      .fill({ color: 0x050a1e, alpha: 0.55 })
      .stroke({ width: 2, color: 0x2a3b7a, alpha: 0.8 });
    this.root.addChild(bg);
    this.timer = label('0:00', 64);
    this.timer.anchor.set(0, 0.5);
    this.timer.position.set(48, top + 36);
    this.root.addChild(this.timer);

    for (let i = 0; i < 3; i++) {
      const x = 300 + i * 250;
      const ring = new Sprite(tex.ring);
      ring.anchor.set(0.5);
      ring.width = ring.height = 60;
      ring.tint = RANK_COLORS[i];
      ring.position.set(x + 30, top + 34);
      const av = new Sprite();
      av.anchor.set(0.5);
      av.width = av.height = 52;
      av.position.copyFrom(ring.position);
      const mass = label('', 38, 0xffffff);
      mass.anchor.set(0, 0.5);
      mass.position.set(x + 68, top + 36);
      const rank = label(String(i + 1), 36, RANK_COLORS[i]);
      rank.scale.set(0.8);
      rank.position.set(x + 4, top + 12);
      this.root.addChild(av, ring, mass, rank);
      this.slots.push({ av, ring, mass, rank, owner: null, ver: -1 });
    }

    this.root.addChild(this.feastBar);
    this.feastText = label('FEAST', 36);
    this.feastText.anchor.set(0, 0.5);
    this.feastText.position.set(52, top + 88);
    this.root.addChild(this.feastText);
    this.hint = label('type join', 38, 0xffe066);
    this.hint.anchor.set(1, 0.5);
    this.hint.position.set(1040, top + 88);
    this.root.addChild(this.hint);
  }

  update(sim: Sim, now: number): void {
    const top = CONFIG.render.hudTop;
    const left = sim.phaseTimeLeft();
    const phase = sim.phase;
    const time = formatTime(left);
    if (this.timer.text !== time) this.timer.text = time;
    if (phase !== this.lastPhase) {
      // Setting a style re-renders the text texture, so only do it on change.
      this.timer.style.fill = phase === 'storm' ? 0xff5b5b : phase === 'join' ? 0xffe066 : phase === 'results' ? 0x9fb4ff : 0xffffff;
      this.lastPhase = phase;
    }

    const tops = sim.topOwners(3);
    this.slots.forEach((s, i) => {
      const t = tops[i];
      const vis = !!t;
      s.av.visible = s.ring.visible = s.mass.visible = s.rank.visible = vis;
      if (!t) return;
      const e = this.avatars.get(t.ownerId, t.nickname, t.avatarUrl);
      if (s.owner !== t.ownerId || s.ver !== e.version) {
        s.av.texture = e.texture;
        s.av.width = s.av.height = 52;
        s.owner = t.ownerId;
        s.ver = e.version;
      }
      const m = formatMass(t.mass);
      if (s.mass.text !== m) s.mass.text = m;
    });

    // Feast meter
    const need = CONFIG.likes.feastLikes;
    const frac = sim.feastActive() ? 1 : Math.min(1, sim.feastProgress / need);
    const x0 = 40, x1 = 640, y = top + 66, h = 44;
    this.feastBar.clear();
    this.feastBar.roundRect(x0, y, x1 - x0, h, h / 2).fill({ color: 0x000000, alpha: 0.55 }).stroke({ width: 3, color: 0xff7ac8, alpha: 0.9 });
    if (frac > 0) {
      const glow = sim.feastActive() ? 0.75 + 0.25 * Math.sin(now * 12) : 1;
      this.feastBar.roundRect(x0 + 3, y + 3, Math.max(h - 6, (x1 - x0 - 6) * frac), h - 6, (h - 6) / 2).fill({ color: 0xff4fa3, alpha: glow });
    }
    const feastLabel = sim.feastActive()
      ? `FEAST! ${Math.ceil(sim.feastUntil - sim.time)}s`
      : `♥ FEAST ${Math.floor(sim.feastProgress)}/${need}`;
    if (this.feastText.text !== feastLabel) this.feastText.text = feastLabel;

    // Queue indicator (alive cap reached): cycles "Queue: N" and the next 3 names in the hint slot.
    const q = sim.queueView();
    let hint = phase === 'join' ? 'TYPE  join  NOW!' : phase === 'storm' ? 'STORM! to center' : phase === 'results' ? 'next round soon' : 'type join to play';
    if (q.length > 0) {
      const frames = [`Queue: ${q.length}`, ...q.next.map((n, i) => `${i + 1}. ${clip(n, 11)}`)];
      hint = frames[Math.floor(now / 1.6) % frames.length];
    }
    if (this.hint.text !== hint) this.hint.text = hint;
    const hintColor = q.length > 0 ? 0x9fdcff : 0xffe066;
    if (hintColor !== this.hintColor) {
      this.hint.style.fill = hintColor;
      this.hintColor = hintColor;
    }
    this.hint.scale.set(phase === 'join' && q.length === 0 ? 1 + 0.06 * Math.sin(now * 8) : 1);
  }
}

/**
 * Gift legend, right side of the 63-88 % band (bottom-left stays free for TikTok comments).
 * Row: real gift icon with a coin-price badge | gift name (36 px) / ability (36 px, ability color).
 * The price badge and the "any other gift" footer use SMALL_FONT: at 36 px the 410 px column cannot fit
 * name + ability + price (e.g. "Black hole" + "1,000" needs ~360 px next to the icon).
 */
const SMALL_FONT = 28;

export function makeLegend(): Container {
  const R = CONFIG.render;
  const c = new Container();
  const rows = CONFIG.legend;
  const x0 = R.legendX, x1 = R.legendRight, top = R.legendTop + 6, bottom = R.legendBottom - 6;
  c.addChild(
    new Graphics()
      .roundRect(x0, top, x1 - x0, bottom - top, 24)
      .fill({ color: 0x050a1e, alpha: 0.6 })
      .stroke({ width: 2, color: 0x2a3b7a, alpha: 0.8 }),
  );
  // Footer: what every other gift does.
  const footer = smallLabel(`Any other gift: grow (+${CONFIG.gifts.massPerCoin} mass per coin)`, 0xb9c6ff, {
    wordWrap: true, wordWrapWidth: x1 - x0 - 24, lineHeight: SMALL_FONT + 4,
  });
  footer.anchor.set(0.5, 1);
  footer.position.set((x0 + x1) / 2, bottom - 8);
  c.addChild(footer);
  const rowsBottom = bottom - 16 - footer.height;
  c.addChild(new Graphics().moveTo(x0 + 18, rowsBottom + 4).lineTo(x1 - 18, rowsBottom + 4).stroke({ width: 2, color: 0x2a3b7a, alpha: 0.8 }));

  const h = (rowsBottom - top - 4) / rows.length;
  const s = Math.min(R.legendIcon, Math.round(h - 14));
  // Icon column: wide enough for the icon and the widest price badge.
  const prices = rows.map((r) => smallLabel(r.coins.toLocaleString('en-US'), 0xffe08a));
  const colW = Math.max(s, ...prices.map((p) => p.width + 30));
  const ix = x0 + 12;
  const cx = ix + colW / 2;
  const tx = ix + colW + 12, maxW = x1 - 12 - tx;
  rows.forEach((row, i) => {
    const y = top + 4 + i * h + h / 2;
    const iy = y - 7; // icon sits a little high; the price badge overlaps its bottom edge
    // Placeholder tile + glyph (gift not in the catalog, or until its icon loads).
    const tile = new Container();
    tile.addChild(new Graphics().roundRect(cx - s / 2, iy - s / 2, s, s, 16).fill({ color: row.color, alpha: 0.25 }).stroke({ width: 4, color: row.color }));
    const g = label(row.glyph, 48, row.color);
    g.position.set(cx, iy);
    tile.addChild(g);
    c.addChild(tile);
    const iconLayer = new Container();
    c.addChild(iconLayer);
    if (row.icon) {
      // Local copy in game/public/gifts (never loaded from TikTok at runtime).
      Assets.load(`${import.meta.env.BASE_URL}${row.icon}`).then((tex: Texture) => {
        const icon = new Sprite(tex);
        icon.anchor.set(0.5);
        icon.scale.set(s / Math.max(tex.width, tex.height));
        icon.position.set(cx, iy);
        iconLayer.addChild(icon);
        tile.visible = false;
      }).catch(() => console.warn(`[legend] could not load ${row.icon}; showing placeholder`));
    }
    // Coin price badge on the icon's bottom edge.
    const price = prices[i];
    const bw = price.width + 30, bh = SMALL_FONT + 6, bx = cx, by = iy + s / 2 + 2;
    const badge = new Graphics()
      .roundRect(bx - bw / 2, by - bh / 2, bw, bh, bh / 2).fill({ color: 0x1a1406, alpha: 0.92 }).stroke({ width: 2, color: 0xffc83d })
      .circle(bx - bw / 2 + 12, by, 7).fill(0xffc83d);
    price.position.set(bx + 7, by);
    c.addChild(badge, price);
    // Line 1: gift name (clipped to fit). Line 2: ability in its color.
    const chars = [...row.giftName];
    const name = label(row.giftName, R.minFont);
    while (name.width > maxW && chars.length > 2) {
      chars.pop();
      name.text = chars.join('').trimEnd() + '…';
    }
    name.anchor.set(0, 0.5);
    name.position.set(tx, y - 19);
    const ability = label(row.label.toUpperCase(), R.minFont, row.color);
    ability.anchor.set(0, 0.5);
    ability.position.set(tx, y + 20);
    if (ability.width > maxW) ability.text = row.label; // "BLACK HOLE" vs "Black hole"
    c.addChild(name, ability);
  });
  return c;
}

/** Secondary legend text below the 36 px minimum (price badge, footer). */
function smallLabel(text: string, fill: number, extra: Partial<TextStyleOptions> = {}): Text {
  const t = new Text({
    text,
    style: {
      fontFamily: CONFIG.render.fontFamily, fontSize: SMALL_FONT, fontWeight: '900', fill, align: 'center',
      stroke: { color: 0x050814, width: 5, join: 'round' }, ...extra,
    },
  });
  t.anchor.set(0.5);
  return t;
}
