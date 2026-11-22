import { Text, type TextStyleOptions } from 'pixi.js';
import { CONFIG } from '../config';

/** Outlined, phone-readable title/number text (Lilita One). Font size is clamped to the configured minimum (36 px). */
export function label(text: string, size: number, fill: number | string = 0xffffff, extra: Partial<TextStyleOptions> = {}): Text {
  const fontSize = Math.max(CONFIG.render.minFont, size);
  const t = new Text({
    text,
    style: {
      fontFamily: CONFIG.render.titleFont,
      fontSize,
      fontWeight: '400',
      fill,
      stroke: { color: 0x050814, width: Math.max(6, Math.round(fontSize * 0.16)), join: 'round' },
      align: 'center',
      ...extra,
    },
  });
  t.anchor.set(0.5);
  return t;
}

export function formatMass(m: number): string {
  if (m >= 1e6) return (m / 1e6).toFixed(m >= 1e7 ? 0 : 1) + 'M';
  if (m >= 1e4) return Math.round(m / 1e3) + 'k';
  if (m >= 1e3) return (m / 1e3).toFixed(1) + 'k';
  return String(Math.max(0, Math.round(m)));
}

export function formatTime(sec: number): string {
  const s = Math.max(0, Math.ceil(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Shorten long nicknames so they fit their slot. */
export function clip(name: string, max: number): string {
  const chars = [...name];
  return chars.length > max ? chars.slice(0, max - 1).join('') + '…' : name;
}

/**
 * Small text in the clean sans (names, captions). Not clamped to minFont: callers keep it >= 26 px so it is
 * still ~9-10 px tall on a 390 px wide phone screen.
 */
export function body(text: string, size: number, fill: number | string = 0xffffff, weight: TextStyleOptions['fontWeight'] = '700', extra: Partial<TextStyleOptions> = {}): Text {
  const t = new Text({
    text,
    style: {
      fontFamily: CONFIG.render.fontFamily,
      fontSize: size,
      fontWeight: weight,
      fill,
      stroke: { color: 0x0a0826, width: Math.max(4, Math.round(size * 0.14)), join: 'round' },
      align: 'center',
      ...extra,
    },
  });
  t.anchor.set(0.5);
  return t;
}
