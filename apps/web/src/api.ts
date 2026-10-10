// Клиент API. Сессия — httpOnly-cookie, для изменяющих запросов — заголовок X-CSRF-Token из cookie csrf.

export class ApiError extends Error {
  constructor(public status: number, public code: string, public requestId?: string) {
    super(code);
  }
}

function csrf(): string {
  const m = document.cookie.match(/(?:^|;\s*)csrf=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : '';
}

export async function api<T = unknown>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const headers = new Headers(init.headers);
  const method = (init.method ?? (init.json !== undefined ? 'POST' : 'GET')).toUpperCase();
  if (method !== 'GET') headers.set('X-CSRF-Token', csrf());
  let body = init.body;
  if (init.json !== undefined) {
    headers.set('Content-Type', 'application/json');
    body = JSON.stringify(init.json);
  }
  const res = await fetch('/api/v1' + path, { ...init, method, headers, body, credentials: 'include' });
  if (!res.ok) {
    let code = 'http_' + res.status;
    try {
      const data = await res.json();
      code = typeof data.detail === 'string' ? data.detail : data.error?.code ?? code;
    } catch { /* тело не JSON */ }
    throw new ApiError(res.status, code, res.headers.get('X-Request-Id') ?? undefined);
  }
  const ct = res.headers.get('content-type') ?? '';
  return (ct.includes('application/json') ? res.json() : res.text()) as Promise<T>;
}

/** Человеческие тексты ошибок. */
export function errorText(e: unknown): string {
  const code = e instanceof ApiError ? e.code : String(e);
  const map: Record<string, string> = {
    no_runs_left: 'Разборы закончились — пополните баланс или введите промокод.',
    promo_unavailable: 'Код не найден или недоступен.',
    not_authenticated: 'Нужно войти в аккаунт.',
    packet_invalid: 'Не удалось подготовить данные. Разбор не списан — попробуйте ещё раз.',
    packet_too_large: 'Слишком большой чат для одного разбора. Напишите нам — поможем.',
    consent_required: 'Нужно согласие на хранение истории просмотров.',
    payments_not_configured: 'Оплата временно недоступна.',
  };
  const rid = e instanceof ApiError && e.requestId ? ` (код: ${e.requestId})` : '';
  return (map[code] ?? 'Что-то пошло не так') + rid;
}

/** События для журнала. НИКАКИХ текстов, имён и названий чатов — только счётчики и корзины размеров. */
export function track(type: string, data: Record<string, unknown> = {}): void {
  void fetch('/api/v1/logs/client', {
    method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ events: [{ type, data }] }),
  }).catch(() => undefined);
}

export function sizeBucket(bytes: number): string {
  const mb = bytes / 1024 / 1024;
  return mb < 1 ? '<1MB' : mb < 10 ? '1-10MB' : mb < 50 ? '10-50MB' : mb < 200 ? '50-200MB' : '>200MB';
}

export function countBucket(n: number): string {
  return n < 1000 ? '<1k' : n < 10_000 ? '1k-10k' : n < 100_000 ? '10k-100k' : n < 500_000 ? '100k-500k' : '>500k';
}

export interface Me {
  user_ref: string;
  email: string | null;
  name: string | null;
  avatar_url: string | null;
  role: 'user' | 'admin';
  balance: number;
  tz: string;
  city: string | null;
  settings: Record<string, unknown>;
  consents: Record<string, unknown>;
  telegram_linked: boolean;
  tt_history: { views: number; files: number; min_ts: number | null; max_ts: number | null } | null;
}
