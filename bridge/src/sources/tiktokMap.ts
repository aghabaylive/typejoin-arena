import { catalogGift } from '@typejoin/shared';
import type { RawSourceEvent, RawUser } from './EventSource';

/**
 * Pure mapping from decoded tiktok-live-connector v2 payloads to raw source events.
 * The payloads are protobuf-decoded objects whose field shapes vary slightly between message types and
 * library versions, so every field is read defensively. Covered by recorded fixtures in bridge/test.
 */

type Any = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const str = (v: unknown): string => (v === undefined || v === null ? '' : String(v));

function firstUrl(img: Any | undefined): string | undefined {
  if (!img) return undefined;
  const lists = [img.url, img.urls, img.urlList, img.url_list, img.mUrls];
  for (const l of lists) {
    if (Array.isArray(l)) {
      const u = l.find((x) => typeof x === 'string' && x.startsWith('https://'));
      if (u) return u;
    }
  }
  return undefined;
}

export function mapUser(user: Any | undefined): RawUser | null {
  if (!user) return null;
  // Stable numeric TikTok user id; uniqueId (the @handle) can be changed by the user.
  const userId = str(user.userId ?? user.id ?? user.idStr);
  if (!userId || userId === '0') return null;
  const nickname = str(user.nickname) || str(user.uniqueId) || str(user.displayId) || userId;
  const avatarUrl = firstUrl(user.profilePicture) ?? firstUrl(user.profilePictureMedium) ?? firstUrl(user.avatarThumb);
  return { userId, nickname, ...(avatarUrl ? { avatarUrl } : {}) };
}

/** TikTok createTime (ms, sometimes seconds) of the message, if present. */
export function sourceTime(data: Any): number | undefined {
  const t = Number(data?.common?.createTime ?? data?.event?.createTime ?? 0);
  if (!Number.isFinite(t) || t <= 0) return undefined;
  return t < 1e12 ? t * 1000 : t;
}

export type TikTokKind = 'chat' | 'like' | 'gift' | 'follow' | 'share';

export function mapTikTok(kind: TikTokKind, data: Any): RawSourceEvent | null {
  const user = mapUser(data?.user);
  if (!user) return null;
  const sourceTs = sourceTime(data);
  const meta = sourceTs ? { sourceTs } : {};
  switch (kind) {
    case 'chat': {
      const text = str(data.comment);
      return text ? { type: 'chat', text, ...user, ...meta } : null;
    }
    case 'like': {
      const count = Math.max(0, Math.floor(Number(data.likeCount ?? 0)));
      return count > 0 ? { type: 'like', count, ...user, ...meta } : null;
    }
    case 'gift': {
      const giftId = Number(data.giftId ?? data.giftDetails?.id ?? 0);
      if (!giftId) return null;
      const details = (data.giftDetails ?? {}) as Any;
      const giftType = Number(details.giftType ?? details.type ?? 0);
      const streakable = giftType === 1;
      const cat = catalogGift(giftId);
      const msgId = str(data.common?.msgId ?? data.msgId);
      const groupId = str(data.groupId);
      // Streak gifts: all updates of one combo share groupId. Other gifts: one message = one gift
      // (a re-delivered packet has the same msgId and is therefore counted once).
      const streakKey = streakable && groupId && groupId !== '0' ? `g${groupId}` : `m${msgId || groupId || Date.now()}`;
      return {
        type: 'gift',
        giftId,
        giftName: cat?.name ?? (str(details.giftName ?? details.name) || `Gift ${giftId}`),
        coinsPerUnit: cat?.coins ?? Number(details.diamondCount ?? 0),
        streakId: `${user.userId}:${giftId}:${streakKey}`,
        repeatCount: Math.max(1, Number(data.repeatCount ?? 1)),
        repeatEnd: streakable ? Boolean(Number(data.repeatEnd ?? 0)) : true,
        ...user,
        ...meta,
      };
    }
    case 'follow':
      return { type: 'follow', ...user, ...meta };
    case 'share':
      return { type: 'share', ...user, ...meta };
  }
}
