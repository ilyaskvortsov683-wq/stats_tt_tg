"""Telegram-бот. Запуск: python -m app.bot (v1 — long polling; в проде — webhook, фаза 9).

Что умеет v1: привязка аккаунта, гайды экспорта, напоминания о выгрузке TikTok, баланс, промокод,
покупка разборов за Telegram Stars. Загрузка файлов в бота — заглушка (фаза 9), пока ведём в приложение.
"""

from __future__ import annotations

import asyncio
import re
from datetime import timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

from aiogram import Bot, Dispatcher, F, Router
from aiogram.filters import Command, CommandObject, CommandStart
from aiogram.types import (
    CallbackQuery,
    InlineKeyboardButton,
    InlineKeyboardMarkup,
    LabeledPrice,
    Message,
    PreCheckoutQuery,
    WebAppInfo,
)
from sqlalchemy import select, update

from app.billing.ledger import balance
from app.billing.promo import PromoError, redeem
from app.billing.router import mark_succeeded, product_by_id
from app.core.config import settings
from app.core.db import SessionLocal, aware, init_models, utcnow
from app.core.logging import configure_logging, log
from app.core.security import hash_token
from app.events import emit
from app.models import Identity, Payment, Reminder, TelegramLinkToken, User

router = Router()


async def user_by_tg(s, tg_id: int) -> User | None:
    ident = (await s.execute(select(Identity).where(Identity.provider == "telegram", Identity.subject == str(tg_id)))).scalar_one_or_none()
    return await s.get(User, ident.user_id) if ident else None


def main_menu() -> InlineKeyboardMarkup:
    rows = [
        [InlineKeyboardButton(text="Как выгрузить данные", callback_data="guide")],
        [InlineKeyboardButton(text="Напомнить о выгрузке TikTok", callback_data="remind")],
        [InlineKeyboardButton(text="Баланс разборов", callback_data="balance")],
    ]
    if settings.public_url.startswith("https://"):
        rows.insert(0, [InlineKeyboardButton(text="Открыть приложение", web_app=WebAppInfo(url=settings.public_url + "/tg"))])
    return InlineKeyboardMarkup(inline_keyboard=rows)


@router.message(CommandStart())
async def start(message: Message, command: CommandObject) -> None:
    payload = command.args or ""
    async with SessionLocal() as s:
        if payload.startswith("link_"):
            row = await s.get(TelegramLinkToken, hash_token(payload[5:]))
            if not row or row.used_at or aware(row.expires_at) < utcnow():
                await message.answer("Ссылка для привязки устарела. Получите новую в профиле на сайте.")
                return
            exists = (await s.execute(select(Identity).where(Identity.provider == "telegram",
                                                             Identity.subject == str(message.from_user.id)))).scalar_one_or_none()
            if exists and exists.user_id != row.user_id:
                await message.answer("Этот Telegram уже привязан к другому аккаунту.")
                return
            if not exists:
                s.add(Identity(user_id=row.user_id, provider="telegram", subject=str(message.from_user.id)))
            row.used_at = utcnow()
            user = await s.get(User, row.user_id)
            user.settings = {**(user.settings or {}), "tg_linked": True}
            await emit(s, "auth.tg_linked", user_ref=user.user_ref, source="bot")
            await s.commit()
            await message.answer("Готово: Telegram привязан к вашему аккаунту. Разборы общие для сайта и бота.", reply_markup=main_menu())
            return
    await message.answer(
        "Привет! Я помогаю разобрать переписку в Telegram и вашу историю TikTok: кто пишет первым, "
        "сколько часов уходит на ленту, самые долгие разговоры и многое другое.\n\n"
        "Файлы удобнее всего загружать в приложении — там они обрабатываются прямо на вашем устройстве.",
        reply_markup=main_menu(),
    )


def _guide_steps(source: str) -> list[str]:
    name = "export-telegram.md" if source == "tg" else "export-tiktok.md"
    text = (Path(settings.guides_dir) / name).read_text(encoding="utf-8")
    text = re.sub(r"^---.*?---\s*", "", text, flags=re.S)
    parts = re.split(r"\n(?=## )", text)
    return [re.sub(r"[*_`>]", "", p).strip() for p in parts if p.strip()]


@router.callback_query(F.data == "guide")
@router.message(Command("guide"))
async def guide(event: Message | CallbackQuery) -> None:
    msg = event.message if isinstance(event, CallbackQuery) else event
    kb = InlineKeyboardMarkup(inline_keyboard=[[
        InlineKeyboardButton(text="TikTok", callback_data="guide:tt"),
        InlineKeyboardButton(text="Telegram", callback_data="guide:tg"),
    ]])
    await msg.answer("Откуда выгружаем данные?", reply_markup=kb)
    if isinstance(event, CallbackQuery):
        await event.answer()


