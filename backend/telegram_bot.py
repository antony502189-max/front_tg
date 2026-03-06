from __future__ import annotations

import json
import os
import time
from dataclasses import dataclass
from typing import Any, Callable, Mapping
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

try:
    from backend.env import load_project_env
except ModuleNotFoundError:  # pragma: no cover - fallback for direct script launch
    from env import load_project_env  # type: ignore


load_project_env()


JsonValue = Any
SleepFn = Callable[[float], None]
HeaderMap = Mapping[str, str]
ALLOWED_UPDATE_TYPES = ["message", "edited_message"]
WEBHOOK_PATH = "/telegram/webhook"


class TelegramBotError(Exception):
    def __init__(self, message: str, status_code: int | None = None) -> None:
        super().__init__(message)
        self.message = message
        self.status_code = status_code


def parse_number_env(name: str, fallback: int) -> int:
    raw = os.getenv(name)

    if raw is None:
        return fallback

    try:
        parsed = int(raw)
    except ValueError:
        return fallback

    return parsed if parsed >= 0 else fallback


def parse_bool_env(name: str, fallback: bool) -> bool:
    raw = os.getenv(name)

    if raw is None:
        return fallback

    return raw.strip().lower() in {"1", "true", "yes", "on"}


@dataclass(frozen=True)
class TelegramBotConfig:
    bot_token: str
    mini_app_url: str
    api_base_url: str
    polling_timeout_s: int
    retry_delay_ms: int
    drop_pending_updates: bool
    set_chat_menu_button: bool
    button_text: str
    start_text: str
    backend_public_url: str | None = None
    webhook_secret: str | None = None


def parse_string_env(name: str) -> str | None:
    raw = os.getenv(name)

    if raw is None:
        return None

    normalized = raw.strip()
    return normalized or None


def load_config() -> TelegramBotConfig:
    bot_token = parse_string_env("BOT_TOKEN") or ""
    mini_app_url = parse_string_env("MINI_APP_URL") or ""

    if not bot_token:
        raise TelegramBotError('Missing required env var "BOT_TOKEN"')

    if not mini_app_url:
        raise TelegramBotError('Missing required env var "MINI_APP_URL"')

    return TelegramBotConfig(
        bot_token=bot_token,
        mini_app_url=mini_app_url,
        api_base_url=os.getenv("TELEGRAM_API_BASE_URL", "https://api.telegram.org"),
        polling_timeout_s=parse_number_env("TELEGRAM_POLLING_TIMEOUT_S", 25),
        retry_delay_ms=parse_number_env("TELEGRAM_RETRY_DELAY_MS", 1_000),
        drop_pending_updates=parse_bool_env("TELEGRAM_DROP_PENDING_UPDATES", False),
        set_chat_menu_button=parse_bool_env("TELEGRAM_SET_CHAT_MENU_BUTTON", True),
        button_text=os.getenv(
            "TELEGRAM_MINI_APP_BUTTON_TEXT",
            "Открыть мини-приложение",
        ).strip()
        or "Открыть мини-приложение",
        start_text=os.getenv(
            "TELEGRAM_START_TEXT",
            "Открой приложение по кнопке ниже.",
        ).strip()
        or "Открой приложение по кнопке ниже.",
        backend_public_url=parse_string_env("BACKEND_PUBLIC_URL"),
        webhook_secret=parse_string_env("TELEGRAM_WEBHOOK_SECRET"),
    )


def load_webhook_config() -> TelegramBotConfig | None:
    backend_public_url = parse_string_env("BACKEND_PUBLIC_URL")

    if not backend_public_url:
        return None

    config = load_config()
    return TelegramBotConfig(
        bot_token=config.bot_token,
        mini_app_url=config.mini_app_url,
        api_base_url=config.api_base_url,
        polling_timeout_s=config.polling_timeout_s,
        retry_delay_ms=config.retry_delay_ms,
        drop_pending_updates=config.drop_pending_updates,
        set_chat_menu_button=config.set_chat_menu_button,
        button_text=config.button_text,
        start_text=config.start_text,
        backend_public_url=backend_public_url,
        webhook_secret=parse_string_env("TELEGRAM_WEBHOOK_SECRET"),
    )


