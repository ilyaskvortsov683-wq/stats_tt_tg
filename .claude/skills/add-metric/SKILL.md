---
name: add-metric
description: Пошаговая процедура добавления новой метрики или сводки в stats_tt_tg — от каталога и пакета агрегатов до модели отчёта, JS-рендера с выбором периода, тарифа и тестов. Загружать при добавлении или изменении любой метрики.
---

# Добавление метрики

Первой строкой ответа: `🔧 Скилл: add-metric — <какая метрика>`.

## Чек-лист (всё в одном коммите)
1. **Каталог.** Строка в `docs/04-metrics-catalog.md`: что считаем, точное определение; пороги — в `config/metrics.yaml`.
2. **Тариф.** Новая сводка → `config/tiers.yaml`, `docs/01-product.md`, тексты в `apps/web/src/data/sections.ts`, заголовок в `SECTION_TITLES` (`apps/api/app/report/render.py`).
3. **Данные.** Хватает ли полей пакета (`docs/05`)? Если нет — расширь `packages/parsers/src/packet.ts` и `apps/api/app/metrics/packet.py` (обратно совместимо), обнови тест «без текстов». Загрузи `privacy-guard`.
4. **Модель отчёта.** `apps/api/app/metrics/report_model.py`: храни **факты по дням** (ряды `[участник][день]`, разреженные `[день, …, n]`, списки событий с полем `d`), чтобы любую сводку можно было пересчитать за любой период.
5. **Рендер.** `apps/api/app/report/assets/report.js`: функция `render(a, b, id)` в `SECTIONS[...]` — считает за дни `a..b`, заголовок-вывод с числом, графики через `bars`/`hbars`/`heatmap`/`table`, пустое состояние через `empty()`. Цвета — только токены. Загрузи `design-system` и `dataviz`.
6. **Бесплатная?** Тогда ещё `packages/parsers/src/free.ts` + показ в `apps/web/src/pages/*Page.tsx`.
7. **Синтетика.** Дополни `apps/api/app/report/sample.py` (и `packages/parsers/test/fixtures.ts`), чтобы метрика была видна в «Примере отчёта».
8. **Тесты.** `apps/api/tests/test_report.py`, при изменении пакета — `packages/parsers/test/parsers.test.ts`.
9. **Пример.** Обнови `docs/report-sample.md`.
10. Прогони все тесты; открой `/api/v1/sample/tg` и проверь сводку на 360 и 1280 px в светлой и тёмной теме.
