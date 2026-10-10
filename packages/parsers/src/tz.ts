// Работа с часовыми поясами. Все ts — настоящее UTC-время; отображаем в поясе пользователя.

const fmtCache = new Map<string, Intl.DateTimeFormat>();
const offsetCache = new Map<string, number>();

function formatter(tz: string): Intl.DateTimeFormat {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
    fmtCache.set(tz, f);
  }
  return f;
}

/** Смещение пояса tz от UTC в секундах для момента ts (кешируется по часам). */
export function offsetSeconds(ts: number, tz: string): number {
  const hour = Math.floor(ts / 3600);
  const key = tz + ':' + hour;
  const cached = offsetCache.get(key);
  if (cached !== undefined) return cached;
  const at = hour * 3600;
  const parts = formatter(tz).formatToParts(new Date(at * 1000));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second')) / 1000;
  const off = asUtc - at;
  if (offsetCache.size > 200_000) offsetCache.clear();
  offsetCache.set(key, off);
  return off;
}

export interface LocalParts {
  dayNumber: number;   // дней с 1970-01-01 по местному времени
  dayKey: string;      // YYYY-MM-DD
  monthKey: string;    // YYYY-MM
  hour: number;
  weekday: number;     // 0 = понедельник
}

export function localParts(ts: number, tz: string): LocalParts {
  const local = ts + offsetSeconds(ts, tz);
  const dayNumber = Math.floor(local / 86400);
  const d = new Date(dayNumber * 86400 * 1000);
  const dayKey = d.toISOString().slice(0, 10);
  return {
    dayNumber,
    dayKey,
    monthKey: dayKey.slice(0, 7),
    hour: Math.floor((local - dayNumber * 86400) / 3600),
    weekday: (dayNumber + 3) % 7,
  };
}

export function browserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Moscow';
  } catch {
    return 'Europe/Moscow';
  }
}
