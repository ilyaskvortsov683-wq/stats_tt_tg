import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { Modal, Notice } from '../components/ui';
import { themeQuery } from '../theme';
import { callWorker, workerErrorText } from '../workerClient';

interface MomentText { ts: number; author: string; kind: string; text: string }
interface SavedMoment { id: string; kind: string; savedAt: number; messages: MomentText[] }

const FAV_KEY = 'saved-moments';

function loadFavs(): SavedMoment[] {
  try { return JSON.parse(localStorage.getItem(FAV_KEY) || '[]'); } catch { return []; }
}

function momentHtml(m: { kind: string; messages: MomentText[] }): string {
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
  const rows = m.messages.map((x) => `<div class="m"><b>${esc(x.author)}</b> <span>${new Date(x.ts * 1000).toLocaleString('ru-RU')}</span><p>${esc(x.text || '[' + x.kind + ']')}</p></div>`).join('');
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Момент</title>
<style>body{font:16px/1.5 system-ui;max-width:680px;margin:32px auto;padding:0 16px;background:#f7f5f0;color:#1c1b19}.m{border-bottom:1px solid #e0dbcf;padding:10px 0}span{color:#8d877b;font-size:13px}p{margin:4px 0;white-space:pre-wrap}</style>
<h1>${m.kind === 'monologue' ? 'Монолог' : 'Разговор'}</h1>${rows}`;
}

function download(name: string, content: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([content], { type: 'text/html' }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export function ReportPage() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const source = (params.get('source') as 'tg' | 'tt') ?? 'tg';
  const chatParam = params.get('chat');
  const [moment, setMoment] = useState<{ kind: string; messages: MomentText[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const onMsg = async (ev: MessageEvent) => {
      const d = ev.data as { type?: string; kind?: string; i0?: number; i1?: number };
      if (d?.type !== 'stats:moment' || typeof d.i0 !== 'number' || typeof d.i1 !== 'number' || d.i1 < d.i0 || d.i1 - d.i0 > 2000) return;
      try {
        const messages = await callWorker<MomentText[]>({
          type: 'texts', i0: d.i0, i1: d.i1, source, chatIndex: chatParam ? Number(chatParam) : null,
        });
        setSaved(false);
        setMoment({ kind: d.kind ?? 'monologue', messages });
      } catch (e) {
        setError(workerErrorText(e));
      }
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, [source, chatParam]);

  function favorite() {
    if (!moment) return;
    const list = loadFavs();
    list.unshift({ id: crypto.randomUUID(), kind: moment.kind, savedAt: Date.now(), messages: moment.messages });
    try { localStorage.setItem(FAV_KEY, JSON.stringify(list.slice(0, 50))); setSaved(true); } catch { setError('Не удалось сохранить: в браузере нет места.'); }
  }

  return (
    <div className="page report-page">
      <div className="row between wrap">
        <Link to="/app/reports" className="muted">← Мои отчёты</Link>
        <div className="row gap">
          <a className="btn ghost small" href={`/api/v1/runs/${id}/report.html${themeQuery()}`} target="_blank" rel="noreferrer">Открыть отдельно</a>
          <a className="btn ghost small" href={`/api/v1/runs/${id}/report.html`} download={`razbor-${id}.html`}>Скачать HTML</a>
          <button className="btn ghost small" disabled title="PDF и PNG — фаза 7">PDF · PNG (скоро)</button>
        </div>
      </div>
      {error && <Notice kind="error">{error}</Notice>}
      <iframe className="report-frame" title="Отчёт" src={`/api/v1/runs/${id}/report.html${themeQuery()}`} sandbox="allow-scripts allow-popups allow-downloads" />
      <Modal open={!!moment} onClose={() => setMoment(null)} title={moment?.kind === 'dialog' ? 'Разговор' : 'Монолог'} wide>
        {moment && (
          <>
            <div className="chat-log">
              {moment.messages.map((m, i) => (
                <div key={i} className="chat-msg">
                  <div className="muted small"><b>{m.author}</b> · {new Date(m.ts * 1000).toLocaleString('ru-RU')}</div>
                  <div className="chat-text">{m.text || <i className="muted">[{m.kind}]</i>}</div>
                </div>
              ))}
            </div>
            <div className="row gap">
              <button className="btn" onClick={() => download('moment.html', momentHtml(moment))}>Сохранить в файл</button>
              <button className="btn ghost" onClick={favorite} disabled={saved}>{saved ? 'В избранном' : 'В избранное (на этом устройстве)'}</button>
            </div>
          </>
        )}
      </Modal>
    </div>
  );
}

export function SavedMomentsList() {
  const [list, setList] = useState<SavedMoment[]>(loadFavs);
  if (!list.length) return <p className="muted">Сохранённых моментов пока нет. Откройте отчёт с монологами и нажмите «Текст».</p>;
  return (
    <div className="list">
      {list.map((m) => (
        <div key={m.id} className="list-item">
          <span>{m.kind === 'dialog' ? 'Разговор' : 'Монолог'} · {m.messages.length} сообщ. · {new Date(m.messages[0]?.ts * 1000).toLocaleDateString('ru-RU')}</span>
          <span className="row gap">
            <button className="btn ghost small" onClick={() => download('moment.html', momentHtml(m))}>Скачать</button>
            <button className="btn ghost small" onClick={() => {
              const next = list.filter((x) => x.id !== m.id);
              setList(next);
              try { localStorage.setItem(FAV_KEY, JSON.stringify(next)); } catch { /* пусто */ }
            }}>Удалить</button>
          </span>
        </div>
      ))}
    </div>
  );
}
