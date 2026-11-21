import { Container, Graphics, Sprite, type Text } from 'pixi.js';
import { CONFIG } from '../config';
import type { Sim } from '../sim/Sim';
import type { RoundResults, TitleEntry } from '../sim/types';
import type { AvatarCache } from './avatars';
import type { Textures } from './textures';
import { clip, formatMass, label } from './text';

/** Big centered texts over the arena + the results screen. */
export class Overlays {
  readonly root = new Container();
  private joinNum: Text;
  private joinText: Text;
  private stormNum: Text;
  private announce: Text;
  private announceSub: Text;
  private announceUntil = 0;
  private announceStart = 0;
  private results: Container | null = null;
  private lastJoinNum = -1;
  private lastStormNum = -1;

  constructor(private tex: Textures, private avatars: AvatarCache) {
    const { cx, cy } = CONFIG.arena;
    this.joinNum = label('10', 220, 0xffe066);
    this.joinNum.position.set(cx, cy - 60);
    this.joinText = label('TYPE  join', 96, 0xffffff);
    this.joinText.position.set(cx, cy + 110);
    this.stormNum = label('10', 260, 0xff3b4a);
    this.stormNum.position.set(cx, cy);
    this.announce = label('', 110, 0xffc83d, { wordWrap: true, wordWrapWidth: 1000, breakWords: true });
    this.announce.position.set(cx, cy - 40);
    this.announceSub = label('', 64, 0xd2a8ff);
    this.announceSub.position.set(cx, cy + 70);
    this.root.addChild(this.joinNum, this.joinText, this.stormNum, this.announce, this.announceSub);
  }

  /** Huge sender-name announcement (black hole). */
  announceName(name: string, sub: string, now: number, color = 0xffc83d): void {
    this.announce.text = clip(name, 16);
    this.announce.style.fill = color;
    this.announceSub.text = sub;
    this.announceStart = now;
    this.announceUntil = now + 2.8;
  }

  update(sim: Sim, now: number, dt: number): void {
    const left = sim.phaseTimeLeft();
    // Join window countdown
    const joining = sim.phase === 'join';
    this.joinNum.visible = this.joinText.visible = joining;
    if (joining) {
      const n = Math.ceil(left);
      if (n !== this.lastJoinNum) this.joinNum.text = String(n);
      const frac = left - Math.floor(left);
      this.joinNum.scale.set(1 + 0.25 * frac * frac);
      this.joinNum.alpha = 0.55 + 0.4 * frac;
      this.joinText.scale.set(1 + 0.05 * Math.sin(now * 7));
      this.lastJoinNum = n;
    }
    // Storm final countdown
    const final = sim.phase === 'storm' && left <= CONFIG.round.finalCountdownSec;
    this.stormNum.visible = final;
    if (final) {
      const n = Math.ceil(left);
      if (n !== this.lastStormNum) this.stormNum.text = String(n);
      this.lastStormNum = n;
      const frac = left - Math.floor(left);
      this.stormNum.scale.set(1 + 0.35 * frac * frac);
      this.stormNum.alpha = 0.35 + 0.5 * frac;
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
    // Results screen
    if (sim.phase === 'results' && sim.lastResults && !this.results) this.showResults(sim.lastResults);
    if (sim.phase !== 'results' && this.results) {
      this.results.destroy({ children: true });
      this.results = null;
    }
    if (this.results) this.results.alpha = Math.min(1, this.results.alpha + dt * 3);
  }

  private showResults(r: RoundResults): void {
    const R = CONFIG.render;
    const c = new Container();
    c.alpha = 0;
    const top = R.hudBottom + 6, bottom = R.arenaBottom - 6;
    c.addChild(
      new Graphics().roundRect(24, top, 1032, bottom - top, 30).fill({ color: 0x050a1e, alpha: 0.93 }).stroke({ width: 4, color: 0xffc83d, alpha: 0.9 }),
    );
    const title = label(`ROUND ${r.roundNo} RESULTS`, 64, 0xffc83d);
    title.position.set(540, top + 56);
    c.addChild(title);
    const cards: [string, TitleEntry | null, (e: TitleEntry) => string, number][] = [
      ['KING', r.king, (e) => formatMass(e.value), 0xffc83d],
      ['KILLER', r.killer, (e) => `${e.value} kill${e.value === 1 ? '' : 's'}`, 0xff5b5b],
      ['BEST FREE', r.bestFree, (e) => formatMass(e.value), 0x3dff9b],
    ];
    cards.forEach(([name, entry, val, color], i) => {
      const x = 540 + (i - 1) * 340;
      const y = top + 130;
      const head = label(name, 44, color);
      head.position.set(x, y);
      c.addChild(head);
      const ring = new Sprite(this.tex.ring);
      ring.anchor.set(0.5);
      ring.tint = color;
      ring.width = ring.height = 170;
      ring.position.set(x, y + 145);
      if (entry) {
        const av = new Sprite(this.avatars.get(entry.userId, entry.nickname, entry.avatarUrl).texture);
        av.anchor.set(0.5);
        av.width = av.height = 150;
        av.position.copyFrom(ring.position);
        c.addChild(av);
      }
      c.addChild(ring);
      if (name === 'KING') {
        const crown = new Sprite(this.tex.crown);
        crown.anchor.set(0.5, 1);
        crown.width = 90;
        crown.height = 62;
        crown.position.set(x, y + 80);
        c.addChild(crown);
      }
      const nm = label(entry ? clip(entry.nickname, 11) : '—', 38);
      nm.position.set(x, y + 262);
      const v = label(entry ? val(entry) : '', 36, color);
      v.position.set(x, y + 306);
      c.addChild(nm, v);
    });
    const lbTitle = label('SESSION TOP 5', 46, 0x9fb4ff);
    lbTitle.position.set(540, top + 490);
    c.addChild(lbTitle);
    r.top.forEach((row, i) => {
      const y = top + 548 + i * 52;
      const rank = label(`${i + 1}.`, 36, i === 0 ? 0xffc83d : 0xffffff);
      rank.anchor.set(1, 0.5);
      rank.position.set(250, y);
      const av = new Sprite(this.avatars.get(row.userId, row.nickname, row.avatarUrl).texture);
      av.anchor.set(0.5);
      av.width = av.height = 40;
      av.position.set(290, y);
      const nm = label(clip(row.nickname, 16), 36);
      nm.anchor.set(0, 0.5);
      nm.position.set(325, y);
      const pts = label(`${row.points} pts`, 36, 0xffd86b);
      pts.anchor.set(1, 0.5);
      pts.position.set(860, y);
      c.addChild(rank, av, nm, pts);
    });
    if (r.top.length === 0) {
      const none = label('no players yet — type join!', 38, 0x9fb4ff);
      none.position.set(540, top + 600);
      c.addChild(none);
    }
    this.results = c;
    this.root.addChild(c);
  }
}
