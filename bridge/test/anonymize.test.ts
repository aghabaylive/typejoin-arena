import { describe, it, expect } from 'vitest';
import { Anonymizer, PLACEHOLDER_AVATAR } from '../src/tools/anonymize';

describe('recording anonymizer', () => {
  const payload = () => ({
    common: { msgId: '123', createTime: '1795310828224', displayText: { defaultPattern: '{0:user} said hi', pieces: [{ stringValue: 'Leyla Real' }] } },
    user: {
      id: '6812345678901234567', idStr: '6812345678901234567', nickname: 'Leyla Real', displayId: 'leyla.real', secUid: 'MS4wLjABAAAA',
      bioDescription: 'my insta @leyla', avatarThumb: { urlList: ['https://p16-sign-va.tiktokcdn.com/real-avatar.jpeg?x-signature=abc'] },
      bgImgUrl: 'https://p16.tiktokcdn.com/bg.jpg', followInfo: { followingCount: '12' },
    },
    content: 'my phone number is 555 0101',
  });

  it('replaces ids, names, chat text, bios and urls; keeps structure, numbers and timestamps', () => {
    const out = new Anonymizer().anonymize(payload()) as ReturnType<typeof payload>;
    const s = JSON.stringify(out);
    for (const secret of ['6812345678901234567', 'Leyla Real', 'leyla.real', 'MS4wLjABAAAA', '@leyla', '555 0101', 'real-avatar', 'x-signature=abc', 'bg.jpg']) {
      expect(s, secret).not.toContain(secret);
    }
    expect(out.user.id).toBe(out.user.idStr); // same real id -> same fake id
    expect(out.user.nickname).toMatch(/^Viewer \d{3}$/);
    expect(out.content).toBe('hello');
    expect(out.user.avatarThumb.urlList[0]).toBe(PLACEHOLDER_AVATAR);
    expect(out.common.createTime).toBe('1795310828224');
    expect(out.common.msgId).toBe('123');
    expect(out.user.followInfo.followingCount).toBe('12');
    expect(out.common.displayText.pieces[0].stringValue).toMatch(/^viewer_\d{3}$/);
  });

  it('keeps join words so join detection can be tested', () => {
    for (const t of ['join', 'J', 'JOIN!']) {
      const p = { ...payload(), content: t };
      expect((new Anonymizer().anonymize(p) as { content: string }).content).toBe(t);
    }
  });
});
