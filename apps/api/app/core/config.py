"""Настройки из переменных окружения (.env). Описание переменных — .env.example."""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Any

import yaml
from pydantic_settings import BaseSettings, SettingsConfigDict

REPO_ROOT = Path(__file__).resolve().parents[4]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=(".env", str(REPO_ROOT / ".env")), extra="ignore")

    env: str = "local"
    public_url: str = "http://localhost:5173"
    api_url: str = "http://localhost:8000"
    database_url: str = "sqlite+aiosqlite:///./data/dev.db"
    redis_url: str = "redis://localhost:6379/0"

    session_secret: str = "dev-session-secret-change-me"
    user_ref_secret: str = "dev-user-ref-secret-change-me"
    history_enc_key: str = ""

    admin_emails: str = ""
    dev_login: bool = True

    google_client_id: str = ""
    google_client_secret: str = ""
    google_sa_json: str = ""
    dict_sheet_id: str = ""
    ops_sheet_id: str = ""
    logs_drive_folder_id: str = ""

    yookassa_shop_id: str = ""
    yookassa_secret: str = ""
    yookassa_send_receipt: bool = False
    yookassa_check_ip: bool = True

    tg_bot_token: str = ""
    tg_bot_username: str = ""
    tg_webhook_secret: str = ""
    admin_tg_chat_id: str = ""

    reports_dir: str = str(REPO_ROOT / "apps" / "api" / "data" / "reports")
    config_dir: str = str(REPO_ROOT / "config")
    dictionaries_seed_dir: str = str(REPO_ROOT / "dictionaries" / "seed")
    tokens_css: str = str(REPO_ROOT / "packages" / "design-tokens" / "tokens.css")
    guides_dir: str = str(REPO_ROOT / "docs" / "guides")

    @property
    def is_local(self) -> bool:
        return self.env == "local"

    @property
    def admin_email_set(self) -> set[str]:
        return {e.strip().lower() for e in self.admin_emails.split(",") if e.strip()}


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()


@lru_cache
def load_yaml(name: str) -> dict[str, Any]:
    with open(Path(settings.config_dir) / name, encoding="utf-8") as f:
        return yaml.safe_load(f)


def products_config() -> dict[str, Any]:
    return load_yaml("products.yaml")


def tiers_config() -> dict[str, Any]:
    return load_yaml("tiers.yaml")


def metrics_config() -> dict[str, Any]:
    return load_yaml("metrics.yaml")


def section_info(section_id: str) -> dict[str, Any] | None:
    for items in tiers_config()["sections"].values():
        for item in items:
            if item["id"] == section_id:
                return item
    return None


def is_free_section(section_id: str) -> bool:
    info = section_info(section_id)
    return bool(info and info.get("free"))
