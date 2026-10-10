# stats_tt_tg — «Разбор» переписок и TikTok

Веб-приложение (и Telegram-бот как второй вход) для красивой статистики по экспортам:

- **Telegram** — `result.json` личного чата или беседы;
- **TikTok** — выгрузка данных аккаунта в JSON (история просмотров, лайки, избранное, входы, личные сообщения).

Что-то вроде «Wrapped» для переписок и экранного времени. Без ML: только честная статистика, подсчёты, регулярные выражения и словари.

> Статус: **проектирование**. Кода ещё нет. Репозиторий содержит план, архитектуру, спецификации и дорожную карту, по которым приложение будет написано пофазно.

## С чего начать

| Если вы… | Читайте |
|---|---|
| хотите понять идею целиком | [docs/00-vision.md](docs/00-vision.md) |
| хотите знать, что умеет продукт и сколько стоит | [docs/01-product.md](docs/01-product.md) |
| садитесь писать код | [CLAUDE.md](CLAUDE.md) → [docs/ROADMAP.md](docs/ROADMAP.md) → документ нужной фазы |
| хотите увидеть, как выглядит результат | [docs/report-sample.md](docs/report-sample.md) |
| хотите понять, как работать с Claude над проектом | [docs/WORKFLOW.md](docs/WORKFLOW.md) |

## Карта документов

| № | Документ | О чём |
|---|---|---|
| 00 | [vision](docs/00-vision.md) | цель, принципы, глоссарий, ключевые решения |
| 01 | [product](docs/01-product.md) | функции, сводки-галочки, бесплатное/платное, тариф «5 разборов» |
| 02 | [architecture](docs/02-architecture.md) | компоненты, потоки данных, стек, структура монорепо, ADR |
| 03 | [data-formats](docs/03-data-formats.md) | структура экспортов Telegram и TikTok, подводные камни |
| 04 | [metrics-catalog](docs/04-metrics-catalog.md) | каждая метрика: id, тариф, формула, визуализация |
| 05 | [aggregate-packet](docs/05-aggregate-packet.md) | обезличенный пакет агрегатов браузер → сервер |
| 06 | [api](docs/06-api.md) | HTTP API |
| 07 | [database](docs/07-database.md) | схема PostgreSQL |
| 08 | [auth-accounts](docs/08-auth-accounts.md) | вход через Google, привязка Telegram, роли |
| 09 | [billing-runs-promo](docs/09-billing-runs-promo.md) | разборы, оплата ЮKassa/Stars, промокоды, админ бесплатно |
| 10 | [telegram-bot](docs/10-telegram-bot.md) | бот: загрузка файлов, склейка, напоминания, Stars |
| 11 | [frontend-ux](docs/11-frontend-ux.md) | экраны, сценарии, гайды экспорта |
| 12 | [design-system](docs/12-design-system.md) | темы, палитры, типографика, графики |
| 13 | [reports-export](docs/13-reports-export.md) | отчёт HTML/PDF/PNG, адаптивность, карточки для шаринга |
| 14 | [logging](docs/14-logging.md) | подробное логирование и наблюдаемость |
| 15 | [admin](docs/15-admin.md) | админка: статистика, промокоды, пользователи, логи |
| 16 | [google-integrations](docs/16-google-integrations.md) | Google Sheets (журналы), Google Drive (словари мата и имён) |
| 17 | [tiktok-content](docs/17-tiktok-content.md) | можно ли анализировать содержание тиктоков |
| 18 | [security-privacy-legal](docs/18-security-privacy-legal.md) | приватность, 152-ФЗ, оферта |
| 19 | [deployment](docs/19-deployment.md) | хостинг (VPS в РФ vs Vercel/Netlify), CI/CD |
| 20 | [testing](docs/20-testing.md) | тесты, фикстуры, синтетические данные |
| — | [ROADMAP](docs/ROADMAP.md) | фазы, задачи, критерии приёмки, промпты для исполнителя |
| — | [OPEN-QUESTIONS](docs/OPEN-QUESTIONS.md) | что ещё нужно решить автору |
| — | [guides/](docs/guides/) | пошаговые гайды экспорта данных из TikTok и Telegram |

Проектные скиллы для Claude Code лежат в [`.claude/skills/`](.claude/skills/).
