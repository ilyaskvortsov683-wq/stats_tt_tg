// Парсер экспорта Telegram Desktop (JSON). Формат: docs/03-data-formats.md §1.
import type { Chat, Message, MessageKind, Participant, Reaction, ServiceAction, ServiceEvent } from './types';

interface RawEntity { type?: string; text?: string }
type RawText = string | Array<string | RawEntity>;

interface RawReaction {
  type?: string;
  count?: number;
  emoji?: string;
  document_id?: string;
  recent?: { from?: string | null; from_id?: string }[];
}

export interface RawTgMessage {
  id: number;
  type: string;
  date?: string;
  date_unixtime?: string;
  from?: string | null;
  from_id?: string;
  actor?: string | null;
  actor_id?: string;
  action?: string;
  title?: string;
  members?: (string | null)[];
  text?: RawText;
  text_entities?: RawEntity[];
  media_type?: string;
  photo?: string;
  file?: string;
  duration_seconds?: number;
  sticker_emoji?: string;
  forwarded_from?: string | null;
  reply_to_message_id?: number;
  reactions?: RawReaction[];
  poll?: unknown;
  location_information?: unknown;
  contact_information?: unknown;
}

export interface RawTgChat {
  name?: string | null;
  type?: string;
  id?: number | string;
  messages?: RawTgMessage[];
}

export interface TgChatListItem { index: number; name: string; type: string; count: number }

export function isTelegramExport(obj: unknown): boolean {
  if (!obj || typeof obj !== 'object') return false;
  const o = obj as Record<string, unknown>;
  if (Array.isArray(o.messages)) return true;
  const chats = o.chats as { list?: unknown } | undefined;
  return !!chats && Array.isArray(chats.list);
}

/** Одиночный чат → список из одного элемента; полный экспорт → все чаты. */
export function telegramChats(obj: unknown): RawTgChat[] {
  const o = obj as Record<string, unknown>;
  if (Array.isArray(o.messages)) return [o as RawTgChat];
  const list = (o.chats as { list?: RawTgChat[] }).list ?? [];
  return list.filter((c) => Array.isArray(c.messages));
}

export function listTelegramChats(obj: unknown): TgChatListItem[] {
  return telegramChats(obj).map((c, index) => ({
    index,
    name: c.name ?? 'Без названия',
    type: c.type ?? 'unknown',
    count: (c.messages ?? []).filter((m) => m.type === 'message').length,
  }));
}

export function textOf(m: RawTgMessage): string {
  if (Array.isArray(m.text_entities)) return m.text_entities.map((e) => e.text ?? '').join('');
  if (typeof m.text === 'string') return m.text;
  if (Array.isArray(m.text)) return m.text.map((p) => (typeof p === 'string' ? p : p.text ?? '')).join('');
  return '';
}

function kindOf(m: RawTgMessage, text: string): MessageKind {
  switch (m.media_type) {
    case 'voice_message': return 'voice';
    case 'video_message': return 'video_note';
    case 'sticker': return 'sticker';
    case 'animation': return 'gif';
    case 'video_file': return 'video';
    case 'audio_file': return 'audio';
  }
  if (m.photo) return 'photo';
  if (m.file) return 'file';
  if (m.poll) return 'poll';
  if (m.location_information) return 'location';
  if (m.contact_information) return 'contact';
  const t = text.trim();
  if (/^https?:\/\/\S+$/i.test(t)) return 'link';
  return t ? 'text' : 'other';
}

function tsOf(m: RawTgMessage): number {
  if (m.date_unixtime) return Number(m.date_unixtime);
  // Старые экспорты без date_unixtime: считаем время UTC (погрешность — пояс экспортирующего).
  return m.date ? Math.floor(Date.parse(m.date + 'Z') / 1000) : 0;
}

const ACTIONS: Record<string, ServiceAction> = {
  edit_group_title: 'title',
  create_group: 'title',
  invite_members: 'invite',
  remove_members: 'remove',
  join_group_by_link: 'join_link',
  join_group_by_request: 'join_link',
  phone_call: 'call',
  group_call: 'call',
  pin_message: 'pin',
};

export function parseTelegramChat(raw: RawTgChat): Chat {
  const names = new Map<string, string>();
  const counts = new Map<string, number>();
  const messages: Message[] = [];
  const events: ServiceEvent[] = [];
  let exporterOffsetMin: number | undefined;

  const keyOf = (id: string | undefined, name: string | null | undefined) => {
    const key = id || (name ? 'name:' + name : 'unknown');
    if (name) names.set(key, name);
    else if (!names.has(key)) names.set(key, 'Удалённый аккаунт');
    return key;
  };

  for (const m of raw.messages ?? []) {
    const ts = tsOf(m);
    if (exporterOffsetMin === undefined && m.date && m.date_unixtime) {
      const naive = Date.parse(m.date + 'Z') / 1000;
      exporterOffsetMin = Math.round((naive - Number(m.date_unixtime)) / 60 / 15) * 15;
    }
    if (m.type === 'service') {
      const action = ACTIONS[m.action ?? ''] ?? 'other';
      const actor = m.actor_id || m.actor ? keyOf(m.actor_id, m.actor) : undefined;
      events.push({
        ts, actor, action,
        title: action === 'title' ? m.title : undefined,
        members: m.members?.filter((x): x is string => !!x),
        durationSec: m.duration_seconds,
      });
      continue;
    }
    if (m.type !== 'message') continue;
    const author = keyOf(m.from_id, m.from);
    counts.set(author, (counts.get(author) ?? 0) + 1);
    const text = textOf(m);
    const reactions: Reaction[] | undefined = m.reactions?.map((r) => ({
      emoji: r.emoji ?? (r.document_id ? 'custom:' + r.document_id : '?'),
      count: r.count ?? 0,
      by: (r.recent ?? []).map((x) => keyOf(x.from_id, x.from)),
    }));
    messages.push({
      id: m.id,
      ts,
      author,
      kind: kindOf(m, text),
      text,
      durationSec: m.duration_seconds,
      forwardedFrom: m.forwarded_from ?? undefined,
      replyTo: m.reply_to_message_id,
      stickerEmoji: m.sticker_emoji,
      stickerId: m.media_type === 'sticker' && m.file ? m.file.split('/').pop() : undefined,
      reactions,
    });
  }

  messages.sort((a, b) => a.ts - b.ts || a.id - b.id);
  events.sort((a, b) => a.ts - b.ts);

  const participants: Participant[] = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([key]) => ({ key, displayName: names.get(key) ?? key, isOwner: false }));

  const type = raw.type ?? '';
  const isGroup = /group|supergroup|channel/.test(type) || participants.length > 2;

  return {
    source: 'tg',
    chatId: String(raw.id ?? raw.name ?? 'chat'),
    kind: isGroup ? 'group' : 'personal',
    title: raw.name ?? 'Без названия',
    participants,
    messages,
    events,
    exporterOffsetMin,
  };
}
