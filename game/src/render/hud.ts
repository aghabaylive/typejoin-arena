import { Container, Graphics, Sprite, type Text } from 'pixi.js';
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

/** Gift legend, right side of the 63-88 % band (bottom-left stays free for TikTok comments). */
export function makeLegend(): Container {
  const R = CONFIG.render;
  const c = new Container();
  const rows = CONFIG.legend;
  const h = (R.legendBottom - R.legendTop) / rows.length;
  c.addChild(
    new Graphics()
      .roundRect(R.legendX, R.legendTop + 6, R.legendRight - R.legendX, R.legendBottom - R.legendTop - 12, 24)
      .fill({ color: 0x050a1e, alpha: 0.6 })
      .stroke({ width: 2, color: 0x2a3b7a, alpha: 0.8 }),
  );
  rows.forEach((row, i) => {
    const y = R.legendTop + i * h + h / 2;
    const ix = R.legendX + 12;
    const s = R.legendIcon;
    // Placeholder icon: colored tile + glyph (real gift art comes later).
    c.addChild(
      new Graphics()
        .roundRect(ix, y - s / 2, s, s, 20)
        .fill({ color: row.color, alpha: 0.25 })
        .stroke({ width: 4, color: row.color }),
    );
    const g = label(row.glyph, 56, row.color);
    g.position.set(ix + s / 2, y);
    c.addChild(g);
    const name = label(row.label, 40);
    name.anchor.set(0, 0.5);
    name.position.set(ix + s + 16, y - 20);
    const coins = label(`${row.coins} coins`, 36, 0xffd86b);
    coins.anchor.set(0, 0.5);
    coins.position.set(ix + s + 16, y + 22);
    c.addChild(name, coins);
  });
  return c;
}
