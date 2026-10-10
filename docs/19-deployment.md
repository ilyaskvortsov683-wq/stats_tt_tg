# 19. Хостинг и деплой

## Вопрос: Vercel или Netlify?

**Коротко: как основа — нет; рекомендуемое решение — один VPS в РФ.**

| Критерий | Vercel / Netlify | VPS в РФ |
|---|---|---|
| 152-ФЗ: ПД (email, платежи, tg_id, TikTok-история) в БД в РФ | ❌ БД всё равно нужна в РФ — получаем два мира | ✅ |
| Telegram-бот (webhook, локальный bot-api сервер для файлов до 2 ГБ) | ⚠️ webhook можно, локальный bot-api — нельзя | ✅ |
| PDF/PNG через Chromium (RAM, время) | ⚠️ лимиты функций по размеру/таймауту | ✅ |
| Фоновые задачи (напоминания, Sheets, словари, oEmbed) | ⚠️ cron ограничен, очереди платные/внешние | ✅ |
| Доступность из РФ | ⚠️ бывают замедления/блокировки зарубежных CDN | ✅ |
| Стоимость | бесплатно для статики, дальше растёт | ~600–1500 ₽/мес за 2 vCPU / 4 ГБ |
| Простота для автора | ✅ | ✅ после настройки — деплой одной кнопкой в GitHub |

**Где Vercel всё-таки пригодится:** превью фронтенда на каждый PR (по желанию) и крошечный прокси для oEmbed TikTok, если tiktok.com не открывается с российского VPS (docs/17).

## Целевая схема
- **VPS:** Timeweb Cloud / Selectel / Yandex Cloud — 2 vCPU, 4 ГБ RAM, 50 ГБ NVMe, Ubuntu 24.04.
- **Docker Compose** сервисы: `caddy` (TLS Let's Encrypt, статика web, reverse proxy), `api`, `worker`, `bot`, `telegram-bot-api`, `postgres`, `redis`, `backup` (cron pg_dump → age → S3 в РФ).
- **Домен** + DNS у российского регистратора.
- **Мониторинг:** внешний пинг `/healthz` (UptimeRobot или аналог), алерты админу в Telegram.

## CI/CD (GitHub Actions)
- `ci.yml` — на каждый push/PR: lint, typecheck, тесты TS и Python, паритет парсеров, сборка web, сборка docker-образов.
- `deploy.yml` — **только ручной запуск** (`workflow_dispatch`) + GitHub Environment `production` с обязательным подтверждением автора: сборка образов → push в GHCR → SSH на VPS → `docker compose pull && docker compose up -d` → миграции Alembic → smoke-тест `/readyz` → уведомление в Telegram. Откат — запуск с предыдущим тегом.
- Автор нажимает кнопку «Run workflow» в GitHub (или просит Claude запустить) — командная строка не нужна.

## Окружения
- `local` — docker compose локально (для Claude).
- `production` — VPS.
- `staging` — позже, тот же VPS с другим доменом/БД, если понадобится.

## Секреты (`.env.example` в фазе 1)
`DATABASE_URL, REDIS_URL, SESSION_SECRET, USER_REF_SECRET, HISTORY_ENC_KEY, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_SA_JSON, DICT_SHEET_ID, OPS_SHEET_ID, YOOKASSA_SHOP_ID, YOOKASSA_SECRET, TG_BOT_TOKEN, TG_WEBHOOK_SECRET, TG_API_ID, TG_API_HASH (для локального bot-api), ADMIN_EMAILS, ADMIN_TG_CHAT_ID, S3_*, OEMBED_PROXY_URL?`
