# 05. Пакет агрегатов packet.v1 (браузер → сервер)

Контракт между сборщиком в браузере (`packages/parsers/src/packet.ts`), будущим сборщиком в боте (Python, фаза 9) и сервером (`apps/api/app/metrics/packet.py`, pydantic).

## Принципы
- **Никаких текстов сообщений.** Только числа, время, имена участников, эмодзи, id словарей, названия источников пересылок и беседы, топ-слова (≥ 3 букв, без стоп-слов, топ-100 на участника за месяц). Тест `packages/parsers/test/parsers.test.ts` проверяет это «ядовитой» строкой.
- В пакет попадают только блоки выбранных сводок.
- Участники — индексы `0…P-1` (`p0` — «вы»); имена можно скрыть («Участник A/B»).
- Время — **UTC unix-секунды**; пояс пользователя — в поле `tz`, переводит сервер.
- `stream` отсортирован по времени; индекс сообщения в нём = индекс в файле браузера (нужно для «моментов»).
- Лимиты: 5 МБ после gzip, 50 МБ после распаковки, ≤ 2 млн сообщений, ≤ 500 участников.

## Структура
```jsonc
{
  "schema": "packet.v1",
  "source": "tg" | "tt",
  "chat_kind": "personal" | "group" | "account",
  "chat_key": "123456789",              // id чата → отпечаток на сервере
  "title": "Аня",                        // «Чат», если имена скрыты
  "sections": ["tg.overview", "tg.rhythm", "tg.moments"],
  "tz": "Asia/Novosibirsk",
  "hide_names": false,
  "participants": [{"key": "p0", "name": "Аня", "is_owner": true}, {"key": "p1", "name": "Кирилл", "is_owner": false}],
  "kinds": ["text", "voice", "video_note", "photo", "video", "sticker", "gif", "file", "audio", "tiktok_share", "link", "poll", "location", "contact", "other"],
  "stream": {                              // колонки одинаковой длины, по сообщению на позицию
    "ts": [1735814710, …], "author": [0, 1, …], "kind": [0, 1, …],
    "dur": [null, 12, …],                  // длительность голосовых/кружков
    "fwd": [null, 0, …],                   // индекс источника пересылки
    "words": [5, 0, …],                    // слов в сообщении
    "laugh": [0, 1, …]                     // есть ли смех
  },
  "forward_sources": ["Канал X"],
  "words": { "by_month": {"2025-01": {"p0": [["привет", 31], …]}}, "custom_patterns": ["росси*"],
             "custom_hits": [[17, 0]], "mask_words": {"0": [["россия", 3]]} },          // tg.words
  "laugh_forms": [["ахах", 120]], "swear_hits": [[42, "r:1"]], "swear_labels": {"r:1": "х*й"},  // tg.laugh_swear
  "name_hits": [[42, "n:alexandr"]], "name_labels": {"n:alexandr": "Александр"},              // tg.names
  "reactions": { "on_msg": [[3, "❤", 2]], "who": [[3, 1, "❤"]] },                           // tg.reactions
  "emoji_hits": [[3, "😂", 2]], "sticker_hits": [[7, "😂#a1b2c3d4"]],
  "events": [{"ts": …, "actor": 0, "action": "title" | "invite" | "call" …, "title": "…", "count": 2, "dur": 300}],
  "tt": { "owner": "nick", "use_history": true,             // true — просмотры берутся из сохранённой истории
          "views": {"ts": […], "video": […]},                 // только если use_history = false
          "likes": [ts…], "favorites": [ts…], "collections": [ts…], "logins": [ts…] },
  "dict_versions": {"all": "a1b2c3d4e5f6"},
  "client": {"app_version": "0.1.0", "parser_version": "parsers-0.1", "build_ms": 840}
}
```
Для TikTok `stream` — сообщения выбранного чата (`tt.chat_deep`), либо пустой.

## Где что считается
| Действие | Где |
|---|---|
| Парсинг, нормализация, токены, стоп-слова, топ-слов, совпадения со словарями | браузер |
| Ряды по дням, часы, сессии, ответы, монологи, разговоры, перерывы, медиа, реакции | **сервер** (модель report.v1) |
| Агрегация за выбранный период, графики | JS внутри отчёта |

## Валидация на сервере
Версия схемы, одинаковая длина колонок, сортировка `ts`, индексы участников и сообщений в границах, `sections ⊆` зарезервированных, тот же источник. Ошибка → разбор не списывается (`run_release`), событие `packet.invalid`.
