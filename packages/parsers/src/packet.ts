// Сборщик обезличенного пакета агрегатов (packet.v1). Контракт: docs/05-aggregate-packet.md.
// В пакет НИКОГДА не попадают тексты сообщений. Тест test/packet.test.ts проверяет это «ядовитой» строкой.
import { extractEmoji, compileWholeTokenPatterns, DEFAULT_LAUGH, squeeze, tokenize, wildcardToRegExp } from './text';
import { localParts } from './tz';
import { KINDS, type Chat, type Dictionaries, type TikTokAccount } from './types';

export interface PacketV1 {
  schema: 'packet.v1';
  source: 'tg' | 'tt';
  chat_kind: 'personal' | 'group' | 'account';
  chat_key: string;
  title: string;
  sections: string[];
  tz: string;
  hide_names: boolean;
  participants: { key: string; name: string; is_owner: boolean }[];
  kinds: string[];
  stream: {
    ts: number[]; author: number[]; kind: number[];
    dur: (number | null)[]; fwd: (number | null)[]; words: number[]; laugh: number[];
  };
  forward_sources: string[];
  words?: {
    by_month: Record<string, Record<string, [string, number][]>>;
    custom_patterns: string[];
    custom_hits: [number, number][];
    mask_words: Record<string, [string, number][]>;
  };
  laugh_forms?: [string, number][];
  swear_hits?: [number, string][];
  swear_labels?: Record<string, string>;
  name_hits?: [number, string][];
  name_labels?: Record<string, string>;
  reactions?: { on_msg: [number, string, number][]; who: [number, number, string][] };
  emoji_hits?: [number, string, number][];
  sticker_hits?: [number, string][];
  events?: { ts: number; actor: number | null; action: string; title?: string; count?: number; dur?: number }[];
  tt?: {
    owner: string;
    use_history: boolean;
    views?: { ts: number[]; video: string[] };
    likes: number[]; favorites: number[]; collections: number[]; logins: number[];
  };
  dict_versions?: Record<string, string>;
  client: { app_version: string; parser_version: string; build_ms: number };
}

export interface BuildOptions {
  sections: string[];
  tz: string;
  dictionaries?: Dictionaries;
  customPatterns?: string[];   // свои слова и маски (до 20)
  hideNames?: boolean;
  ownerKey?: string;           // «Кто из них вы?»
  appVersion?: string;
}

const TOP_WORDS_PER_MONTH = 100;
const has = (o: BuildOptions, s: string) => o.sections.includes(s);

function topN(map: Map<string, number>, n: number): [string, number][] {
  return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
}

