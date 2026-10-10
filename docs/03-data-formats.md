# 03. Форматы данных

> ⚠️ Структуры ниже собраны по скриптам автора и открытым описаниям. **Их нужно сверить с реальными образцами**, которые автор пришлёт (положить в `samples/`, папка не коммитится). Фаза 0 роадмапа — обновить этот документ по образцам.

## 1. Telegram (`result.json`, Telegram Desktop → «Экспорт истории чата» → JSON)

### 1.1 Экспорт одного чата
```jsonc
{
  "name": "Имя собеседника или название беседы",
  "type": "personal_chat",        // personal_chat | private_group | private_supergroup | public_supergroup | saved_messages | bot_chat ...
  "id": 123456789,                // ID чата — основа отпечатка
  "messages": [
    {
      "id": 1,
      "type": "message",          // message | service
      "date": "2025-01-02T13:45:10",
      "date_unixtime": "1735814710", // строка! предпочитать её
      "from": "Аня",              // null у удалённых аккаунтов
      "from_id": "user111",       // группировать по нему
      "text": "привет" | ["часть ", {"type": "link", "text": "https://…"}],
      "text_entities": [{"type": "plain", "text": "…"}],
      "media_type": "voice_message" | "video_message" | "sticker" | "animation" | "video_file" | "audio_file",
      "photo": "photos/…",        // признак фото
      "duration_seconds": 12,
      "sticker_emoji": "😂",
      "forwarded_from": "Канал X",
      "reply_to_message_id": 0,
      "edited": "…",
      "reactions": [{"type": "emoji", "count": 2, "emoji": "❤", "recent": [{"from": "…", "from_id": "…", "date": "…"}]}]
    },
    {
      "type": "service",
      "action": "invite_members" | "edit_group_title" | "remove_members" | "join_group_by_link" | "pin_message" | "phone_call" ...,
      "actor": "…", "actor_id": "…", "title": "новое название", "members": ["…"],
      "duration_seconds": 300      // у phone_call
    }
  ]
}
```

### 1.2 Полный экспорт аккаунта
Корень содержит `chats.list[]` — массив объектов того же вида. UI предлагает выбрать чат из списка (название, тип, число сообщений).

### 1.3 Подводные камни (из анализа скриптов автора)
- `text` бывает строкой **или** списком фрагментов → текст собирать из `text_entities` (конкатенация `text`).
- `from` = `null` у удалённых аккаунтов → ключ участника — `from_id`, отображаемое имя — последнее непустое `from`, иначе «Удалённый аккаунт».
- Дата — из `date_unixtime` (строка → int). Часовой пояс: время в экспорте локальное для экспортирующего; храним как «наивное локальное» и **не** конвертируем.
- `reactions[].recent` содержит не все реакции (только последние) → «кто кому ставит» — оценка; суммарный счёт брать из `count`. Отметить в отчёте сноской.
- Пересланные (`forwarded_from`) исключать из топа слов, мата, имён и смеха (это не слова участника), но считать в «Медиа».
- «Кто вы?» — владелец экспорта не помечен явно. В личке спросить «Кто из них вы?» (для формулировок «вы/собеседник»), в полном экспорте — `personal_information.user_id`.

## 2. TikTok («Download your data», формат JSON)

Файл обычно `user_data_tiktok.json` (у автора переименованы в `I_user_data_tiktok_YYYYMMDD.json`), иногда внутри zip.

```jsonc
{
  "Profile": { "Profile Info": { "ProfileMap": { "userName": "…", … } } },
  "Your Activity": {
    "Watch History": { "VideoList": [ {"Date": "2025-03-01 21:14:05", "Link": "https://www.tiktokv.com/share/video/7341234567890123456/"} ] },
    "Like List": { "ItemFavoriteList": [ {"date": "…", "link": "…"} ] },
    "Favorite Videos": { "FavoriteVideoList": [ {"Date": "…", "Link": "…"} ] },
    "Favorite Collection": { "FavoriteCollectionList": [ {"Date": "…", "FavoriteCollection": "…"} ] },
    "Login History": { "LoginHistoryList": [ {"Date": "…", "IP": "…", "DeviceModel": "…", …} ] }
  },
  "Direct Message": {
    "Direct Messages": {
      "ChatHistory": {
        "Chat History with some_user:": [ {"Date": "…", "From": "some_user", "Content": "текст или https://…"} ]
      }
    }
  }
}
```

### 2.1 Подводные камни
- Регистр ключей непоследователен (`Date`/`date`, `Link`/`link`) → нормализовать ключи в нижний регистр.
- Названия разделов менялись между версиями экспорта → парсер ищет разделы по набору синонимов, неизвестную структуру логирует (только имена ключей, не значения) событием `parser.unknown_shape`.
- История просмотров — только ~последние 6 месяцев → склейка.
- **Дедупликация по паре `(Date, Link)`**, а не по `Link`: повторные просмотры одного видео — реальные просмотры (у автора терялись, экранное время занижалось).
- `video_id` извлекать из ссылки регуляркой `/video/(\d+)`; ссылки без id хранить хэшем.
- Сообщение «присланный тикток» = `Content` начинается с `https://` и содержит домен tiktok (уточнить по образцам; у автора — просто `https`).
- Реакции и стикеры в личных сообщениях TikTok — **неизвестно, есть ли в экспорте**. Проверить по образцам; если нет — в `tt.chats_counts` колонка «реакции» скрывается.
- Владелец экспорта — `Profile…userName`; собеседник — из ключа `Chat History with <user>:`.
- IP и модель устройства из `Login History` **не отправляются на сервер** (не нужны для метрик).
- Время в экспорте — проверить пояс (по образцам; у некоторых экспортов UTC). Добавить в UI выбор часового пояса с автоопределением по браузеру.

## 3. Нормализованная модель (общая для TS и Python)

```ts
type Participant = { key: string; displayName: string; isOwner: boolean };

type Message = {
  ts: number;                 // unix, локальное «наивное» время
  author: string;             // Participant.key
  kind: 'text' | 'voice' | 'video_note' | 'photo' | 'video' | 'sticker' | 'gif' | 'file' | 'audio'
      | 'tiktok_share' | 'link' | 'call' | 'other';
  text?: string;              // ТОЛЬКО в памяти браузера/воркера; в пакет не попадает
  durationSec?: number;
  forwardedFrom?: string;
  replyTo?: number;
  stickerEmoji?: string;
  reactions?: { emoji: string; count: number; by?: string[] }[];
};

type ServiceEvent = { ts: number; actor?: string; action: 'title' | 'invite' | 'remove' | 'join_link' | 'call' | 'pin' | 'other'; title?: string; members?: string[] };

type Chat = { source: 'tg' | 'tt'; chatId: string; kind: 'personal' | 'group'; title: string;
              participants: Participant[]; messages: Message[]; events: ServiceEvent[] };

type TikTokAccount = { owner: string; views: { ts: number; videoId: string }[];
                       likes: number[]; favorites: number[]; collections: { ts: number }[];
                       logins: number[]; chats: Chat[] };
```
