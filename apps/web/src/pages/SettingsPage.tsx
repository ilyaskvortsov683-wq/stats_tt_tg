import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, errorText } from '../api';
import { useAuth } from '../auth';
import { CityPicker } from '../components/CityPicker';
import { fmtDate, fmtN, Notice, ThemeSwitcher } from '../components/ui';

export function SettingsPage() {
  const { me, refresh, logout } = useAuth();
  const nav = useNavigate();
  const [msg, setMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  if (!me) return null;

  async function linkTelegram() {
    try {
      const r = await api<{ url: string }>('/me/telegram-link', { method: 'POST' });
      window.open(r.url, '_blank');
    } catch (e) { setMsg({ kind: 'error', text: errorText(e) }); }
  }

  async function deleteHistory() {
    if (!confirm('Удалить сохранённую историю просмотров TikTok? Отменить нельзя.')) return;
    await api('/tiktok/history', { method: 'DELETE' });
    await refresh();
    setMsg({ kind: 'ok', text: 'История удалена.' });
  }

  async function deleteAccount() {
    if (!confirm('Удалить аккаунт и все данные? Неиспользованные разборы сгорят.')) return;
    await api('/me', { method: 'DELETE' });
    await logout();
    nav('/');
  }

  return (
    <div className="page">
      <header className="page-head"><div><h1>Профиль</h1><p className="lead">{me.email ?? me.name}</p></div></header>
      {msg && <Notice kind={msg.kind}>{msg.text}</Notice>}

      <section className="block">
        <h2>Город и время</h2>
        <CityPicker tz={me.tz} onChange={async (tz, city) => { await api('/me/settings', { method: 'PATCH', json: { tz, city } }); await refresh(); }} />
      </section>

      <section className="block">
        <h2>Оформление</h2>
        <ThemeSwitcher />
      </section>

      <section className="block">
        <h2>Telegram</h2>
        {me.telegram_linked
          ? <p>Telegram привязан: баланс и отчёты общие для сайта и бота, бот может напоминать о выгрузке TikTok.</p>
          : <button className="btn" onClick={() => void linkTelegram()}>Привязать Telegram</button>}
      </section>

      <section className="block">
        <h2>История TikTok</h2>
        {me.tt_history?.views
          ? <>
              <p>{fmtN(me.tt_history.views)} просмотров, {fmtDate(me.tt_history.min_ts, me.tz)} — {fmtDate(me.tt_history.max_ts, me.tz)}, выгрузок: {me.tt_history.files}.</p>
              <button className="btn ghost" onClick={() => void deleteHistory()}>Удалить историю</button>
            </>
          : <p className="muted">История не сохранена.</p>}
      </section>

      <section className="block danger">
        <h2>Аккаунт</h2>
        <div className="row gap wrap">
          <button className="btn ghost" onClick={() => void logout().then(() => nav('/'))}>Выйти</button>
          <button className="btn ghost danger" onClick={() => void deleteAccount()}>Удалить аккаунт и данные</button>
        </div>
      </section>
    </div>
  );
}
