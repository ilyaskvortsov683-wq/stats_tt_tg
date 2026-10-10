import '@stats/design-tokens/tokens.css';
import './styles.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { track } from './api';
import { AuthProvider } from './auth';
import { AdminPage } from './pages/AdminPage';
import { AppLayout } from './pages/AppLayout';
import { BillingPage } from './pages/BillingPage';
import { Landing } from './pages/Landing';
import { LoginPage } from './pages/LoginPage';
import { ReportPage } from './pages/ReportPage';
import { ReportsPage } from './pages/ReportsPage';
import { LegalPage, MiniAppPage, SamplePage } from './pages/SamplePage';
import { SettingsPage } from './pages/SettingsPage';
import { TelegramPage } from './pages/TelegramPage';
import { TikTokPage } from './pages/TikTokPage';
import { ThemeProvider } from './theme';

window.addEventListener('error', (e) => track('client.error', { message: String(e.message).slice(0, 200), at: location.pathname }));
window.addEventListener('unhandledrejection', (e) => track('client.error', { message: String(e.reason).slice(0, 200), at: location.pathname }));

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<Landing />} />
            <Route path="/login" element={<LoginPage />} />
            <Route path="/sample" element={<SamplePage />} />
            <Route path="/legal/offer" element={<LegalPage kind="offer" />} />
            <Route path="/legal/privacy" element={<LegalPage kind="privacy" />} />
            <Route path="/tg" element={<MiniAppPage />} />
            <Route element={<AppLayout />}>
              <Route path="/app" element={<Navigate to="/app/tg" replace />} />
              <Route path="/app/tg" element={<TelegramPage />} />
              <Route path="/app/tt" element={<TikTokPage />} />
              <Route path="/app/reports" element={<ReportsPage />} />
              <Route path="/app/reports/:id" element={<ReportPage />} />
              <Route path="/app/billing" element={<BillingPage />} />
              <Route path="/app/settings" element={<SettingsPage />} />
              <Route path="/admin" element={<AdminPage />} />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </ThemeProvider>
  </StrictMode>,
);
