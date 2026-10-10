# 13. Отчёт и экспорт

## Как устроен (v0.1)
- Сервер строит **модель report.v1** (`app/metrics/report_model.py`) и рендерит один **самодостаточный HTML** (`app/report/render.py`, шаблон `templates/report.html`): внутри токены и стили, JSON-модель (`<script type="application/json">`, символы `< > &` экранированы) и JS-рендер (`assets/report.js`, без библиотек). Открывается офлайн.
- **Выбор периода:** общий в шапке и свой у каждой сводки (по умолчанию — весь период экспорта). Выбор запоминается в браузере.
- Графики — SVG, цвета только из токенов; тема и палитра переключаются в шапке или параметрами `?mode=dark&palette=moss`.

## Модель report.v1 (основное)
```jsonc
{
  "schema": "report.v1",
  "meta": { "source", "chat_kind", "title", "tz", "generated_at", "participants", "sections", "hide_names",
            "dict_versions", "config": { "pause_hours", "reply_max_hours", "monologue_gap_min", "dialog_gap_min",
                                         "tt_session_gap_min", "reply_edges" } },
  "days": { "start": "2025-01-01", "n": 420 },                 // день i = start + i (местное время)
  "series": { "msgs": [[…D] на участника], "words", "laugh", "swear", "voice_n", "voice_sec", "vnote_n", "vnote_sec",
              "photo", "video", "sticker", "gif", "file", "link", "fwd", "reactions_recv", "calls_n", "calls_sec",
              "views", "screen_sec", "likes", "favorites", "logins", "chat_msgs", "chat_shares", "chat_text" },
  "hours": [[D×24] на участника или одна строка для бесед], "hours_by_participant": true,
  "firsts": [[…D]], "reply_bins": [[D×13]], "gaps": [{ "from", "to", "d0", "d1" }],
  "monologues": [{ "p", "from", "to", "msgs", "words", "i0", "i1", "d" }],
  "dialogs": [{ "from", "to", "dur", "msgs", "words", "i0", "i1", "d", "by" }],
  "words_by_month", "custom_patterns", "custom": [[d, p, k, n]], "mask_words",
  "swear_roots": [[d, p, id, n]], "swear_labels", "laugh_forms", "names": [[d, p, id, n]], "name_labels",
  "reaction_emoji": [[d, emoji, n]], "who_whom": [[d, from, to, n]], "emoji_text": [[d, p, emoji, n]], "stickers": [[d, p, label, n]],
  "forward_sources", "fwd_src": [[d, src, p, n]], "events": [{ "d", "ts", "actor", "action", "title", "count" }],
  "sessions": [[start, end, n, d]], "screen_hours": [D×24], "login_hours": [D×24], "collections": [d…]
}
```
Размер: для 300 тыс. сообщений за 3 года — порядка 1–3 МБ HTML.

## Структура страницы
Обложка (название, участники, период, тема) → оглавление → сводки → «Как считали» (пороги, пояс, оговорки) → подвал со ссылкой на сервис.

## Адаптивность
Графики `viewBox` на всю ширину, полосы вместо подписей на узких экранах, таблицы с прокруткой внутри, проверка Playwright-скриншотами 360/768/1280 (фаза 7).

## PDF и PNG (фаза 7)
Playwright открывает тот же HTML с нужными периодом и темой: `page.pdf` (A4, `@media print` уже есть в CSS — без кнопок, сводка с новой страницы) и `screenshot` (длинный PNG шириной 1080 и карточки 1080×1920). Очередь arq, кэш по `(run, формат, тема, период)`.

## Моменты
«Текст» у монолога/разговора → `postMessage` в приложение → тексты из файла в воркере → окно с сообщениями → «Сохранить в файл» (HTML) / «В избранное» (до 50 штук в браузере). Если отчёт открыт отдельно или файл не загружен — подсказка загрузить файл.

## Пример
`/sample` в приложении (настоящий рендер синтетики) и [report-sample.md](report-sample.md).
