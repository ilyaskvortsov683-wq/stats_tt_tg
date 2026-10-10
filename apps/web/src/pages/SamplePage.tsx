import { useState } from 'react';
import { Link } from 'react-router-dom';
import { themeQuery } from '../theme';

/** Пример отчёта на синтетических данных — тем же рендером, что и настоящие отчёты. */
export function SamplePage() {
  const [source, setSource] = useState<'tg' | 'tt'>('tg');
  return (
    <div className="page wide">
      <div className="row between wrap">
        <Link to="/" className="logo">Разбор<span>.</span></Link>
        <div className="segmented">
          <button className={source === 'tg' ? 'on' : ''} onClick={() => setSource('tg')}>Чат Telegram</button>
          <button className={source === 'tt' ? 'on' : ''} onClick={() => setSource('tt')}>TikTok</button>
        </div>
      </div>
      <p className="muted small">Все имена и числа выдуманы. Попробуйте выбрать период в шапке или в любой сводке.</p>
      <iframe key={source} className="report-frame" title="Пример отчёта" src={`/api/v1/sample/${source}${themeQuery()}`} sandbox="allow-scripts" />
    </div>
  );
}

export function LegalPage({ kind }: { kind: 'offer' | 'privacy' }) {
  return (
    <div className="page narrow">
      <Link to="/" className="logo">Разбор<span>.</span></Link>
      <h1>{kind === 'offer' ? 'Публичная оферта' : 'Политика обработки персональных данных'}</h1>
      <p className="muted">Черновик готовится (фаза 12, docs/18-security-privacy-legal.md). Текст будет согласован с юристом до запуска оплаты.</p>
    </div>
  );
}

export function MiniAppPage() {
  return (
    <div className="page narrow">
      <h1>Разбор в Telegram</h1>
      <p>Mini App появится в фазе 9. Пока откройте приложение в браузере.</p>
      <Link className="btn" to="/app">Открыть приложение</Link>
    </div>
  );
}
