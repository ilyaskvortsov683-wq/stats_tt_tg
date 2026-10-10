# Стартовые словари (seed)

Рабочие словари живут в Google-таблице `dictionaries` на Google Диске автора (формат — `docs/16-google-integrations.md`). Эта папка — резервная стартовая версия и источник для тестов.

В фазе 6 здесь появятся:

| Файл | Колонки |
|---|---|
| `swear.csv` | `id,pattern,display,weight,enabled` |
| `swear_exceptions.csv` | `word` |
| `names.csv` | `id,base,gender,variants,enabled` |
| `laugh.csv` | `pattern,enabled` |
| `stopwords.csv` | `word` |
| `safe_words.txt` | безобидные слова для проверки, что паттерны мата не дают ложных срабатываний |

Список мата автор переносит из своего файла в Google-таблицу; в репозиторий кладётся минимальная версия, достаточная для тестов.
