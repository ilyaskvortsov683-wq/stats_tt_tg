# 06. HTTP API

Базовый путь `/api/v1`. JSON, ошибки в формате `{"error": {"code": "…", "message": "…", "request_id": "…"}}`. Аутентификация — httpOnly-cookie сессии (`SameSite=Lax`), для мутаций — заголовок `X-CSRF-Token`. Каждый ответ содержит `X-Request-Id`.

## Аутентификация и профиль
| Метод | Путь | Описание |
|---|---|---|
| GET | `/auth/google/login` | редирект на Google (PKCE, state) |
| GET | `/auth/google/callback` | обмен кода, создание/вход пользователя, cookie |
| POST | `/auth/logout` | выход |
| GET | `/me` | профиль, роль, баланс, привязан ли Telegram, настройки (тема, палитра, сохранение истории) |
| PATCH | `/me/settings` | тема/палитра/часовой пояс/согласия |
| POST | `/me/telegram-link` | одноразовая ссылка `t.me/<bot>?start=link_<token>` (TTL 10 мин) |
| DELETE | `/me` | удаление аккаунта и всех данных (кроме того, что обязаны хранить по закону — платежи) |

## Каталог и оплата
| GET | `/products` | пакеты из `config/products.yaml` |
| POST | `/payments/yookassa` | `{product_id, promo_code?}` → `{confirmation_url}` |
| POST | `/webhooks/yookassa` | webhook; проверка IP-диапазонов ЮKassa + перезапрос платежа по API |
| POST | `/promo/redeem` | `{code}` → `{granted_runs | discount}` |
| GET | `/me/ledger` | история движений разборов |

## Разборы
| POST | `/runs` | `{source, chat_kind, chat_fingerprint, sections[]}` → `{run_id, status: "reserved", free_rerun: bool, ticket, dictionaries}`; 402 если нет баланса |
| POST | `/runs/{id}/packet` | тело — gzip JSON пакета (`Content-Encoding: gzip`) → 202 |
| GET | `/runs/{id}` | статус: `reserved → queued → computing → rendering → done | failed` |
| GET | `/runs/{id}/events` | SSE с прогрессом |
| GET | `/runs/{id}/report.html` | отчёт (`?theme=light|dark|<palette>`) |
| POST | `/runs/{id}/export` | `{format: pdf|png_full|png_cards, theme}` → задача → `{export_id}` |
| GET | `/exports/{id}` | файл или статус |
| GET | `/runs` | мои разборы |
| DELETE | `/runs/{id}` | удалить отчёт |

## TikTok-история
| POST | `/tiktok/history` | gzip `{files: [{file_hash, owner, views: {ts[], video_id[]}}]}` → `{added, duplicates, total, period}` |
| GET | `/tiktok/history/summary` | число просмотров, период, число выгрузок, даты |
| DELETE | `/tiktok/history` | удалить историю |

## Прочее
| GET | `/guides/{tg|tt}` | контент гайда (из `docs/guides`, собирается при сборке) |
| POST | `/logs/client` | ошибки и события клиента (батч, лимит 50/мин) |
| GET/PUT | `/me/reminders` | напоминания (дублирует бот) |
| POST | `/tg/webhook/{secret}` | webhook бота |
| GET | `/healthz`, `/readyz` | проверки |

## Админка (`role=admin`)
| GET | `/admin/stats?from&to` | KPI и ряды (docs/15) |
| GET | `/admin/users?q=` | поиск пользователей |
| GET | `/admin/users/{id}` | профиль, журнал, разборы, события |
| POST | `/admin/users/{id}/grant` | `{runs, reason}` |
| POST | `/admin/users/{id}/refund` | возврат платежа |
| GET/POST | `/admin/promos` | список / генерация (docs/09) |
| PATCH | `/admin/promos/{id}` | отключить, продлить |
| GET | `/admin/runs?status=` | разборы, ошибки |
| GET | `/admin/events?level&type&user&from&to` | журнал событий |
| POST | `/admin/dictionaries/sync` | синхронизировать словари с Drive сейчас |
| GET | `/admin/dictionaries` | версии, ошибки валидации |
| POST | `/admin/sheets/resync` | перевыгрузить журнал в Google Sheets |

## Ограничения частоты
- Аноним: 60 запросов/мин на IP. Пользователь: 120/мин. `/promo/redeem`: 5/мин и 20/сутки на пользователя (перебор кодов). `/runs`: 10/мин.
