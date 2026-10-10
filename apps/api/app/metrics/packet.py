"""Схема пакета агрегатов packet.v1 (зеркало packages/parsers/src/packet.ts). Контракт — docs/05."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field, model_validator

MAX_MESSAGES = 2_000_000
MAX_PARTICIPANTS = 500


class Participant(BaseModel):
    key: str
    name: str = Field(max_length=200)
    is_owner: bool = False


class Stream(BaseModel):
    ts: list[int]
    author: list[int]
    kind: list[int]
    dur: list[int | float | None]
    fwd: list[int | None]
    words: list[int]
    laugh: list[int]

    @model_validator(mode="after")
    def same_length(self) -> Stream:
        n = len(self.ts)
        if n > MAX_MESSAGES:
            raise ValueError("too_many_messages")
        for name in ("author", "kind", "dur", "fwd", "words", "laugh"):
            if len(getattr(self, name)) != n:
                raise ValueError(f"stream.{name} length mismatch")
        if any(self.ts[i] > self.ts[i + 1] for i in range(n - 1)):
            raise ValueError("stream.ts must be sorted")
        return self


class Words(BaseModel):
    by_month: dict[str, dict[str, list[tuple[str, int]]]] = {}
    custom_patterns: list[str] = []
    custom_hits: list[tuple[int, int]] = []
    mask_words: dict[str, list[tuple[str, int]]] = {}


class Reactions(BaseModel):
    on_msg: list[tuple[int, str, int]] = []
    who: list[tuple[int, int, str]] = []


class Event(BaseModel):
    ts: int
    actor: int | None = None
    action: str
    title: str | None = None
    count: int | None = None
    dur: int | float | None = None


class TikTok(BaseModel):
    owner: str = ""
    use_history: bool = False
    views: dict[str, list[Any]] | None = None
    likes: list[int] = []
    favorites: list[int] = []
    collections: list[int] = []
    logins: list[int] = []


class PacketV1(BaseModel):
    schema_: Literal["packet.v1"] = Field(alias="schema")
    source: Literal["tg", "tt"]
    chat_kind: Literal["personal", "group", "account"]
    chat_key: str = Field(max_length=300)
    title: str = Field(default="", max_length=300)
    sections: list[str]
    tz: str
    hide_names: bool = False
    participants: list[Participant] = Field(max_length=MAX_PARTICIPANTS)
    kinds: list[str]
    stream: Stream
    forward_sources: list[str] = []
    words: Words | None = None
    laugh_forms: list[tuple[str, int]] | None = None
    swear_hits: list[tuple[int, str]] | None = None
    swear_labels: dict[str, str] | None = None
    name_hits: list[tuple[int, str]] | None = None
    name_labels: dict[str, str] | None = None
    reactions: Reactions | None = None
    emoji_hits: list[tuple[int, str, int]] | None = None
    sticker_hits: list[tuple[int, str]] | None = None
    events: list[Event] | None = None
    tt: TikTok | None = None
    dict_versions: dict[str, str] | None = None
    client: dict[str, Any] = {}

    model_config = {"populate_by_name": True}

    @model_validator(mode="after")
    def indices_in_range(self) -> PacketV1:
        n = len(self.stream.ts)
        p = len(self.participants)
        if any(a < 0 or a >= max(p, 1) for a in self.stream.author):
            raise ValueError("author index out of range")
        for name in ("swear_hits", "name_hits", "emoji_hits", "sticker_hits"):
            for item in getattr(self, name) or []:
                if not 0 <= item[0] < n:
                    raise ValueError(f"{name}: message index out of range")
        return self
