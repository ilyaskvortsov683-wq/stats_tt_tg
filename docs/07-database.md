# 07. База данных (PostgreSQL)

Все таймстемпы — `timestamptz` UTC. Первичные ключи — `uuid` (v7). Миграции — Alembic.

```sql
-- Пользователи и идентичности
users (
  id uuid pk, email citext unique, display_name text, avatar_url text,
  role text not null default 'user',          -- user | admin
  user_ref text unique not null,              -- HMAC(user_id) для Google Sheets и логов
  tz text default 'Europe/Moscow',
  settings jsonb default '{}',                -- тема, палитра, последние галочки, согласия
  created_at, last_seen_at, deleted_at
)
identities (id, user_id fk, provider text,     -- google | telegram
            subject text, created_at, unique(provider, subject))
sessions (id, user_id, token_hash, created_at, expires_at, ip_hash, user_agent)
telegram_link_tokens (token_hash pk, user_id, expires_at, used_at)

-- Деньги и разборы
products — в config/products.yaml (не в БД), id продукта пишется в payments
payments (
  id, user_id, provider text,                 -- yookassa | stars | admin
  provider_payment_id text, unique(provider, provider_payment_id),
  product_id text, amount_minor int, currency text,  -- RUB копейки | XTR
  runs int, promo_code_id null, status text,  -- pending | succeeded | canceled | refunded
  raw jsonb, created_at, updated_at
)
ledger (                                       -- неизменяемый журнал
  id bigserial, user_id, delta int,            -- +5, -1, +1 (возврат резерва)
  reason text,                                 -- purchase | promo | admin_grant | run_reserve | run_release | refund
  payment_id null, promo_redemption_id null, run_id null,
  created_at
)
-- баланс = sum(delta); материализован в wallets для скорости, обновляется в той же транзакции
wallets (user_id pk, balance int not null check (balance >= 0), updated_at)

promo_codes (
  id, code text unique,                        -- хранится в верхнем регистре
  kind text,                                   -- runs | discount_percent | fixed_price
  value int,                                   -- число разборов / процент / цена в копейках
  scope text,                                  -- personal | global
  user_id null,                                -- для personal
  max_redemptions int null,                    -- для global: общий лимит (null — без лимита)
  redemptions int default 0,
  valid_from, valid_until null, disabled_at null,
  note text, created_by, created_at
)
promo_redemptions (id, promo_code_id, user_id, payment_id null, created_at,
                   unique(promo_code_id, user_id))   -- один раз на пользователя

-- Разборы и отчёты
runs (
  id, user_id, source text, chat_kind text,
  chat_fingerprint text, sections text[],
  status text, charge text,                   -- paid | free_rerun | admin | free
  error_code text null, packet_bytes int, timings jsonb,
  created_at, finished_at
)
create index on runs(user_id, chat_fingerprint, created_at);
reports (run_id pk, html_path text, expires_at, deleted_at)   -- файлы на диске/S3, шифрование at-rest
exports (id, run_id, format, theme, status, path, created_at)

-- TikTok
tt_history (
  user_id pk, blob bytea,                      -- zstd(колонки ts:int64[], video_id:int64[]), шифр. AES-GCM
  views int, min_ts, max_ts, files_count int, updated_at
)
tt_history_files (id, user_id, file_hash text, owner text, views int, period_from, period_to,
                  created_at, unique(user_id, file_hash))
tt_video_meta (video_id bigint pk, author text, caption text, hashtags text[],
               status text,                    -- ok | unavailable | error
               fetched_at)                     -- общий кэш, не ПД пользователя

-- Бот
reminders (id, user_id, kind text,             -- tt_export_ready | tt_refresh
           due_at, repeat_rule text null, status text, created_at, sent_at)

-- Словари
dictionary_versions (id, name text, version text, checksum, entries int,
                     source text,              -- drive | seed
                     payload jsonb, valid bool, errors jsonb, created_at, is_active bool)

-- Журналы
events (id bigserial, ts, level, type text, user_ref text null, run_id null,
        request_id text, source text, data jsonb)   -- без ПД и без текстов (docs/14)
admin_audit (id, admin_id, action, target, data jsonb, ts)
sheets_outbox (id bigserial, sheet text, row jsonb, created_at, sent_at null, attempts int)
```

## Транзакция резерва разбора (псевдо)
```
BEGIN;
  SELECT … FROM wallets WHERE user_id = :u FOR UPDATE;
  -- бесплатный повтор?
  SELECT 1 FROM runs WHERE user_id=:u AND chat_fingerprint=:f AND status='done'
         AND charge IN ('paid','admin') AND created_at > now() - interval '30 days';
  -- иначе, если не админ: balance >= 1 → INSERT ledger(-1, run_reserve); UPDATE wallets
COMMIT;
```
При `failed` — `ledger(+1, run_release)` в одной транзакции со сменой статуса.

## Хранение и удаление
- Отчёты — 90 дней, затем удаляются (пользователь может удалить раньше).
- `events` — 180 дней, `sessions` — до истечения.
- `tt_history` — пока пользователь не удалит или 24 мес. неактивности.
- `payments` — 5 лет (бухучёт), даже после удаления аккаунта (обезличенно).
