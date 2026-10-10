"""Перевод UTC-времени в местное время пользователя (его город → IANA-пояс)."""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta
from zoneinfo import ZoneInfo

EPOCH = date(1970, 1, 1)


class Clock:
    def __init__(self, tz: str):
        self.tz = ZoneInfo(tz)
        self._cache: dict[int, int] = {}

    def offset(self, ts: int) -> int:
        hour = ts // 3600
        off = self._cache.get(hour)
        if off is None:
            dt = datetime.fromtimestamp(hour * 3600, UTC).astimezone(self.tz)
            off = int(dt.utcoffset().total_seconds())  # type: ignore[union-attr]
            self._cache[hour] = off
        return off

    def local(self, ts: int) -> int:
        return ts + self.offset(ts)

    def day(self, ts: int) -> int:
        """Номер дня с 1970-01-01 по местному времени."""
        return self.local(ts) // 86400

    def hour(self, ts: int) -> int:
        return (self.local(ts) % 86400) // 3600

    @staticmethod
    def weekday(day_number: int) -> int:
        """0 — понедельник."""
        return (day_number + 3) % 7

    @staticmethod
    def day_str(day_number: int) -> str:
        return (EPOCH + timedelta(days=day_number)).isoformat()

    @staticmethod
    def month_str(day_number: int) -> str:
        return Clock.day_str(day_number)[:7]
