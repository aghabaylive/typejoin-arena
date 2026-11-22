import { Assets, Container, Graphics, Sprite, type Text, type Texture } from 'pixi.js';
import { CONFIG } from '../config';
import type { Sim } from '../sim/Sim';
import type { AvatarCache } from './avatars';
import type { Textures } from './textures';
import { body, clip, formatMass, formatTime, label } from './text';

const B = CONFIG.brand;
/** The call-to-action: joining works at any time, so no countdown is attached to it. */
export const JOIN_CTA = 'Type JOIN to play - anytime';

/**
 * Top band (15-21 % of the height), two rows.
 * Row 1: players alive, or "STORM 0:32" during the storm (left); King card with reign time (right).
 * Row 2: "Type JOIN to play" pill (left; larger + pulsing in the join window; shows the queue when full),
 *        like meter "Likes -> FOOD RAIN" (right).
 */
export class Hud {
  readonly root = new Container();
  private timer: Text;
  private phaseKey = '';
  // King card
  private king = new Container();
  private kingCrown: Sprite;
  private kingRing: Sprite;
  private kingAv = new Sprite();
  private kingName: Text;
  private kingMass: Text;
  private kingReign: Text;
  private noKing: Text;
  private kingKey = '';
  private kingVer = -1;
  // Join pill
  private join = new Container();
  private joinBg = new Graphics();
  private joinText: Text;
  private joinW = 0;
  // Like meter
  private meter = new Graphics();
  private meterText: Text;

  constructor(tex: Textures, private avatars: AvatarCache) {
    const R = CONFIG.render;
    const top = R.hudTop;
    this.root.addChild(
      new Graphics()
        .roundRect(24, top + 2, 1032, R.hudBottom - top - 4, 24)
        .fill({ color: B.ink, alpha: 0.85 })
        .stroke({ width: 2, color: B.cobalt, alpha: 0.55 }),
    );
    const row1 = top + 31, row2 = top + 86;

    // Row 1 left: players alive / storm timer
    this.timer = label('', 52, B.yellow);
    this.timer.anchor.set(0, 0.5);
    this.timer.position.set(46, row1);
    this.root.addChild(this.timer);

    // Row 1 right: King card (laid out right-aligned in update)
    this.kingCrown = new Sprite(tex.crown);
    this.kingCrown.anchor.set(0.5);
    this.kingCrown.width = 46;
    this.kingCrown.height = 32;
    this.kingRing = new Sprite(tex.ringThick);
    this.kingRing.anchor.set(0.5);
    this.kingRing.tint = B.yellow;
    this.kingRing.width = this.kingRing.height = 50;
    this.kingAv.anchor.set(0.5);
    this.kingName = body('', 30, 0xffffff, '700');
    this.kingName.anchor.set(0, 0.5);
    this.kingMass = label('', 36, B.yellow);
    this.kingMass.anchor.set(0, 0.5);
    this.kingReign = body('', 28, B.muted, '800');
    this.kingReign.anchor.set(0, 0.5);
    this.king.addChild(this.kingCrown, this.kingAv, this.kingRing, this.kingName, this.kingMass, this.kingReign);
    this.king.position.set(0, row1);
    this.noKing = body('No king yet', 30, B.muted, '700');
    this.noKing.anchor.set(1, 0.5);
    this.noKing.position.set(1034, row1);
    this.root.addChild(this.king, this.noKing);

    // Row 2 left: join pill
    const icon = new Sprite(tex.chat);
    icon.anchor.set(0.5);
    icon.width = 40;
    icon.height = 37;
    icon.position.set(34, 0);
    this.joinText = label(JOIN_CTA, 36, B.ink, { stroke: { color: B.ink, width: 0 } });
    this.joinText.anchor.set(0, 0.5);
    this.joinText.position.set(62, 2);
    this.join.addChild(this.joinBg, icon, this.joinText);
    this.join.position.set(40, row2);
    this.root.addChild(this.join);

    // Row 2 right: like meter
    this.root.addChild(this.meter);
    this.meterText = body('', 28, 0xffffff, '800');
    this.meterText.position.set(780, row2);
    this.root.addChild(this.meterText);
  }

