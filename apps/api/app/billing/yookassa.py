"""Клиент ЮKassa API v3. Документация: https://yookassa.ru/developers/api

Самозанятость (НПД): чеки формирует «Мой налог» — объект receipt в платёж не передаём
(YOOKASSA_SEND_RECEIPT=false). Для ИП на УСН включить и передавать receipt по 54-ФЗ.
"""

from __future__ import annotations

import ipaddress
import uuid
from decimal import Decimal
from typing import Any

import httpx

from app.core.config import settings

BASE_URL = "https://api.yookassa.ru/v3"

# IP-адреса уведомлений ЮKassa (сверить с документацией перед запуском).
WEBHOOK_NETWORKS = [ipaddress.ip_network(n) for n in (
    "185.71.76.0/27", "185.71.77.0/27", "77.75.153.0/25", "77.75.156.11/32", "77.75.156.35/32",
    "77.75.154.128/25", "2a02:5180::/32",
)]


def is_yookassa_ip(ip: str) -> bool:
    try:
        addr = ipaddress.ip_address(ip)
    except ValueError:
        return False
    return any(addr in net for net in WEBHOOK_NETWORKS)


class YooKassaError(Exception):
    pass


class YooKassaClient:
    def __init__(self, shop_id: str | None = None, secret: str | None = None):
        self.shop_id = shop_id or settings.yookassa_shop_id
        self.secret = secret or settings.yookassa_secret

    @property
    def configured(self) -> bool:
        return bool(self.shop_id and self.secret)

    async def _request(self, method: str, path: str, json: dict[str, Any] | None = None,
                       idempotence_key: str | None = None) -> dict[str, Any]:
        headers = {"Idempotence-Key": idempotence_key} if idempotence_key else {}
        async with httpx.AsyncClient(timeout=20, auth=(self.shop_id, self.secret)) as c:
            r = await c.request(method, BASE_URL + path, json=json, headers=headers)
        if r.status_code >= 400:
            raise YooKassaError(f"{r.status_code}: {r.text[:300]}")
        return r.json()

    async def create_payment(self, *, amount_rub: int, description: str, return_url: str,
                             metadata: dict[str, str], receipt: dict[str, Any] | None = None,
                             idempotence_key: str | None = None) -> dict[str, Any]:
        body: dict[str, Any] = {
            "amount": {"value": f"{Decimal(amount_rub):.2f}", "currency": "RUB"},
            "capture": True,
            "confirmation": {"type": "redirect", "return_url": return_url},
            "description": description[:128],
            "metadata": metadata,
        }
        if receipt and settings.yookassa_send_receipt:
            body["receipt"] = receipt
        return await self._request("POST", "/payments", body, idempotence_key or str(uuid.uuid4()))

    async def get_payment(self, payment_id: str) -> dict[str, Any]:
        return await self._request("GET", f"/payments/{payment_id}")

    async def refund(self, payment_id: str, amount_rub: Decimal) -> dict[str, Any]:
        body = {"payment_id": payment_id, "amount": {"value": f"{amount_rub:.2f}", "currency": "RUB"}}
        return await self._request("POST", "/refunds", body, str(uuid.uuid4()))