@router.callback_query(F.data.startswith("guide:"))
async def guide_source(cb: CallbackQuery) -> None:
    steps = _guide_steps(cb.data.split(":")[1])
    for step in steps[:12]:
        await cb.message.answer(step[:3500])
    if cb.data.endswith("tt"):
        await cb.message.answer("Когда запросите выгрузку — нажмите кнопку, и я напомню её скачать.",
                                reply_markup=InlineKeyboardMarkup(inline_keyboard=[[InlineKeyboardButton(text="Я запросил выгрузку", callback_data="remind")]]))
    await cb.answer()


REMIND_OPTIONS = [("Через 24 часа", "r:24"), ("Через 48 часов", "r:48"), ("Завтра в 19:00", "r:t19"), ("Не напоминать", "r:no")]


@router.callback_query(F.data == "remind")
@router.message(Command("remind"))
async def remind(event: Message | CallbackQuery) -> None:
    msg = event.message if isinstance(event, CallbackQuery) else event
    kb = InlineKeyboardMarkup(inline_keyboard=[[InlineKeyboardButton(text=t, callback_data=d)] for t, d in REMIND_OPTIONS])
    await msg.answer("TikTok готовит архив от нескольких часов до 1–2 дней. Когда напомнить?", reply_markup=kb)
    if isinstance(event, CallbackQuery):
        await event.answer()


@router.callback_query(F.data.startswith("r:"))
async def remind_set(cb: CallbackQuery) -> None:
    choice = cb.data[2:]
    async with SessionLocal() as s:
        user = await user_by_tg(s, cb.from_user.id)
        await s.execute(update(Reminder).where(Reminder.tg_chat_id == cb.message.chat.id, Reminder.status == "pending",
                                               Reminder.kind == "tt_export_ready").values(status="canceled"))
        if choice == "no":
            await s.commit()
            await cb.message.answer("Хорошо, напоминаний не будет.")
            await cb.answer()
            return
        tz = ZoneInfo(user.tz if user else "Europe/Moscow")
        now = utcnow()
        if choice == "t19":
            local = (now.astimezone(tz) + timedelta(days=1)).replace(hour=19, minute=0, second=0, microsecond=0)
            due = local.astimezone(now.tzinfo)
        else:
            due = now + timedelta(hours=int(choice))
        s.add(Reminder(user_id=user.id if user else None, tg_chat_id=cb.message.chat.id, kind="tt_export_ready", due_at=due))
        await emit(s, "reminder.created", user_ref=user.user_ref if user else None, source="bot", kind="tt_export_ready")
        await s.commit()
    await cb.message.answer(f"Напомню {due.astimezone(tz).strftime('%d.%m в %H:%M')}.")
    await cb.answer()


@router.callback_query(F.data == "balance")
@router.message(Command("balance"))
async def show_balance(event: Message | CallbackQuery) -> None:
    msg = event.message if isinstance(event, CallbackQuery) else event
    uid = event.from_user.id
    async with SessionLocal() as s:
        user = await user_by_tg(s, uid)
        if not user:
            await msg.answer("Сначала привяжите аккаунт: войдите на сайте через Google и нажмите «Привязать Telegram» в профиле. "
                             "Или войдите на сайте через Telegram.")
        else:
            b = await balance(s, user.id)
            kb = InlineKeyboardMarkup(inline_keyboard=[[InlineKeyboardButton(text="Купить 5 разборов за ⭐", callback_data="buy:pack5")]])
            await msg.answer(f"У вас {b} разб." + (" Администратор: всё бесплатно." if user.role == "admin" else ""), reply_markup=kb)
    if isinstance(event, CallbackQuery):
        await event.answer()


@router.message(Command("promo"))
async def promo(message: Message, command: CommandObject) -> None:
    if not command.args:
        await message.answer("Отправьте: /promo КОД")
        return
    async with SessionLocal() as s:
        user = await user_by_tg(s, message.from_user.id)
        if not user:
            await message.answer("Сначала привяжите аккаунт (см. /balance).")
            return
        user_ref = user.user_ref
        try:
            r = await redeem(s, user, command.args)
            await emit(s, "promo.redeemed", user_ref=user.user_ref, source="bot", kind=r.kind)
            await s.commit()
            await message.answer(f"Промокод применён. Начислено разборов: {r.granted_runs}." if r.granted_runs
                                 else "Промокод применён: скидка будет учтена при следующей оплате на сайте.")
        except PromoError as e:
            await s.rollback()
            await emit(s, "promo.redeem_failed", level="warning", user_ref=user_ref, source="bot", reason=e.reason)
            await s.commit()
            await message.answer("Код не найден или недоступен.")


