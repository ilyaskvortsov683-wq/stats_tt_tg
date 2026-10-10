// Парсер выгрузки TikTok «Download your data» (JSON). Формат: docs/03-data-formats.md §2.
// Время в выгрузке TikTok — UTC.
import type { Chat, Message, TikTokAccount, TikTokView } from './types';

type Obj = Record<string, unknown>;

/** Поиск ключа без учёта регистра и пробелов среди нескольких вариантов названия. */
function pick(obj: unknown, ...candidates: string[]): unknown {
  if (!obj || typeof obj !== 'object') return undefined;
  const o = obj as Obj;
  const norm = (s: string) => s.toLowerCase().replace(/[\s_]+/g, '');
  const wanted = candidates.map(norm);
  for (const k of Object.keys(o)) {
    if (wanted.includes(norm(k))) return o[k];
  }
  return undefined;
}

function list(obj: unknown, ...candidates: string[]): Obj[] {
  const v = pick(obj, ...candidates);
  return Array.isArray(v) ? (v as Obj[]) : [];
}

/** «2025-03-01 21:14:05» в UTC → unix-секунды. */
export function parseTikTokDate(s: unknown): number | null {
  if (typeof s !== 'string') return null;
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
  if (!m) return null;
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) / 1000;
}

export function videoIdOf(link: unknown): string {
  if (typeof link !== 'string') return 'none';
  const m = link.match(/\/video\/(\d+)/) ?? link.match(/[?&]item_id=(\d+)/);
  if (m) return m[1];
  let h = 2166136261;
  for (let i = 0; i < link.length; i++) h = Math.imul(h ^ link.charCodeAt(i), 16777619);
  return 'h' + (h >>> 0).toString(16);
}

const dateOf = (o: Obj) => parseTikTokDate(pick(o, 'Date', 'date', 'Time'));
const tsList = (items: Obj[]) => items.map(dateOf).filter((x): x is number => x !== null).sort((a, b) => a - b);

export function isTikTokExport(obj: unknown): boolean {
  return !!(pick(obj, 'Your Activity', 'Activity') || pick(obj, 'Direct Message', 'Direct Messages') || pick(obj, 'Profile'));
}

const KNOWN_ROOT = ['youractivity', 'activity', 'directmessage', 'directmessages', 'profile', 'profileandsettings'];

export function parseTikTokExport(obj: unknown): TikTokAccount {
  const root = obj as Obj;
  const profile = pick(root, 'Profile', 'Profile And Settings');
  const profileMap = pick(pick(profile, 'Profile Info', 'Profile Information'), 'ProfileMap', 'Profile Map');
  const owner = String(pick(profileMap, 'userName', 'username', 'User Name') ?? 'me');

  const activity = pick(root, 'Your Activity', 'Activity');
  const watch = list(pick(activity, 'Watch History', 'Video Browsing History', 'Browsing History'), 'VideoList', 'Video List');
  const views: TikTokView[] = [];
  for (const v of watch) {
    const ts = dateOf(v);
    if (ts === null) continue;
    views.push({ ts, videoId: videoIdOf(pick(v, 'Link', 'link', 'VideoLink')) });
  }
  views.sort((a, b) => a.ts - b.ts);

  const likes = tsList(list(pick(activity, 'Like List', 'Likes', 'Liked Videos'), 'ItemFavoriteList', 'ItemLikeList', 'VideoList'));
  const favorites = tsList(list(pick(activity, 'Favorite Videos', 'Favorites'), 'FavoriteVideoList', 'VideoList'));
  const collections = tsList(list(pick(activity, 'Favorite Collection', 'Favorite Collections'), 'FavoriteCollectionList'));
  const logins = tsList(list(pick(activity, 'Login History'), 'LoginHistoryList'));

  const dmRoot = pick(root, 'Direct Message', 'Direct Messages');
  const history = pick(pick(dmRoot, 'Direct Messages', 'Direct Message'), 'ChatHistory', 'Chat History') as Obj | undefined;
  const chats: Chat[] = [];
  if (history && typeof history === 'object') {
    for (const [key, raw] of Object.entries(history)) {
      if (!Array.isArray(raw)) continue;
      const partner = key.replace(/^chat history with\s*/i, '').replace(/:\s*$/, '').trim() || key;
      chats.push(parseTikTokChat(owner, partner, raw as Obj[]));
    }
  }
  chats.sort((a, b) => b.messages.length - a.messages.length);

  const unknownSections = Object.keys(root).filter((k) => !KNOWN_ROOT.includes(k.toLowerCase().replace(/[\s_]+/g, '')));
  return { owner, views, likes, favorites, collections, logins, chats, unknownSections };
}

function parseTikTokChat(owner: string, partner: string, raw: Obj[]): Chat {
  const messages: Message[] = [];
  const authors = new Map<string, number>();
  raw.forEach((m, i) => {
    const ts = dateOf(m);
    if (ts === null) return;
    const author = String(pick(m, 'From', 'from', 'Sender') ?? 'unknown');
    const content = String(pick(m, 'Content', 'content', 'Message') ?? '');
    const t = content.trim();
    const isLink = /^https?:\/\//i.test(t);
    const kind = isLink ? (/tiktok/i.test(t) ? 'tiktok_share' : 'link') : t ? 'text' : 'other';
    authors.set(author, (authors.get(author) ?? 0) + 1);
    messages.push({ id: i, ts, author, kind, text: content });
  });
  messages.sort((a, b) => a.ts - b.ts || a.id - b.id);
  if (!authors.has(owner)) authors.set(owner, 0);
  if (!authors.has(partner)) authors.set(partner, 0);
  const participants = [...authors.keys()]
    .sort((a, b) => (a === owner ? -1 : b === owner ? 1 : (authors.get(b)! - authors.get(a)!)))
    .map((key) => ({ key, displayName: key, isOwner: key === owner }));
  return {
    source: 'tt',
    chatId: `${owner}:${partner}`,
    kind: participants.length > 2 ? 'group' : 'personal',
    title: partner,
    participants,
    messages,
    events: [],
  };
}

/** Склейка нескольких выгрузок: дедупликация по паре (время, видео) — повторные просмотры сохраняются. */
export function mergeViews(...lists: TikTokView[][]): TikTokView[] {
  const seen = new Set<string>();
  const out: TikTokView[] = [];
  for (const l of lists) {
    for (const v of l) {
      const key = v.ts + ':' + v.videoId;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(v);
    }
  }
  return out.sort((a, b) => a.ts - b.ts);
}
