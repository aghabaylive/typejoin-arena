/**
 * Anonymizer for recorded TikTok payloads (deny-by-default for text):
 * - ids -> consistent fake ids; nickname / handle -> "Viewer NNN" / "viewer_NNN"
 * - every real nickname / handle is also replaced inside ANY other string (display texts etc.)
 * - chat text (content / comment) -> kept only if it is a join word, else "hello"
 * - other free-text fields -> "" ; every URL -> placeholder (TikTok CDN host kept for avatar realism)
 */
const JOIN = /^\s*(j|join)\W*$/i;
const ID_KEYS = ['userId', 'id', 'idStr', 'secUid', 'specialId'];
const NAME_KEYS = ['nickname', 'uniqueId', 'displayId'];
const CHAT_KEYS = ['comment', 'content'];
const FREE_TEXT_KEYS = ['bioDescription', 'signature', 'verifiedReason', 'verifiedContent', 'shareQrcodeUri', 'bgImgUrl', 'openWebUrl', 'defaultPattern', 'pattern', 'ecStreamerKey'];
export const PLACEHOLDER_AVATAR = 'https://p16-sign-va.tiktokcdn.com/tos-maliva-avt-0068/placeholder~c5_100x100.jpeg';

export class Anonymizer {
  private ids = new Map<string, string>();
  private realNames = new Set<string>();

  private fakeId(real: string): string {
    if (!this.ids.has(real)) this.ids.set(real, String(7000000000000000000n + BigInt(this.ids.size + 1)));
    return this.ids.get(real)!;
  }

  /** Anonymize one decoded payload (plain JSON, bigints already stringified). */
  anonymize(payload: unknown): unknown {
    this.collectNames(payload);
    return this.walk(payload);
  }

  private collectNames(o: unknown, key = ''): void {
    if (Array.isArray(o)) return o.forEach((x) => this.collectNames(x, key));
    if (o && typeof o === 'object') return Object.entries(o).forEach(([k, v]) => this.collectNames(v, k));
    if (typeof o === 'string' && NAME_KEYS.includes(key) && o.trim().length >= 2) this.realNames.add(o);
  }

  private scrubNames(s: string): string {
    let out = s;
    for (const n of this.realNames) if (out.includes(n)) out = out.split(n).join(`viewer_${this.fakeId(n).slice(-3)}`);
    return out;
  }

  private walk(o: unknown, key = ''): unknown {
    if (Array.isArray(o)) return o.map((x) => this.walk(x, key));
    if (o && typeof o === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(o)) out[k] = this.walk(v, k);
      return out;
    }
    if (typeof o === 'bigint') o = o.toString();
    if (typeof o !== 'string') return o;
    if (ID_KEYS.includes(key) && /\S/.test(o) && o !== '0') return this.fakeId(o);
    if (key === 'nickname') return `Viewer ${this.fakeId(o).slice(-3)}`;
    if (key === 'uniqueId' || key === 'displayId') return `viewer_${this.fakeId(o).slice(-3)}`;
    if (CHAT_KEYS.includes(key)) return JOIN.test(o) ? o : 'hello';
    if (FREE_TEXT_KEYS.includes(key)) return '';
    if (/^https?:\/\//i.test(o)) {
      try {
        return /tiktokcdn/i.test(new URL(o).hostname) ? PLACEHOLDER_AVATAR : 'https://example.invalid/';
      } catch {
        return 'https://example.invalid/';
      }
    }
    return this.scrubNames(o);
  }
}