  update(sim: Sim, now: number): void {
    const top = CONFIG.render.hudTop;
    const row2 = top + 86;
    const phase = sim.phase;

    // Players alive (no round timer: the arena runs nonstop); the storm event shows its own timer.
    const t = phase === 'storm' ? `STORM ${formatTime(sim.stormTimeLeft())}` : `${sim.aliveRealOwners()} playing`;
    if (this.timer.text !== t) this.timer.text = t;
    if (phase !== this.phaseKey) {
      // Setting a style re-renders the text texture, so only do it on change.
      this.timer.style.fill = phase === 'storm' ? B.coral : B.yellow;
      this.phaseKey = phase;
    }

    // King card
    const kingId = sim.kingOwner;
    const kp = kingId ? sim.players.get(kingId) : undefined;
    this.king.visible = !!kp;
    this.noKing.visible = !kp;
    if (kp && kingId) {
      const e = this.avatars.get(kingId, kp.nickname, kp.avatarUrl);
      if (this.kingKey !== kingId || this.kingVer !== e.version) {
        this.kingAv.texture = e.texture;
        this.kingAv.width = this.kingAv.height = 44;
        this.kingName.text = clip(kp.nickname || '?', 10);
        this.kingKey = kingId;
        this.kingVer = e.version;
      }
      const m = formatMass(sim.ownerMass(kingId));
      if (this.kingMass.text !== m) this.kingMass.text = m;
      const reign = `· ${formatTime(sim.time - sim.kingSince)}`;
      if (this.kingReign.text !== reign) this.kingReign.text = reign;
      // right-aligned layout: [crown][avatar] name mass · reign |1034
      const right = 1034;
      const reignX = right - this.kingReign.width;
      this.kingReign.x = reignX;
      const massX = reignX - 10 - this.kingMass.width;
      const nameX = massX - 14 - this.kingName.width;
      const avX = nameX - 12 - 25;
      this.kingMass.x = massX;
      this.kingName.x = nameX;
      this.kingAv.x = this.kingRing.x = avX;
      this.kingCrown.x = avX - 25 - 30;
      this.kingCrown.rotation = Math.sin(now * 2.2) * 0.08;
    }

    // Join pill (queue indicator lives here when the arena is full)
    const q = sim.queueView();
    let jt = JOIN_CTA;
    if (q.length > 0) {
      const frames = [`Queue: ${q.length}`, ...q.next.map((n, i) => `Next ${i + 1}: ${clip(n, 10)}`)];
      jt = frames[Math.floor(now / 1.6) % frames.length];
    }
    if (this.joinText.text !== jt) this.joinText.text = jt;
    const w = Math.round(62 + this.joinText.width + 24);
    if (w !== this.joinW) {
      this.joinW = w;
      this.joinBg.clear().roundRect(0, -26, w, 52, 26).fill(B.yellow).stroke({ width: 3, color: 0xffffff, alpha: 0.6 });
    }
    this.join.y = row2;

    // Like meter: Likes -> FOOD RAIN
    const need = CONFIG.likes.feastLikes;
    const active = sim.feastActive();
    const frac = active ? 1 : Math.min(1, sim.feastProgress / need);
    const x0 = Math.max(548, 40 + this.joinW + 22), x1 = 1034, h = 46, y = row2 - h / 2;
    this.meter.clear();
    this.meter.roundRect(x0, y, x1 - x0, h, h / 2).fill({ color: 0x000000, alpha: 0.45 }).stroke({ width: 3, color: B.cobalt, alpha: 0.9 });
    if (frac > 0) {
      const glow = active ? 0.75 + 0.25 * Math.sin(now * 12) : 1;
      this.meter.roundRect(x0 + 4, y + 4, Math.max(h - 8, (x1 - x0 - 8) * frac), h - 8, (h - 8) / 2).fill({ color: active ? B.yellow : B.cobalt, alpha: glow });
    }
    const mt = active ? `FOOD RAIN! ${Math.ceil(sim.feastUntil - sim.time)}s` : 'Likes → FOOD RAIN';
    if (this.meterText.text !== mt) this.meterText.text = mt;
    this.meterText.position.set((x0 + x1) / 2, row2);
  }
}

