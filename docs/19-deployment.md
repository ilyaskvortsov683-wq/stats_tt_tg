# 19. Хостинг и деплой

## Решение: один VPS в РФ (не Vercel/Netlify)
| Критерий | Vercel / Netlify | VPS в РФ |
|---|---|---|
| 152-ФЗ: ПД в БД в РФ | ❌ БД всё равно нужна в РФ | ✅ |
| Бот с файлами до 2 ГБ (локальный Bot API) | ❌ | ✅ |
| PDF/PNG через Chromium | ⚠️ лимиты функций | ✅ |
| Фоновые задачи (Sheets, напоминания, словари) | ⚠️ | ✅ |
| Доступность из РФ | ⚠️ бывают замедления | ✅ |
| Цена | бесплатно для статики | ~600–1500 ₽/мес (2 vCPU / 4 ГБ) |

Vercel может пригодиться только как маленький прокси для oEmbed TikTok (через него идут лишь id видео, docs/17).

## Схема
Timeweb Cloud (или Selectel / Yandex Cloud), Ubuntu 24.04, Docker Compose (`infra/docker-compose.yml`): `caddy` (HTTPS Let's Encrypt, статика сайта, прокси `/api`), `api`, `worker`, `bot`, `postgres`, `redis`; фаза 9 — `telegram-bot-api`; фаза 12 — бэкап в S3 в РФ.

## Кто что делает
**Автор** (мышкой, по [AUTHOR-SETUP.md](AUTHOR-SETUP.md)): аккаунт и сервер в Timeweb, домен и A-запись, проект Google Cloud (OAuth + сервисный аккаунт), бот в BotFather, ЮKassa (после запуска сайта), секреты в GitHub Environment `production`.
**Claude:** всё остальное — Dockerfile'ы, compose, Caddy, workflow, `PROD_ENV` без секретов, проверка после выкладки, разбор логов.

## CI/CD (GitHub Actions)
- `ci.yml` — на каждый push: typecheck и тесты TS, сборка сайта; ruff и pytest для API.
- `deploy.yml` — **только вручную** (Actions → Deploy → Run workflow) и только после подтверждения автора (Environment `production` с Required reviewers). Первый запуск ставит Docker и клонирует репозиторий; каждый запуск записывает `.env` из секрета `PROD_ENV`, пересобирает и перезапускает сервисы, проверяет `/healthz`. Откат — запуск с предыдущим тегом.

## Окружения
`local` (SQLite, вход по email, тестовая оплата), `production` (VPS). `staging` — при необходимости на том же VPS.

## Переменные
Полный список — `.env.example`. Для compose дополнительно: `DOMAIN`, `POSTGRES_PASSWORD`.
