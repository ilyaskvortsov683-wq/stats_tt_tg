// Бесплатные метрики — считаются в браузере, сеть не нужна. Каталог: docs/04-metrics-catalog.md.
import { localParts } from './tz';
import type { Chat, TikTokAccount } from './types';

export interface TgOverview {
  total: number;
  byParticipant: { key: string; name: string; count: number; share: number }[];
  firstTs: number | null;
  lastTs: number | null;
  days: number;
  activeDays: number;
}

export function tgOverview(chat: Chat, tz: string): TgOverview {
  const counts = new Map<string, number>();
  const activeDays = new Set<number>();
  for (const m of chat.messages) {
    counts.set(m.author, (counts.get(m.author) ?? 0) + 1);
    activeDays.add(localParts(m.ts, tz).dayNumber);
  }
  const total = chat.messages.length;
  const firstTs = total ? chat.messages[0].ts : null;
  const lastTs = total ? chat.messages[total - 1].ts : null;
  const days = firstTs !== null && lastTs !== null
    ? localParts(lastTs, tz).dayNumber - localParts(firstTs, tz).dayNumber + 1
    : 0;
  return {
    total,
    byParticipant: chat.participants
      .map((p) => ({ key: p.key, name: p.displayName, count: counts.get(p.key) ?? 0, share: total ? (counts.get(p.key) ?? 0) / total : 0 }))
      .filter((p) => p.count > 0)
      .sort((a, b) => b.count - a.count),
    firstTs, lastTs, days, activeDays: activeDays.size,
  };
}

export interface TtViewsTotal { count: number; firstTs: number | null; lastTs: number | null; days: number; perDay: number }

export function ttViewsTotal(views: { ts: number }[], tz: string): TtViewsTotal {
  if (!views.length) return { count: 0, firstTs: null, lastTs: null, days: 0, perDay: 0 };
  const firstTs = views[0].ts;
  const lastTs = views[views.length - 1].ts;
  const days = localParts(lastTs, tz).dayNumber - localParts(firstTs, tz).dayNumber + 1;
  return { count: views.length, firstTs, lastTs, days, perDay: views.length / Math.max(days, 1) };
}

export interface TtChatCounts {
  partner: string;
  chatId: string;
  total: number;
  byAuthor: { author: string; isOwner: boolean; text: number; shares: number; other: number; total: number }[];
}

export function ttChatsCounts(acc: TikTokAccount): TtChatCounts[] {
  return acc.chats.map((c) => {
    const by = new Map<string, { text: number; shares: number; other: number }>();
    for (const p of c.participants) by.set(p.key, { text: 0, shares: 0, other: 0 });
    for (const m of c.messages) {
      const row = by.get(m.author) ?? { text: 0, shares: 0, other: 0 };
      if (m.kind === 'tiktok_share') row.shares++;
      else if (m.kind === 'text') row.text++;
      else row.other++;
      by.set(m.author, row);
    }
    return {
      partner: c.title,
      chatId: c.chatId,
      total: c.messages.length,
      byAuthor: [...by.entries()].map(([author, r]) => ({
        author, isOwner: author === acc.owner, ...r, total: r.text + r.shares + r.other,
      })),
    };
  });
}
