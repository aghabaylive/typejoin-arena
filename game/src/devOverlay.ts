import type { GameEvent } from '@typejoin/shared';

function describe(e: GameEvent): string {
  const t = new Date(e.ts).toLocaleTimeString();
  const extra =
    e.type === 'gift' ? ` ${e.giftName} x${e.units} (${e.coinsPerUnit}c)`
    : e.type === 'like' ? ` x${e.count}`
    : e.type === 'chat' ? ` "${e.text.slice(0, 30)}"`
    : '';
  return `${t} ${e.type.padEnd(6)} ${e.nickname.slice(0, 18)}${extra}`;
}

/** HTML dev overlay (toggle with D): FPS, ball count, last 20 events. */
export class DevOverlay {
  private el = document.getElementById('dev')!;
  private visible = false;
  private events: string[] = [];
  private nextUpdate = 0;

  constructor() {
    window.addEventListener('keydown', (k) => {
      if (k.key === 'd' || k.key === 'D') {
        this.visible = !this.visible;
        this.el.style.display = this.visible ? 'block' : 'none';
      }
    });
  }

  log(e: GameEvent): void {
    this.events.push(describe(e));
    if (this.events.length > 20) this.events.shift();
  }

  update(info: Record<string, string | number>): void {
    if (!this.visible) return;
    const now = performance.now();
    if (now < this.nextUpdate) return;
    this.nextUpdate = now + 250;
    const head = Object.entries(info).map(([k, v]) => `${k}: ${v}`).join('\n');
    this.el.textContent = `${head}\n\nlast 20 events:\n${[...this.events].reverse().join('\n') || '(none yet)'}`;
  }
}
