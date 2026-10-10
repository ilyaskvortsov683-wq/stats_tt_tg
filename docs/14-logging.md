# 14. Логирование и наблюдаемость

## Два слоя
1. **Технические логи** — structlog JSON в stdout всех контейнеров (api, worker, bot, web-клиент через `/logs/client`). Docker хранит с ротацией (`max-size 50m, max-file 10`). Позже — Loki/Grafana при необходимости.
2. **Бизнес-события** — таблица `events` (для админки и выборок) + зеркало ключевых событий в Google Sheets (через `sheets_outbox`).

## Поля каждой записи
`ts, level, service (api|worker|bot|web), event (строковый тип), request_id, run_id?, user_ref?, duration_ms?, status?, error_code?, data{}`.

- `request_id` создаётся в Caddy/api и протаскивается в задачи worker и ответы бота — одна цепочка от клика до PDF.
- `user_ref` — HMAC от user_id; email и tg_id в логах **запрещены**.

## Что запрещено логировать (фильтр-процессор structlog + тест)
Тексты сообщений, содержимое файлов, имена участников чатов, названия чатов, слова, токены сессий, cookie, промокоды целиком (только первые 4 символа), IP в открытом виде (только хэш /24), заголовки `Authorization`, тела webhook платёжки целиком (только id и статус).

Процессор `scrub_pii` удаляет запрещённые ключи и обрезает строки длиннее 200 символов. Юнит-тест прогоняет каждый тип события с «ядовитыми» данными и проверяет, что они не попали в вывод.

## Уровни
- `DEBUG` — только локально.
- `INFO` — бизнес-события и границы шагов.
- `WARNING` — ожидаемые отказы (невалидный файл, нет баланса, неверный промокод).
- `ERROR` — исключения; уходят уведомлением админу в Telegram (с дедупликацией по `error_code` раз в 15 мин).

## Каталог событий (минимум)
| Группа | События |
|---|---|
| auth | `auth.login`, `auth.logout`, `auth.failed`, `auth.tg_linked` |
| visit | `visit.landing`, `visit.app` (utm, source: site/bot/miniapp) |
| upload | `upload.started`, `upload.parsed` (source, kind, size_bucket, messages_bucket, parse_ms), `upload.failed` (reason), `parser.unknown_shape` (только имена ключей) |
| analysis | `analysis.free_computed`, `sections.selected` (список id) |
| runs | `run.reserved`, `run.packet_received` (bytes), `run.computed` (ms), `run.rendered`, `run.done`, `run.failed` (error_code), `run.released`, `run.free_rerun` |
| export | `export.requested`, `export.done` (format, ms), `export.failed` |
| billing | `payment.created`, `payment.succeeded`, `payment.canceled`, `payment.refunded`, `stars.paid` |
| promo | `promo.created`, `promo.redeemed`, `promo.redeem_failed` (reason) |
| tiktok | `tt.history_merged` (added, duplicates, total), `tt.history_deleted`, `oembed.batch` (ok, unavailable, errors) |
| bot | `bot.command`, `bot.file_received` (size_bucket), `reminder.created/sent/clicked/disabled` |
| dictionaries | `dict.sync_started`, `dict.sync_ok` (versions), `dict.sync_invalid` (errors) |
| admin | `admin.*` (+ admin_audit) |
| client | `client.error` (message, stack без данных), `client.perf` |

## Метрики здоровья (в админке)
Ошибки за 24 ч по типам, p50/p95 времени парсинга/разбора/экспорта, длина очереди, неудачные webhook, последняя синхронизация словарей и Sheets, место на диске.

## Хранение
`events` — 180 дней; технические логи — ротация ~500 МБ на сервис; ошибки клиента — 30 дней.
