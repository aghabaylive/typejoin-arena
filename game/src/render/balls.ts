import { BitmapFont, BitmapText, Container, Graphics, Sprite, type Text } from 'pixi.js';
import { CONFIG, tierColor } from '../config';
import type { Sim } from '../sim/Sim';
import type { Ball } from '../sim/types';
import type { AvatarCache } from './avatars';
import { Textures } from './textures';
import { body, clip, formatMass } from './text';
import { fadedTags, type BodyCircle, type TagBox } from './tagLayout';

const BOT_RING = 0x5d6080;
/** Name tag sizing (canvas px). Name >= 30 px stays ~11 px tall on a 390 px phone screen. */
const TAG = { nameSize: 30, massSize: 28, h: 46, padX: 16, gap: 10, overlap: 0.3, fadedAlpha: 0.3, minRadiusForMass: 30 };
let fontInstalled = false;

/** Mass numbers: Lilita One as a bitmap font (cheap to update every few frames). */
function ensureMassFont(): void {
  if (fontInstalled) return;
  fontInstalled = true;
  BitmapFont.install({
    name: 'MassFont',
    style: {
      fontFamily: CONFIG.render.titleFont,
      fontSize: TAG.massSize,
      fill: CONFIG.brand.yellow,
    },
    chars: [['0', '9'], '.kM+'],
  });
}

export class BallView {
  readonly root = new Container();
  readonly body = new Container();
  readonly shadow: Sprite;
  readonly glow: Sprite;
  readonly avatar = new Sprite();
  readonly shade: Sprite;
  readonly gloss: Sprite;
  readonly ring: Sprite;
  readonly shield: Sprite;
  readonly magnet: Sprite;
  readonly hole: Sprite;
  readonly dashGlow: Sprite;
  /** Name tag (lives in the labels layer, above all balls). */
  readonly tag = new Container();
  readonly pill = new Graphics();
  name: Text | null = null;
  mass: BitmapText;
  pillKey = '';
  tagW = 0;
  tagAlpha = 1;
  avatarVersion = -1;
  massShown = '';
  massUpdateAt = 0;
  wobble = 0;
  wobblePhase = Math.random() * 6.28;
  born: number;
  /** 0..1 swallow progress (smoothed): pulled into the eater's center and shrunk. */
  swallowK = 0;
  x = 0;
  y = 0;
  r = 0;

  constructor(tex: Textures, public readonly ballId: number, now: number, isBot: boolean) {
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
    this.shadow = new Sprite(tex.softDot);
    this.shadow.tint = 0x000000;
    this.shadow.alpha = isBot ? 0.25 : 0.45;
    this.glow = new Sprite(tex.softDot);
    this.glow.visible = false;
    this.avatar.anchor.set(0.5);
    this.shade = new Sprite(tex.innerShade);
    this.gloss = new Sprite(tex.gloss);
    this.ring = new Sprite(isBot ? tex.ringThin : tex.ringThick);
    this.shield = new Sprite(tex.bubble);
    this.shield.tint = 0x3dff9b;
    this.shield.visible = false;
    for (const s of [this.shadow, this.glow, this.shade, this.gloss, this.ring, this.shield]) s.anchor.set(0.5);
    this.gloss.visible = !isBot;
    this.body.addChild(this.shadow, this.glow, this.avatar, this.shade, this.gloss, this.ring, this.shield);
    ensureMassFont();
    this.mass = new BitmapText({ text: '', style: { fontFamily: 'MassFont', fontSize: TAG.massSize } });
    this.mass.anchor.set(0, 0.5);
    this.tag.addChild(this.pill, this.mass);
    this.tag.visible = false; // set per frame (players only; bots never get a name or mass)
  }

  destroy(): void {
    this.root.destroy({ children: true });
    this.tag.destroy({ children: true });
  }
}

/** Keeps one BallView per sim ball and draws it each frame. */
export class BallLayer {
  readonly fields = new Container(); // magnet / black-hole visuals under everything
  readonly bodies = new Container();
  /** Name tags, drawn above ALL balls. */
  readonly labels = new Container();
  readonly views = new Map<number, BallView>();

  constructor(private tex: Textures, private avatars: AvatarCache) {
    this.bodies.sortableChildren = true;
    this.labels.sortableChildren = true;
  }