/** Пакет для Telegram-чата или выбранного чата TikTok (stream = сообщения чата). */
export function buildChatPacket(chat: Chat | null, opts: BuildOptions, account?: TikTokAccount, useHistory = false): PacketV1 {
  const started = Date.now();
  const source = account ? 'tt' : 'tg';
  const msgs = chat?.messages ?? [];

  // Порядок участников: владелец первым, затем по активности.
  const parts = [...(chat?.participants ?? [])].map((p) => ({ ...p, isOwner: p.isOwner || p.key === opts.ownerKey }));
  parts.sort((a, b) => Number(b.isOwner) - Number(a.isOwner));
  const pIndex = new Map<string, number>(parts.map((p, i): [string, number] => [p.key, i]));
  const letter = (i: number) => 'Участник ' + String.fromCharCode(65 + (i % 26)) + (i >= 26 ? Math.floor(i / 26) : '');

  const kindIndex = new Map<string, number>(KINDS.map((k, i): [string, number] => [k, i]));
  const fwdSources: string[] = [];
  const fwdIndex = new Map<string, number>();

  const dict = opts.dictionaries;
  const stop = new Set(dict?.stopwords ?? []);
  const laughRe = compileWholeTokenPatterns(dict?.laugh?.length ? dict.laugh : DEFAULT_LAUGH);
  const swearExc = new Set(dict?.swear.exceptions ?? []);
  const swearPatterns = (dict?.swear.patterns ?? []).flatMap((p) => {
    try { return [{ id: p.id, re: new RegExp(p.re, 'u') }]; } catch { return []; }
  });
  const custom = (opts.customPatterns ?? []).slice(0, 20).filter((p) => p.trim());
  const customRe = custom.map(wildcardToRegExp);

  const stream: PacketV1['stream'] = { ts: [], author: [], kind: [], dur: [], fwd: [], words: [], laugh: [] };
  const byMonth = new Map<string, Map<number, Map<string, number>>>();
  const laughForms = new Map<string, number>();
  const swearHits: [number, string][] = [];
  const nameHits: [number, string][] = [];
  const customHits: [number, number][] = [];
  const maskWords = custom.map(() => new Map<string, number>());
  const reactionsOnMsg: [number, string, number][] = [];
  const reactionsWho: [number, number, string][] = [];
  const emojiHits: [number, string, number][] = [];
  const stickerHits: [number, string][] = [];

  const wantWords = has(opts, 'tg.words');
  const wantSwear = has(opts, 'tg.laugh_swear') && !!dict;
  const wantNames = has(opts, 'tg.names') && !!dict;
  const wantReactions = has(opts, 'tg.reactions') || has(opts, 'tt.emoji');

  msgs.forEach((m, i) => {
    const p = pIndex.get(m.author) ?? 0;
    stream.ts.push(m.ts);
    stream.author.push(p);
    stream.kind.push(kindIndex.get(m.kind) ?? kindIndex.get('other')!);
    stream.dur.push(m.durationSec ?? null);
    let fwd: number | null = null;
    if (m.forwardedFrom) {
      fwd = fwdIndex.get(m.forwardedFrom) ?? null;
      if (fwd === null) { fwd = fwdSources.length; fwdSources.push(m.forwardedFrom); fwdIndex.set(m.forwardedFrom, fwd); }
    }
    stream.fwd.push(fwd);

    const own = !m.forwardedFrom && m.kind !== 'tiktok_share' && m.kind !== 'link';
    const tokens = own ? tokenize(m.text) : [];
    stream.words.push(tokens.length);

    let laughed = 0;
    for (const t of tokens) {
      const sq = squeeze(t);
      if (laughRe && (laughRe.test(t) || laughRe.test(sq))) {
        laughed = 1;
        laughForms.set(sq, (laughForms.get(sq) ?? 0) + 1);
        continue;
      }
      if (wantSwear && !swearExc.has(t) && !swearExc.has(sq)) {
        const id = dict!.swear.words[t] ?? dict!.swear.words[sq] ?? swearPatterns.find((sp) => sp.re.test(t) || sp.re.test(sq))?.id;
        if (id) swearHits.push([i, id]);
      }
      if (wantNames) {
        const id = dict!.names.forms[t];
        if (id) nameHits.push([i, id]);
      }
      if (custom.length) {
        customRe.forEach((re, k) => {
          if (re.test(t)) { customHits.push([i, k]); maskWords[k].set(t, (maskWords[k].get(t) ?? 0) + 1); }
        });
      }
      if (wantWords && t.length >= 3 && !stop.has(t) && !/^\d+$/.test(t)) {
        const month = localParts(m.ts, opts.tz).monthKey;
        let mm = byMonth.get(month);
        if (!mm) { mm = new Map(); byMonth.set(month, mm); }
        let pm = mm.get(p);
        if (!pm) { pm = new Map(); mm.set(p, pm); }
        pm.set(t, (pm.get(t) ?? 0) + 1);
      }
    }
    stream.laugh.push(laughed);

    if (wantReactions) {
      for (const r of m.reactions ?? []) {
        reactionsOnMsg.push([i, r.emoji, r.count]);
        for (const who of r.by) {
          const wi = pIndex.get(who);
          if (wi !== undefined) reactionsWho.push([i, wi, r.emoji]);
        }
      }
      if (own) {
        const em = new Map<string, number>();
        for (const e of extractEmoji(m.text)) em.set(e, (em.get(e) ?? 0) + 1);
        for (const [e, n] of em) emojiHits.push([i, e, n]);
      }
      if (m.kind === 'sticker') stickerHits.push([i, (m.stickerEmoji ?? '·') + (m.stickerId ? '#' + m.stickerId.slice(-8) : '')]);
    }
  });

  const packet: PacketV1 = {
    schema: 'packet.v1',
    source,
    chat_kind: account && !chat ? 'account' : chat?.kind ?? 'personal',
    chat_key: account ? (chat ? chat.chatId : account.owner) : chat?.chatId ?? 'none',
    title: opts.hideNames ? 'Чат' : chat?.title ?? (account ? 'TikTok @' + account.owner : 'Чат'),
    sections: opts.sections,
    tz: opts.tz,
    hide_names: !!opts.hideNames,
    participants: parts.map((p, i) => ({ key: 'p' + i, name: opts.hideNames ? letter(i) : p.displayName, is_owner: p.isOwner })),
    kinds: [...KINDS],
    stream,
    forward_sources: fwdSources,
    client: { app_version: opts.appVersion ?? '0.1.0', parser_version: 'parsers-0.1', build_ms: 0 },
  };

  if (wantWords || custom.length) {
    const by_month: Record<string, Record<string, [string, number][]>> = {};
    for (const [month, mm] of byMonth) {
      by_month[month] = {};
      for (const [p, words] of mm) by_month[month]['p' + p] = topN(words, TOP_WORDS_PER_MONTH);
    }
    packet.words = {
      by_month,
      custom_patterns: custom,
      custom_hits: customHits,
      mask_words: Object.fromEntries(maskWords.map((m, k) => [String(k), topN(m, 30)])),
    };
  }
  if (has(opts, 'tg.laugh_swear')) {
    packet.laugh_forms = topN(laughForms, 30);
    packet.swear_hits = swearHits;
    packet.swear_labels = dict?.swear.labels ?? {};
  }
  if (wantNames) {
    packet.name_hits = nameHits;
    packet.name_labels = dict!.names.labels;
  }
  if (wantReactions) {
    packet.reactions = { on_msg: reactionsOnMsg, who: reactionsWho };
    packet.emoji_hits = emojiHits;
    packet.sticker_hits = stickerHits;
  }
  if (chat && (has(opts, 'tg.group_life') || has(opts, 'tg.media'))) {
    packet.events = chat.events.map((e) => ({
      ts: e.ts,
      actor: e.actor !== undefined ? pIndex.get(e.actor) ?? null : null,
      action: e.action,
      title: e.action === 'title' && !opts.hideNames ? e.title : undefined,
      count: e.members?.length,
      dur: e.durationSec,
    }));
  }
  if (account) {
    packet.tt = {
      owner: opts.hideNames ? 'вы' : account.owner,
      use_history: useHistory,
      views: useHistory ? undefined : { ts: account.views.map((v) => v.ts), video: account.views.map((v) => v.videoId) },
      likes: account.likes,
      favorites: account.favorites,
      collections: account.collections,
      logins: account.logins,
    };
  }
  if (dict) packet.dict_versions = { all: dict.version };
  packet.client.build_ms = Date.now() - started;
  return packet;
}
