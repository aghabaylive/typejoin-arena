import { Texture } from 'pixi.js';

function canvas(w: number, h = w): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}

/** Procedurally generated textures (no asset files needed in this step). */
export class Textures {
  readonly ring: Texture;
  readonly dot: Texture;
  readonly softDot: Texture;
  readonly shard: Texture;
  readonly spike: Texture;
  readonly crown: Texture;
  readonly bubble: Texture;
  readonly swirl: Texture;
  readonly vignette: Texture;
  /** Ring texture size; ring sprite is scaled to 2*radius. */
  static readonly RING = 256;

  constructor() {
    this.ring = this.makeRing();
    this.dot = this.makeDot(false);
    this.softDot = this.makeDot(true);
    this.shard = this.makeShard();
    this.spike = this.makeSpike();
    this.crown = this.makeCrown();
    this.bubble = this.makeBubble();
    this.swirl = this.makeSwirl();
    this.vignette = this.makeVignette();
  }

  private makeRing(): Texture {
    const S = Textures.RING;
    const [c, g] = canvas(S);
    const r = S / 2;
    g.beginPath();
    g.arc(r, r, r - 2, 0, Math.PI * 2);
    g.arc(r, r, r * 0.86, 0, Math.PI * 2, true);
    g.fillStyle = '#fff';
    g.fill('evenodd');
    // subtle inner shadow line for depth
    g.beginPath();
    g.arc(r, r, r * 0.86, 0, Math.PI * 2);
    g.lineWidth = 3;
    g.strokeStyle = 'rgba(0,0,0,0.35)';
    g.stroke();
    return Texture.from(c);
  }

  private makeDot(soft: boolean): Texture {
    const S = 64;
    const [c, g] = canvas(S);
    const grd = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    if (soft) {
      grd.addColorStop(0, 'rgba(255,255,255,1)');
      grd.addColorStop(0.4, 'rgba(255,255,255,0.6)');
      grd.addColorStop(1, 'rgba(255,255,255,0)');
    } else {
      grd.addColorStop(0, 'rgba(255,255,255,1)');
      grd.addColorStop(0.55, 'rgba(255,255,255,1)');
      grd.addColorStop(0.7, 'rgba(255,255,255,0.35)');
      grd.addColorStop(1, 'rgba(255,255,255,0)');
    }
    g.fillStyle = grd;
    g.fillRect(0, 0, S, S);
    return Texture.from(c);
  }

  private makeShard(): Texture {
    const [c, g] = canvas(32);
    g.beginPath();
    g.moveTo(16, 0);
    g.lineTo(30, 28);
    g.lineTo(4, 22);
    g.closePath();
    g.fillStyle = '#fff';
    g.fill();
    return Texture.from(c);
  }

  private makeSpike(): Texture {
    const S = 128;
    const [c, g] = canvas(S);
    const r = S / 2;
    const n = 12;
    g.beginPath();
    for (let i = 0; i < n * 2; i++) {
      const a = (i / (n * 2)) * Math.PI * 2;
      const rr = i % 2 === 0 ? r - 2 : r * 0.55;
      g.lineTo(r + Math.cos(a) * rr, r + Math.sin(a) * rr);
    }
    g.closePath();
    const grd = g.createRadialGradient(r, r, 0, r, r, r);
    grd.addColorStop(0, '#ff9a9a');
    grd.addColorStop(0.5, '#ff3b4a');
    grd.addColorStop(1, '#7a0010');
    g.fillStyle = grd;
    g.fill();
    g.lineWidth = 4;
    g.strokeStyle = '#2a0006';
    g.stroke();
    return Texture.from(c);
  }

  private makeCrown(): Texture {
    const [c, g] = canvas(160, 110);
    g.beginPath();
    g.moveTo(10, 100);
    g.lineTo(18, 30);
    g.lineTo(50, 62);
    g.lineTo(80, 8);
    g.lineTo(110, 62);
    g.lineTo(142, 30);
    g.lineTo(150, 100);
    g.closePath();
    const grd = g.createLinearGradient(0, 0, 0, 110);
    grd.addColorStop(0, '#fff1a8');
    grd.addColorStop(0.5, '#ffc83d');
    grd.addColorStop(1, '#c47f00');
    g.fillStyle = grd;
    g.fill();
    g.lineWidth = 6;
    g.strokeStyle = '#3b2400';
    g.stroke();
    for (const [x, y] of [[18, 30], [80, 8], [142, 30]]) {
      g.beginPath();
      g.arc(x, y, 9, 0, Math.PI * 2);
      g.fillStyle = '#ff4fa3';
      g.fill();
      g.stroke();
    }
    return Texture.from(c);
  }

  private makeBubble(): Texture {
    const S = 256;
    const [c, g] = canvas(S);
    const r = S / 2;
    const grd = g.createRadialGradient(r, r, r * 0.6, r, r, r);
    grd.addColorStop(0, 'rgba(255,255,255,0)');
    grd.addColorStop(0.8, 'rgba(255,255,255,0.25)');
    grd.addColorStop(0.95, 'rgba(255,255,255,0.9)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, S, S);
    return Texture.from(c);
  }

  private makeSwirl(): Texture {
    const S = 512;
    const [c, g] = canvas(S);
    const r = S / 2;
    const grd = g.createRadialGradient(r, r, 0, r, r, r);
    grd.addColorStop(0, 'rgba(0,0,0,1)');
    grd.addColorStop(0.25, 'rgba(20,0,40,0.95)');
    grd.addColorStop(0.7, 'rgba(90,30,160,0.35)');
    grd.addColorStop(1, 'rgba(90,30,160,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, S, S);
    g.translate(r, r);
    for (let arm = 0; arm < 4; arm++) {
      g.rotate(Math.PI / 2);
      g.beginPath();
      for (let t = 0; t < 1; t += 0.01) {
        const a = t * Math.PI * 2.2;
        const rr = r * 0.12 + t * r * 0.85;
        g.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
      }
      g.lineWidth = 10;
      g.strokeStyle = 'rgba(200,140,255,0.35)';
      g.stroke();
    }
    return Texture.from(c);
  }

  private makeVignette(): Texture {
    const [c, g] = canvas(540, 960);
    const grd = g.createRadialGradient(270, 400, 120, 270, 480, 620);
    grd.addColorStop(0, 'rgba(0,0,0,0)');
    grd.addColorStop(1, 'rgba(0,0,0,0.75)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 540, 960);
    return Texture.from(c);
  }
}
