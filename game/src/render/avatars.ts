import { Texture } from 'pixi.js';
import { CONFIG } from '../config';
import { hashString } from '../sim/util';

const SIZE = 256;

export interface AvatarEntry {
  texture: Texture;
  /** Bumped when the texture is replaced (initials -> real picture). */
  version: number;
  status: 'fallback' | 'loading' | 'loaded' | 'failed';
  url?: string;
}

/** Stable per-user color, derived from the userId hash. */
export function userColor(userId: string): string {
  const h = hashString(userId);
  return `hsl(${h % 360}, ${55 + (h >> 9) % 25}%, ${40 + (h >> 17) % 12}%)`;
}

export function initialsOf(nickname: string): string {
  const clean = nickname.replace(/[_.\-@#]+/g, ' ').trim();
  const seg = typeof Intl !== 'undefined' && 'Segmenter' in Intl
    ? [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(clean)].map((s) => s.segment)
    : [...clean];
  if (seg.length === 0) return '?';
  // Use capitals / word starts when present: "SleepyPanda" -> "SP", "ayla x" -> "AX"
  const words = clean.split(/\s+/).filter(Boolean);
  if (words.length >= 2) return ([...words[0]][0] + [...words[1]][0]).toUpperCase();
  const caps = clean.match(/\p{Lu}/gu);
  if (caps && caps.length >= 2) return caps[0] + caps[1];
  return seg.slice(0, 2).join('').toUpperCase();
}

/**
 * Circle-cropped avatar textures. Initials are generated instantly; when a real URL exists
 * it is loaded through the bridge's avatar proxy (/avatar?url=...) and swapped in.
 * Any load failure keeps the initials fallback.
 */
export class AvatarCache {
  private entries = new Map<string, AvatarEntry>();
  private botTexture: Texture | null = null;

  get(userId: string, nickname: string, avatarUrl?: string, isBot = false): AvatarEntry {
    if (isBot) {
      this.botTexture ??= this.drawBot();
      return { texture: this.botTexture, version: 0, status: 'fallback' };
    }
    let e = this.entries.get(userId);
    if (!e) {
      e = { texture: this.drawInitials(userId, nickname), version: 0, status: 'fallback' };
      this.entries.set(userId, e);
    }
    if (avatarUrl && e.url !== avatarUrl && e.status !== 'loading') {
      e.url = avatarUrl;
      void this.load(e, avatarUrl);
    }
    return e;
  }

  private async load(e: AvatarEntry, url: string): Promise<void> {
    e.status = 'loading';
    try {
      const img = await loadImage(proxied(url), 8000);
      const [c, g] = this.circleCanvas();
      const s = Math.max(SIZE / img.naturalWidth, SIZE / img.naturalHeight);
      const w = img.naturalWidth * s, h = img.naturalHeight * s;
      g.drawImage(img, (SIZE - w) / 2, (SIZE - h) / 2, w, h);
      const old = e.texture;
      e.texture = Texture.from(c);
      e.version++;
      e.status = 'loaded';
      // Old initials texture may still be referenced this frame; destroy it later.
      setTimeout(() => old.destroy(true), 2000);
    } catch {
      e.status = 'failed'; // keep initials
    }
  }

  private circleCanvas(): [HTMLCanvasElement, CanvasRenderingContext2D] {
    const c = document.createElement('canvas');
    c.width = c.height = SIZE;
    const g = c.getContext('2d')!;
    g.beginPath();
    g.arc(SIZE / 2, SIZE / 2, SIZE / 2, 0, Math.PI * 2);
    g.clip();
    return [c, g];
  }

  private drawInitials(userId: string, nickname: string): Texture {
    const [c, g] = this.circleCanvas();
    g.fillStyle = userColor(userId);
    g.fillRect(0, 0, SIZE, SIZE);
    const grd = g.createLinearGradient(0, 0, 0, SIZE);
    grd.addColorStop(0, 'rgba(255,255,255,0.18)');
    grd.addColorStop(1, 'rgba(0,0,0,0.25)');
    g.fillStyle = grd;
    g.fillRect(0, 0, SIZE, SIZE);
    const text = initialsOf(nickname);
    g.font = `900 ${text.length > 1 ? 104 : 128}px ${CONFIG.render.fontFamily}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineWidth = 10;
    g.strokeStyle = 'rgba(0,0,0,0.45)';
    g.strokeText(text, SIZE / 2, SIZE / 2 + 6);
    g.fillStyle = '#fff';
    g.fillText(text, SIZE / 2, SIZE / 2 + 6);
    return Texture.from(c);
  }

  private drawBot(): Texture {
    const [c, g] = this.circleCanvas();
    const grd = g.createRadialGradient(SIZE * 0.4, SIZE * 0.35, 10, SIZE / 2, SIZE / 2, SIZE / 2);
    grd.addColorStop(0, '#6b7180');
    grd.addColorStop(1, '#2b2f3a');
    g.fillStyle = grd;
    g.fillRect(0, 0, SIZE, SIZE);
    g.fillStyle = 'rgba(255,255,255,0.55)';
    for (const x of [SIZE * 0.36, SIZE * 0.64]) {
      g.beginPath();
      g.arc(x, SIZE * 0.45, SIZE * 0.07, 0, Math.PI * 2);
      g.fill();
    }
    return Texture.from(c);
  }
}

function proxied(url: string): string {
  if (url.startsWith('data:') || url.startsWith('blob:') || url.startsWith('/')) return url;
  return CONFIG.net.avatarProxy + encodeURIComponent(url);
}

function loadImage(src: string, timeoutMs: number): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.decoding = 'async';
    const t = setTimeout(() => {
      img.src = '';
      reject(new Error('timeout'));
    }, timeoutMs);
    img.onload = () => {
      clearTimeout(t);
      if (img.naturalWidth > 0) resolve(img);
      else reject(new Error('empty'));
    };
    img.onerror = () => {
      clearTimeout(t);
      reject(new Error('load failed'));
    };
    img.src = src;
  });
}
