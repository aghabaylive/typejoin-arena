import { BitmapFont, BitmapText, Container, Sprite, type Text } from 'pixi.js';
import { CONFIG, tierColor } from '../config';
import type { Sim } from '../sim/Sim';
import type { Ball } from '../sim/types';
import type { AvatarCache } from './avatars';
import { Textures } from './textures';
import { clip, formatMass, label } from './text';

const BOT_RING = 0x8a8f9c;
let fontInstalled = false;

function ensureMassFont(): void {
  if (fontInstalled) return;
  fontInstalled = true;
  BitmapFont.install({
    name: 'MassFont',
    style: {
      fontFamily: CONFIG.render.fontFamily,
      fontSize: CONFIG.render.minFont,
      fontWeight: '900',
      fill: 0xffffff,
      stroke: { color: 0x050814, width: 6, join: 'round' },
    },
    chars: [['0', '9'], '.kM+'],
  });
}

export class BallView {
  readonly root = new Container();
  readonly body = new Container();
  readonly avatar = new Sprite();
  readonly ring: Sprite;
  readonly shield: Sprite;
  readonly magnet: Sprite;
  readonly hole: Sprite;
  readonly dashGlow: Sprite;
  readonly labels = new Container();
  name: Text | null = null;
  mass: BitmapText;
  avatarVersion = -1;
  massShown = '';
  massUpdateAt = 0;
  wobble = 0;
  wobblePhase = Math.random() * 6.28;
  born: number;
  x = 0;
  y = 0;
  r = 0;

  constructor(tex: Textures, public readonly ballId: number, now: number) {
    this.born = now;
    this.hole = new Sprite(tex.swirl);
    this.magnet = new Sprite(tex.bubble);
    this.dashGlow = new Sprite(tex.softDot);
    for (const s of [this.hole, this.magnet, this.dashGlow]) {
      s.anchor.set(0.5);
      s.visible = false;
      this.root.addChild(s);
    }
    this.magnet.tint = 0xb05bff;
    this.dashGlow.tint = 0x3dd6ff;
    this.avatar.anchor.set(0.5);
    this.ring = new Sprite(tex.ring);
    this.ring.anchor.set(0.5);
    this.shield = new Sprite(tex.bubble);
    this.shield.anchor.set(0.5);
    this.shield.tint = 0x3dff9b;
    this.shield.visible = false;
    this.body.addChild(this.avatar, this.ring, this.shield);
    ensureMassFont();
    this.mass = new BitmapText({ text: '', style: { fontFamily: 'MassFont', fontSize: CONFIG.render.minFont } });
    this.mass.anchor.set(0.5, 0);
    this.labels.addChild(this.mass);
  }

  destroy(): void {
    this.root.destroy({ children: true });
    this.labels.destroy({ children: true });
  }
}

/** Keeps one BallView per sim ball and draws it each frame. */
export class BallLayer {
  readonly fields = new Container(); // magnet / black-hole visuals under everything
  readonly bodies = new Container();
  readonly labels = new Container();
  readonly views = new Map<number, BallView>();

  constructor(private tex: Textures, private avatars: AvatarCache) {
    this.bodies.sortableChildren = true;
  }

  update(sim: Sim, alpha: number, now: number, dt: number): void {
    const seen = new Set<number>();
    const t = sim.time;
    for (const b of sim.balls) {
      seen.add(b.id);
      let v = this.views.get(b.id);
      if (!v) {
        v = new BallView(this.tex, b.id, now);
        this.views.set(b.id, v);
        this.bodies.addChild(v.body);
        this.fields.addChild(v.root);
        this.labels.addChild(v.labels);
      }
      this.drawBall(sim, b, v, alpha, now, dt, t);
    }
    for (const [id, v] of this.views) {
      if (!seen.has(id)) {
        this.bodies.removeChild(v.body);
        v.body.destroy({ children: true });
        v.destroy();
        this.views.delete(id);
      }
    }
  }

