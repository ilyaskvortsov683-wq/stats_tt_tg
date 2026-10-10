import { useEffect, useRef, useState, type ReactNode } from 'react';
import { PALETTES, useTheme, type Mode } from '../theme';

export function fmtN(n: number): string {
  return Math.round(n).toLocaleString('ru-RU');
}

export function fmtDate(ts: number | null | undefined, tz?: string): string {
  if (!ts) return '—';
  try {
    return new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric', timeZone: tz }).format(ts * 1000);
  } catch {
    return new Date(ts * 1000).toLocaleDateString('ru-RU');
  }
}

export function Kpis({ items }: { items: { value: ReactNode; label: string }[] }) {
  return (
    <div className="kpis">
      {items.map((k) => (
        <div className="kpi" key={k.label}>
          <div className="kpi-value">{k.value}</div>
          <div className="kpi-label">{k.label}</div>
        </div>
      ))}
    </div>
  );
}

export function HBars({ rows }: { rows: { label: string; value: number; note?: string; color?: string }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div className="hbars">
      {rows.map((r, i) => (
        <div className="hbar" key={r.label + i}>
          <div className="hbar-label" title={r.label}>{r.label}</div>
          <div className="hbar-track"><div className="hbar-fill" style={{ width: `${(100 * r.value) / max}%`, background: r.color ?? `var(--s${(i % 8) + 1})` }} /></div>
          <div className="hbar-value">{fmtN(r.value)}{r.note ? <span className="muted"> {r.note}</span> : null}</div>
        </div>
      ))}
    </div>
  );
}

export function Dropzone({ multiple, accept, onFiles, hint }: { multiple?: boolean; accept: string; onFiles: (f: File[]) => void; hint: ReactNode }) {
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  return (
    <div
      className={'dropzone' + (over ? ' over' : '')}
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); const f = [...e.dataTransfer.files]; if (f.length) onFiles(multiple ? f : f.slice(0, 1)); }}
      onClick={() => input.current?.click()}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') input.current?.click(); }}
    >
      <input ref={input} type="file" hidden multiple={multiple} accept={accept}
        onChange={(e) => { const f = [...(e.target.files ?? [])]; if (f.length) onFiles(f); e.target.value = ''; }} />
      <div className="dropzone-title">{multiple ? 'Перетащите файлы сюда' : 'Перетащите файл сюда'}</div>
      <div className="muted">или нажмите, чтобы выбрать · {hint}</div>
    </div>
  );
}

export function Modal({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} className={'modal' + (wide ? ' wide' : '')} onClose={onClose} onClick={(e) => { if (e.target === ref.current) onClose(); }}>
      <header className="modal-head">
        <h2>{title}</h2>
        <button className="icon-btn" onClick={onClose} aria-label="Закрыть">✕</button>
      </header>
      <div className="modal-body">{children}</div>
    </dialog>
  );
}

export function ThemeSwitcher() {
  const { mode, palette, setMode, setPalette } = useTheme();
  const modes: [Mode, string][] = [['light', 'Светлая'], ['dark', 'Тёмная'], ['system', 'Как в системе']];
  return (
    <div className="theme-switcher">
      <div className="segmented" role="radiogroup" aria-label="Тема">
        {modes.map(([m, t]) => (
          <button key={m} role="radio" aria-checked={mode === m} className={mode === m ? 'on' : ''} onClick={() => setMode(m)}>{t}</button>
        ))}
      </div>
      <div className="palettes" role="radiogroup" aria-label="Палитра">
        {PALETTES.map((p) => (
          <button key={p.id} role="radio" aria-checked={palette === p.id} className={'palette' + (palette === p.id ? ' on' : '')}
            title={`${p.title} — ${p.note}`} onClick={() => setPalette(p.id)}>
            <span className="swatches">{p.preview.map((c) => <i key={c} style={{ background: c }} />)}</span>
            <span>{p.title}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

export function Notice({ kind = 'info', children }: { kind?: 'info' | 'error' | 'ok'; children: ReactNode }) {
  return <div className={'notice ' + kind} role={kind === 'error' ? 'alert' : 'status'}>{children}</div>;
}

export function Progress({ label }: { label: string }) {
  return <div className="progress"><span className="spinner" aria-hidden /> {label}</div>;
}
