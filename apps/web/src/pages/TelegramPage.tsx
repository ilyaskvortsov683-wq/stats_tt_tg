import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Participant, TgChatListItem, TgOverview } from '@stats/parsers';
import { api, countBucket, errorText, sizeBucket, track } from '../api';
import { useAuth } from '../auth';
import { CityPicker } from '../components/CityPicker';
import { GuideDialog } from '../components/GuideDialog';
import { SectionPicker } from '../components/SectionPicker';
import { Dropzone, fmtDate, fmtN, HBars, Kpis, Notice, Progress } from '../components/ui';
import { TG_SECTIONS } from '../data/sections';
import { runAnalysis, STAGE_TEXT, type RunStage } from '../runFlow';
import { callWorker, workerErrorText } from '../workerClient';

interface ChatInfo { title: string; kind: 'personal' | 'group'; chatId: string; count: number; participants: Participant[]; exporterOffsetMin: number | null }

const SAVED_KEY = 'tg-sections';

export function TelegramPage() {
  const { me, refresh } = useAuth();
  const nav = useNavigate();
  const [guide, setGuide] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [chats, setChats] = useState<TgChatListItem[] | null>(null);
  const [chat, setChat] = useState<ChatInfo | null>(null);
  const [owner, setOwner] = useState<string>('');
  const [tz, setTz] = useState(me?.tz ?? 'Europe/Moscow');
  const [overview, setOverview] = useState<TgOverview | null>(null);
  const [selected, setSelected] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem(SAVED_KEY) || 'null') ?? ['tg.rhythm', 'tg.clock', 'tg.dialog', 'tg.moments']; } catch { return ['tg.rhythm']; }
  });
  const [words, setWords] = useState('');
  const [names, setNames] = useState('');
  const [hideNames, setHideNames] = useState(false);
  const [stage, setStage] = useState<{ s: RunStage; info?: string } | null>(null);

  useEffect(() => { try { localStorage.setItem(SAVED_KEY, JSON.stringify(selected)); } catch { /* пусто */ } }, [selected]);
  useEffect(() => {
    if (!chat) return;
    callWorker<TgOverview>({ type: 'tgOverview', tz }).then(setOverview).catch((e) => setError(workerErrorText(e)));
  }, [chat, tz]);

  async function onFile(files: File[]) {
    const f = files[0];
    setError(null); setChats(null); setChat(null); setOverview(null);
    setBusy('Читаем файл на вашем устройстве…');
    track('upload.started', { source: 'tg', size: sizeBucket(f.size) });
    const t0 = performance.now();
    try {
      const r = await callWorker<{ chats: TgChatListItem[] }>({ type: 'parseTelegram', file: f });
      const nonEmpty = r.chats.filter((c) => c.count > 0);
      if (nonEmpty.length === 1) await selectChat(nonEmpty[0].index, t0, f.size);
      else setChats(nonEmpty);
    } catch (e) {
      setError(workerErrorText(e));
      track('upload.failed', { source: 'tg', reason: e instanceof Error ? e.message : 'unknown' });
    } finally {
      setBusy(null);
    }
  }

  async function selectChat(index: number, t0 = performance.now(), size = 0) {
    setBusy('Разбираем чат…');
    const info = await callWorker<ChatInfo>({ type: 'selectTelegramChat', index });
    setChat(info);
    setChats(null);
    setOwner(info.participants[0]?.key ?? '');
    track('upload.parsed', { source: 'tg', kind: info.kind, messages: countBucket(info.count), size: sizeBucket(size), ms: Math.round(performance.now() - t0) });
    track('analysis.free_computed', { source: 'tg', kind: info.kind });
    setBusy(null);
  }

  async function saveTz(newTz: string, city: string) {
    setTz(newTz);
    if (me) await api('/me/settings', { method: 'PATCH', json: { tz: newTz, city } }).catch(() => undefined);
  }

  async function startRun() {
    if (!chat) return;
    setError(null);
    const sections = ['tg.overview', ...selected.filter((s) => TG_SECTIONS.find((x) => x.id === s && !x.free && (!x.only || x.only === chat.kind)))];
    track('sections.selected', { source: 'tg', sections });
    try {
      const id = await runAnalysis({
        source: 'tg', chatKind: chat.kind, chatKey: chat.chatId, sections, tz,
        customPatterns: words.split(',').map((w) => w.trim()).filter(Boolean),
        customNames: names.split(',').map((w) => w.trim()).filter(Boolean),
        hideNames, ownerKey: owner || undefined,
      }, (s, info) => setStage({ s, info }));
      await refresh();
      nav(`/app/reports/${id}?source=tg`);
    } catch (e) {
      setStage(null);
      setError(errorText(e));
      await refresh();
    }
  }

  const paidSelected = selected.filter((s) => TG_SECTIONS.find((x) => x.id === s && !x.free));

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <div className="eyebrow">Telegram</div>
          <h1>Разбор переписки</h1>
          <p className="lead">Загрузите экспорт чата — файл обработается прямо в браузере и никуда не уйдёт.</p>
        </div>
        <button className="btn ghost" onClick={() => setGuide(true)}>Как выгрузить чат?</button>
      </header>
      <GuideDialog source="tg" open={guide} onClose={() => setGuide(false)} />

      {!chat && <Dropzone accept=".json,application/json" onFiles={onFile} hint="result.json из Telegram Desktop" />}
      {busy && <Progress label={busy} />}
      {error && <Notice kind="error">{error}</Notice>}

      {chats && (
        <section className="block">
          <h2>В экспорте несколько чатов — выберите один</h2>
          <div className="list">
            {chats.map((c) => (
              <button key={c.index} className="list-item" onClick={() => void selectChat(c.index)}>
                <span>{c.name}</span><span className="muted">{fmtN(c.count)} сообщ.</span>
              </button>
            ))}
          </div>
        </section>
      )}

      {chat && (
        <>
          <section className="block">
            <div className="row between wrap">
              <h2>{chat.title}</h2>
              <button className="btn ghost small" onClick={() => { setChat(null); setOverview(null); }}>Другой файл</button>
            </div>
            <div className="grid-2">
              {chat.kind === 'personal' && (
                <label className="field">
                  <span>Кто из них вы?</span>
                  <select value={owner} onChange={(e) => setOwner(e.target.value)}>
                    {chat.participants.map((p) => <option key={p.key} value={p.key}>{p.displayName}</option>)}
                  </select>
                </label>
              )}
              <CityPicker tz={tz} onChange={saveTz} exporterOffsetMin={chat.exporterOffsetMin} />
            </div>
          </section>

          {overview && (
            <section className="block">
              <div className="eyebrow">Бесплатно</div>
              <h2>{fmtN(overview.total)} сообщений</h2>
              <p className="muted">{fmtDate(overview.firstTs, tz)} — {fmtDate(overview.lastTs, tz)} · {fmtN(overview.days)} дн., из них активных {fmtN(overview.activeDays)}</p>
              <Kpis items={[
                { value: fmtN(overview.total), label: 'всего сообщений' },
                { value: overview.byParticipant.length, label: 'участников' },
                { value: (overview.total / Math.max(overview.activeDays, 1)).toFixed(1).replace('.', ','), label: 'в активный день' },
              ]} />
              <HBars rows={overview.byParticipant.slice(0, 20).map((p) => ({ label: p.name, value: p.count, note: Math.round(p.share * 100) + '%' }))} />
            </section>
          )}

          <section className="block">
            <h2>Что посчитать в разборе</h2>
            <SectionPicker sections={TG_SECTIONS} selected={selected} onChange={setSelected} isAdmin={me?.role === 'admin'} chatKind={chat.kind} />
            {selected.includes('tg.words') && (
              <label className="field">
                <span>Свои слова или маски через запятую: <code>котик, росси*, д*а*</code></span>
                <input value={words} onChange={(e) => setWords(e.target.value)} placeholder="котик, росси*" />
              </label>
            )}
            {selected.includes('tg.names') && (
              <label className="field">
                <span>Свои имена и прозвища через запятую (формы посчитаем сами)</span>
                <input value={names} onChange={(e) => setNames(e.target.value)} placeholder="Котя, Зая" />
              </label>
            )}
            <label className="check">
              <input type="checkbox" checked={hideNames} onChange={(e) => setHideNames(e.target.checked)} />
              Скрыть имена в отчёте (будут «Участник A/B»)
            </label>
            {!me ? (
              <Notice>Чтобы сделать разбор, войдите в аккаунт.</Notice>
            ) : stage ? (
              <Progress label={(stage.info ? stage.info + ' · ' : '') + STAGE_TEXT[stage.s]} />
            ) : (
              <div className="cta-row">
                <button className="btn big" disabled={!paidSelected.length} onClick={() => void startRun()}>
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