  private drawBall(sim: Sim, b: Ball, v: BallView, alpha: number, now: number, dt: number, t: number): void {
    const p = sim.players.get(b.ownerId);
    const x = b.px + (b.x - b.px) * alpha;
    const y = b.py + (b.y - b.py) * alpha;
    const r = b.radius;
    v.x = x;
    v.y = y;
    v.r = r;
    // avatar texture (swap when the real picture arrives)
    const entry = this.avatars.get(b.ownerId, p?.nickname ?? '', p?.avatarUrl, b.isBot);
    if (entry.version !== v.avatarVersion || v.avatar.texture !== entry.texture) {
      v.avatar.texture = entry.texture;
      v.avatarVersion = entry.version;
    }
    // spawn pop + jelly wobble
    const age = now - v.born;
    const pop = age < 0.35 ? easeOutBack(age / 0.35) : 1;
    if (b.inContact) v.wobble = Math.min(CONFIG.render.wobbleAmp, v.wobble + dt * 0.6);
    v.wobble *= Math.exp(-3 * dt);
    v.wobblePhase += dt * 16;
    const w = Math.sin(v.wobblePhase) * v.wobble;
    v.body.position.set(x, y);
    v.body.scale.set(pop * (1 + w), pop * (1 - w));
    v.body.zIndex = b.mass;
    const d = r * 2;
    v.ring.width = v.ring.height = d;
    v.avatar.width = v.avatar.height = d * 0.88;
    v.ring.tint = b.isBot ? BOT_RING : tierColor(b.mass);
    // protection: translucent + blink
    const prot = b.protectedUntil > t;
    v.body.alpha = prot ? 0.45 + 0.15 * Math.sin(now * 14) : 1;
    // shield bubble
    const shield = !!p && p.shieldUntil > t;
    v.shield.visible = shield;
    if (shield) {
      const s = d * (1.28 + 0.04 * Math.sin(now * 6));
      v.shield.width = v.shield.height = s;
      v.shield.alpha = 0.8 + 0.2 * Math.sin(now * 9);
    }
    // field abilities around the ball
    v.root.position.set(x, y);
    const hole = !!p && p.blackHoleUntil > t;
    const mag = !!p && p.magnetUntil > t && !hole;
    v.hole.visible = hole;
    if (hole) {
      const s = (CONFIG.abilities.blackHole.range + r) * 2;
      v.hole.width = v.hole.height = s;
      v.hole.rotation -= dt * 3;
      v.hole.alpha = 0.9;
    }
    v.magnet.visible = mag;
    if (mag) {
      const pulse = (now * 0.8) % 1; // contracting rings read as "pull"
      const s = (CONFIG.abilities.magnet.range + r) * 2 * (1 - pulse * 0.6);
      v.magnet.width = v.magnet.height = s;
      v.magnet.alpha = 0.25 + pulse * 0.6;
    }
    const dash = !!p && p.dashUntil > t;
    v.dashGlow.visible = dash;
    if (dash) {
      v.dashGlow.width = v.dashGlow.height = d * 2.2;
      v.dashGlow.alpha = 0.6 + 0.3 * Math.sin(now * 20);
    }
    // labels
    if (!b.isBot) {
      if (!v.name) {
        v.name = label(clip(p?.nickname ?? '?', 14), CONFIG.render.minFont);
        v.name.anchor.set(0.5, 0);
        v.labels.addChild(v.name);
      }
      v.name.position.set(x, y + r * pop + 4);
      v.mass.position.set(x, y + r * pop + 4 + v.name.height - 6);
    } else {
      v.mass.position.set(x, y + r * pop + 4);
    }
    v.labels.alpha = prot ? 0.75 : 1;
    if (now >= v.massUpdateAt) {
      const s = formatMass(b.mass);
      if (s !== v.massShown) {
        v.mass.text = s;
        v.massShown = s;
      }
      v.massUpdateAt = now + 0.15;
    }
    v.mass.visible = CONFIG.render.showMassBelowName;
  }
}

export function easeOutBack(t: number): number {
  const c1 = 1.70158, c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}