/**
 * Gift legend ("full" mode), right side of the 63-88 % band (bottom-left stays free for TikTok comments).
 * 5 rows: gift icon (~84 px), ability name (Lilita One 40 px, ability color), small "Gift - N coins" line.
 * One footer line: "Any gift = grow".
 */
export function makeLegend(): Container {
  const R = CONFIG.render;
  const c = new Container();
  const rows = CONFIG.legend;
  const x0 = R.legendX, x1 = R.legendRight, top = R.legendTop + 6, bottom = R.legendBottom - 6;
  c.addChild(
    new Graphics()
      .roundRect(x0, top, x1 - x0, bottom - top, 28)
      .fill({ color: B.ink, alpha: 0.85 })
      .stroke({ width: 2, color: B.cobalt, alpha: 0.5 }),
  );
  // Footer: two short lines (one line would not fit the 410 px column at 36 px).
  const footer = label('Any gift = grow\nLike = small grow', 36, B.yellow, { lineHeight: 40 });
  footer.anchor.set(0.5, 1);
  footer.position.set((x0 + x1) / 2, bottom - 8);
  c.addChild(footer);
  const rowsBottom = bottom - 14 - footer.height;
  const h = (rowsBottom - top - 8) / rows.length;
  const s = Math.min(88, Math.round(h - 4));
  const ix = x0 + 14;
  const tx = ix + s + 16, maxW = x1 - 14 - tx;
  rows.forEach((row, i) => {
    const y = top + 8 + i * h + h / 2;
    // Placeholder tile + glyph (gift not in the catalog, or until its icon loads).
    const tile = new Container();
    tile.addChild(new Graphics().roundRect(ix, y - s / 2, s, s, 18).fill({ color: row.color, alpha: 0.22 }).stroke({ width: 4, color: row.color }));
    const g = label(row.glyph, 52, row.color);
    g.position.set(ix + s / 2, y);
    tile.addChild(g);
    c.addChild(tile);
    if (row.icon) {
      // Local copy in game/public/gifts (never loaded from TikTok at runtime).
      Assets.load(`${import.meta.env.BASE_URL}${row.icon}`).then((tex: Texture) => {
        const icon = new Sprite(tex);
        icon.anchor.set(0.5);
        icon.scale.set(s / Math.max(tex.width, tex.height));
        icon.position.set(ix + s / 2, y);
        c.addChild(icon);
        tile.visible = false;
      }).catch(() => console.warn(`[legend] could not load ${row.icon}; showing placeholder`));
    }
    const ability = label(row.label, 40, row.color);
    ability.anchor.set(0, 0.5);
    ability.position.set(tx, y - 15);
    // Small line: "Rose - 1 coin" (shrinks to 25 px if needed, then clips the gift name).
    const price = `${row.coins.toLocaleString('en-US')} coin${row.coins === 1 ? '' : 's'}`;
    let size = 28;
    let line = body(`${row.giftName} - ${price}`, size, B.muted, '700');
    while (line.width > maxW && size > 25) {
      size--;
      line.destroy();
      line = body(`${row.giftName} - ${price}`, size, B.muted, '700');
    }
    const chars = [...row.giftName];
    while (line.width > maxW && chars.length > 2) {
      chars.pop();
      line.text = `${chars.join('').trimEnd()}… - ${price}`;
    }
    line.anchor.set(0, 0.5);
    line.position.set(tx, y + 24);
    c.addChild(ability, line);
  });
  return c;
}
