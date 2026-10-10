# 08. Аккаунты и вход

## Google OAuth (основной вход)
- Authorization Code + PKCE на бэкенде (`/auth/google/login` → `/auth/google/callback`). Scopes: `openid email profile`.
- Проверка `id_token` (подпись, `aud`, `iss`, `exp`, `email_verified`).
- Создаётся `users` + `identities(provider='google', subject=sub)`. Сессия — случайный токен в httpOnly Secure cookie, в БД хранится хэш.
- Требуется проект в Google Cloud Console: OAuth consent screen (External), домен, политика конфиденциальности, redirect URI. Пока приложение в режиме «Testing» — до 100 тестовых пользователей; для запуска нужна публикация (для базовых scopes проверка простая).
- Риск: доступность Google-входа из РФ. Резерв — вход через Telegram (виджет Login или через бота) как вторая идентичность; в будущем — Яндекс ID. Архитектура `identities` это позволяет.

## Что доступно без входа
- Лендинг, пример отчёта, гайды экспорта.
- **Анализ — только после входа** (по решению автора: «общее приложение со входом по Google»). Это даёт честную статистику, сохранение выбора, историю разборов. Флаг `FREE_REQUIRES_LOGIN` в конфиге на случай, если конверсия окажется низкой.

## Привязка Telegram
1. В веб-профиле «Привязать Telegram» → `POST /me/telegram-link` → ссылка `t.me/<bot>?start=link_<token>`.
2. Бот получает `/start link_<token>`, проверяет токен (хэш, TTL, одноразовость), создаёт `identities(provider='telegram', subject=tg_user_id)`.
3. Если человек пришёл в бота первым: бот предлагает «Войти через Google» — открывает сайт с одноразовым токеном, после Google-входа идентичности связываются.
4. Mini App: проверка `initData` по HMAC-SHA256 с ключом от токена бота, `auth_date` не старше 24 ч.

## Роли
- `user` — обычный.
- `admin` — email из переменной `ADMIN_EMAILS` (через запятую) получает роль при входе. Роль `admin`: все сводки бесплатно, доступ к `/admin`, разборы помечаются `charge=admin`.
- Все действия в админке → `admin_audit`.

## Безопасность сессий
- Cookie: `HttpOnly; Secure; SameSite=Lax; Path=/`, срок 30 дней со скользящим продлением.
- CSRF: double-submit token для мутаций.
- Выход со всех устройств — в профиле.