def extract_message_context(update: JsonValue) -> tuple[int, str] | None:
    if not isinstance(update, dict):
        return None

    for key in ("message", "edited_message"):
        event = update.get(key)

        if not isinstance(event, dict):
            continue

        chat = event.get("chat")
        if not isinstance(chat, dict):
            continue

        chat_id = chat.get("id")
        text = event.get("text")

        if not isinstance(chat_id, int) or not isinstance(text, str):
            continue

        normalized_text = text.strip()
        if not normalized_text:
            continue

        return chat_id, normalized_text

    return None


def normalize_command(text: str) -> str | None:
    stripped = text.strip()
    if not stripped.startswith("/"):
        return None

    first_token = stripped.split(maxsplit=1)[0]
    command = first_token.split("@", maxsplit=1)[0].lower()

    return command or None


def build_web_app_markup(url: str, button_text: str) -> dict[str, Any]:
    return {
        "inline_keyboard": [
            [
                {
                    "text": button_text,
                    "web_app": {"url": url},
                }
            ]
        ]
    }


def create_start_message_payload(
    chat_id: int,
    config: TelegramBotConfig,
) -> dict[str, Any]:
    return {
        "chat_id": chat_id,
        "text": config.start_text,
        "reply_markup": build_web_app_markup(
            config.mini_app_url,
            config.button_text,
        ),
        "disable_web_page_preview": True,
    }


def create_menu_button_payload(config: TelegramBotConfig) -> dict[str, Any]:
    return {
        "menu_button": {
            "type": "web_app",
            "text": config.button_text,
            "web_app": {"url": config.mini_app_url},
        }
    }


def build_webhook_url(config: TelegramBotConfig) -> str:
    if not config.backend_public_url:
        raise TelegramBotError('Missing required env var "BACKEND_PUBLIC_URL"')

    return f"{config.backend_public_url.rstrip('/')}{WEBHOOK_PATH}"


def matches_webhook_secret(
    headers: HeaderMap,
    expected_secret: str | None,
) -> bool:
    if not expected_secret:
        return True

    actual_secret = headers.get("x-telegram-bot-api-secret-token", "").strip()
    return actual_secret == expected_secret


class TelegramBotClient:
    def __init__(self, config: TelegramBotConfig) -> None:
        self.config = config

    def _request(self, method: str, payload: dict[str, Any]) -> JsonValue:
        base_url = self.config.api_base_url.rstrip("/")
        url = f"{base_url}/bot{self.config.bot_token}/{method}"
        body = json.dumps(payload).encode("utf-8")
        request = Request(
            url,
            data=body,
            method="POST",
            headers={
                "Accept": "application/json",
                "Content-Type": "application/json; charset=utf-8",
                "User-Agent": "front_tg_telegram_wrapper/1.0",
            },
        )

        try:
            with urlopen(request, timeout=self.config.polling_timeout_s + 5) as response:
                raw_body = response.read()
        except HTTPError as error:
            raise TelegramBotError(
                _read_telegram_error(error.read()),
                status_code=error.code,
            ) from error
        except URLError as error:
            raise TelegramBotError(str(error.reason or "Telegram API request failed")) from error

        try:
            parsed = json.loads(raw_body.decode("utf-8")) if raw_body else {}
        except json.JSONDecodeError as error:
            raise TelegramBotError("Telegram API returned invalid JSON") from error

        if not isinstance(parsed, dict) or not parsed.get("ok"):
            error_code = parsed.get("error_code") if isinstance(parsed, dict) else None
            description = (
                parsed.get("description")
                if isinstance(parsed, dict)
                else "Telegram API request failed"
            )
            raise TelegramBotError(
                str(description or "Telegram API request failed"),
                status_code=error_code if isinstance(error_code, int) else None,
            )

        return parsed.get("result")

    def get_updates(self, offset: int | None = None) -> list[dict[str, Any]]:
        payload: dict[str, Any] = {
            "timeout": self.config.polling_timeout_s,
            "allowed_updates": ALLOWED_UPDATE_TYPES,
        }

        if offset is not None:
            payload["offset"] = offset

        response = self._request("getUpdates", payload)
        return response if isinstance(response, list) else []

    def send_start_message(self, chat_id: int) -> None:
        self._request("sendMessage", create_start_message_payload(chat_id, self.config))

    def delete_webhook(self, drop_pending_updates: bool) -> None:
        self._request(
            "deleteWebhook",
            {"drop_pending_updates": drop_pending_updates},
        )

    def set_chat_menu_button(self) -> None:
        self._request("setChatMenuButton", create_menu_button_payload(self.config))

    def set_webhook(
        self,
        url: str,
        *,
        drop_pending_updates: bool,
        secret_token: str | None,
    ) -> None:
        payload: dict[str, Any] = {
            "url": url,
            "allowed_updates": ALLOWED_UPDATE_TYPES,
            "drop_pending_updates": drop_pending_updates,
        }

        if secret_token:
            payload["secret_token"] = secret_token

        self._request("setWebhook", payload)


