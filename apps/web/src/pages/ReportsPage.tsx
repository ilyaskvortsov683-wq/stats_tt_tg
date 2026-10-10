import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { Notice, Progress } from '../components/ui';
import { SavedMomentsList } from './ReportPage';

interface RunRow { id: string; source: 'tg' | 'tt'; chat_kind: string; title: string | null; sections: string[]; status: string; charge: string; created_at: string }

const STATUS: Record<string, string> = { done: 'готов', failed: 'ошибка — разбор возвращён', reserved: 'ожидает данных', queued: 'в очереди', computing: 'считается', rendering: 'рисуется' };

export function ReportsPage() {
  const [runs, setRuns] = useState<RunRow[] | null>(null);
  useEffect(() => { api<RunRow[]>('/runs').then(setRuns).catch(() => setRuns([])); }, []);
  return (
    <div className="page">
      <header className="page-head"><div><h1>Мои отчёты</h1><p className="lead">Отчёты хранятся 90 дней. Скачайте HTML, чтобы сохранить навсегда.</p></div></header>
      {!runs ? <Progress label="Загружаем…" /> : !runs.length ? <Notice>Отчётов пока нет. Начните с вкладки Telegram или TikTok.</Notice> : (
        <div className="list">
          {runs.map((r) => (
            <div key={r.id} className="list-item">
              <span>
                <b>{r.title || (r.source === 'tg' ? 'Чат Telegram' : 'TikTok')}</b>
                <span className="muted small"> · {new Date(r.created_at).toLocaleString('ru-RU')} · {STATUS[r.status] ?? r.status}{r.charge === 'free_rerun' ? ' · повтор бесплатно' : ''}</span>
              </span>
              {r.status === 'done' && <Link className="btn small" to={`/app/reports/${r.id}?source=${r.source}`}>Открыть</Link>}
            </div>
          ))}
        </div>
      )}
      <section className="block">
        <h2>Сохранённые моменты</h2>
        <SavedMomentsList />
      </section>
    </div>
  );
}
