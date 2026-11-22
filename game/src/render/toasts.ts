import { Container, Graphics, type Text } from 'pixi.js';
import { CONFIG } from '../config';
import { clip, label } from './text';

interface Toast {
  c: Container;
  life: number;
  y: number;
}

/** Short confirmation pills under the top bar (e.g. "@name: Shield ready next round"). Newest on top. */
export class Toasts {
  readonly root = new Container();
  private live: Toast[] = [];
  /** Extra downward offset (the "Any gift = grow" line occupies the first slot when the legend is off). */
  offsetY = 0;

  add(text: string): void {
    const c = new Container();
    const t: Text = label(clip(text, 40), 36, 0xffd43b);
    const w = Math.min(1032, t.width + 56), h = 58;
    c.addChild(
      new Graphics().roundRect(-w / 2, -h / 2, w, h, h / 2).fill({ color: 0x12103a, alpha: 0.9 }).stroke({ width: 3, color: 0xffd43b, alpha: 0.9 }),
      t,
    );
    c.position.set(540, CONFIG.render.hudBottom + 36 + this.offsetY);
    c.alpha = 0;
    this.root.addChild(c);
    this.live.unshift({ c, life: CONFIG.toast.sec, y: 0 });
    while (this.live.length > CONFIG.toast.maxVisible) this.kill(this.live.length - 1);
  }

  update(dt: number): void {
    const base = CONFIG.render.hudBottom + 36 + this.offsetY;
    for (let i = this.live.length - 1; i >= 0; i--) {
      const t = this.live[i];
      t.life -= dt;
      if (t.life <= 0) {
        this.kill(i);
        continue;
      }
      t.y += (i * 64 - t.y) * Math.min(1, dt * 12);
      t.c.y = base + t.y;
      const age = CONFIG.toast.sec - t.life;
      t.c.alpha = Math.min(1, age / 0.15, t.life / 0.4);
      t.c.scale.set(age < 0.15 ? 0.85 + age : 1);
    }
  }

  private kill(i: number): void {
    const [t] = this.live.splice(i, 1);
    t.c.destroy({ children: true });
  }
}
