# Схема образцов без текстов (ячейка для Google Colab)

Зачем: файлы экспортов слишком большие, чтобы Claude прочитал их через подключение к Google Диску. Эта ячейка кладёт рядом с каждым `.json` маленький `*_schema.json`: структуру ключей, типы, длины строк, счётчики типов сообщений, примеры дат. **Тексты сообщений, имена и ссылки в схему не попадают** — строки заменяются на их длину.

Как запустить: colab.research.google.com → «Создать блокнот» → вставить код → ▶. Разрешить доступ к Диску. Путь к папке поправьте, если он другой.

```python
from google.colab import drive
drive.mount('/content/drive')

import collections, glob, json, os

FOLDER = '/content/drive/MyDrive/Приложения/Аналитика истории тг и тт/samples'

def shape(x, depth=0):
    """Структура без значений: строки → длина, списки → длина + форма первого элемента."""
    if depth > 7:
        return '…'
    if isinstance(x, dict):
        out = {}
        for i, (k, v) in enumerate(list(x.items())[:80]):
            # ключи чатов TikTok содержат ники собеседников — прячем их
            key = f'Chat History with <собеседник {i}>' if k.lower().startswith('chat history with') else k
            out[key] = shape(v, depth + 1)
        return out
    if isinstance(x, list):
        return [f'list[{len(x)}]', shape(x[0], depth + 1)] if x else ['list[0]']
    if isinstance(x, str):
        return f'str(len={len(x)})'
    return type(x).__name__

def find_dates(x, out, limit=5):
    """Примеры значений ключей Date/date (это не персональные данные)."""
    if len(out) >= limit:
        return
    if isinstance(x, dict):
        for k, v in x.items():
            if k.lower() in ('date', 'date_unixtime') and isinstance(v, str):
                out.append(v)
            else:
                find_dates(v, out, limit)
    elif isinstance(x, list):
        for v in x[:3]:
            find_dates(v, out, limit)

for path in sorted(glob.glob(FOLDER + '/*.json')):
    if path.endswith('_schema.json'):
        continue
    with open(path, encoding='utf-8') as f:
        data = json.load(f)
    out = {'file': os.path.basename(path), 'size_mb': round(os.path.getsize(path) / 1e6, 1), 'shape': shape(data)}
    dates = []
    find_dates(data, dates)
    out['date_examples'] = dates
    if isinstance(data, dict) and isinstance(data.get('messages'), list):   # Telegram
        msgs = data['messages']
        out['telegram'] = {
            'chat_type': data.get('type'),
            'messages': len(msgs),
            'types': collections.Counter(m.get('type') for m in msgs),
            'media_type': collections.Counter(m.get('media_type') for m in msgs),
            'service_actions': collections.Counter(m.get('action') for m in msgs if m.get('type') == 'service'),
            'keys': collections.Counter(k for m in msgs for k in m),
            'text_is_list': sum(isinstance(m.get('text'), list) for m in msgs),
            'from_is_null': sum(m.get('type') == 'message' and m.get('from') is None for m in msgs),
            'reaction_types': collections.Counter(r.get('type') for m in msgs for r in m.get('reactions', [])),
            'first_dates': [(m.get('date'), m.get('date_unixtime')) for m in msgs[:3]],
        }
    with open(path.replace('.json', '_schema.json'), 'w', encoding='utf-8') as f:
        json.dump(out, f, ensure_ascii=False, indent=1, default=str)
    print('готово:', os.path.basename(path))
```

После запуска напишите Claude «схемы готовы» — он прочитает `*_schema.json` и сверит форматы (фаза 0, docs/03).
