import { describe, expect, it } from 'vitest';
import {
  buildChatPacket, isTelegramExport, isTikTokExport, listTelegramChats, localParts, mergeViews,
  parseTelegramChat, parseTikTokExport, squeeze, telegramChats, tgOverview, tokenize, ttChatsCounts,
  ttViewsTotal, wildcardToRegExp, type Dictionaries,
} from '../src';
import { POISON, tgFull, tgPersonal, ttExportA, ttExportB } from './fixtures';

describe('telegram', () => {
  it('распознаёт одиночный и полный экспорт', () => {
    expect(isTelegramExport(tgPersonal)).toBe(true);
    expect(isTelegramExport(tgFull)).toBe(true);
    expect(listTelegramChats(tgFull)).toHaveLength(2);
    expect(telegramChats(tgFull)[0].name).toBe('Аня');
  });

  it('собирает текст из списка, группирует по from_id, видит удалённые аккаунты и типы', () => {
    const chat = parseTelegramChat(tgPersonal);
    expect(chat.messages).toHaveLength(6);
    expect(chat.messages[1].text).toBe('смотри https://example.com');
    expect(chat.messages[3].kind).toBe('voice');
    expect(chat.messages[3].durationSec).toBe(12);
    const deleted = chat.participants.find((p) => p.key === 'user3');
    expect(deleted?.displayName).toBe('Удалённый аккаунт');
    expect(chat.events[0].action).toBe('call');
    expect(chat.exporterOffsetMin).toBe(180);
    expect(chat.kind).toBe('group'); // три автора
  });
});

describe('время', () => {
  it('переводит UTC в выбранный пояс', () => {
    const ts = 1735848600; // 2025-01-02 20:10 UTC
    expect(localParts(ts, 'Europe/Moscow').hour).toBe(23);
    expect(localParts(ts, 'Asia/Novosibirsk').dayKey).toBe('2025-01-03');
    expect(localParts(ts, 'Asia/Novosibirsk').hour).toBe(3);
    expect(localParts(0, 'UTC').weekday).toBe(3); // 1970-01-01 — четверг
  });
});

describe('tiktok', () => {
  it('разбирает разделы без учёта регистра и время как UTC', () => {
    expect(isTikTokExport(ttExportA)).toBe(true);
    const acc = parseTikTokExport(ttExportA);
    expect(acc.owner).toBe('me_user');
    expect(acc.views).toHaveLength(3);
    expect(acc.views[0].ts).toBe(Date.UTC(2025, 2, 1, 21, 14, 5) / 1000);
    expect(acc.views[0].videoId).toBe('7341234567890123456');
    expect(acc.likes).toHaveLength(1);
    expect(acc.logins).toHaveLength(1);
    expect(acc.chats[0].title).toBe('friend_1');
    expect(acc.chats[0].messages[0].kind).toBe('tiktok_share');
    expect(acc.unknownSections).toContain('Some New Section');
  });

  it('склейка: повторные просмотры сохраняются, дубли между файлами — нет', () => {
    const a = parseTikTokExport(ttExportA);
    const b = parseTikTokExport(ttExportB);
    const merged = mergeViews(a.views, b.views);
    expect(merged).toHaveLength(4);
  });

  it('бесплатные счётчики', () => {
    const acc = parseTikTokExport(ttExportA);
    const counts = ttChatsCounts(acc);
    const me = counts[0].byAuthor.find((x) => x.isOwner)!;
    expect(me.text).toBe(1);
    expect(counts[0].byAuthor.find((x) => !x.isOwner)!.shares).toBe(1);
    expect(ttViewsTotal(acc.views, 'Europe/Moscow').count).toBe(3);
  });
});

describe('текст', () => {
  it('токенизация и нормализация', () => {
    expect(tokenize('Ёлка, XУЙНЯ и кот-обормот!')).toEqual(['елка', 'хуйня', 'и', 'кот-обормот']);
    expect(squeeze('бляяяя')).toBe('бляя');
    expect(wildcardToRegExp('росси*').test('россии')).toBe(true);
    expect(wildcardToRegExp('д*а*').test('дача')).toBe(true);
  });
});

describe('пакет', () => {
  const dict: Dictionaries = {
    version: 't1',
    swear: { words: {}, patterns: [{ id: 'r1', re: 'репост' }], exceptions: [], labels: { r1: 'р*т' } },
    names: { forms: { кирилл: 'n1' }, labels: { n1: 'Кирилл' } },
    laugh: ['а?(?:ха)+х?'],
    stopwords: ['и'],
  };

  it('не содержит текстов сообщений', () => {
    const chat = parseTelegramChat(tgPersonal);
    const packet = buildChatPacket(chat, {
      sections: ['tg.overview', 'tg.words', 'tg.laugh_swear', 'tg.names', 'tg.reactions', 'tg.media', 'tg.dialog'],
      tz: 'Europe/Moscow', dictionaries: dict, customPatterns: ['прив*'], ownerKey: 'user1',
    });
    const json = JSON.stringify(packet);
    expect(json).not.toContain(POISON);
    expect(json).not.toContain(POISON.toLowerCase());
    expect(packet.stream.ts).toHaveLength(6);
    expect(packet.participants[0].is_owner).toBe(true);
    expect(packet.stream.laugh[2]).toBe(1);
    expect(packet.reactions?.who).toHaveLength(1);
    expect(packet.forward_sources).toEqual(['Канал X']);
    expect(packet.words?.custom_hits.length).toBe(1);
  });

  it('скрытие имён', () => {
    const chat = parseTelegramChat(tgPersonal);
    const packet = buildChatPacket(chat, { sections: ['tg.rhythm'], tz: 'UTC', hideNames: true });
    expect(packet.participants.map((p) => p.name)).toEqual(['Участник A', 'Участник B', 'Участник C']);
    expect(JSON.stringify(packet)).not.toContain('Кирилл');
  });

  it('tiktok: пакет без текстов, история передаётся только без согласия на хранение', () => {
    const acc = parseTikTokExport(ttExportA);
    const p1 = buildChatPacket(acc.chats[0], { sections: ['tt.chat_deep', 'tt.sessions'], tz: 'UTC' }, acc, false);
    expect(p1.tt?.views?.ts).toHaveLength(3);
    expect(JSON.stringify(p1)).not.toContain(POISON);
    const p2 = buildChatPacket(null, { sections: ['tt.sessions'], tz: 'UTC' }, acc, true);
    expect(p2.tt?.views).toBeUndefined();
    expect(p2.chat_kind).toBe('account');
  });

  it('обзор', () => {
    const o = tgOverview(parseTelegramChat(tgPersonal), 'Europe/Moscow');
    expect(o.total).toBe(6);
    expect(o.byParticipant[0].name).toBe('Аня');
  });
});
