// Разбор файлов в фоне. Файлы и тексты остаются в памяти этого воркера и никуда не отправляются.
import {
  buildChatPacket, isTelegramExport, isTikTokExport, listTelegramChats, mergeViews, parseTelegramChat,
  parseTikTokExport, telegramChats, tgOverview, ttChatsCounts, ttViewsTotal,
  type Chat, type Dictionaries, type RawTgChat, type TikTokAccount,
} from '@stats/parsers';

export type WorkerRequest =
  | { type: 'parseTelegram'; file: File }
  | { type: 'selectTelegramChat'; index: number }
  | { type: 'tgOverview'; tz: string }
  | { type: 'parseTikTok'; files: File[] }
  | { type: 'ttFree'; tz: string }
  | { type: 'historyPayload' }
  | { type: 'buildPacket'; source: 'tg' | 'tt'; chatIndex: number | null; useHistory: boolean; opts: PacketOpts }
  | { type: 'texts'; i0: number; i1: number; source: 'tg' | 'tt'; chatIndex: number | null };

export interface PacketOpts {
  sections: string[];
  tz: string;
  dictionaries?: Dictionaries | null;
  customPatterns?: string[];
  hideNames?: boolean;
  ownerKey?: string;
}

let tgRaw: RawTgChat[] = [];
let tgChat: Chat | null = null;
let tt: TikTokAccount | null = null;
let ttFiles: { name: string; hash: string; views: { ts: number; videoId: string }[] }[] = [];

// Минимальный тип контекста воркера (lib webworker конфликтует с lib dom в одном проекте).
const ctx = self as unknown as {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  onmessage: ((ev: MessageEvent) => void) | null;
};

async function sha256(buf: ArrayBuffer): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function readJson(file: File): Promise<{ obj: unknown; buf: ArrayBuffer }> {
  if (/\.zip$/i.test(file.name)) throw new Error('zip_not_supported_yet');
  const buf = await file.arrayBuffer();
  const text = new TextDecoder('utf-8').decode(buf);
  try {
    return { obj: JSON.parse(text), buf };
  } catch {
    throw new Error('not_json');
  }
}

async function gzip(text: string): Promise<ArrayBuffer> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Response(stream).arrayBuffer();
}

async function handle(req: WorkerRequest): Promise<unknown> {
  switch (req.type) {
    case 'parseTelegram': {
      const { obj } = await readJson(req.file);
      if (!isTelegramExport(obj)) throw new Error('not_telegram');
      tgRaw = telegramChats(obj);
      tgChat = null;
      return { chats: listTelegramChats(obj) };
    }
    case 'selectTelegramChat': {
      tgChat = parseTelegramChat(tgRaw[req.index]);
      return {
        title: tgChat.title, kind: tgChat.kind, chatId: tgChat.chatId, count: tgChat.messages.length,
        participants: tgChat.participants, exporterOffsetMin: tgChat.exporterOffsetMin ?? null,
      };
    }
    case 'tgOverview':
      if (!tgChat) throw new Error('no_chat');
      return tgOverview(tgChat, req.tz);
    case 'parseTikTok': {
      const accounts: TikTokAccount[] = [];
      ttFiles = [];
      for (const f of req.files) {
        const { obj, buf } = await readJson(f);
        if (!isTikTokExport(obj)) throw new Error('not_tiktok:' + f.name);
        const acc = parseTikTokExport(obj);
        accounts.push(acc);
        ttFiles.push({ name: f.name, hash: await sha256(buf), views: acc.views });
      }
      // Основа — выгрузка с самым свежим просмотром: в ней актуальные чаты, лайки и входы.
      accounts.sort((a, b) => (b.views.at(-1)?.ts ?? 0) - (a.views.at(-1)?.ts ?? 0));
      const base = accounts[0];
      tt = { ...base, views: mergeViews(...accounts.map((a) => a.views)) };
      return {
        owner: tt.owner,
        files: ttFiles.map((f) => ({ name: f.name, views: f.views.length, from: f.views[0]?.ts ?? null, to: f.views.at(-1)?.ts ?? null })),
        mergedViews: tt.views.length,
        chats: tt.chats.map((c, index) => ({ index, partner: c.title, count: c.messages.length })),
        unknownSections: tt.unknownSections,
      };
    }
    case 'ttFree':
      if (!tt) throw new Error('no_tiktok');
      return { views: ttViewsTotal(tt.views, req.tz), chats: ttChatsCounts(tt) };
    case 'historyPayload':
      return { files: ttFiles.map((f) => ({ file_hash: f.hash, ts: f.views.map((v) => v.ts), video: f.views.map((v) => v.videoId) })) };
    case 'buildPacket': {
      const opts = { ...req.opts, dictionaries: req.opts.dictionaries ?? undefined };
      const packet = req.source === 'tg'
        ? buildChatPacket(tgChat, opts)
        : buildChatPacket(req.chatIndex !== null && tt ? tt.chats[req.chatIndex] : null, opts, tt ?? undefined, req.useHistory);
      const json = JSON.stringify(packet);
      const body = await gzip(json);
      return { body, rawBytes: json.length, gzBytes: body.byteLength, sections: packet.sections };
    }
    case 'texts': {
      const chat = req.source === 'tg' ? tgChat : req.chatIndex !== null && tt ? tt.chats[req.chatIndex] : null;
      if (!chat) throw new Error('file_not_loaded');
      const names = new Map<string, string>(chat.participants.map((p): [string, string] => [p.key, p.displayName]));
      return chat.messages.slice(req.i0, req.i1 + 1).map((m) => ({ ts: m.ts, author: names.get(m.author) ?? m.author, kind: m.kind, text: m.text }));
    }
  }
}

ctx.onmessage = async (ev: MessageEvent<{ id: number; req: WorkerRequest }>) => {
  const { id, req } = ev.data;
  try {
    const result = await handle(req);
    const transfer = result && typeof result === 'object' && 'body' in result && (result as { body: unknown }).body instanceof ArrayBuffer
      ? [(result as { body: ArrayBuffer }).body] : [];
    ctx.postMessage({ id, ok: true, result }, transfer);
  } catch (e) {
    ctx.postMessage({ id, ok: false, error: e instanceof Error ? e.message : String(e) });
  }
};
