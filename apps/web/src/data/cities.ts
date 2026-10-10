// Город → часовой пояс. Время в отчёте показывается в поясе пользователя.

export interface City { name: string; tz: string }

export const CITIES: City[] = [
  { name: 'Москва', tz: 'Europe/Moscow' },
  { name: 'Санкт-Петербург', tz: 'Europe/Moscow' },
  { name: 'Калининград', tz: 'Europe/Kaliningrad' },
  { name: 'Казань', tz: 'Europe/Moscow' },
  { name: 'Нижний Новгород', tz: 'Europe/Moscow' },
  { name: 'Ростов-на-Дону', tz: 'Europe/Moscow' },
  { name: 'Краснодар', tz: 'Europe/Moscow' },
  { name: 'Воронеж', tz: 'Europe/Moscow' },
  { name: 'Самара', tz: 'Europe/Samara' },
  { name: 'Ижевск', tz: 'Europe/Samara' },
  { name: 'Волгоград', tz: 'Europe/Volgograd' },
  { name: 'Саратов', tz: 'Europe/Saratov' },
  { name: 'Ульяновск', tz: 'Europe/Ulyanovsk' },
  { name: 'Астрахань', tz: 'Europe/Astrakhan' },
  { name: 'Екатеринбург', tz: 'Asia/Yekaterinburg' },
  { name: 'Пермь', tz: 'Asia/Yekaterinburg' },
  { name: 'Уфа', tz: 'Asia/Yekaterinburg' },
  { name: 'Челябинск', tz: 'Asia/Yekaterinburg' },
  { name: 'Тюмень', tz: 'Asia/Yekaterinburg' },
  { name: 'Омск', tz: 'Asia/Omsk' },
  { name: 'Новосибирск', tz: 'Asia/Novosibirsk' },
  { name: 'Томск', tz: 'Asia/Tomsk' },
  { name: 'Барнаул', tz: 'Asia/Barnaul' },
  { name: 'Кемерово', tz: 'Asia/Novokuznetsk' },
  { name: 'Красноярск', tz: 'Asia/Krasnoyarsk' },
  { name: 'Иркутск', tz: 'Asia/Irkutsk' },
  { name: 'Чита', tz: 'Asia/Chita' },
  { name: 'Якутск', tz: 'Asia/Yakutsk' },
  { name: 'Хабаровск', tz: 'Asia/Vladivostok' },
  { name: 'Владивосток', tz: 'Asia/Vladivostok' },
  { name: 'Южно-Сахалинск', tz: 'Asia/Sakhalin' },
  { name: 'Магадан', tz: 'Asia/Magadan' },
  { name: 'Петропавловск-Камчатский', tz: 'Asia/Kamchatka' },
  { name: 'Минск', tz: 'Europe/Minsk' },
  { name: 'Киев', tz: 'Europe/Kyiv' },
  { name: 'Кишинёв', tz: 'Europe/Chisinau' },
  { name: 'Рига', tz: 'Europe/Riga' },
  { name: 'Вильнюс', tz: 'Europe/Vilnius' },
  { name: 'Таллин', tz: 'Europe/Tallinn' },
  { name: 'Алматы', tz: 'Asia/Almaty' },
  { name: 'Астана', tz: 'Asia/Almaty' },
  { name: 'Ташкент', tz: 'Asia/Tashkent' },
  { name: 'Бишкек', tz: 'Asia/Bishkek' },
  { name: 'Душанбе', tz: 'Asia/Dushanbe' },
  { name: 'Ереван', tz: 'Asia/Yerevan' },
  { name: 'Тбилиси', tz: 'Asia/Tbilisi' },
  { name: 'Баку', tz: 'Asia/Baku' },
  { name: 'Стамбул', tz: 'Europe/Istanbul' },
  { name: 'Дубай', tz: 'Asia/Dubai' },
  { name: 'Берлин', tz: 'Europe/Berlin' },
  { name: 'Лондон', tz: 'Europe/London' },
  { name: 'Бангкок', tz: 'Asia/Bangkok' },
  { name: 'Нью-Йорк', tz: 'America/New_York' },
  { name: 'Лос-Анджелес', tz: 'America/Los_Angeles' },
];

/** Текущее смещение пояса от UTC в минутах. */
export function offsetMinutes(tz: string, at = Date.now()): number {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    }).formatToParts(new Date(at));
    const g = (t: string) => Number(parts.find((p) => p.type === t)?.value);
    const asUtc = Date.UTC(g('year'), g('month') - 1, g('day'), g('hour'), g('minute'));
    return Math.round((asUtc - Math.floor(at / 60000) * 60000) / 60000);
  } catch {
    return 0;
  }
}

export function formatOffset(min: number): string {
  const sign = min >= 0 ? '+' : '−';
  const a = Math.abs(min);
  return `UTC${sign}${Math.floor(a / 60)}${a % 60 ? ':' + String(a % 60).padStart(2, '0') : ''}`;
}

export function cityForTz(tz: string): City | undefined {
  return CITIES.find((c) => c.tz === tz);
}
