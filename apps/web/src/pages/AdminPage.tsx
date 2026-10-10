import { useEffect, useState, type FormEvent } from 'react';
import { Navigate } from 'react-router-dom';
import { api, errorText } from '../api';
import { useAuth } from '../auth';
import { fmtN, Kpis, Notice } from '../components/ui';

type Tab = 'stats' | 'users' | 'promos' | 'runs' | 'events';
type Row = Record<string, unknown>;

export function AdminPage() {
  const { me } = useAuth();
  const [tab, setTab] = useState<Tab>('stats');
  if (!me) return null;
  if (me.role !== 'admin') return <Navigate to="/app" replace />;
  const tabs: [Tab, string][] = [['stats', 'Обзор'], ['users', 'Пользователи'], ['promos', 'Промокоды'], ['runs', 'Разборы'], ['events', 'Журнал']];
  return (
    <div className="page">
      <header className="page-head"><div><h1>Админка</h1>
        <p className="lead">Полный журнал — здесь. Копия без персональных данных — в Google-таблице ops_log.</p></div></header>
      <nav className="tabs sub">{tabs.map(([t, l]) => <button key={t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>{l}</button>)}</nav>
      {tab === 'stats' && <Stats />}
      {tab === 'users' && <Users />}
      {tab === 'promos' && <Promos />}
      {tab === 'runs' && <Table path="/admin/runs" cols={['at', 'user_ref', 'source', 'status', 'charge', 'error']} />}
      {tab === 'events' && <Events />}
    </div>
  );
}

function Stats() {
  const [days, setDays] = useState(30);
  const [s, setS] = useState<Row | null>(null);
  useEffect(() => { api<Row>(`/admin/stats?days=${days}`).then(setS); }, [days]);
  if (!s) return null;
  const n = (k: string) => fmtN(Number(s[k] ?? 0));
  return (
    <>
      <div className="row gap">{[1, 7, 30, 365].map((d) => <button key={d} className={'btn small ' + (d === days ? '' : 'ghost')} onClick={() => setDays(d)}>{d === 1 ? 'Сутки' : d + ' дн.'}</button>)}</div>
      <Kpis items={[
        { value: n('users_new'), label: 'новых пользователей' }, { value: n('users_active'), label: 'активных' },
        { value: n('uploads'), label: 'загрузок файлов' }, { value: n('runs_paid'), label: 'платных разборов' },
        { value: n('payments'), label: 'оплат' }, { value: n('revenue_rub') + ' ₽', label: 'выручка' },
        { value: n('revenue_stars') + ' ⭐', label: 'в звёздах' }, { value: n('promo_redemptions'), label: 'промокодов применено' },
        { value: n('runs_failed'), label: 'ошибок разборов' }, { value: n('errors_24h'), label: 'ошибок за сутки' },
      ]} />
      <h3>Популярность сводок</h3>
      <div className="table-wrap"><table><tbody>
        {(s.sections_popularity as [string, number][]).map(([k, v]) => <tr key={k}><td>{k}</td><td>{fmtN(v)}</td></tr>)}
      </tbody></table></div>
    </>
  );
}

function Users() {
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<Row[]>([]);
  const [card, setCard] = useState<Row | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const search = () => { void api<Row[]>(`/admin/users?q=${encodeURIComponent(q)}`).then(setRows); };
  useEffect(search, []); // eslint-disable-line react-hooks/exhaustive-deps
  async function grant(id: string) {
    const runs = Number(prompt('Сколько разборов начислить (можно отрицательное число)?', '1'));
    const reason = prompt('Причина (видна в истории пользователя)?', 'подарок');
    if (!runs || !reason) return;
    try {
      await api(`/admin/users/${id}/grant`, { json: { runs, reason } });
      setMsg('Начислено');
      search();
    } catch (e) { setMsg(errorText(e)); }
  }
  return (
    <>
      <form className="row gap" onSubmit={(e) => { e.preventDefault(); search(); }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="email или u_…" />
        <button className="btn ghost">Найти</button>
      </form>
      {msg && <Notice>{msg}</Notice>}
      <div className="table-wrap"><table>
        <thead><tr><th>user_ref</th><th>email</th><th>роль</th><th>баланс</th><th>создан</th><th /></tr></thead>
        <tbody>{rows.map((u) => (
          <tr key={String(u.id)}>
            <td><button className="link-btn" onClick={() => void api<Row>(`/admin/users/${u.id}`).then(setCard)}>{String(u.user_ref)}</button></td>
            <td>{String(u.email ?? '—')}</td><td>{String(u.role)}</td><td>{String(u.balance)}</td>
            <td>{new Date(String(u.created_at)).toLocaleDateString('ru-RU')}</td>
            <td><button className="btn small ghost" onClick={() => void grant(String(u.id))}>Начислить</button></td>
          </tr>
        ))}</tbody>
      </table></div>
      {card && <pre className="json">{JSON.stringify(card, null, 2)}</pre>}
    </>
  );
}

function Promos() {
  const [rows, setRows] = useState<Row[]>([]);
  const [form, setForm] = useState({ kind: 'runs', value: 1, scope: 'global', user_email: '', max_redemptions: '', valid_until: '', code: '', count: 1, note: '' });
  const [created, setCreated] = useState<string[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const load = () => { void api<Row[]>('/admin/promos').then(setRows); };
  useEffect(load, []);
  async function create(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    try {
      const r = await api<{ codes: string[] }>('/admin/promos', { json: {
        kind: form.kind, value: Number(form.value), scope: form.scope,
        user_email: form.scope === 'personal' ? form.user_email : null,
        max_redemptions: form.max_redemptions ? Number(form.max_redemptions) : null,
        valid_until: form.valid_until ? new Date(form.valid_until + 'T23:59:59').toISOString() : null,
        code: form.code || null, count: Number(form.count), note: form.note || null,
      } });
      setCreated(r.codes);
      load();
    } catch (e2) { setErr(errorText(e2)); }
  }
  const set = (k: string) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value });
  return (
    <>
      <form className="promo-form" onSubmit={create}>
        <label className="field"><span>Что даёт</span><select value={form.kind} onChange={set('kind')}>
          <option value="runs">N разборов</option><option value="discount_percent">Скидка, %</option><option value="fixed_price">Цена пакета, копеек</option></select></label>
        <label className="field"><span>Значение</span><input type="number" min={1} value={form.value} onChange={set('value')} /></label>
        <label className="field"><span>Для кого</span><select value={form.scope} onChange={set('scope')}>
          <option value="global">Для всех (каждый — один раз)</option><option value="personal">Для одного пользователя</option></select></label>
        {form.scope === 'personal' && <label className="field"><span>Email пользователя</span><input type="email" required value={form.user_email} onChange={set('user_email')} /></label>}
        <label className="field"><span>Общий лимит применений</span><input type="number" min={1} value={form.max_redemptions} onChange={set('max_redemptions')} placeholder="без лимита" /></label>
        <label className="field"><span>Действует до</span><input type="date" value={form.valid_until} onChange={set('valid_until')} /></label>
        <label className="field"><span>Свой код (необязательно)</span><input value={form.code} onChange={set('code')} placeholder="VALENTINE26" /></label>
        <label className="field"><span>Сколько кодов</span><input type="number" min={1} max={500} value={form.count} onChange={set('count')} /></label>
        <label className="field"><span>Заметка</span><input value={form.note} onChange={set('note')} /></label>
        <button className="btn">Создать</button>
      </form>
      {err && <Notice kind="error">{err}</Notice>}
      {created.length > 0 && <Notice kind="ok">Создано: <code>{created.join(', ')}</code></Notice>}
      <div className="table-wrap"><table>
        <thead><tr><th>Код</th><th>Тип</th><th>Значение</th><th>Охват</th><th>Использован</th><th>До</th><th>Заметка</th><th /></tr></thead>
        <tbody>{rows.map((p) => (
          <tr key={String(p.id)} className={p.disabled ? 'muted' : ''}>
            <td><code>{String(p.code)}</code></td><td>{String(p.kind)}</td><td>{String(p.value)}</td><td>{String(p.scope)}</td>
            <td>{String(p.redemptions)}{p.max_redemptions ? ' / ' + String(p.max_redemptions) : ''}</td>
            <td>{p.valid_until ? new Date(String(p.valid_until)).toLocaleDateString('ru-RU') : '—'}</td>
            <td>{String(p.note ?? '')}</td>
            <td><button className="btn small ghost" onClick={() => void api(`/admin/promos/${p.id}`, { method: 'PATCH' }).then(load)}>{p.disabled ? 'Включить' : 'Выключить'}</button></td>
          </tr>
        ))}</tbody>
      </table></div>
    </>
  );
}

function Events() {
  const [level, setLevel] = useState('');
  const [type, setType] = useState('');
  return (
    <>
      <div className="row gap wrap">
        <select value={level} onChange={(e) => setLevel(e.target.value)}><option value="">все уровни</option><option value="info">info</option><option value="warning">warning</option><option value="error">error</option></select>
        <input value={type} onChange={(e) => setType(e.target.value)} placeholder="тип, например run.* или payment.*" />
      </div>
      <Table key={level + type} path={'/admin/events?' + new URLSearchParams({ ...(level ? { level } : {}), ...(type ? { type } : {}) }).toString()} cols={['ts', 'level', 'type', 'user_ref', 'source', 'data']} />
    </>
  );
}

function Table({ path, cols }: { path: string; cols: string[] }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  useEffect(() => { api<Row[]>(path).then(setRows).catch(() => setRows([])); }, [path]);
  if (!rows) return null;
  return (
    <div className="table-wrap"><table>
      <thead><tr>{cols.map((c) => <th key={c}>{c}</th>)}</tr></thead>
      <tbody>{rows.map((r, i) => <tr key={i}>{cols.map((c) => <td key={c}>{typeof r[c] === 'object' ? JSON.stringify(r[c]) : String(r[c] ?? '')}</td>)}</tr>)}</tbody>
    </table></div>
  );
}
