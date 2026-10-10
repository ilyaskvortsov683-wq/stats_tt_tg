// Нормализация текста и токенизация. Работает только в браузере/воркере — тексты не уходят на сервер.

const LATIN_TO_CYR: Record<string, string> = {
  a: 'а', e: 'е', o: 'о', p: 'р', c: 'с', x: 'х', y: 'у', k: 'к', m: 'м', t: 'т', b: 'в', h: 'н', u: 'и',
};

const TOKEN_RE = /[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu;
const HAS_CYR = /\p{Script=Cyrillic}/u;
const HAS_LAT = /[a-z]/;

export function normalize(s: string): string {
  return s.toLowerCase().replace(/ё/g, 'е');
}

/** Слова сообщения в нормализованном виде. Смешанные кириллица+латиница («xуй») приводятся к кириллице. */
export function tokenize(s: string): string[] {
  if (!s) return [];
  const out: string[] = [];
  for (const m of normalize(s).matchAll(TOKEN_RE)) {
    let t = m[0];
    if (HAS_CYR.test(t) && HAS_LAT.test(t)) {
      t = t.replace(/[a-z]/g, (ch) => LATIN_TO_CYR[ch] ?? ch);
    }
    out.push(t);
  }
  return out;
}

/** «блять» и «бляяять» → одинаково: повторы букв > 2 сжимаем до двух. */
export function squeeze(token: string): string {
  return token.replace(/(\p{L})\1{2,}/gu, '$1$1');
}

const EMOJI_RE = /\p{Extended_Pictographic}(?:️|‍\p{Extended_Pictographic}|[\u{1F3FB}-\u{1F3FF}])*/gu;

export function extractEmoji(s: string): string[] {
  if (!s) return [];
  return Array.from(s.matchAll(EMOJI_RE), (m) => m[0].replace(/️/g, ''));
}

export const DEFAULT_LAUGH = [
  '(?:а?х+[аеыи]+){2,}х*',
  'а+х+а+[ха]*',
  'лол+',
  'ор+у+',
  'кек+',
  'ха+',
  '(?:h+a+){2,}h*',
];

export function compileWholeTokenPatterns(patterns: string[]): RegExp | null {
  const valid: string[] = [];
  for (const p of patterns) {
    try {
      new RegExp(p, 'u');
      valid.push(`(?:${p})`);
    } catch {
      /* битый паттерн из словаря пропускаем — сервер валидирует при синхронизации */
    }
  }
  return valid.length ? new RegExp(`^(?:${valid.join('|')})$`, 'u') : null;
}

/** Пользовательский шаблон: «росси*», «д*а*», «кот?к». * — любые буквы, ? — одна буква. */
export function wildcardToRegExp(pattern: string): RegExp {
  const norm = normalize(pattern.trim());
  const escaped = norm.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  const body = escaped.replace(/\*/g, '[\\p{L}\\p{N}]*').replace(/\?/g, '[\\p{L}\\p{N}]');
  return new RegExp(`^${body}$`, 'u');
}