def _read_telegram_error(raw_body: bytes) -> str:
    if not raw_body:
        return "Telegram API request failed"

    try:
        payload = json.loads(raw_body.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        decoded = raw_body.decode("utf-8", errors="replace").strip()
        return decoded or "Telegram API request failed"

    if isinstance(payload, dict):
        description = payload.get("description")
        if isinstance(description, str) and description.strip():
            return description.strip()

    return "Telegram API request failed"


class TelegramBotApp:
    def __init__(
        self,
        config: TelegramBotConfig,
        *,
        client: TelegramBotClient | None = None,
        sleep: SleepFn | None = None,
    ) -> None:
        self.config = config
        self.client = client or TelegramBotClient(config)
        self.sleep = sleep or time.sleep
        self.offset: int | None = None
        self.is_configured = False

    def ensure_setup(self) -> None:
        self.client.delete_webhook(self.config.drop_pending_updates)

        if self.config.set_chat_menu_button:
            self.client.set_chat_menu_button()

        self.is_configured = True

    def ensure_webhook_setup(self) -> None:
        self.client.set_webhook(
            build_webhook_url(self.config),
            drop_pending_updates=self.config.drop_pending_updates,
            secret_token=self.config.webhook_secret,
        )

        if self.config.set_chat_menu_button:
            self.client.set_chat_menu_button()

        self.is_configured = True

    def handle_update(self, update: JsonValue) -> None:
        context = extract_message_context(update)
        if context is None:
            return

        chat_id, text = context
        command = normalize_command(text)

        if command in {"/start", "/app", "/help"}:
            self.client.send_start_message(chat_id)

    def process_updates(self, updates: list[dict[str, Any]]) -> None:
        for update in updates:
            update_id = update.get("update_id")
            if isinstance(update_id, int):
                next_offset = update_id + 1
                self.offset = max(self.offset or next_offset, next_offset)

            self.handle_update(update)

    def run_iteration(self) -> None:
        if not self.is_configured:
            self.ensure_setup()

        updates = self.client.get_updates(self.offset)
        self.process_updates(updates)

    def run_forever(self) -> None:
        warn_if_non_https(self.config.mini_app_url)

        while True:
            try:
                self.run_iteration()
            except TelegramBotError as error:
                print(f"[telegram-bot] error: {error.message}")
                self.sleep(self.config.retry_delay_ms / 1000)


def warn_if_non_https(url: str) -> None:
    if url.startswith("https://"):
        return

    print(
        "[telegram-bot] warning: MINI_APP_URL is not HTTPS. "
        "Telegram Mini Apps normally require a public HTTPS URL."
    )


def run_bot() -> None:
    app = TelegramBotApp(load_config())

    print("[telegram-bot] wrapper started")
    print("[telegram-bot] commands: /start, /app, /help")

    try:
        app.run_forever()
    except KeyboardInterrupt:
        print("[telegram-bot] stopped")


if __name__ == "__main__":
    run_bot()
