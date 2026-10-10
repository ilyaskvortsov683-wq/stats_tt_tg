# 07. База данных

Прод — PostgreSQL 16, локально и в тестах — SQLite. Модели — `apps/api/app/models.py`. v0.1 создаёт таблицы при старте (`create_all`); миграции Alembic — фаза 4 (до первых реальных пользователей).

| Таблица | Назначение |
|---|---|
| `users` | email, имя, роль, `user_ref` (псевдоним), `tz`, `city`, `settings`, `consents`, даты, `deleted_at` |
| `identities` | способы входа: `google` / `telegram` / `dev` + subject (уникально) |
| `sessions` | хэш токена сессии, срок |
| `telegram_link_tokens` | одноразовые токены привязки бота |
| `wallets` | баланс разборов (`CHECK`-логика в коде: `UPDATE … WHERE balance >= 1`) |
| `ledger` | движения разборов: purchase, promo, admin_grant, run_reserve, run_release, refund |
| `payments` | ЮKassa / Stars / mock: сумма, валюта (RUB копейки / XTR), разборов, статус, уникально `(provider, provider_payment_id)` |
| `promo_codes`, `promo_redemptions` | коды (runs / discount_percent / fixed_price; personal / global; лимит, срок) и применения (уникально код+пользователь) |
| `runs` | разборы: источник, отпечаток, сводки, статус, списание (paid / free_rerun / admin), ошибки, тайминги, путь к отчёту |
| `tt_history`, `tt_history_files` | зашифрованная история просмотров; хэши загруженных файлов |
| `reminders` | напоминания бота |
| `dictionary_versions` | версии словарей из Google-таблицы (фаза 10) |
| `events` | бизнес-события без ПД |
| `admin_audit` | действия админа |
| `sheets_outbox` | очередь строк для Google Sheets |

## Атомарность разборов
```
UPDATE wallets SET balance = balance - 1 WHERE user_id = :u AND balance >= 1 RETURNING balance;
-- нет строки → 402; есть → INSERT ledger(-1, run_reserve)
```
Повтор (тот же отпечаток, успешный платный/админский разбор ≤ 30 дней) — `charge=free_rerun` без списания. Ошибка разбора → `ledger(+1, run_release)` (идемпотентно).

## Хранение
Отчёты — 90 дней (`report_retention_days`), события — 180 дней, история TikTok — пока пользователь не удалит (или 24 мес. неактивности), платежи — 5 лет (обезличенно после удаления аккаунта).
