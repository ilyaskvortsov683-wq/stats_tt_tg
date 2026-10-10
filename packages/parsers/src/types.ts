// Нормализованная модель данных — общая для Telegram и TikTok.
// Python-зеркало: apps/api/app/parsers/model.py. Описание: docs/03-data-formats.md.
// ВАЖНО: поле text живёт только в памяти браузера (воркера) и никогда не попадает в пакет.

export type Source = 'tg' | 'tt';

export const KINDS = [
  'text', 'voice', 'video_note', 'photo', 'video', 'sticker', 'gif', 'file', 'audio',
  'tiktok_share', 'link', 'poll', 'location', 'contact', 'other',
] as const;
export type MessageKind = (typeof KINDS)[number];

export interface Participant {
  key: string;            // стабильный ключ: from_id в Telegram, username в TikTok
  displayName: string;
  isOwner: boolean;
}

export interface Reaction {
  emoji: string;
  count: number;
  by: string[];           // ключи участников из recent (неполный список!)
}

export interface Message {
  id: number;
  ts: number;             // настоящее UTC unix-время, секунды
  author: string;         // Participant.key
  kind: MessageKind;
  text: string;           // только в памяти
  durationSec?: number;
  forwardedFrom?: string;
  replyTo?: number;
  stickerEmoji?: string;
  stickerId?: string;
  reactions?: Reaction[];
}

export type ServiceAction = 'title' | 'invite' | 'remove' | 'join_link' | 'call' | 'pin' | 'other';

export interface ServiceEvent {
  ts: number;
  actor?: string;
  action: ServiceAction;
  title?: string;
  members?: string[];
  durationSec?: number;
}

export interface Chat {
  source: Source;
  chatId: string;
  kind: 'personal' | 'group';
  title: string;
  participants: Participant[];
  messages: Message[];    // отсортированы по ts
  events: ServiceEvent[];
  /** Смещение часового пояса того, кто делал экспорт (Telegram), минуты. Подсказка для выбора города. */
  exporterOffsetMin?: number;
}

export interface TikTokView {
  ts: number;             // UTC
  videoId: string;
}

export interface TikTokAccount {
  owner: string;
  views: TikTokView[];
  likes: number[];
  favorites: number[];
  collections: number[];
  logins: number[];       // только время; IP и устройство не читаем
  chats: Chat[];
  unknownSections: string[];
}

export interface Dictionaries {
  version: string;
  swear: {
    words: Record<string, string>;            // словоформа -> id группы
    patterns: { id: string; re: string }[];   // регулярки по корню
    exceptions: string[];
    labels: Record<string, string>;           // id -> подпись с маской
  };
  names: {
    forms: Record<string, string>;            // словоформа -> id имени
    labels: Record<string, string>;
  };
  laugh: string[];                            // регулярки целого токена
  stopwords: string[];
}
