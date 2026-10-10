# 14. Логирование и наблюдаемость

## Где хранятся логи
| Слой | Где | Сколько | Как смотреть |
|---|---|---|---|
| Технические логи (structlog JSON: запросы, ошибки, тайминги) | stdout контейнеров → Docker на VPS, ротация 10 × 50 МБ на сервис | ~1–4 недели | ежедневный архив `logs-YYYY-MM-DD.jsonl.gz` в папку проекта на **вашем Google Диске** (фаза 10); при необходимости — Claude смотрит на сервере |
| Бизнес-события | таблица `events` в PostgreSQL | 180 дней | админка → «Журнал» (фильтры по уровню и типу) |
| Зеркало событий | Google-таблица `ops_log`, листы `events`, `errors` (+ `orders`, `runs`, `users`) | пока не очистите | в Google Sheets |
| Действия админа | `admin_audit` | всегда | админка (фаза 10) |

Логи на Google Диск можно: в них нет текстов и персональных данных (вычистка ниже), только `user_ref`.

## Поля записи
`timestamp, level, event, request_id, user_ref?, run_id?, ms?, status?, …данные`. `request_id` создаётся на входе в API (или берётся из заголовка) и возвращается в `X-Request-Id`; пользователь видит его в тексте ошибки — по нему находится вся цепочка.

## Что запрещено (процессор `scrub_pii` + тест)
Тексты сообщений, содержимое файлов, имена участников и названия чатов, слова, токены и cookie, промокоды целиком, IP, тела webhook целиком. Ключи `text, content, messages, email, tg_id, phone, display_name, title, participants, token, cookie, authorization, password, secret, promo_code, code, ip, words, packet, body` → `[scrubbed]`; email и телефоны в строках маскируются; строки обрезаются до 200 символов; списки — до 20 элементов.

## Уровни
`INFO` — бизнес-события и запросы; `WARNING` — ожидаемые отказы (неверный файл, нет баланса, неверный промокод); `ERROR` — исключения → лист `errors` и (фаза 10) уведомление админу в Telegram с дедупликацией.

## Каталог событий
| Группа | События |
|---|---|
| вход | `auth.login` (provider), `auth.failed`, `auth.tg_linked`, `account.deleted` |
| визиты | `visit.landing`, `visit.app` |
| загрузка | `upload.started` (источник, корзина размера), `upload.parsed` (корзина сообщений, мс), `upload.failed` (причина), `parser.unknown_shape` (только имена ключей) |
| анализ | `analysis.free_computed`, `sections.selected` (id сводок) |
| разборы | `run.reserved` (charge), `run.packet_received` (байт), `packet.invalid`, `run.done` (мс), `run.failed` |
| оплата | `payment.created`, `payment.succeeded`, `payment.canceled`, `payment.create_failed`, `payment.webhook_rejected`, `stars.paid` |
| промокоды | `promo.created`, `promo.redeemed`, `promo.redeem_failed` (причина) |
| TikTok | `tt.history_merged` (добавлено, дублей, всего), `tt.history_deleted` |
| бот | `reminder.created`, `reminder.sent` |
| админ | `admin.grant` |
| клиент | `client.error`, `client.perf` |
| HTTP | `http.request` (метод, путь, статус, мс), `http.unhandled` |

## Здоровье (админка → «Обзор»)
Ошибки за сутки, неудачные разборы; дальше (фаза 10–12): p50/p95 времени, очередь, webhook, синхронизация словарей и таблиц, место на диске, внешний мониторинг `/healthz`.