@router.callback_query(F.data.startswith("buy:"))
async def buy(cb: CallbackQuery, bot: Bot) -> None:
    product = product_by_id(cb.data.split(":")[1])
    async with SessionLocal() as s:
        user = await user_by_tg(s, cb.from_user.id)
        if not user:
            await cb.answer("Сначала привяжите аккаунт", show_alert=True)
            return
        payment = Payment(user_id=user.id, provider="stars", product_id=product["id"], amount_minor=int(product["price_stars"]),
                          currency="XTR", runs=int(product["runs"]))
        s.add(payment)
        await s.commit()
    await bot.send_invoice(chat_id=cb.message.chat.id, title=product["title"],
                           description="Разборы переписок и TikTok — общие для сайта и бота",
                           payload=str(payment.id), currency="XTR",
                           prices=[LabeledPrice(label=product["title"], amount=int(product["price_stars"]))])
    await cb.answer()


@router.pre_checkout_query()
async def pre_checkout(q: PreCheckoutQuery) -> None:
    async with SessionLocal() as s:
        from uuid import UUID

        try:
            payment = await s.get(Payment, UUID(q.invoice_payload))
        except ValueError:
            payment = None
        ok = bool(payment and payment.status == "pending" and payment.amount_minor == q.total_amount and q.currency == "XTR")
    await q.answer(ok=ok, error_message=None if ok else "Платёж устарел, попробуйте ещё раз")


@router.message(F.successful_payment)
async def paid(message: Message) -> None:
    sp = message.successful_payment
    from uuid import UUID

    async with SessionLocal() as s:
        payment = await s.get(Payment, UUID(sp.invoice_payload))
        if not payment:
            log.error("stars.unknown_payment")
            return
        payment.provider_payment_id = sp.telegram_payment_charge_id
        await mark_succeeded(s, payment, "stars")
        await s.commit()
        b = await balance(s, payment.user_id)
    await message.answer(f"Оплата прошла! Разборов на балансе: {b}.")


@router.message(F.document)
async def document(message: Message) -> None:
    """Фаза 9: приём файлов (до 2 ГБ через локальный bot-api), склейка альбомов TikTok, разбор на сервере."""
    await message.answer(
        "Загрузка файлов в бота появится в следующей версии. Пока откройте приложение — "
        "там файл обрабатывается прямо на вашем устройстве и никуда не уходит.",
        reply_markup=main_menu(),
    )


@router.message(Command("privacy"))
async def privacy(message: Message) -> None:
    await message.answer(
        "В приложении файлы обрабатываются на вашем устройстве: на сервер уходят только обезличенные счётчики. "
        "Через бота (когда появится загрузка) файл обрабатывается на сервере в памяти и сразу удаляется. "
        "Удалить все данные можно в профиле на сайте."
    )


async def send_due_reminders(bot: Bot) -> int:
    sent = 0
    async with SessionLocal() as s:
        rows = (await s.execute(select(Reminder).where(Reminder.status == "pending", Reminder.due_at <= utcnow()).limit(100))).scalars().all()
        for r in rows:
            try:
                await bot.send_message(r.tg_chat_id, "Пора проверить выгрузку TikTok: Профиль → ☰ → Настройки и конфиденциальность → "
                                       "Аккаунт → Скачать свои данные → вкладка «Скачать данные». Файл доступен ограниченное время.",
                                       reply_markup=InlineKeyboardMarkup(inline_keyboard=[[InlineKeyboardButton(text="Ещё не готово — завтра", callback_data="r:24")]]))
                r.status = "sent"
                r.sent_at = utcnow()
                sent += 1
                await emit(s, "reminder.sent", source="bot", kind=r.kind)
            except Exception as e:  # noqa: BLE001
                log.warning("reminder.failed", error=str(e)[:200])
        await s.commit()
    return sent


async def reminders_loop(bot: Bot) -> None:
    while True:
        await send_due_reminders(bot)
        await asyncio.sleep(60)


async def main() -> None:
    configure_logging()
    if not settings.tg_bot_token:
        raise SystemExit("TG_BOT_TOKEN не задан")
    await init_models()
    bot = Bot(settings.tg_bot_token)
    dp = Dispatcher()
    dp.include_router(router)
    asyncio.create_task(reminders_loop(bot))
    log.info("bot.started")
    await dp.start_polling(bot)


if __name__ == "__main__":
    asyncio.run(main())
