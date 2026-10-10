import { useEffect, useState } from 'react';
import { api } from '../api';
import { Modal } from './ui';

interface Step { title: string; body: string[] }

/** Гайд из docs/guides/*.md: шаги — заголовки «## ». Скриншоты появятся, когда автор их подготовит. */
function parseGuide(md: string): { intro: string[]; steps: Step[] } {
  const text = md.replace(/^---[\s\S]*?---\s*/, '');
  const parts = text.split(/\n(?=## )/);
  const intro = parts[0].split('\n').filter((l) => l.trim() && !l.startsWith('# '));
  const steps = parts.slice(1).map((p) => {
    const [head, ...rest] = p.split('\n');
    return { title: head.replace(/^##\s*/, ''), body: rest.filter((l) => l.trim()) };
  });
  return { intro, steps };
}

function Line({ text }: { text: string }) {
  const clean = text.replace(/^>\s?/, '').replace(/^- /, '• ');
  const parts = clean.split(/(\*\*[^*]+\*\*)/g);
  return (
    <p className={text.startsWith('>') ? 'callout' : text.startsWith('*') && !text.startsWith('**') ? 'muted small' : ''}>
      {parts.map((p, i) => (p.startsWith('**') ? <b key={i}>{p.slice(2, -2)}</b> : p.replace(/^\*|\*$/g, '')))}
    </p>
  );
}

export function GuideDialog({ source, open, onClose }: { source: 'tg' | 'tt'; open: boolean; onClose: () => void }) {
  const [guide, setGuide] = useState<{ intro: string[]; steps: Step[] } | null>(null);
  const [i, setI] = useState(0);

  useEffect(() => {
    if (!open || guide) return;
    api<{ markdown: string }>(`/guides/${source}`).then((r) => setGuide(parseGuide(r.markdown))).catch(() => setGuide({ intro: ['Не удалось загрузить гайд.'], steps: [] }));
  }, [open, source, guide]);

  const step = guide?.steps[i];
  return (
    <Modal open={open} onClose={onClose} title={source === 'tg' ? 'Как выгрузить чат из Telegram' : 'Как выгрузить данные из TikTok'}>
      {!guide ? <p className="muted">Загружаем…</p> : (
        <div className="guide">
          {i === 0 && guide.intro.map((l, k) => <Line key={k} text={l} />)}
          {step && (
            <section className="guide-step">
              <div className="eyebrow">Шаг {i + 1} из {guide.steps.length}</div>
              <h3>{step.title.replace(/^Шаг \d+\.\s*/, '')}</h3>
              {step.body.map((l, k) => <Line key={k} text={l} />)}
            </section>
          )}
          <div className="row gap">
            <button className="btn ghost" disabled={i === 0} onClick={() => setI(i - 1)}>Назад</button>
            {i < guide.steps.length - 1
              ? <button className="btn" onClick={() => setI(i + 1)}>Дальше</button>
              : <button className="btn" onClick={onClose}>Готово</button>}
          </div>
        </div>
      )}
    </Modal>
  );
}
