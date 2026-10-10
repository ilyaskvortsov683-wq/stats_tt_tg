import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, errorText } from '../api';
import { useAuth } from '../auth';
import { Notice } from '../components/ui';

interface AuthConfig { google: boolean; telegram_bot: string | null; dev_login: boolean }

export function LoginPage() {
  const { me, refresh } = useAuth();
  const nav = useNavigate();
  const [cfg, setCfg] = useState<AuthConfig | null>(null);
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [agree, setAgree] = useState(false);
  const tgBox = useRef<HTMLDivElement>(null);

  useEffect(() => { if (me) nav('/app'); }, [me, nav]);
  useEffect(() => { api<AuthConfig>('/auth/config').then(setCfg).catch(() => setCfg({ google: false, telegram_bot: null, dev_login: false })); }, []);

  // Виджет «Войти через Telegram» (резервный вход).
  useEffect(() => {
    if (!cfg?.telegram_bot || !tgBox.current || !agree) return;
    (window as unknown as { onTelegramAuth: (u: Record<string, unknown>) => void }).onTelegramAuth = async (user) => {
      try {
        await api('/auth/telegram', { json: user });
        await refresh();
      } catch (e) { setError(errorText(e)); }
    };
    const s = document.createElement('script');
    s.src = 'https://telegram.org/js/telegram-widget.js?22';
    s.async = true;
    s.setAttribute('data-telegram-login', cfg.telegram_bot);
    s.setAttribute('data-size', 'large');
    s.setAttribute('data-radius', '8');
    s.setAttribute('data-onauth', 'onTelegramAuth(user)');
    s.setAttribute('data-request-access', 'write');
    tgBox.current.innerHTML = '';
    tgBox.current.appendChild(s);
  }, [cfg, agree, refresh]);

  async function devLogin(e: FormEvent) {
    e.preventDefault();
    try {
      await api('/auth/dev-login', { json: { email } });
      await refresh();
    } catch (err) { setError(errorText(err)); }
  }

  return (
    <div className="page narrow login">
      <Link to="/" className="logo">Разбор<span>.</span></Link>
      <h1>Вход</h1>
      <p className="lead">Аккаунт нужен, чтобы хранить ваши разборы, баланс и (по желанию) историю TikTok.</p>
      <label className="check">
        <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
        <span>Я принимаю <Link to="/legal/offer">оферту</Link> и даю согласие на обработку персональных данных по <Link to="/legal/privacy">политике</Link>.</span>
      </label>
      {error && <Notice kind="error">{error}</Notice>}
      <div className="login-options">
        {cfg?.google && (
          <a className={'btn big' + (agree ? '' : ' disabled')} aria-disabled={!agree} href={agree ? '/api/v1/auth/google/login' : undefined}>Войти через Google</a>
        )}
        {cfg?.telegram_bot && <div ref={tgBox} className={agree ? '' : 'disabled'} />}
        {cfg && !cfg.google && !cfg.telegram_bot && !cfg.dev_login && <Notice>Вход временно недоступен.</Notice>}
      </div>
      {cfg?.dev_login && (
        <form onSubmit={devLogin} className="dev-login">
          <p className="muted small">Локальная разработка: вход по email без пароля (в проде выключен).</p>
          <div className="row gap">
            <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
            <button className="btn" disabled={!agree}>Войти</button>
          </div>
        </form>
      )}
    </div>
  );
}