  update(sim: Sim, alpha: number, now: number, dt: number): void {
    const seen = new Set<number>();
    const t = sim.time;
    const boxes: TagBox[] = [];
    const bodies: BodyCircle[] = [];
    // One tag per player: on their largest piece (split pieces would repeat the same name).
    const tagged = new Map<string, Ball>();
    for (const b of sim.balls) {
      if (b.isBot) continue;
      const cur = tagged.get(b.ownerId);
      if (!cur || b.mass > cur.mass) tagged.set(b.ownerId, b);
    }
    for (const b of sim.balls) {
      seen.add(b.id);
      let v = this.views.get(b.id);
      if (!v) {
        v = new BallView(this.tex, b.id, now, b.isBot);
        this.views.set(b.id, v);
        this.bodies.addChild(v.body);
        this.fields.addChild(v.root);
        this.labels.addChild(v.tag);
      }
      v.tag.visible = !b.isBot && tagged.get(b.ownerId) === b;
      this.drawBall(sim, b, v, alpha, now, dt, t);
      if (!b.isBot) bodies.push({ id: b.id, mass: b.mass, x: v.x, y: v.y, r: v.r }); // bots never hide a player's tag
      if (v.tag.visible) boxes.push({ id: b.id, mass: b.mass, x: v.tag.x, y: v.tag.y, w: v.tagW, h: TAG.h });
    }
    // Overlaps: the bigger ball's tag stays fully visible; a smaller ball's tag fades to 30 % when it hits a
    // bigger tag or would cover a bigger ball's picture.
    const faded = fadedTags(boxes, bodies);
    for (const box of boxes) {
      const v = this.views.get(box.id)!;
      const target = faded.has(box.id) ? TAG.fadedAlpha : 1;
      v.tagAlpha += (target - v.tagAlpha) * Math.min(1, dt * 12);
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
    let x = b.px + (b.x - b.px) * alpha;
    let y = b.py + (b.y - b.py) * alpha;
    let r = b.radius;
    // Swallow: while a bigger ball eats this one, pull it into the eater's center and shrink it.
    const eater = b.swallowerId ? sim.ballById(b.swallowerId) : undefined;
    const target = eater && b.contactRef > 0 ? Math.min(1, Math.max(0, 1 - b.mass / b.contactRef)) : 0;
    v.swallowK += (target - v.swallowK) * Math.min(1, dt * (target > v.swallowK ? 30 : 6));
    if (eater && v.swallowK > 0.001) {
      const k = v.swallowK * (2 - v.swallowK); // ease-out: moves early, settles in the center
      const ex = eater.px + (eater.x - eater.px) * alpha;
      const ey = eater.py + (eater.y - eater.py) * alpha;
      x += (ex - x) * k;
      y += (ey - y) * k;
      r *= 1 - 0.75 * k;
    }
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
    const tier = b.isBot ? BOT_RING : tierColor(b.mass);
    // depth: soft drop shadow below
    v.shadow.width = d * 1.25;
    v.shadow.height = d * 1.1;
    v.shadow.position.set(0, r * 0.18);
    // picture + inner shadow + gloss + ring
    v.avatar.width = v.avatar.height = d * (b.isBot ? 0.94 : 0.84);
    v.shade.width = v.shade.height = d * 0.84;
    v.gloss.width = v.gloss.height = d * 0.84;
    v.ring.width = v.ring.height = d;
    v.ring.tint = tier;
    // outer glow for purple and gold tiers
    const glowTier = !b.isBot && b.mass >= 5000;
    v.glow.visible = glowTier;
    if (glowTier) {
      v.glow.tint = tier;
      v.glow.width = v.glow.height = d * (1.45 + 0.05 * Math.sin(now * 3));
      v.glow.alpha = 0.55;
    }
    // bots: low visual weight
    const prot = b.protectedUntil > t;
    if (b.isBot) v.body.alpha = 0.55;
    else v.body.alpha = prot ? 0.5 + 0.15 * Math.sin(now * 14) : 1;
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
      const s = (sim.fieldRange(CONFIG.abilities.blackHole.range) + r) * 2;
      v.hole.width = v.hole.height = s;
      v.hole.rotation -= dt * 3;
      v.hole.alpha = 0.9;
    }
    v.magnet.visible = mag;
    if (mag) {
      const pulse = (now * 0.8) % 1; // contracting rings read as "pull"
      const s = (sim.fieldRange(CONFIG.abilities.magnet.range) + r) * 2 * (1 - pulse * 0.6);
      v.magnet.width = v.magnet.height = s;
      v.magnet.alpha = 0.25 + pulse * 0.6;
    }
    const dash = !!p && p.dashUntil > t;
    v.dashGlow.visible = dash;
    if (dash) {
      v.dashGlow.width = v.dashGlow.height = d * 2.2;
      v.dashGlow.alpha = 0.6 + 0.3 * Math.sin(now * 20);
    }
    if (v.tag.visible) this.drawTag(b, v, p?.nickname || '?', x, y, r * pop, now, tier, prot);
  }

  /** Name tag attached to the ball's bottom edge: pill overlapping the ring by ~30 % of its height. */
  private drawTag(b: Ball, v: BallView, nickname: string, x: number, y: number, r: number, now: number, tier: number, prot: boolean): void {
    if (!v.name) {
      v.name = body(clip(nickname, 10), TAG.nameSize, 0xffffff, '700');
      v.name.anchor.set(0, 0.5);
      v.tag.addChildAt(v.name, 1);
    }
    const showMass = r >= TAG.minRadiusForMass;
    if (showMass && now >= v.massUpdateAt) {
      const s = formatMass(b.mass);
      if (s !== v.massShown) {
        v.mass.text = s;
        v.massShown = s;
      }
      v.massUpdateAt = now + 0.15;
    }
    v.mass.visible = showMass;
    const nameW = v.name.width;
    const massW = showMass ? v.mass.width : 0;
    const w = Math.round(TAG.padX * 2 + nameW + (showMass ? TAG.gap + massW : 0));
    const h = TAG.h;
    const key = `${w}|${tier}`;
    if (key !== v.pillKey) {
      v.pillKey = key;
      v.pill.clear()
        .roundRect(-w / 2, -h / 2, w, h, h / 2).fill({ color: CONFIG.brand.ink, alpha: 0.92 })
        .stroke({ width: 4, color: tier, alpha: 1 });
    }
    v.tagW = w;
    v.name.position.set(-w / 2 + TAG.padX, 0);
    v.mass.position.set(-w / 2 + TAG.padX + nameW + TAG.gap, 1);
    v.tag.position.set(x, y + r + h * (0.5 - TAG.overlap));
    v.tag.zIndex = b.mass;
    v.tag.alpha = v.tagAlpha * (prot ? 0.85 : 1);
  }
}

export function easeOutBack(t: number): number {
  const c1 = 1.70158, c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}
