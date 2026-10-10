import { api, track } from './api';
import { callWorker } from './workerClient';

export interface RunParams {
  source: 'tg' | 'tt';
  chatKind: 'personal' | 'group' | 'account';
  chatKey: string;
  sections: string[];
  tz: string;
  customPatterns?: string[];
  customNames?: string[];
  hideNames?: boolean;
  ownerKey?: string;
  chatIndex?: number | null;
  useHistory?: boolean;
}

export type RunStage = 'reserve' | 'packet' | 'upload' | 'compute' | 'done';

/** Резерв разбора → сборка пакета в воркере → отправка → ожидание отчёта. Возвращает id разбора. */
export async function runAnalysis(p: RunParams, onStage: (s: RunStage, info?: string) => void): Promise<string> {
  onStage('reserve');
  const run = await api<{ run_id: string; charge: string; dictionaries: unknown }>('/runs', {
    json: { source: p.source, chat_kind: p.chatKind, chat_key: p.chatKey, sections: p.sections, custom_names: p.customNames ?? [] },
  });
  onStage('packet', run.charge === 'free_rerun' ? 'Повторный разбор этого чата — бесплатно' : undefined);
  const built = await callWorker<{ body: ArrayBuffer; gzBytes: number; rawBytes: number }>({
    type: 'buildPacket',
    source: p.source,
    chatIndex: p.chatIndex ?? null,
    useHistory: !!p.useHistory,
    opts: {
      sections: p.sections, tz: p.tz, dictionaries: run.dictionaries as never,
      customPatterns: p.customPatterns, hideNames: p.hideNames, ownerKey: p.ownerKey,
    },
  });
  onStage('upload', `${Math.max(1, Math.round(built.gzBytes / 1024))} КБ`);
  await api(`/runs/${run.run_id}/packet`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Encoding': 'gzip' },
    body: new Blob([built.body]),
  });
  onStage('compute');
  const started = Date.now();
  for (;;) {
    await new Promise((r) => setTimeout(r, 1200));
    const st = await api<{ status: string; error_code: string | null }>(`/runs/${run.run_id}`);
    if (st.status === 'done') break;
    if (st.status === 'failed') {
      track('client.error', { where: 'run', code: st.error_code });
      throw new Error('run_failed');
    }
    if (Date.now() - started > 5 * 60_000) throw new Error('run_timeout');
  }
  onStage('done');
  return run.run_id;
}

export const STAGE_TEXT: Record<RunStage, string> = {
  reserve: 'Резервируем разбор…',
  packet: 'Собираем обезличенный пакет на вашем устройстве…',
  upload: 'Отправляем счётчики (без текстов)…',
  compute: 'Считаем и рисуем отчёт…',
  done: 'Готово',
};
