import { Container, Graphics, Sprite, type Text } from 'pixi.js';
import { CONFIG } from '../config';
import type { Sim } from '../sim/Sim';
import type { LeaderPanel, TitleEntry } from '../sim/types';
import type { AvatarCache } from './avatars';
import type { Textures } from './textures';
import { body, clip, formatMass, formatTime, label } from './text';

/** Big centered texts over the arena, the storm warning and the TOP PLAYERS panel. */
export class Overlays {
  readonly root = new Container();
  private stormWarn: Text;
  private stormWarnSub: Text;
  private announce: Text;
  private announceSub: Text;
  private announceUntil = 0;
  private announceStart = 0;
  private panel: Container | null = null;
  private panelFor: LeaderPanel | null = null;
  private lastWarnSec = -1;
  private banner: Container;
  private bannerText: Text;
  private bannerShown: string | null = null;

  constructor(private tex: Textures, private avatars: AvatarCache) {
    const { cx, cy } = CONFIG.arena;
    // "STORM INCOMING" in the upper part of the arena (the game keeps running underneath).
    this.stormWarn = label('STORM INCOMING', 96, CONFIG.brand.coral);
    this.stormWarn.position.set(cx, cy - 230);
    this.stormWarnSub = label('', 56, 0xffffff);
    this.stormWarnSub.position.set(cx, cy - 150);
    this.announce = label('', 110, 0xffd43b, { wordWrap: true, wordWrapWidth: 1000, breakWords: true });
    this.announce.position.set(cx, cy - 40);
    this.announceSub = label('', 64, 0xd2a8ff);
    this.announceSub.position.set(cx, cy + 70);
    this.root.addChild(this.stormWarn, this.stormWarnSub, this.announce, this.announceSub);
    // Connection banner over the arena (on top of everything, incl. results).
    this.banner = new Container();
    this.banner.visible = false;
    const R = CONFIG.render;
    this.banner.addChild(new Graphics().rect(0, R.hudBottom, CONFIG.canvas.width, R.arenaBottom - R.hudBottom).fill({ color: 0x12103a, alpha: 0.72 }));
    this.bannerText = label('', 96, 0xffffff);
    this.bannerText.position.set(cx, cy);
    this.banner.addChild(this.bannerText);
  }

  setBanner(text: string | null, now: number): void {
    if (text !== this.bannerShown) {
      this.bannerShown = text;
      if (text) {
        this.bannerText.text = text;
        this.bannerText.style.fill = text === 'LIVE ended' ? 0xff5a5f : 0xffd43b;
      }
      this.banner.visible = !!text;
      if (text) this.root.addChild(this.banner); // keep on top
    }
    if (text && text !== 'LIVE ended') this.bannerText.alpha = 0.7 + 0.3 * Math.sin(now * 4);
    else this.bannerText.alpha = 1;
  }

  /** Huge sender-name announcement (black hole). */
  announceName(name: string, sub: string, now: number, color = 0xffd43b): void {
    this.announce.text = clip(name, 16);
    this.announce.style.fill = color;
    this.announceSub.text = sub;
    this.announceStart = now;
    this.announceUntil = now + 2.8;
  }

  update(sim: Sim, now: number, dt: number): void {
    // Storm warning (hidden while a banner - waiting / reconnecting / LIVE ended / paused - is up).
    const warn = sim.stormStage() === 'warn' && !this.bannerShown;
    this.stormWarn.visible = this.stormWarnSub.visible = warn;
    if (warn) {
      const n = Math.max(1, Math.ceil(sim.stormTimeLeft()));
      if (n !== this.lastWarnSec) this.stormWarnSub.text = `in ${n}s`;
      this.lastWarnSec = n;
      const pulse = 0.5 + 0.5 * Math.sin(now * 8);
      this.stormWarn.alpha = 0.75 + 0.25 * pulse;
      this.stormWarn.scale.set(1 + 0.04 * pulse);
    }
    // Announcement
    const on = now < this.announceUntil;
    this.announce.visible = this.announceSub.visible = on;
    if (on) {
      const age = now - this.announceStart;
      const s = age < 0.25 ? 0.3 + (age / 0.25) * 0.9 : age < 0.4 ? 1.2 - ((age - 0.25) / 0.15) * 0.2 : 1;
      this.announce.scale.set(s);
      this.announceSub.scale.set(s);
      const a = Math.min(1, (this.announceUntil - now) / 0.4);
      this.announce.alpha = this.announceSub.alpha = a;
    }
    // TOP PLAYERS panel (non-blocking, lower part of the arena)
    if (sim.panel !== this.panelFor) {
      this.panel?.destroy({ children: true });
      this.panel = sim.panel ? this.makePanel(sim.panel) : null;
      this.panelFor = sim.panel;
      if (this.panel) {
        this.panel.alpha = 0;
        this.root.addChildAt(this.panel, 0);
      }
    }
    if (this.panel) {
      const left = sim.panelUntil - sim.time;
      const target = Math.min(1, left / 0.4);
      this.panel.alpha = Math.min(target, this.panel.alpha + dt * 4);
      this.panel.y = 40 * (1 - Math.min(1, this.panel.alpha * 1.5));
    }
  }

