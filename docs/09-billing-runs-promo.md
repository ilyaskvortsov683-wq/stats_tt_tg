# 09. Разборы, оплата, промокоды

## Продукты (`config/products.yaml`)
```yaml
unit_name: {one: "разбор", few: "разбора", many: "разборов", plural_title: "Разборы"}
products:
  - {id: pack5, title: "5 разборов", runs: 5, price_rub: 200, price_stars: 150, active: true}
rerun_free_days: 30
report_retention_days: 90
```

## Что тратит разбор
| Действие | Цена |
|---|---|
| Бесплатные сводки (TG: «Общее»; TT: итог просмотров, счётчики чатов) | 0 |
| Telegram: платные сводки по одному чату | 1 |
| TikTok: платные сводки истории и активности + один чат | 1 |
| Повтор того же чата ≤ 30 дней, смена темы, повторное скачивание | 0 |
| Склейка истории TikTok | 0 |
| Админ | 0 (`charge=admin`) |

Отпечаток: `sha256(user_id:source:chat_key)`; `chat_key` — id чата Telegram или `ник:собеседник` / `ник` для TikTok.

## Сайт — ЮKassa (самозанятость)
Сравнение с Робокассой и подводные камни — [21-payments.md](21-payments.md).
1. `POST /payments/yookassa` → платёж (`capture: true`, `redirect`, `metadata {payment_id, user_ref, product_id}`, `Idempotence-Key` = id платежа). Объект `receipt` не передаём: при НПД чек формирует «Мой налог» (автоматическая регистрация в ЮKassa) — флаг `YOOKASSA_SEND_RECEIPT=false`.
2. Webhook → проверка IP → **перезапрос** платежа по id → сверка статуса и суммы → `mark_succeeded()`: `payments.status`, `ledger(+5, purchase)`, событие, строка в Google-таблицу `orders`. Повтор — без эффекта.
3. Без ключей локально — тестовая оплата: ссылка ведёт на `/app/billing?mock_payment=…` с кнопкой подтверждения.
4. Возврат — `POST /v3/refunds` из админки (фаза 12).

## Бот — Telegram Stars
`/balance` → «Купить 5 разборов за ⭐» → `sendInvoice` (`XTR`) → `pre_checkout_query` (сверка платежа и суммы) → `successful_payment` → `mark_succeeded()`. Возврат — `refundStarPayment`. Ссылку на ЮKassa в боте не ставим (правила Telegram). Учёт дохода в звёздах при НПД — вопрос к бухгалтеру.

## Промокоды
| kind | value | Эффект |
|---|---|---|
| `runs` | N | +N разборов сразу |
| `discount_percent` | 1–99 | скидка на следующую покупку на сайте |
| `fixed_price` | копейки | пакет по фиксированной цене |

- **personal** — для одного пользователя (выбирается по email), один раз; **global** — для всех, каждый пользователь один раз; опционально общий лимит и срок.
- Генерация в админке: `XXXX-XXXX` из алфавита без похожих символов, свой код (например `VALENTINE26`) или пачка до 500 штук.
- Применение: проверки активности, срока, владельца, уникальности; атомарный захват лимита (`UPDATE … WHERE redemptions < max`). Пользователю — всегда «Код не найден или недоступен», причина — в журнал (`promo.redeem_failed`).
- В Google-таблицу `orders` — с маской кода (`ABCD…`).

## Админ
Email из `ADMIN_EMAILS` → роль `admin`: разборы без списания, админка, начисление разборов с причиной (`admin_grant`).
