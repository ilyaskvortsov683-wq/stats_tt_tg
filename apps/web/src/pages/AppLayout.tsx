import { useEffect } from 'react';
import { Link, NavLink, Navigate, Outlet } from 'react-router-dom';
import { track } from '../api';
import { useAuth } from '../auth';
import { Progress } from '../components/ui';

export function AppLayout() {
  const { me, loading } = useAuth();
  useEffect(() => { track('visit.app', {}); }, []);
  if (loading) return <div className="page"><Progress label="Загрузка…" /></div>;
  if (!me) return <Navigate to="/login" replace />;
  return (
    <div className="app">
      <header className="app-head">
        <Link to="/" className="logo">Разбор<span>.</span></Link>
        <nav className="tabs">
          <NavLink to="/app/tg">Telegram</NavLink>
          <NavLink to="/app/tt">TikTok</NavLink>
          <NavLink to="/app/reports">Отчёты</NavLink>
          <NavLink to="/app/billing">Разборы</NavLink>
          <NavLink to="/app/settings">Профиль</NavLink>
          {me.role === 'admin' && <NavLink to="/admin">Админка</NavLink>}
        </nav>
        <Link to="/app/billing" className="balance" title="Баланс разборов">
          {me.role === 'admin' ? '∞' : me.balance} <span className="muted">разб.</span>
        </Link>
      </header>
      <main><Outlet /></main>
    </div>
  );
}
