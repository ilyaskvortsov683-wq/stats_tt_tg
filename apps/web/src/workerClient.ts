import type { WorkerRequest } from './workers/parse.worker';

let worker: Worker | null = null;
let seq = 0;
const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();

function get(): Worker {
  if (!worker) {
    worker = new Worker(new URL('./workers/parse.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (ev: MessageEvent<{ id: number; ok: boolean; result?: unknown; error?: string }>) => {
      const p = pending.get(ev.data.id);
      if (!p) return;
      pending.delete(ev.data.id);
      if (ev.data.ok) p.resolve(ev.data.result);
      else p.reject(new Error(ev.data.error));
    };
  }
  return worker;
}

/** Один воркер на вкладку: загруженный файл живёт в нём, пока открыта страница (нужно для текста «моментов»). */
export function callWorker<T>(req: WorkerRequest): Promise<T> {
  const id = ++seq;
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
    get().postMessage({ id, req });
  });
}

export function workerErrorText(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (msg === 'not_json') return 'Файл не похож на JSON. Нужен экспорт в формате JSON (машиночитаемый).';
  if (msg === 'not_telegram') return 'Это не экспорт Telegram. Нужен файл result.json из Telegram Desktop.';
  if (msg.startsWith('not_tiktok')) return 'Это не выгрузка TikTok в формате JSON: ' + msg.split(':')[1];
  if (msg === 'zip_not_supported_yet') return 'Распакуйте архив и загрузите JSON-файл из него (поддержка zip — скоро).';
  if (msg === 'file_not_loaded') return 'Загрузите файл чата ещё раз — тексты хранятся только на вашем устройстве, пока открыта вкладка.';
  return 'Не удалось прочитать файл: ' + msg;
}
