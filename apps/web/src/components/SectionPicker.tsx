import type { SectionInfo } from '../data/sections';

/** Галочки сводок до анализа. Цена разбора не зависит от числа галочек. */
export function SectionPicker({ sections, selected, onChange, isAdmin, chatKind }: {
  sections: SectionInfo[];
  selected: string[];
  onChange: (ids: string[]) => void;
  isAdmin: boolean;
  chatKind?: 'personal' | 'group';
}) {
  const available = sections.filter((s) => !s.only || !chatKind || s.only === chatKind);
  const paid = available.filter((s) => !s.free && !s.beta);
  const toggle = (id: string) => onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  return (
    <div className="section-picker">
      <div className="row between wrap">
        <p className="muted small">Отметьте сводки для отчёта. Бесплатные уже посчитаны выше; цена разбора не зависит от числа галочек.</p>
        <div className="row gap">
          <button className="btn ghost small" onClick={() => onChange([...new Set([...selected, ...paid.map((s) => s.id)])])}>Выбрать все</button>
          <button className="btn ghost small" onClick={() => onChange(selected.filter((id) => available.find((s) => s.id === id)?.free))}>Снять</button>
        </div>
      </div>
      <div className="section-grid">
        {available.map((s) => {
          const checked = s.free || selected.includes(s.id);
          return (
            <label key={s.id} className={'section-card' + (checked ? ' on' : '') + (s.free ? ' free' : '') + (s.beta ? ' beta' : '')}>
              <input type="checkbox" checked={checked} disabled={s.free || s.beta} onChange={() => toggle(s.id)} />
              <span className="section-title">
                {s.title}
                {s.free ? <span className="badge">бесплатно</span> : s.beta ? <span className="badge">скоро</span> : !isAdmin ? <span className="badge lock" title="Входит в разбор">разбор</span> : null}
              </span>
              <span className="section-desc">{s.description}</span>
            </label>
          );
        })}
      </div>
    </div>
  );
}
