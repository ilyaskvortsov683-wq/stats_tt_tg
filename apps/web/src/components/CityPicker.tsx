import { useMemo } from 'react';
import { CITIES, formatOffset, offsetMinutes } from '../data/cities';

/** Выбор города → часового пояса. Подсказка: пояс браузера и пояс, в котором делали экспорт Telegram. */
export function CityPicker({ tz, onChange, exporterOffsetMin }: { tz: string; onChange: (tz: string, city: string) => void; exporterOffsetMin?: number | null }) {
  const allZones = useMemo(() => {
    try {
      return (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.('timeZone') ?? [];
    } catch {
      return [];
    }
  }, []);
  const current = CITIES.find((c) => c.tz === tz);
  const offset = offsetMinutes(tz);
  const mismatch = exporterOffsetMin != null && exporterOffsetMin !== offset;

  return (
    <div className="city-picker">
      <label className="field">
        <span>Ваш город — время в отчёте будет по нему</span>
        <select value={current ? current.name : '__other'} onChange={(e) => {
          const c = CITIES.find((x) => x.name === e.target.value);
          if (c) onChange(c.tz, c.name);
        }}>
          {CITIES.map((c) => <option key={c.name} value={c.name}>{c.name} ({formatOffset(offsetMinutes(c.tz))})</option>)}
          {!current && <option value="__other">{tz} ({formatOffset(offset)})</option>}
        </select>
      </label>
      {allZones.length > 0 && (
        <details className="small">
          <summary>Нет вашего города? Выберите часовой пояс</summary>
          <select value={tz} onChange={(e) => onChange(e.target.value, e.target.value)}>
            {allZones.map((z) => <option key={z} value={z}>{z}</option>)}
          </select>
        </details>
      )}
      {mismatch && (
        <p className="muted small">
          Экспорт Telegram сделан на устройстве с поясом {formatOffset(exporterOffsetMin!)}. Если вы были в другом городе — выберите
          его; время сообщений пересчитается правильно в любом случае.
        </p>
      )}
    </div>
  );
}
