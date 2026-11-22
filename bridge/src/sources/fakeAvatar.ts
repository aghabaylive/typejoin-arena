/**
 * Dev-only fake profile pictures: colorful illustrated faces, generated locally from the user id
 * (deterministic, no network, never photos of real people). Returned as an SVG data URI, which the game's
 * avatar loader accepts directly (no proxy needed).
 */

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function rng(seed: number): () => number {
  let a = seed || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const BG = [['#ff5a5f', '#ffd43b'], ['#2340ff', '#4dd8ff'], ['#7cf29a', '#2340ff'], ['#ff7ab6', '#ffd43b'], ['#9b5bff', '#ff7ab6'], ['#4dd8ff', '#7cf29a'], ['#ffd43b', '#ff8a3d'], ['#12103a', '#9b5bff']];
const SKIN = ['#ffe0c7', '#f5c6a0', '#e0a77c', '#c68642', '#8d5524', '#ffd7b5', '#a0e6ff', '#c8ffb0', '#ffc2e2'];
const HAIR = ['#2b1d0e', '#6b3e1f', '#ffd43b', '#ff5a5f', '#12103a', '#9b5bff', '#ffffff', '#4dd8ff'];

export function fakeAvatarSvg(userId: string): string {
  const r = rng(hash(userId));
  const pick = <T,>(a: T[]) => a[Math.floor(r() * a.length)];
  const [c1, c2] = pick(BG);
  const skin = pick(SKIN);
  const hair = pick(HAIR);
  const blobs = Array.from({ length: 3 }, () =>
    `<circle cx="${(r() * 128).toFixed(0)}" cy="${(r() * 128).toFixed(0)}" r="${(14 + r() * 26).toFixed(0)}" fill="#fff" opacity="${(0.08 + r() * 0.12).toFixed(2)}"/>`).join('');
  const faceR = 34 + r() * 6;
  const eyeY = 62 + r() * 6, eyeDx = 11 + r() * 4, eyeR = 3.5 + r() * 2;
  const smile = r() < 0.75;
  const mouth = smile
    ? `<path d="M${64 - 12} ${eyeY + 16} Q64 ${eyeY + 26 + r() * 6} ${64 + 12} ${eyeY + 16}" stroke="#12103a" stroke-width="4" fill="none" stroke-linecap="round"/>`
    : `<circle cx="64" cy="${eyeY + 19}" r="5" fill="#12103a"/>`;
  const style = Math.floor(r() * 4);
  const hairShape = [
    `<path d="M${64 - faceR} 62 Q64 ${8 + r() * 10} ${64 + faceR} 62 Q${64 + faceR * 0.6} 40 64 38 Q${64 - faceR * 0.6} 40 ${64 - faceR} 62Z" fill="${hair}"/>`,
    `<circle cx="64" cy="34" r="16" fill="${hair}"/><path d="M${64 - faceR} 60 Q64 22 ${64 + faceR} 60Z" fill="${hair}"/>`,
    `<path d="M${64 - faceR - 4} 70 Q${64 - faceR} 20 64 22 Q${64 + faceR} 20 ${64 + faceR + 4} 70 L${64 + faceR - 6} 58 Q64 36 ${64 - faceR + 6} 58Z" fill="${hair}"/>`,
    `<rect x="${64 - faceR + 2}" y="30" width="${faceR * 2 - 4}" height="14" rx="7" fill="${hair}"/><circle cx="64" cy="26" r="7" fill="${hair}"/>`,
  ][style];
  const cheeks = r() < 0.6 ? `<circle cx="${64 - eyeDx - 6}" cy="${eyeY + 12}" r="5" fill="#ff7ab6" opacity=".55"/><circle cx="${64 + eyeDx + 6}" cy="${eyeY + 12}" r="5" fill="#ff7ab6" opacity=".55"/>` : '';
  const glasses = r() < 0.2 ? `<g stroke="#12103a" stroke-width="3" fill="none"><circle cx="${64 - eyeDx}" cy="${eyeY}" r="9"/><circle cx="${64 + eyeDx}" cy="${eyeY}" r="9"/><path d="M${64 - eyeDx + 9} ${eyeY} H${64 + eyeDx - 9}"/></g>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128">`
    + `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient></defs>`
    + `<rect width="128" height="128" fill="url(#g)"/>${blobs}`
    + `<ellipse cx="64" cy="128" rx="44" ry="26" fill="${hair}" opacity=".85"/>`
    + `<circle cx="64" cy="${66 + r() * 4}" r="${faceR.toFixed(1)}" fill="${skin}"/>`
    + hairShape
    + `<circle cx="${64 - eyeDx}" cy="${eyeY}" r="${eyeR.toFixed(1)}" fill="#12103a"/><circle cx="${64 + eyeDx}" cy="${eyeY}" r="${eyeR.toFixed(1)}" fill="#12103a"/>`
    + cheeks + glasses + mouth
    + `</svg>`;
}

export function fakeAvatarUrl(userId: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(fakeAvatarSvg(userId))}`;
}