  /** "TOP PLAYERS": King with reign time, top killers and the biggest free player of the window. */
  private makePanel(p: LeaderPanel): Container {
    const B = CONFIG.brand;
    const c = new Container();
    const x0 = 60, x1 = 1020, top = 846, bottom = CONFIG.render.arenaBottom - 8;
    c.addChild(
      new Graphics().roundRect(x0, top, x1 - x0, bottom - top, 30).fill({ color: B.ink, alpha: 0.86 }).stroke({ width: 4, color: B.yellow, alpha: 0.9 }),
    );
    const title = label('TOP PLAYERS', 52, B.yellow);
    title.position.set(540, top + 44);
    c.addChild(title);
    const colY = top + 104;
    const portrait = (x: number, e: TitleEntry | null, color: number, value: string) => {
      const ring = new Sprite(this.tex.ring);
      ring.anchor.set(0.5);
      ring.tint = color;
      ring.width = ring.height = 100;
      ring.position.set(x, colY + 92);
      if (e) {
        const av = new Sprite(this.avatars.get(e.userId, e.nickname, e.avatarUrl).texture);
        av.anchor.set(0.5);
        av.width = av.height = 90;
        av.position.copyFrom(ring.position);
        c.addChild(av);
      }
      c.addChild(ring);
      const nm = body(e ? clip(e.nickname, 12) : '—', 30, 0xffffff, '800');
      nm.position.set(x, colY + 166);
      const v = label(e ? value : '', 36, color);
      v.position.set(x, colY + 206);
      c.addChild(nm, v);
    };
    const head = (x: number, text: string, color: number) => {
      const h = label(text, 38, color);
      h.position.set(x, colY);
      c.addChild(h);
    };
    // King
    head(236, 'KING', B.yellow);
    const cr = new Sprite(this.tex.crown);
    cr.anchor.set(0.5);
    cr.width = 54;
    cr.height = 37;
    cr.position.set(150, colY - 2);
    c.addChild(cr);
    portrait(220, p.king, B.yellow, p.king ? `${formatMass(p.king.value)} · ${formatTime(p.king.reignSec)}` : '');
    // Top killers
    head(540, 'TOP KILLERS', B.coral);
    if (p.killers.length === 0) {
      const none = body('no kills yet', 28, B.muted, '700');
      none.position.set(540, colY + 110);
      c.addChild(none);
    }
    p.killers.forEach((k, i) => {
      const y = colY + 70 + i * 62;
      const av = new Sprite(this.avatars.get(k.userId, k.nickname, k.avatarUrl).texture);
      av.anchor.set(0.5);
      av.width = av.height = 48;
      av.position.set(412, y);
      const nm = body(clip(k.nickname, 9), 28, 0xffffff, '800');
      nm.anchor.set(0, 0.5);
      nm.position.set(446, y);
      const kills = label(String(k.value), 36, B.coral);
      kills.anchor.set(1, 0.5);
      kills.position.set(676, y);
      c.addChild(av, nm, kills);
    });
    // Best free player
    head(860, 'BEST FREE', 0x3dff9b);
    portrait(860, p.bestFree, 0x3dff9b, p.bestFree ? formatMass(p.bestFree.value) : '');
    return c;
  }
}
