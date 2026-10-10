# 09. Разборы, оплата, промокоды

## Продукты (`config/products.yaml`)
```yaml
unit_name: {one: "разбор", few: "разбора", many: "разборов"}   # меняется без кода
products:
  - id: pack5
    title: "5 разборов"
    runs: 5
    price_rub: 200
    price_stars: 150          # уточнить
    active: true
rerun_free_days: 30
```

## Что тратит разбор
| Действие | Цена |
|---|---|
| Бесплатные сводки (TG: общее; TT: итог просмотров, счётчики чатов) | 0 |
| Telegram: платные сводки по 1 чату | 1 разбор |
| TikTok: платные сводки истории + активности + 1 чат (`tt.chat_deep`) | 1 разбор |
| Повтор того же чата (тот же отпечаток) ≤ 30 дней | 0 |
| Повторный экспорт PDF/PNG готового отчёта, смена темы | 0 |
| Склейка TikTok-истории | 0 |
| Админ | 0, лог `charge=admin` |

Отпечаток: Telegram — `sha256(chat.id + user_id)`; TikTok — `sha256("tt:" + owner_username + ":" + partner_username + user_id)` (без партнёра — разбор без чата).

## Оплата на сайте — ЮKassa
1. `POST /payments/yookassa` → создаём платёж (`amount`, `capture: true`, `confirmation.type=redirect`, `metadata {user_id, product_id, promo_code_id}`, `receipt` для 54-ФЗ), заголовок `Idempotence-Key` = uuid.
2. Пользователь платит (карта, СБП, SberPay).
3. Webhook `payment.succeeded` → **перезапрос** `GET /v3/payments/{id}` → проверка `status=succeeded`, суммы, валюты, metadata.
4. В одной транзакции: `payments` (unique по `provider_payment_id`) + `ledger(+runs, purchase)` + `wallets`. Повторный webhook ничего не меняет.
5. Событие `payment.succeeded` → Sheets (`orders`) + уведомление админу в Telegram.
- Альтернатива ЮKassa — Robokassa (Робочеки). Адаптер платёжки — интерфейс `PaymentProvider`, чтобы сменить без переделок.
- Возврат: `POST /v3/refunds` из админки; `ledger(-runs, refund)` только если разборы не потрачены, иначе частично — решение админа.

## Оплата в боте — Telegram Stars
- `sendInvoice` с `currency=XTR`, `provider_token` пустой, payload = `{user_id, product_id}` (подписанный).
- `pre_checkout_query` → проверка → `answerPreCheckoutQuery(ok=True)`.
- `successful_payment` → `payments(provider='stars', provider_payment_id=telegram_payment_charge_id)` → ledger.
- Возврат: `refundStarPayment`.
- В боте **нельзя** ставить ссылку на оплату через ЮKassa для цифрового товара (правила Telegram). Бот может предложить бесплатную часть и открыть сайт, но без кнопки «купить на сайте».

## Промокоды

### Типы
| kind | value | Эффект |
|---|---|---|
| `runs` | N | +N разборов сразу при вводе |
| `discount_percent` | 1–100 | скидка на следующую покупку (применяется при создании платежа) |
| `fixed_price` | копейки | пакет по фиксированной цене |

### Охват
- `personal` — привязан к одному пользователю (выбирается в админке по email); использовать можно **один раз**.
- `global` — для всех; **каждый пользователь — один раз**; опционально общий лимит `max_redemptions` и срок `valid_until`.

### Генерация (админка)
- Формат: `XXXX-XXXX` из алфавита без похожих символов (`ABCDEFGHJKMNPQRSTUVWXYZ23456789`), криптостойкий генератор; можно задать свой код (например `VALENTINE26`).
- Массовая генерация: N персональных или N одноразовых глобальных (`max_redemptions=1`) с выгрузкой CSV.
- Поля: тип, значение, охват, пользователь, лимит, срок, заметка.

### Применение
- `POST /promo/redeem` в транзакции: проверка активности, срока, охвата, `unique(promo_code_id, user_id)`, лимита (`UPDATE … SET redemptions = redemptions + 1 WHERE redemptions < max_redemptions RETURNING`).
- Защита от перебора: лимиты частоты, одинаковое сообщение «Код не найден или недоступен», события `promo.redeem_failed` с причиной (в логах), алерт админу при > 20 неудачах с одного аккаунта/IP в час.
- Учёт в Sheets: строка в `orders` с `method=promo`, кодом и числом разборов.

## Админ
- `role=admin`: `POST /runs` не резервирует баланс, `charge=admin`; оплата не требуется; можно начислять разборы пользователям (`admin_grant`) с причиной.

## Налоги и юр. (для автора)
См. docs/18 и OPEN-QUESTIONS: НПД vs УСН, оферта, чеки 54-ФЗ.
