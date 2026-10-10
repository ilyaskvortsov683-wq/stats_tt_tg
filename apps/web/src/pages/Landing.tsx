import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { track } from '../api';
import { useAuth } from '../auth';
import { GuideDialog } from '../components/GuideDialog';
import { ThemeSwitcher } from '../components/ui';

export function Landing() {
  const { me } = useAuth();
  const [guide, setGuide] = useState<'tg' | 'tt' | null>(null);
  useEffect(() => { track('visit.landing', { ref: document.referrer ? new URL(document.referrer).hostname : '' }); }, []);

  return (
    <div className="landing">
      <header className="site-head">
        <Link to="/" className="logo">Разбор<span>.</span></Link>
        <nav className="row gap">
          <Link to="/sample">Пример отчёта</Link>
          {me ? <Link className="btn small" to="/app">Открыть приложение</Link> : <Link className="btn small" to="/login">Войти</Link>}
        </nav>
      </header>

      <section className="hero">
        <div className="eyebrow">Telegram · TikTok</div>
        <h1>Ваша переписка<br />и ваша лента —<br /><em>в цифрах</em></h1>
        <p className="lead">
          Кто пишет первым, во сколько вы обычно болтаете, самый долгий разговор, сколько часов ушло на TikTok и какое
          «залипание» было самым длинным. Только честная статистика по вашим собственным данным.
        </p>
        <div className="row gap wrap">
          <Link className="btn big" to={me ? '/app/tg' : '/login'}>Разобрать чат Telegram</Link>
          <Link className="btn big ghost" to={me ? '/app/tt' : '/login'}>Разобрать TikTok</Link>
        </div>
      </section>

      <section className="facts">
        <div className="fact"><div className="fact-n">0</div><p>текстов сообщений уходит на сервер. Файл разбирается в вашем браузере, на сервер — только обезличенные счётчики.</p></div>
        <div className="fact"><div className="fact-n">20+</div><p>сводок: ритм, часы, монологи, реакции, мат и смех, имена, экранное время, сессии. Отмечаете только нужные.</p></div>
        <div className="fact"><div className="fact-n">5</div><p>разборов за 200 ₽ — в любых сочетаниях: например, TikTok целиком и четыре чата Telegram.</p></div>
      </section>

      <section className="howto-cards">
        <h2>Как это работает</h2>
        <ol className="steps">
          <li><b>Выгрузите данные.</b> Telegram — в приложении для компьютера, TikTok — в настройках аккаунта.
            <div className="row gap"><button className="link-btn" onClick={() => setGuide('tg')}>Гайд для Telegram</button><button className="link-btn" onClick={() => setGuide('tt')}>Гайд для TikTok</button></div>
          </li>
          <li><b>Загрузите файл</b> — сразу увидите бесплатные итоги: сколько сообщений и у кого, сколько просмотров.</li>
          <li><b>Отметьте сводки</b> и получите отчёт: в любой сводке можно выбрать любой период.</li>
          <li><b>Сохраните</b> отчёт файлом или поделитесь карточками.</li>
        </ol>
      </section>

      <section className="appearance">
        <h2>Как вам удобнее смотреть</h2>
        <ThemeSwitcher />
      </section>

      <footer className="site-foot">
        <span>© Разбор · данные обрабатываются по закону 152-ФЗ</span>
        <span className="row gap"><Link to="/legal/privacy">Конфиденциальность</Link><Link to="/legal/offer">Оферта</Link></span>
      </footer>
      {guide && <GuideDialog source={guide} open onClose={() => setGuide(null)} />}
    </div>
  );
}
