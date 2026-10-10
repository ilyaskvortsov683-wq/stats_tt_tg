# CLAUDE.md — правила для исполнителя

Этот файл читается Claude Code автоматически в каждой сессии. Следуй ему всегда.

## Об авторе и процессе

- Автор — программист (Python, статистика), но **не работает с командной строкой**. Все команды запускаешь ты; автор только подтверждает действия.
- Язык общения, документации, комментариев и UI — **русский**. Идентификаторы в коде — английские.
- **Коммит — один на сообщение автора, в самом конце**, когда результат проверен (тесты/линтеры прошли). Если автор просит сначала показать результат — сначала подробный отчёт, пуш только после его «можно».
- Деплой — **только по явной команде автора** (workflow Deploy с ручным подтверждением).
- Pull request не создавай, пока автор не попросит.
- Перед началом фазы прочитай `docs/ROADMAP.md` (раздел фазы) и все документы, на которые фаза ссылается.
- Противоречие документов и запроса автора: главнее запрос, но обнови документ в том же коммите. Архитектурные решения — в ADR (`docs/02-architecture.md`).

## Скиллы

- Начиная пользоваться скиллом, **первой строкой ответа пиши**: `🔧 Скилл: <имя> — <зачем>`.
- Графики, тепловые карты, KPI — скилл `dataviz`.
- Интерфейс и шаблон отчёта — проектный скилл `design-system`.
- Новая метрика — `add-metric`. Загрузка файлов, пакет, логи, хранение — `privacy-guard`.

## Жёсткие правила

1. **Тексты сообщений никогда не попадают в логи, Google Sheets, пакет, аналитику и ошибки.** Даже обрезанные.
2. Персональные данные (email, Telegram ID, имена, платежи) — только в PostgreSQL на сервере в РФ. В Google Sheets — только `user_ref`.
3. Образцы реальных экспортов (`samples/`, `*_schema.json`, `bad_words.txt`) — в `.gitignore`, **никогда не коммитить**. Тесты — на синтетике (`apps/api/app/report/sample.py`, `packages/parsers/test/fixtures.ts`).
4. Код платных метрик — **только на сервере** (`apps/api/app/metrics/`). В браузер уходят бесплатные метрики и сборщик пакета.
5. Баланс разборов меняется только через `app/billing/ledger.py` (атомарный `UPDATE … WHERE balance >= 1`).
6. Webhook платёжки не доверяем: перезапрашиваем платёж по id.
7. Секреты — только в `.env` (в `.gitignore`) и GitHub Secrets.
8. Время: в данных — настоящее UTC (Telegram `date_unixtime`, TikTok `Date` — UTC). Показываем в поясе выбранного пользователем города.

## Стек (подробно — docs/02)

- Монорепо: `pnpm` workspaces (TS) + `uv` (Python).
- Web: React 18 + Vite + TypeScript, общий CSS на токенах (`packages/design-tokens/tokens.css`), без UI-китов.
- Парсинг в браузере — Web Worker (`apps/web/src/workers/parse.worker.ts`).
- API: FastAPI, SQLAlchemy 2 (async), PostgreSQL 16 (локально SQLite), arq + Redis.
- Бот: aiogram 3, тот же Python-пакет (`python -m app.bot`).
- Отчёт: Jinja2-шаблон + модель report.v1 (JSON) + встроенный JS-рендер (`app/report/assets/report.js`) — период выбирается в любой сводке.
- Логи: structlog (JSON) с вычисткой ПД.

## Команды проверки

```
pnpm install --no-frozen-lockfile && pnpm -r typecheck && pnpm -r test && pnpm --filter @stats/web build
cd apps/api && uv venv && uv pip install -r pyproject.toml --extra dev && uv run --no-sync ruff check . && uv run --no-sync pytest -q
```
