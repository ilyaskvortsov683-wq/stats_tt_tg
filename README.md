# stats_tt_tg — «Разбор» переписок и TikTok

Веб-приложение (и Telegram-бот как второй вход) для красивой статистики по экспортам:

- **Telegram** — `result.json` личного чата или беседы;
- **TikTok** — выгрузка данных аккаунта в JSON (история просмотров, лайки, избранное, входы, личные сообщения).

Без ML: честная статистика, подсчёты, регулярные выражения и словари. Тексты переписок не покидают устройство пользователя.

> Статус: **v0.1 — первая версия с заглушками.** Работают: разбор файлов в браузере, бесплатные сводки, выбор сводок, разборы с балансом, промокоды, тестовая оплата, ЮKassa (код), отчёт с выбором периода в любой сводке, монологи и диалоги, склейка истории TikTok, админка, бот (напоминания, звёзды). Заглушки: PDF/PNG, загрузка файлов в бота, Google Sheets/Drive без ключей, содержание тиктоков, юридические тексты. Подробно — [docs/ROADMAP.md](docs/ROADMAP.md).

## Структура
```
apps/web/            сайт + админка (React, Vite, TypeScript)
apps/api/            API (FastAPI), воркер (arq), Telegram-бот (aiogram) — один Python-пакет
packages/parsers/    разбор экспортов в браузере, бесплатные метрики, сборка пакета (TypeScript)
packages/design-tokens/  палитры и токены (общие для сайта и отчёта)
config/              тарифы, цены, пороги метрик — меняются без кода
dictionaries/seed/   стартовые словари (имена, стоп-слова, смех, корни мата)
infra/               Docker, Caddy, docker-compose для VPS
docs/                план, спецификации, гайды
```

## С чего начать
| Если вы… | Читайте |
|---|---|
| автор и хотите понять, что нужно сделать руками | [docs/AUTHOR-SETUP.md](docs/AUTHOR-SETUP.md) |
| хотите понять продукт и тарифы | [docs/00-vision.md](docs/00-vision.md), [docs/01-product.md](docs/01-product.md) |
| хотите посмотреть результат | `/sample` в приложении, [docs/report-sample.md](docs/report-sample.md) |
| садитесь писать код | [CLAUDE.md](CLAUDE.md) → [docs/ROADMAP.md](docs/ROADMAP.md) |
| ищете, где смотреть покупки и логи | [docs/22-data-access.md](docs/22-data-access.md) |

## Документы
00 [vision](docs/00-vision.md) · 01 [product](docs/01-product.md) · 02 [architecture](docs/02-architecture.md) · 03 [data-formats](docs/03-data-formats.md) · 04 [metrics](docs/04-metrics-catalog.md) · 05 [packet](docs/05-aggregate-packet.md) · 06 [api](docs/06-api.md) · 07 [database](docs/07-database.md) · 08 [auth](docs/08-auth-accounts.md) · 09 [billing](docs/09-billing-runs-promo.md) · 10 [bot](docs/10-telegram-bot.md) · 11 [ux](docs/11-frontend-ux.md) · 12 [design](docs/12-design-system.md) · 13 [reports](docs/13-reports-export.md) · 14 [logging](docs/14-logging.md) · 15 [admin](docs/15-admin.md) · 16 [google](docs/16-google-integrations.md) · 17 [tiktok-content](docs/17-tiktok-content.md) · 18 [privacy-legal](docs/18-security-privacy-legal.md) · 19 [deployment](docs/19-deployment.md) · 20 [testing](docs/20-testing.md) · 21 [payments](docs/21-payments.md) · 22 [data-access](docs/22-data-access.md) · [ROADMAP](docs/ROADMAP.md) · [OPEN-QUESTIONS](docs/OPEN-QUESTIONS.md) · [WORKFLOW](docs/WORKFLOW.md) · [гайды экспорта](docs/guides/)

## Локальный запуск (делает Claude)
```
pnpm install && pnpm dev:web                         # сайт на :5173
cd apps/api && uv venv && uv pip install -r pyproject.toml --extra dev
uv run --no-sync uvicorn app.main:app --reload        # API на :8000 (SQLite, вход по email без пароля)
uv run --no-sync pytest                               # тесты API
pnpm -r test                                          # тесты парсеров
```
