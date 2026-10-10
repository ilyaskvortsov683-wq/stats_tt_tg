import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { TtChatCounts, TtViewsTotal } from '@stats/parsers';
import { api, countBucket, errorText, sizeBucket, track } from '../api';
import { useAuth } from '../auth';
import { CityPicker } from '../components/CityPicker';
import { GuideDialog } from '../components/GuideDialog';
import { SectionPicker } from '../components/SectionPicker';
import { Dropzone, fmtDate, fmtN, Kpis, Notice, Progress } from '../components/ui';
import { TT_SECTIONS } from '../data/sections';
import { runAnalysis, STAGE_TEXT, type RunStage } from '../runFlow';
import { callWorker, workerErrorText } from '../workerClient';

interface Parsed {
  owner: string;
  files: { name: string; views: number; from: number | null; to: number | null }[];
  mergedViews: number;
  chats: { index: number; partner: string; count: number }[];
  unknownSections: string[];
}

export function TikTokPage() {
  const { me, refresh } = useAuth();
  const nav = useNavigate();
  const [guide, setGuide] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [free, setFree] = useState<{ views: TtViewsTotal; chats: TtChatCounts[] } | null>(null);
  const [tz, setTz] = useState(me?.tz ?? 'Europe/Moscow');
  const [store, setStore] = useState<boolean>(Boolean(me?.consents?.store_tt_history ?? true));
  const [history, setHistory] = useState<{ total: number; added: number; duplicates: number; min_ts: number | null; max_ts: number | null } | null>(null);
  const [chatIndex, setChatIndex] = useState<number | null>(null);
  const [selected, setSelected] = useState<string[]>(['tt.views_rhythm', 'tt.sessions', 'tt.activity']);
  const [stage, setStage] = useState<{ s: RunStage; info?: string } | null>(null);

  useEffect(() => {
    if (!parsed) return;
    callWorker<{ views: TtViewsTotal; chats: TtChatCounts[] }>({ type: 'ttFree', tz }).then(setFree).catch((e) => setError(workerErrorText(e)));
  }, [parsed, tz]);

  async function onFiles(files: File[]) {
    setError(null); setParsed(null); setFree(null); setHistory(null);
    setBusy(files.length > 1 ? `Читаем и склеиваем ${files.length} выгрузки…` : 'Читаем файл на вашем устройстве…');
    track('upload.started', { source: 'tt', files: files.length, size: sizeBucket(files.reduce((s, f) => s + f.size, 0)) });
    try {
      const r = await callWorker<Parsed>({ type: 'parseTikTok', files });
      setParsed(r);
      setChatIndex(r.chats[0]?.index ?? null);
      track('upload.parsed', { source: 'tt', files: files.length, views: countBucket(r.mergedViews), chats: r.chats.length });
      track('analysis.free_computed', { source: 'tt' });
      if (r.unknownSections.length) track('parser.unknown_shape', { keys: r.unknownSections.slice(0, 10) });
      if (me && store) await saveHistory();
    } catch (e) {
      setError(workerErrorText(e));
      track('upload.failed', { source: 'tt', reason: e instanceof Error ? e.message : 'unknown' });
    } finally {
      setBusy(null);
    }
  }

  async function saveHistory() {
    try {
      await api('/me/settings', { method: 'PATCH', json: { consents: { store_tt_history: true } } });
      const payload = await callWorker<{ files: unknown[] }>({ type: 'historyPayload' });
      setHistory(await api<{ total: number; added: number; duplicates: number; min_ts: number | null; max_ts: number | null }>(
        '/tiktok/history', { json: payload },
      ));
      await refresh();
    } catch (e) {
      setError(errorText(e));
    }
  }

  async function toggleStore(v: boolean) {
    setStore(v);
    if (!me) return;
    await api('/me/settings', { method: 'PATCH', json: { consents: { store_tt_history: v } } }).catch(() => undefined);
    if (v && parsed) await saveHistory();
  }

  async function startRun() {
    if (!parsed) return;
    setError(null);
    const needsChat = selected.some((s) => TT_SECTIONS.find((x) => x.id === s)?.needs === 'chat');
    const idx = needsChat ? chatIndex : null;
    const sections = ['tt.views_total', ...selected.filter((s) => TT_SECTIONS.find((x) => x.id === s && !x.free))];
    track('sections.selected', { source: 'tt', sections });
    try {
      const id = await runAnalysis({
        source: 'tt', chatKind: idx !== null ? 'personal' : 'account',
        chatKey: idx !== null ? `${parsed.owner}:${parsed.chats.find((c) => c.index === idx)?.partner}` : parsed.owner,
        sections, tz, chatIndex: idx, useHistory: store && !!history,
      }, (s, info) => setStage({ s, info }));
      await refresh();
      nav(`/app/reports/${id}?source=tt&chat=${idx ?? ''}`);
    } catch (e) {
      setStage(null);
      setError(errorText(e));
      await refresh();
    }
  }

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <div className="eyebrow">TikTok</div>
          <h1>Ваш TikTok в цифрах</h1>
          <p className="lead">Можно загрузить сразу несколько выгрузок — склеим их в одну историю: TikTok хранит только последние ~6 месяцев.</p>
        </div>
        <button className="btn ghost" onClick={() => setGuide(true)}>Как выгрузить данные?</button>
      </header>
      <GuideDialog source="tt" open={guide} onClose={() => setGuide(false)} />

      {me?.tt_history && me.tt_history.views > 0 && !parsed && (
        <Notice>Сохранённая история: {fmtN(me.tt_history.views)} просмотров ({fmtDate(me.tt_history.min_ts, tz)} — {fmtDate(me.tt_history.max_ts, tz)}). Новая выгрузка склеится с ней.</Notice>
      )}
      {!parsed && <Dropzone multiple accept=".json,application/json" onFiles={onFiles} hint="один или несколько user_data_tiktok.json" />}
      {busy && <Progress label={busy} />}
      {error && <Notice kind="error">{error}</Notice>}

      {parsed && (
        <>
          <section className="block">
            <div className="row between wrap">
              <h2>@{parsed.owner}</h2>
              <button className="btn ghost small" onClick={() => { setParsed(null); setFree(null); }}>Другие файлы</button>
            </div>
            <div className="grid-2">
              <CityPicker tz={tz} onChange={(t, city) => { setTz(t); if (me) void api('/me/settings', { method: 'PATCH', json: { tz: t, city } }).catch(() => undefined); }} />
              <label className="check">
                <input type="checkbox" checked={store} onChange={(e) => void toggleStore(e.target.checked)} />
                <span>Хранить мою историю просмотров для склейки с будущими выгрузками. Храним только время и номер видео,
                  в зашифрованном виде; удалить можно в профиле.</span>
              </label>
            </div>
            {history && <Notice kind="ok">История сохранена: всего {fmtN(history.total)} просмотров, новых {fmtN(history.added)}, повторов отброшено {fmtN(history.duplicates)}.</Notice>}
            {parsed.files.length > 1 && (
              <p className="muted small">Склеено файлов: {parsed.files.length} → {fmtN(parsed.mergedViews)} просмотров без дублей.</p>
            )}
          </section>

          {free && (
            <section className="block">
              <div className="eyebrow">Бесплатно</div>
              <h2>{fmtN(free.views.count)} просмотров</h2>
              <p className="muted">{fmtDate(free.views.firstTs, tz)} — {fmtDate(free.views.lastTs, tz)}</p>
              <Kpis items={[
                { value: fmtN(free.views.count), label: 'просмотров в этих файлах' },
                { value: fmtN(free.views.days), label: 'дней' },
                { value: fmtN(free.views.perDay), label: 'в среднем в день' },
              ]} />
              <h3>Сообщения по чатам</h3>
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Чат</th><th>Всего</th><th>Вы: текст / тиктоки</th><th>Собеседник: текст / тиктоки</th><th>Прочее</th></tr></thead>
                  <tbody>
                    {free.chats.slice(0, 30).map((c) => {
                      const mine = c.byAuthor.find((a) => a.isOwner);
                      const other = c.byAuthor.filter((a) => !a.isOwner);
                      const sum = (k: 'text' | 'shares' | 'other') => other.reduce((s, a) => s + a[k], 0);
                      return (
                        <tr key={c.chatId}>
                          <td>{c.partner}</td><td>{fmtN(c.total)}</td>
                          <td>{fmtN(mine?.text ?? 0)} / {fmtN(mine?.shares ?? 0)}</td>
                          <td>{fmtN(sum('text'))} / {fmtN(sum('shares'))}</td>
                          <td>{fmtN((mine?.other ?? 0) + sum('other'))}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          <section className="block">
            <h2>Что посчитать в разборе</h2>
            <SectionPicker sections={TT_SECTIONS} selected={selected} onChange={setSelected} isAdmin={me?.role === 'admin'} />
            {selected.some((s) => TT_SECTIONS.find((x) => x.id === s)?.needs === 'chat') && parsed.chats.length > 0 && (
              <label className="field">
                <span>Чат для подробного разбора (один на разбор)</span>
                <select value={chatIndex ?? ''} onChange={(e) => setChatIndex(Number(e.target.value))}>
                  {parsed.chats.map((c) => <option key={c.index} value={c.index}>{c.partner} — {fmtN(c.count)} сообщ.</option>)}
                </select>
              </label>
            )}
            {!me ? <Notice>Чтобы сделать разбор, войдите в аккаунт.</Notice> : stage ? (
              <Progress label={(stage.info ? stage.info + ' · ' : '') + STAGE_TEXT[stage.s]} />
            ) : (
              <div className="cta-row">
                <button className="btn big" onClick={() => void startRun()} disabled={!selected.some((s) => !TT_SECTIONS.find((x) => x.id === s)?.free)}>
                  {me.role === 'admin' ? 'Сделать разбор (админ — бесплатно)' : `Сделать разбор — спишется 1 из ${me.balance}`}
                </button>
                {me.role !== 'admin' && me.balance < 1 && <a className="btn ghost" href="/app/billing">Пополнить</a>}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
