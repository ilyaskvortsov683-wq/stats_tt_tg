# 06. HTTP API

База `/api/v1`. JSON. Ошибки: `{"detail": "<код>"}` (FastAPI) или `{"error": {"code", "request_id"}}` (500). Сессия — httpOnly-cookie `sid`; для изменяющих запросов — заголовок `X-CSRF-Token` = cookie `csrf`. Каждый ответ содержит `X-Request-Id`. Локально документация — `/api/docs`.

✅ — реализовано в v0.1, ⏳ — заглушка/позже.

## Вход и профиль
| | Метод | Путь | Описание |
|---|---|---|---|
| ✅ | GET | `/auth/config` | какие способы входа включены |
| ✅ | GET | `/auth/google/login` → `/auth/google/callback` | Google OAuth (PKCE, state в подписанной cookie) |
| ✅ | POST | `/auth/telegram` | данные виджета «Войти через Telegram» (проверка HMAC) |
| ✅ | POST | `/auth/dev-login` | вход по email — только `ENV=local` |
| ✅ | POST | `/auth/logout` | выход |
| ✅ | GET | `/me` | профиль, роль, баланс, пояс/город, согласия, привязка Telegram, сводка истории TikTok |
| ✅ | PATCH | `/me/settings` | `tz`, `city`, `settings`, `consents` |
| ✅ | POST | `/me/telegram-link` | одноразовая ссылка `t.me/<bot>?start=link_<token>` (10 мин) |
| ✅ | DELETE | `/me` | удаление аккаунта и данных |

## Оплата и промокоды
| ✅ | GET | `/products` | пакеты из `config/products.yaml` |
| ✅ | GET | `/me/ledger` | баланс и история движений |
| ✅ | POST | `/payments/yookassa` | `{product_id}` → `{confirmation_url}`; без ключей и локально — тестовая оплата |
| ✅ | POST | `/webhooks/yookassa` | уведомление → перезапрос платежа → начисление (идемпотентно) |
| ✅ | POST | `/payments/mock/{id}/succeed` | только локально |
| ✅ | POST | `/promo/redeem` | `{code}` |

## Разборы
| ✅ | POST | `/runs` | `{source, chat_kind, chat_key, sections[], custom_names[]}` → `{run_id, charge, balance, dictionaries}`; 402 — нет разборов; 400 — только бесплатные сводки |
| ✅ | POST | `/runs/{id}/packet` | gzip JSON пакета → 202; расчёт в фоне |
| ✅ | GET | `/runs`, `/runs/{id}` | список, статус `reserved → queued → computing → rendering → done/failed` |
| ✅ | GET | `/runs/{id}/report.html` | отчёт (строгий CSP); `?mode=&palette=` — тема |
| ⏳ | POST | `/runs/{id}/export` | PDF/PNG — фаза 7 (сейчас 501) |
| ✅ | DELETE | `/runs/{id}` | удалить отчёт |
| ✅ | GET | `/sample/{tg|tt}` | пример отчёта на синтетике (публично) |

## TikTok-история
| ✅ | POST | `/tiktok/history` | `{files: [{file_hash, ts[], video[]}]}` → `{added, duplicates, total, min_ts, max_ts}`; 409 без согласия |
| ✅ | GET | `/tiktok/history/summary` | сводка |
| ✅ | DELETE | `/tiktok/history` | удалить |

## Прочее
| ✅ | GET | `/catalog` | `config/tiers.yaml` |
| ✅ | GET | `/guides/{tg|tt}` | markdown гайда |
| ✅ | POST | `/logs/client` | события браузера (белый список типов, ≤ 50) |
| ✅ | GET | `/healthz` | проверка |

## Админка (`role=admin`)
| ✅ | GET | `/admin/stats?days=` | KPI, популярность сводок |
| ✅ | GET | `/admin/users?q=` · `/admin/users/{id}` | поиск, карточка |
| ✅ | POST | `/admin/users/{id}/grant` | `{runs, reason}` |
| ✅ | GET/POST | `/admin/promos` | список / создание (в т.ч. пачкой) |
| ✅ | PATCH | `/admin/promos/{id}` | включить/выключить |
| ✅ | GET | `/admin/runs?status=` · `/admin/events?level&type&user_ref` | разборы, журнал |
| ⏳ | POST | `/admin/users/{id}/refund` · `/admin/dictionaries/sync` · `/admin/sheets/resync` | фазы 10, 12 |

## Лимиты частоты (⏳ фаза 4)
Аноним 60/мин на IP, пользователь 120/мин, `/promo/redeem` 5/мин и 20/сутки, `/runs` 10/мин.
