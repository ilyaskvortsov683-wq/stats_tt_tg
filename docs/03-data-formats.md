# 03. Форматы данных

> Структуры собраны по скриптам и ноутбукам автора и открытым описаниям. **Сверка с образцами** — фаза 0: образцы лежат на Google Диске автора (`Приложения/Аналитика истории тг и тт/samples`: `личный чат.json` 89 МБ, `чат беседы.json` 34 МБ, две выгрузки TikTok по ~20 МБ, ноутбуки, `bad_words.txt`). Через подключение к Диску большие файлы не читаются (файл целиком попадает в контекст модели), поэтому автор запускает ячейку из [samples-schema.md](samples-schema.md) — она кладёт рядом маленькие `*_schema.json` без текстов.

## 1. Telegram (`result.json`, Telegram Desktop → «Экспорт истории чата» → JSON)

```jsonc
{
  "name": "Имя собеседника или название беседы",
  "type": "personal_chat",        // personal_chat | private_group | private_supergroup | public_supergroup | saved_messages …
  "id": 123456789,                // ID чата — основа отпечатка
  "messages": [
    {
      "id": 1, "type": "message",
      "date": "2025-01-02T13:45:10",       // местное время УСТРОЙСТВА, где делали экспорт
      "date_unixtime": "1735814710",        // настоящее UTC-время (строка!) — используем его
      "from": "Аня", "from_id": "user111", // from = null у удалённых аккаунтов
      "text": "привет" | ["часть ", {"type": "link", "text": "https://…"}],
      "text_entities": [{"type": "plain", "text": "…"}],
      "media_type": "voice_message" | "video_message" | "sticker" | "animation" | "video_file" | "audio_file",
      "photo": "photos/…", "file": "…", "duration_seconds": 12, "sticker_emoji": "😂",
      "forwarded_from": "Канал X", "reply_to_message_id": 0,
      "reactions": [{"type": "emoji", "count": 2, "emoji": "❤", "recent": [{"from": "…", "from_id": "…", "date": "…"}]}]
    },
    { "type": "service", "action": "invite_members" | "edit_group_title" | "remove_members" | "join_group_by_link" | "pin_message" | "phone_call" …,
      "actor": "…", "actor_id": "…", "title": "новое название", "members": ["…"], "duration_seconds": 300 }
  ]
}
```
Полный экспорт аккаунта: `chats.list[]` — массив таких объектов; приложение предлагает выбрать чат.

### Время и часовые пояса
- `date_unixtime` — точное UTC, по нему считаем всё. Пользователь выбирает город → время показывается в его поясе.
- `date` — время на устройстве, где делали экспорт. Разница `date − date_unixtime` = пояс экспортирующего (`exporterOffsetMin`); показываем как подсказку («экспорт сделан на устройстве с поясом UTC+3»).
- Собеседник в другом поясе: отчёт показывает всё во времени пользователя (так честнее для «во сколько мы переписываемся»).

### Подводные камни (учтены в парсере)
- `text` — строка или список → текст собираем из `text_entities`.
- `from = null` у удалённых → ключ участника `from_id`, имя «Удалённый аккаунт».
- `reactions[].recent` — не все реакции → «кто кому» — оценка, итог — по `count`.
- Пересланные не входят в слова, смех, мат, имена, но считаются в «Медиа».
- «Кто вы» в личке — спрашиваем; участников > 2 → беседа.

### Размер
300 тыс. сообщений ≈ 100 МБ JSON (у автора — 89 МБ). На компьютере это нормально: воркер читает такой файл за несколько секунд, памяти нужно ~0,5–1 ГБ. На телефоне может не хватить памяти → фаза 2: потоковый парсер, предупреждение для файлов > 200 МБ. Пакет для сервера после gzip — ~1–2 МБ (лимит 5 МБ). Экспорт Telegram делается только на компьютере, так что основной сценарий — десктоп.

## 2. TikTok («Download your data», JSON)

Файл `user_data_tiktok.json` (у автора переименован в `I_user_data_tiktok_YYYYMMDD.json`), иногда внутри zip (v0.1 просит распаковать; zip — фаза 2).

```jsonc
{
  "Profile": { "Profile Info": { "ProfileMap": { "userName": "…" } } },
  "Your Activity": {
    "Watch History": { "VideoList": [ {"Date": "2025-03-01 21:14:05", "Link": "https://www.tiktokv.com/share/video/7341…/"} ] },
    "Like List": { "ItemFavoriteList": [ {"date": "…", "link": "…"} ] },
    "Favorite Videos": { "FavoriteVideoList": [ … ] },
    "Favorite Collection": { "FavoriteCollectionList": [ … ] },
    "Login History": { "LoginHistoryList": [ {"Date": "…", "IP": "…", "DeviceModel": "…"} ] }
  },
  "Direct Message": { "Direct Messages": { "ChatHistory": {
    "Chat History with some_user:": [ {"Date": "…", "From": "some_user", "Content": "текст или https://…"} ] } } }
}
```

### Подводные камни
- **Время — UTC** (по наблюдению автора); переводим в пояс выбранного города.
- Регистр и названия разделов меняются между версиями → поиск ключей без учёта регистра и по синонимам; неизвестные разделы логируются (только имена ключей).
- История просмотров — ~6 месяцев → склейка; **дедупликация по паре (Date, Link)**, повторные просмотры сохраняются.
- `video_id` — из ссылки (`/video/(\d+)`), иначе хэш ссылки.
- «Присланный тикток» — `Content` начинается с `https://` и содержит `tiktok`; другие ссылки — «ссылка».
- Реакции и стикеры в личных сообщениях TikTok — **неизвестно, есть ли в экспорте**: проверить по схеме образцов.
- IP и устройство из `Login History` на сервер не отправляются.

## 3. Нормализованная модель
TS: `packages/parsers/src/types.ts`; Python-зеркало (фаза 9) — `apps/api/app/parsers/`. Ключевое: `Message { id, ts (UTC), author, kind, text (только в памяти), durationSec, forwardedFrom, stickerEmoji, reactions }`, `Chat { source, chatId, kind, title, participants, messages, events, exporterOffsetMin }`, `TikTokAccount { owner, views[{ts, videoId}], likes, favorites, collections, logins, chats, unknownSections }`.

## 4. Список мата автора (`bad_words.txt`)
~2000 точных словоформ (по строке на слово). Кроме мата там есть просто грубые и нейтральные слова (например «дурак», «лох», «спам/spam») — при переносе в Google-таблицу предлагается колонка «категория» (мат / грубое / исключить), чтобы «Смех и мат» не завышался. В репозиторий список не кладётся (`.gitignore`).
