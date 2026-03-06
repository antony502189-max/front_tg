import unittest

from backend.telegram_bot import (
    TelegramBotApp,
    TelegramBotConfig,
    TelegramBotError,
    build_web_app_markup,
    create_menu_button_payload,
    create_start_message_payload,
    extract_message_context,
    normalize_command,
)


TEST_CONFIG = TelegramBotConfig(
    bot_token="123:token",
    mini_app_url="https://example.com/app",
    api_base_url="https://api.telegram.org",
    polling_timeout_s=5,
    retry_delay_ms=10,
    drop_pending_updates=False,
    set_chat_menu_button=True,
    button_text="Открыть приложение",
    start_text="Открой приложение по кнопке ниже.",
)


class FakeTelegramBotClient:
    def __init__(self) -> None:
        self.sent_chat_ids: list[int] = []
        self.menu_button_calls = 0
        self.delete_webhook_calls: list[bool] = []
        self.updates_calls = 0
        self.fail_setup_once = False

    def send_start_message(self, chat_id: int) -> None:
        self.sent_chat_ids.append(chat_id)

    def delete_webhook(self, drop_pending_updates: bool) -> None:
        if self.fail_setup_once:
            self.fail_setup_once = False
            raise TelegramBotError("temporary setup failure")

        self.delete_webhook_calls.append(drop_pending_updates)

    def set_chat_menu_button(self) -> None:
        self.menu_button_calls += 1

    def get_updates(self, _offset: int | None) -> list[dict[str, object]]:
        self.updates_calls += 1
        return []


class TelegramBotTests(unittest.TestCase):
    def test_extract_message_context_reads_message_payload(self) -> None:
        update = {
            "update_id": 1000,
            "message": {
                "chat": {"id": 42},
                "text": "/start hello",
            },
        }

        self.assertEqual(extract_message_context(update), (42, "/start hello"))

    def test_normalize_command_strips_bot_suffix_and_args(self) -> None:
        self.assertEqual(normalize_command("/start@my_bot test"), "/start")
        self.assertEqual(normalize_command("plain text"), None)

    def test_build_web_app_markup_returns_inline_button(self) -> None:
        markup = build_web_app_markup(
            "https://example.com/app",
            "Открыть",
        )

        self.assertEqual(
            markup,
            {
                "inline_keyboard": [
                    [
                        {
                            "text": "Открыть",
                            "web_app": {"url": "https://example.com/app"},
                        }
                    ]
                ]
            },
        )

    def test_create_start_message_payload_embeds_web_app_button(self) -> None:
        payload = create_start_message_payload(99, TEST_CONFIG)

        self.assertEqual(payload["chat_id"], 99)
        self.assertEqual(payload["text"], TEST_CONFIG.start_text)
        self.assertEqual(
            payload["reply_markup"]["inline_keyboard"][0][0]["web_app"]["url"],
            TEST_CONFIG.mini_app_url,
        )

    def test_create_menu_button_payload_uses_web_app(self) -> None:
        payload = create_menu_button_payload(TEST_CONFIG)

        self.assertEqual(payload["menu_button"]["type"], "web_app")
        self.assertEqual(
            payload["menu_button"]["web_app"]["url"],
            TEST_CONFIG.mini_app_url,
        )

    def test_process_updates_sends_start_message_and_advances_offset(self) -> None:
        client = FakeTelegramBotClient()
        app = TelegramBotApp(TEST_CONFIG, client=client)

        app.process_updates(
            [
                {
                    "update_id": 10,
                    "message": {
                        "chat": {"id": 77},
                        "text": "/start",
                    },
                }
            ]
        )

        self.assertEqual(client.sent_chat_ids, [77])
        self.assertEqual(app.offset, 11)

    def test_process_updates_ignores_plain_text(self) -> None:
        client = FakeTelegramBotClient()
        app = TelegramBotApp(TEST_CONFIG, client=client)

        app.process_updates(
            [
                {
                    "update_id": 10,
                    "message": {
                        "chat": {"id": 77},
                        "text": "hello",
                    },
                }
            ]
        )

        self.assertEqual(client.sent_chat_ids, [])
        self.assertEqual(app.offset, 11)

    def test_ensure_setup_sets_menu_button_when_enabled(self) -> None:
        client = FakeTelegramBotClient()
        app = TelegramBotApp(TEST_CONFIG, client=client)

        app.ensure_setup()

        self.assertEqual(client.delete_webhook_calls, [False])
        self.assertEqual(client.menu_button_calls, 1)
        self.assertTrue(app.is_configured)

    def test_run_iteration_retries_setup_before_polling(self) -> None:
        client = FakeTelegramBotClient()
        client.fail_setup_once = True
        app = TelegramBotApp(TEST_CONFIG, client=client)

        with self.assertRaises(TelegramBotError):
            app.run_iteration()

        self.assertFalse(app.is_configured)
        self.assertEqual(client.updates_calls, 0)

        app.run_iteration()

        self.assertTrue(app.is_configured)
        self.assertEqual(client.delete_webhook_calls, [False])
        self.assertEqual(client.menu_button_calls, 1)
        self.assertEqual(client.updates_calls, 1)


if __name__ == "__main__":
    unittest.main()
