import asyncio
import json
import unittest
from datetime import date, datetime
from pathlib import Path
from threading import Event, Lock, Thread

from backend.server import (
    BackendApp,
    CacheEntry,
    MAX_REQUEST_BODY_BYTES,
    REQUEST_BODY_TOO_LARGE_MESSAGE,
    RequestBodyTooLargeError,
    UpstreamRequestError,
    cache_key,
    create_asgi_app,
    fetch_with_retry,
    matches_rating_speciality,
    normalize_auditories_response,
    normalize_employees_response,
    extract_grade_subjects,
    normalize_grades_response,
    normalize_omissions_response,
    normalize_schedule_response,
    read_request_body,
    read_fresh_cache,
    read_stale_cache,
    route_config,
    write_cache,
)
from backend.services.rating import build_rating_list_summary
from backend.user_profiles import UserProfileStore


TEST_CONFIG = {
    "host": "127.0.0.1",
    "port": 8787,
    "iis_base_url": "https://iis.bsuir.by/api/v1",
    "cache_ttl_ms": 60_000,
    "stale_ttl_ms": 300_000,
    "request_timeout_ms": 100,
    "max_retries": 0,
    "retry_delay_ms": 1,
}


class FakeWebhookBotApp:
    def __init__(self, secret: str | None = "secret") -> None:
        self.config = type(
            "Config",
            (),
            {
                "webhook_secret": secret,
                "backend_public_url": "https://example.com",
            },
        )()
        self.is_configured = False
        self.setup_calls = 0
        self.received_updates: list[dict[str, object]] = []

    def ensure_webhook_setup(self) -> None:
        self.setup_calls += 1
        self.is_configured = True

    def handle_update(self, update: dict[str, object]) -> None:
        self.received_updates.append(update)


class BackendServerTests(unittest.TestCase):
    def test_asgi_app_serves_health_response(self) -> None:
        backend_app = BackendApp(config=TEST_CONFIG, fetcher=lambda *_: {})
        app = create_asgi_app(backend_app)
        messages: list[dict[str, object]] = []

        async def receive() -> dict[str, object]:
            return {
                "type": "http.request",
                "body": b"",
                "more_body": False,
            }

        async def send(message: dict[str, object]) -> None:
            messages.append(message)

        asyncio.run(
            app(
                {
                    "type": "http",
                    "method": "GET",
                    "path": "/api/health",
                    "query_string": b"",
                },
                receive,
                send,
            )
        )

        self.assertEqual(messages[0]["type"], "http.response.start")
        self.assertEqual(messages[0]["status"], 200)
        self.assertEqual(messages[1]["type"], "http.response.body")
        payload = json.loads(messages[1]["body"])
        self.assertTrue(payload["ok"])

    def test_asgi_app_handles_lifespan_startup_and_shutdown(self) -> None:
        bot_app = FakeWebhookBotApp()
        backend_app = BackendApp(
            config=TEST_CONFIG,
            fetcher=lambda *_: {},
            telegram_bot_app=bot_app,
        )
        app = create_asgi_app(backend_app)
        messages: list[dict[str, object]] = []
        received_messages = iter(
            [
                {"type": "lifespan.startup"},
                {"type": "lifespan.shutdown"},
            ]
        )

        async def receive() -> dict[str, object]:
            return next(received_messages)

        async def send(message: dict[str, object]) -> None:
            messages.append(message)

        asyncio.run(
            app(
                {
                    "type": "lifespan",
                },
                receive,
                send,
            )
        )

        self.assertEqual(
            messages,
            [
                {"type": "lifespan.startup.complete"},
                {"type": "lifespan.shutdown.complete"},
            ],
        )
        self.assertEqual(bot_app.setup_calls, 1)

    def test_root_request_returns_service_info(self) -> None:
        app = BackendApp(config=TEST_CONFIG, fetcher=lambda *_: {})

        response = app.handle_request("GET", "/")

        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.payload["ok"])
        self.assertEqual(response.payload["healthPath"], "/api/health")

    def test_root_request_includes_webhook_path_when_bot_is_enabled(self) -> None:
        bot_app = FakeWebhookBotApp()
        app = BackendApp(
            config=TEST_CONFIG,
            fetcher=lambda *_: {},
            telegram_bot_app=bot_app,
        )

        response = app.handle_request("GET", "/")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.payload["telegramWebhookPath"], "/telegram/webhook")

    def test_route_config_resolves_known_routes(self) -> None:
        self.assertEqual(route_config("/api/schedule").cache_namespace, "/schedule")
        self.assertEqual(route_config("/api/grades").query_param, "studentCardNumber")
        self.assertEqual(route_config("/api/omissions").query_param, "telegramUserId")
        self.assertEqual(route_config("/api/employees").min_length, 2)
        self.assertEqual(route_config("/api/auditories").query_param, "q")
        self.assertIsNone(route_config("/unknown"))

    def test_webhook_post_processes_update(self) -> None:
        bot_app = FakeWebhookBotApp()
        app = BackendApp(
            config=TEST_CONFIG,
            fetcher=lambda *_: {},
            telegram_bot_app=bot_app,
        )
        body = json.dumps(
            {
                "update_id": 1,
                "message": {
                    "chat": {"id": 55},
                    "text": "/start",
                },
            }
        ).encode("utf-8")

        response = app.handle_request(
            "POST",
            "/telegram/webhook",
            body=body,
            headers={"x-telegram-bot-api-secret-token": "secret"},
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.payload, {"ok": True})
        self.assertEqual(len(bot_app.received_updates), 1)

    def test_webhook_post_rejects_invalid_secret(self) -> None:
        bot_app = FakeWebhookBotApp()
        app = BackendApp(
            config=TEST_CONFIG,
            fetcher=lambda *_: {},
            telegram_bot_app=bot_app,
        )

        response = app.handle_request(
            "POST",
            "/telegram/webhook",
            body=b"{}",
            headers={"x-telegram-bot-api-secret-token": "wrong"},
        )

        self.assertEqual(response.status_code, 403)
        self.assertEqual(bot_app.received_updates, [])

    def test_configure_telegram_webhook_runs_once(self) -> None:
        bot_app = FakeWebhookBotApp()
        app = BackendApp(
            config=TEST_CONFIG,
            fetcher=lambda *_: {},
            telegram_bot_app=bot_app,
        )

        app.configure_telegram_webhook()
        app.configure_telegram_webhook()

        self.assertEqual(bot_app.setup_calls, 1)

    def test_returns_400_when_required_query_is_missing(self) -> None:
        app = BackendApp(config=TEST_CONFIG, fetcher=lambda *_: {})

        response = app.handle_request("GET", "/api/schedule")

        self.assertEqual(response.status_code, 400)
        self.assertIn("studentGroup", response.payload["error"])

    def test_head_request_is_served_for_known_routes(self) -> None:
        app = BackendApp(config=TEST_CONFIG, fetcher=lambda *_: {"days": []})

        response = app.handle_request("HEAD", "/api/schedule?studentGroup=353502")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.payload["days"], [])
        self.assertEqual(response.payload["view"], "week")

    def test_serves_fresh_cache_without_calling_upstream(self) -> None:
        fetch_count = {"value": 0}
        store: dict[str, CacheEntry] = {}
        now_ms = lambda: 1_000
        today = lambda: date(2026, 3, 4)
        key = cache_key(
            "/schedule",
            {
                "studentGroup": "353502",
                "teacherUrlId": "",
                "teacherEmployeeId": "",
                "subgroup": "all",
                "week": "",
                "view": "week",
                "date": "2026-03-04",
            },
        )

        write_cache(
            store,
            key,
            {
                "view": "week",
                "currentWeek": 3,
                "selectedWeek": 3,
                "rangeStart": "2026-03-02",
                "rangeEnd": "2026-03-08",
                "days": [{"date": "2026-01-01", "lessons": []}],
            },
            60_000,
            120_000,
            now_ms(),
        )

        def fetcher(_path: str, _params: dict[str, str]):
            fetch_count["value"] += 1
            return []

        app = BackendApp(
            config=TEST_CONFIG,
            store=store,
            fetcher=fetcher,
            now_ms=now_ms,
            today=today,
        )

        response = app.handle_request("GET", "/api/schedule?studentGroup=353502")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(fetch_count["value"], 0)
        self.assertEqual(
            response.payload,
            {
                "view": "week",
                "currentWeek": 3,
                "selectedWeek": 3,
                "rangeStart": "2026-03-02",
                "rangeEnd": "2026-03-08",
                "days": [{"date": "2026-01-01", "lessons": []}],
            },
        )

    def test_returns_stale_cache_when_upstream_fails(self) -> None:
        store = {}
        now_value = 10_000
        key = cache_key("/grades", {"studentCardNumber": "123"})
        store[key] = CacheEntry(
            payload={"subjects": [{"id": "1"}]},
            fresh_until=now_value - 1,
            stale_until=now_value + 60_000,
        )

        def failing_fetcher(_path: str, _params: dict[str, str]):
            raise UpstreamRequestError("denied", status=403)

        app = BackendApp(
            config=TEST_CONFIG,
            store=store,
            fetcher=failing_fetcher,
            now_ms=lambda: now_value,
        )

        response = app.handle_request("GET", "/api/grades?studentCardNumber=123")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.payload, {"subjects": [{"id": "1"}]})

    def test_concurrent_identical_requests_share_inflight_result(self) -> None:
        release = Event()
        started = Event()
        seen_paths: list[str] = []
        seen_lock = Lock()
        responses = []
        errors = []

        def fetcher(path: str, _params: dict[str, str]):
            with seen_lock:
                seen_paths.append(path)
                if path == "/schedule":
                    started.set()

            if path == "/schedule":
                if not release.wait(timeout=0.2):
                    self.fail("schedule request was not blocked for inflight dedupe test")
                return {"schedules": {"Понедельник": []}}

            if path == "/schedule/current-week":
                return 3

            raise AssertionError(f"Unexpected path: {path}")

        app = BackendApp(
            config=TEST_CONFIG,
            fetcher=fetcher,
            today=lambda: date(2026, 3, 4),
        )

        def worker() -> None:
            try:
                responses.append(
                    app.handle_request(
                        "GET",
                        "/api/schedule?studentGroup=353502",
                    )
                )
            except Exception as error:  # pragma: no cover - debug safety
                errors.append(error)

        leader = Thread(target=worker)
        follower = Thread(target=worker)

        leader.start()
        self.assertTrue(started.wait(timeout=0.1))
        follower.start()
        release.set()
        leader.join()
        follower.join()

        self.assertEqual(errors, [])
        self.assertEqual(len(responses), 2)
        self.assertTrue(all(response.status_code == 200 for response in responses))
        self.assertCountEqual(
            seen_paths,
            ["/schedule", "/schedule/current-week"],
        )

    def test_cache_helpers_respect_fresh_and_stale_windows(self) -> None:
        store = {}
        key = cache_key("/employees", {"q": "ivan"})

        write_cache(store, key, [{"id": "1"}], 5, 10, 100)

        self.assertIsNotNone(read_fresh_cache(store, key, 102))
        self.assertIsNotNone(read_stale_cache(store, key, 108))
        self.assertIsNone(read_stale_cache(store, key, 116))

    def test_cache_entries_prunes_expired_items(self) -> None:
        expired_key = cache_key("/grades", {"studentCardNumber": "123"})
        fresh_key = cache_key("/grades", {"studentCardNumber": "456"})
        store = {
            expired_key: CacheEntry(
                payload={"ok": False},
                fresh_until=50,
                stale_until=90,
            ),
            fresh_key: CacheEntry(
                payload={"ok": True},
                fresh_until=120,
                stale_until=180,
            ),
        }
        app = BackendApp(
            config=TEST_CONFIG,
            store=store,
            fetcher=lambda *_: {},
            now_ms=lambda: 100,
        )

        self.assertEqual(app.cache_entries(), 1)
        self.assertNotIn(expired_key, store)
        self.assertIn(fresh_key, store)

    def test_handle_request_rejects_oversized_body(self) -> None:
        app = BackendApp(config=TEST_CONFIG, fetcher=lambda *_: {})

        response = app.handle_request(
            "PUT",
            "/api/profile",
            body=b"x" * (MAX_REQUEST_BODY_BYTES + 1),
        )

        self.assertEqual(response.status_code, 413)
        self.assertEqual(
            response.payload,
            {"error": REQUEST_BODY_TOO_LARGE_MESSAGE},
        )

    def test_read_request_body_rejects_oversized_payload(self) -> None:
        async def receive() -> dict[str, object]:
            messages = getattr(receive, "_messages", None)
            if messages is None:
                receive._messages = iter(  # type: ignore[attr-defined]
                    [
                        {
                            "type": "http.request",
                            "body": b"x" * (MAX_REQUEST_BODY_BYTES // 2),
                            "more_body": True,
                        },
                        {
                            "type": "http.request",
                            "body": b"x" * (MAX_REQUEST_BODY_BYTES // 2 + 1),
                            "more_body": False,
                        },
                    ]
                )
                messages = receive._messages  # type: ignore[attr-defined]
            return next(messages)

        with self.assertRaises(RequestBodyTooLargeError):
            asyncio.run(read_request_body(receive))

    def test_asgi_app_rejects_oversized_body(self) -> None:
        backend_app = BackendApp(config=TEST_CONFIG, fetcher=lambda *_: {})
        app = create_asgi_app(backend_app)
        messages: list[dict[str, object]] = []
        body_chunks = iter(
            [
                {
                    "type": "http.request",
                    "body": b"x" * (MAX_REQUEST_BODY_BYTES // 2),
                    "more_body": True,
                },
                {
                    "type": "http.request",
                    "body": b"x" * (MAX_REQUEST_BODY_BYTES // 2 + 1),
                    "more_body": False,
                },
            ]
        )

        async def receive() -> dict[str, object]:
            return next(body_chunks)

        async def send(message: dict[str, object]) -> None:
            messages.append(message)

        asyncio.run(
            app(
                {
                    "type": "http",
                    "method": "POST",
                    "path": "/api/profile",
                    "query_string": b"",
                },
                receive,
                send,
            )
        )

        self.assertEqual(messages[0]["type"], "http.response.start")
        self.assertEqual(messages[0]["status"], 413)
        self.assertEqual(messages[1]["type"], "http.response.body")
        self.assertEqual(
            json.loads(messages[1]["body"]),
            {"error": REQUEST_BODY_TOO_LARGE_MESSAGE},
        )

    def test_fetch_with_retry_does_not_retry_timeout_errors(self) -> None:
        attempts = {"value": 0}

        def fetcher(_path: str, _params: dict[str, str]):
            attempts["value"] += 1
            raise UpstreamRequestError("The read operation timed out")

        with self.assertRaises(UpstreamRequestError):
            fetch_with_retry(
                fetcher,
                "/rating/studentRating",
                {"studentCardNumber": "123"},
                max_retries=2,
                retry_delay_ms=1,
            )

        self.assertEqual(attempts["value"], 1)

    def test_fetch_with_retry_retries_server_errors(self) -> None:
        attempts = {"value": 0}

        def fetcher(_path: str, _params: dict[str, str]):
            attempts["value"] += 1
            if attempts["value"] < 3:
                raise UpstreamRequestError("server unavailable", status=503)
            return {"ok": True}

        payload = fetch_with_retry(
            fetcher,
            "/schedule",
            {"studentGroup": "353502"},
            max_retries=2,
            retry_delay_ms=1,
        )

        self.assertEqual(payload, {"ok": True})
        self.assertEqual(attempts["value"], 3)

    def test_normalize_schedule_response_maps_current_week(self) -> None:
        payload = {
            "schedules": {
                "Понедельник": [
                    {
                        "subjectFullName": "Higher Math",
                        "startLessonTime": "10:05",
                        "endLessonTime": "11:30",
                        "lessonTypeAbbrev": "ЛК",
                        "auditories": ["101-1"],
                        "employees": [
                            {
                                "lastName": "Ivanov",
                                "firstName": "Ivan",
                                "middleName": "Ivanovich",
                            }
                        ],
                        "weekNumber": [3],
                        "startLessonDate": "01.01.2026",
                        "endLessonDate": "31.12.2026",
                    },
                    {
                        "subject": "Skip me",
                        "startLessonTime": "12:00",
                        "endLessonTime": "13:25",
                        "weekNumber": [2],
                        "startLessonDate": "01.01.2026",
                        "endLessonDate": "31.12.2026",
                    },
                ]
            }
        }

        normalized = normalize_schedule_response(payload, 3, date(2026, 3, 4))

        self.assertEqual(normalized["currentWeek"], 3)
        self.assertEqual(normalized["selectedWeek"], 3)
        self.assertEqual(len(normalized["days"]), 7)
        monday = normalized["days"][0]
        self.assertEqual(monday["date"], "2026-03-02")
        self.assertEqual(len(monday["lessons"]), 1)
        self.assertEqual(monday["lessons"][0]["subject"], "Higher Math")
        self.assertEqual(monday["lessons"][0]["teacher"], "Ivanov Ivan Ivanovich")
        self.assertEqual(monday["lessons"][0]["typeKey"], "lecture")

    def test_normalize_schedule_response_supports_semester_view(self) -> None:
        payload = {
            "schedules": {
                "Понедельник": [
                    {
                        "subjectFullName": "Higher Math",
                        "startLessonTime": "10:05",
                        "endLessonTime": "11:30",
                        "lessonTypeAbbrev": "ЛК",
                        "weekNumber": [3],
                        "startLessonDate": "01.03.2026",
                        "endLessonDate": "30.04.2026",
                    }
                ]
            }
        }

        normalized = normalize_schedule_response(
            payload,
            3,
            date(2026, 3, 4),
            reference_date=date(2026, 3, 9),
            view="semester",
        )

        self.assertEqual(normalized["view"], "semester")
        self.assertEqual(normalized["currentWeek"], 3)
        self.assertEqual(normalized["selectedWeek"], 4)
        self.assertEqual(normalized["rangeStart"], "2026-03-09")
        self.assertEqual(normalized["rangeEnd"], "2026-04-30")
        self.assertEqual(normalized["days"][0]["date"], "2026-03-09")
        self.assertEqual(normalized["days"][-1]["date"], "2026-04-30")

    def test_normalize_schedule_response_respects_selected_week_override(
        self,
    ) -> None:
        payload = {
            "schedules": {
                "Понедельник": [
                    {
                        "subject": "Неделя 4",
                        "startLessonTime": "10:05",
                        "endLessonTime": "11:30",
                        "weekNumber": [4],
                        "startLessonDate": "01.01.2026",
                        "endLessonDate": "31.12.2026",
                    },
                    {
                        "subject": "Неделя 1",
                        "startLessonTime": "12:00",
                        "endLessonTime": "13:25",
                        "weekNumber": [1],
                        "startLessonDate": "01.01.2026",
                        "endLessonDate": "31.12.2026",
                    },
                ]
            }
        }

        normalized = normalize_schedule_response(
            payload,
            4,
            date(2026, 3, 9),
            reference_date=date(2026, 3, 9),
            selected_week=1,
        )

        self.assertEqual(normalized["currentWeek"], 4)
        self.assertEqual(normalized["selectedWeek"], 1)
        monday = normalized["days"][0]
        self.assertEqual(
            [lesson["subject"] for lesson in monday["lessons"]],
            ["Неделя 1"],
        )

    def test_normalize_schedule_response_filters_by_subgroup(self) -> None:
        payload = {
            "schedules": {
                "Понедельник": [
                    {
                        "subject": "Общая пара",
                        "startLessonTime": "08:00",
                        "endLessonTime": "09:25",
                        "weekNumber": [3],
                        "startLessonDate": "01.01.2026",
                        "endLessonDate": "31.12.2026",
                    },
                    {
                        "subject": "Подгруппа 1",
                        "startLessonTime": "10:00",
                        "endLessonTime": "11:25",
                        "weekNumber": [3],
                        "numSubgroup": 1,
                        "startLessonDate": "01.01.2026",
                        "endLessonDate": "31.12.2026",
                    },
                    {
                        "subject": "Подгруппа 2",
                        "startLessonTime": "12:00",
                        "endLessonTime": "13:25",
                        "weekNumber": [3],
                        "numSubgroup": 2,
                        "startLessonDate": "01.01.2026",
                        "endLessonDate": "31.12.2026",
                    },
                ]
            }
        }

        normalized = normalize_schedule_response(
            payload,
            3,
            date(2026, 3, 4),
            subgroup="1",
        )

        monday = normalized["days"][0]
        self.assertEqual(monday["date"], "2026-03-02")
        self.assertEqual(
            [lesson["subject"] for lesson in monday["lessons"]],
            ["Общая пара", "Подгруппа 1"],
        )

    def test_normalize_schedule_response_infers_subgroups_from_parallel_lessons(
        self,
    ) -> None:
        payload = {
            "schedules": {
                "Понедельник": [
                    {
                        "subject": "Лекция",
                        "startLessonTime": "08:00",
                        "endLessonTime": "09:25",
                        "weekNumber": [3],
                        "startLessonDate": "01.01.2026",
                        "endLessonDate": "31.12.2026",
                    },
                    {
                        "subject": "Лаба в 416",
                        "startLessonTime": "10:00",
                        "endLessonTime": "11:25",
                        "weekNumber": [3],
                        "auditories": ["416-4"],
                        "startLessonDate": "01.01.2026",
                        "endLessonDate": "31.12.2026",
                    },
                    {
                        "subject": "Лаба в 517",
                        "startLessonTime": "10:00",
                        "endLessonTime": "11:25",
                        "weekNumber": [3],
                        "auditories": ["517-2"],
                        "startLessonDate": "01.01.2026",
                        "endLessonDate": "31.12.2026",
                    },
                ]
            }
        }

        normalized_all = normalize_schedule_response(
            payload,
            3,
            date(2026, 3, 4),
        )
        monday_all = normalized_all["days"][0]["lessons"]
        self.assertEqual(
            [lesson["subgroup"] for lesson in monday_all],
            [None, "1", "2"],
        )

        normalized_second = normalize_schedule_response(
            payload,
            3,
            date(2026, 3, 4),
            subgroup="2",
        )
        monday_second = normalized_second["days"][0]
        self.assertEqual(
            [lesson["subject"] for lesson in monday_second["lessons"]],
            ["Лекция", "Лаба в 517"],
        )

    def test_normalize_schedule_response_applies_group_subgroup_overrides(
        self,
    ) -> None:
        payload = {
            "studentGroupDto": {"name": "568403"},
            "schedules": {
                "Четверг": [
                    {
                        "subject": "ИнЯз",
                        "subjectFullName": "Иностранный язык",
                        "startLessonTime": "13:35",
                        "endLessonTime": "15:00",
                        "weekNumber": [4],
                        "auditories": ["507-1-3 к."],
                        "employees": [{"urlId": "i-malikova", "fio": "Маликова И. Г."}],
                        "startLessonDate": "12.02.2026",
                        "endLessonDate": "04.06.2026",
                    },
                    {
                        "subject": "ИнЯз",
                        "subjectFullName": "Иностранный язык",
                        "startLessonTime": "13:35",
                        "endLessonTime": "15:00",
                        "weekNumber": [4],
                        "auditories": ["302-3 к."],
                        "employees": [{"urlId": "o-shulga", "fio": "Шульга О. Н."}],
                        "startLessonDate": "12.02.2026",
                        "endLessonDate": "04.06.2026",
                    },
                ]
            },
        }

        normalized = normalize_schedule_response(
            payload,
            4,
            date(2026, 3, 9),
            reference_date=date(2026, 3, 12),
            subgroup="1",
        )

        thursday = next(
            day
            for day in normalized["days"]
            if day["date"] == "2026-03-12"
        )
        self.assertEqual(
            [lesson["teacher"] for lesson in thursday["lessons"]],
            ["Шульга О. Н."],
        )

    def test_schedule_route_returns_frontend_contract(self) -> None:
        def fetcher(path: str, _params: dict[str, str]):
            if path == "/schedule":
                return {
                    "schedules": {
                        "Понедельник": [
                            {
                                "subjectFullName": "Высшая математика",
                                "startLessonTime": "10:05",
                                "endLessonTime": "11:30",
                                "lessonTypeAbbrev": "ЛК",
                                "auditories": ["101-1"],
                                "employees": [{"fio": "Иванов И.И."}],
                            }
                        ]
                    }
                }

            if path == "/schedule/current-week":
                return 3

            raise AssertionError(f"Unexpected path: {path}")

        app = BackendApp(
            config=TEST_CONFIG,
            fetcher=fetcher,
            today=lambda: date(2026, 3, 4),
        )

        response = app.handle_request("GET", "/api/schedule?studentGroup=353502")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.payload["days"]), 7)
        self.assertEqual(response.payload["currentWeek"], 3)
        self.assertEqual(response.payload["selectedWeek"], 3)
        monday = response.payload["days"][0]
        lesson = monday["lessons"][0]
        self.assertEqual(monday["date"], "2026-03-02")
        self.assertEqual(lesson["subject"], "Высшая математика")
        self.assertEqual(lesson["teacher"], "Иванов И.И.")
        self.assertEqual(lesson["room"], "101-1")
        self.assertEqual(lesson["type"], "ЛК")
        self.assertEqual(lesson["startTime"], "10:05")
        self.assertEqual(lesson["endTime"], "11:30")

    def test_schedule_route_passes_subgroup_and_filters_lessons(self) -> None:
        calls: list[tuple[str, dict[str, str]]] = []

        def fetcher(path: str, params: dict[str, str]):
            calls.append((path, dict(params)))
            if path == "/schedule":
                return {
                    "schedules": {
                        "Понедельник": [
                            {
                                "subject": "Общая пара",
                                "startLessonTime": "08:00",
                                "endLessonTime": "09:25",
                                "weekNumber": [3],
                                "startLessonDate": "01.01.2026",
                                "endLessonDate": "31.12.2026",
                            },
                    {
                        "subject": "Для 2-й подгруппы",
                        "startLessonTime": "10:00",
                        "endLessonTime": "11:25",
                        "weekNumber": [3],
                        "numSubgroup": 2,
                        "startLessonDate": "01.01.2026",
                        "endLessonDate": "31.12.2026",
                    },
                        ]
                    }
                }

            if path == "/schedule/current-week":
                return 3

            raise AssertionError(f"Unexpected path: {path}")

        app = BackendApp(
            config=TEST_CONFIG,
            fetcher=fetcher,
            today=lambda: date(2026, 3, 4),
        )

        response = app.handle_request(
            "GET",
            "/api/schedule?studentGroup=353502&subgroup=1",
        )

        self.assertEqual(response.status_code, 200)
        monday = response.payload["days"][0]
        self.assertEqual(
            [lesson["subject"] for lesson in monday["lessons"]],
            ["Общая пара"],
        )
        self.assertIn(("/schedule", {"studentGroup": "353502"}), calls)

    def test_schedule_route_applies_selected_week_override(self) -> None:
        def fetcher(path: str, _params: dict[str, str]):
            if path == "/schedule":
                return {
                    "schedules": {
                        "Понедельник": [
                            {
                                "subject": "Неделя 4",
                                "startLessonTime": "10:05",
                                "endLessonTime": "11:30",
                                "weekNumber": [4],
                                "startLessonDate": "01.01.2026",
                                "endLessonDate": "31.12.2026",
                            },
                            {
                                "subject": "Неделя 1",
                                "startLessonTime": "12:00",
                                "endLessonTime": "13:25",
                                "weekNumber": [1],
                                "startLessonDate": "01.01.2026",
                                "endLessonDate": "31.12.2026",
                            },
                        ]
                    }
                }

            if path == "/schedule/current-week":
                return 4

            raise AssertionError(f"Unexpected path: {path}")

        app = BackendApp(
            config=TEST_CONFIG,
            fetcher=fetcher,
            today=lambda: date(2026, 3, 9),
        )

        response = app.handle_request(
            "GET",
            "/api/schedule?studentGroup=353502&date=2026-03-09&week=1",
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.payload["currentWeek"], 4)
        self.assertEqual(response.payload["selectedWeek"], 1)
        monday = response.payload["days"][0]
        self.assertEqual(
            [lesson["subject"] for lesson in monday["lessons"]],
            ["Неделя 1"],
        )


    def test_normalize_employees_response_unwraps_value_payload(self) -> None:
        payload = {
            "value": [
                {
                    "id": 42,
                    "fio": "Ivanov I. I.",
                    "academicDepartment": "POIT",
                    "rank": "docent",
                }
            ]
        }

        normalized = normalize_employees_response(payload, TEST_CONFIG)

        self.assertEqual(len(normalized), 1)
        self.assertEqual(normalized[0]["fullName"], "Ivanov I. I.")
        self.assertEqual(normalized[0]["employeeId"], "42")
        self.assertEqual(normalized[0]["urlId"], "42")
        self.assertEqual(normalized[0]["department"], "POIT")
        self.assertEqual(
            normalized[0]["avatarUrl"],
            "https://iis.bsuir.by/api/v1/employees/photo/42",
        )

    def test_employees_route_returns_normalized_list(self) -> None:
        def fetcher(path: str, _params: dict[str, str]):
            if path == "/employees/fio":
                return {
                    "value": [
                        {
                            "id": 7,
                            "lastName": "Петров",
                            "firstName": "Пётр",
                            "middleName": "Петрович",
                            "jobPosition": "Доцент",
                            "academicDepartment": "СиСИ",
                        }
                    ]
                }

            raise AssertionError(f"Unexpected path: {path}")

        app = BackendApp(config=TEST_CONFIG, fetcher=fetcher)

        response = app.handle_request("GET", "/api/employees?q=Пе")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.payload,
            [
                {
                    "id": "7",
                    "employeeId": "7",
                    "urlId": "7",
                    "fullName": "Петров Пётр Петрович",
                    "position": "Доцент",
                    "department": "СиСИ",
                    "avatarUrl": "https://iis.bsuir.by/api/v1/employees/photo/7",
                }
            ],
        )

    def test_normalize_auditories_response_filters_and_maps_fields(self) -> None:
        payload = [
            {
                "id": 214,
                "name": "303",
                "capacity": 24,
                "note": "После ремонта",
                "auditoryType": {"name": "лабораторные занятия", "abbrev": "лб"},
                "buildingNumber": {"name": "3 к."},
                "department": {"nameAndAbbrev": "Каф.ИИС"},
            },
            {
                "id": 999,
                "name": "999",
                "auditoryType": {"name": "лекции", "abbrev": "лк"},
                "buildingNumber": {"name": "9 к."},
            },
        ]

        normalized = normalize_auditories_response(payload, "303")

        self.assertEqual(len(normalized), 1)
        self.assertEqual(normalized[0]["fullName"], "303 3 к.")
        self.assertEqual(normalized[0]["typeAbbrev"], "лб")
        self.assertEqual(normalized[0]["department"], "Каф.ИИС")
        self.assertEqual(normalized[0]["capacity"], 24)

    def test_normalize_auditories_response_matches_building_alias_queries(self) -> None:
        payload = [
            {
                "id": 214,
                "name": "303",
                "buildingNumber": {"name": "5 к."},
            },
            {
                "id": 215,
                "name": "101",
                "buildingNumber": {"name": "1 к."},
            },
        ]

        normalized = normalize_auditories_response(payload, "5 корпус")

        self.assertEqual(len(normalized), 1)
        self.assertEqual(normalized[0]["name"], "303")
        self.assertEqual(normalized[0]["building"], "5 к.")

    def test_auditories_route_returns_filtered_list(self) -> None:
        def fetcher(path: str, _params: dict[str, str]):
            if path == "/auditories":
                return [
                    {
                        "id": 214,
                        "name": "303",
                        "auditoryType": {"name": "лабораторные занятия", "abbrev": "лб"},
                        "buildingNumber": {"name": "3 к."},
                    },
                    {
                        "id": 215,
                        "name": "101",
                        "auditoryType": {"name": "лекции", "abbrev": "лк"},
                        "buildingNumber": {"name": "1 к."},
                    },
                ]

            raise AssertionError(f"Unexpected path: {path}")

        app = BackendApp(config=TEST_CONFIG, fetcher=fetcher)

        response = app.handle_request("GET", "/api/auditories?q=303")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.payload), 1)
        self.assertEqual(response.payload[0]["name"], "303")

    def test_normalize_grades_response_combines_summary_and_subjects(self) -> None:
        search_payload = {
            "studentCardNumber": "123456",
            "averageMark": 8.4,
            "place": 12,
            "specialityAbbrev": "CS",
        }
        rating_payload = {
            "subjects": [
                {
                    "id": "math",
                    "subject": "Math",
                    "marks": [{"mark": 9}, {"value": 8}],
                }
            ]
        }

        normalized = normalize_grades_response(
            "123456",
            search_payload,
            rating_payload,
            extra_summary={"position": 12, "speciality": "CS"},
        )

        self.assertEqual(normalized["summary"]["average"], 8.5)
        self.assertEqual(normalized["summary"]["position"], 12)
        self.assertEqual(normalized["summary"]["speciality"], "CS")
        self.assertEqual(normalized["subjects"][0]["subject"], "Math")
        self.assertEqual(len(normalized["subjects"][0]["marks"]), 2)

    def test_normalize_grades_response_parses_string_summary_values(self) -> None:
        search_payload = {
            "studentCardNumber": "123456",
            "specialityAbbrev": "CS",
        }
        rating_payload = {
            "subjects": [
                {
                    "id": "math",
                    "subject": "Math",
                    "marks": ["8", "9"],
                }
            ]
        }

        normalized = normalize_grades_response(
            "123456",
            search_payload,
            rating_payload=rating_payload,
            extra_summary={"position": "12"},
        )

        self.assertEqual(normalized["summary"]["average"], 8.5)
        self.assertEqual(normalized["summary"]["position"], 12)
        self.assertEqual(normalized["summary"]["speciality"], "CS")

    def test_normalize_grades_response_merges_extra_summary_fields(self) -> None:
        normalized = normalize_grades_response(
            "123456",
            {"studentCardNumber": "123456", "average": 8.4},
            rating_payload={},
            extra_summary={"position": 2, "speciality": "CS"},
        )

        self.assertEqual(
            normalized["summary"],
            {"position": 2, "speciality": "CS"},
        )

    def test_build_rating_list_summary_ranks_by_average_when_payload_is_unsorted(self) -> None:
        payload = [
            {"studentCardNumber": "56841001", "average": 8.7},
            {"studentCardNumber": "56841006", "average": 8.28},
            {"studentCardNumber": "56841002", "average": 9.0},
            {"studentCardNumber": "56841003", "average": 8.5},
            {"studentCardNumber": "56841007", "average": 5.63},
        ]

        self.assertEqual(
            build_rating_list_summary(payload, "56841006"),
            {"position": 4},
        )
        self.assertEqual(
            build_rating_list_summary(payload, "56841007"),
            {"position": 5},
        )

    def test_build_rating_list_summary_breaks_average_ties_by_list_order(self) -> None:
        payload = [
            {"studentCardNumber": "56141011", "average": 10.0},
            {"studentCardNumber": "56141016", "average": 10.0},
            {"studentCardNumber": "56141061", "average": 10.0},
            {"studentCardNumber": "56140021", "average": 9.75},
        ]

        self.assertEqual(
            build_rating_list_summary(payload, "56141011"),
            {"position": 1},
        )
        self.assertEqual(
            build_rating_list_summary(payload, "56141016"),
            {"position": 2},
        )
        self.assertEqual(
            build_rating_list_summary(payload, "56141061"),
            {"position": 3},
        )

    def test_normalize_grades_response_merges_search_and_rating_summary(self) -> None:
        normalized = normalize_grades_response(
            "123456",
            {"studentCardNumber": "123456", "average": 8.4},
            rating_payload={"ratingPlace": 2, "specialityName": "CS"},
        )

        self.assertEqual(
            normalized["summary"],
            {"speciality": "CS"},
        )

    def test_matches_rating_speciality_accepts_track_suffix(self) -> None:
        self.assertTrue(
            matches_rating_speciality(
                "(6-05-0611-06) CS (AI) (1 ступень дневная)",
                "CS",
            )
        )
        self.assertFalse(
            matches_rating_speciality(
                "(6-05-0611-02) IB (1 ступень дневная)",
                "CS",
            )
        )


    def test_extract_grade_summary_handles_wrapped_rating_payload(self) -> None:
        rating_payload = {
            "value": [
                {
                    "studentCardNumber": "123456",
                    "avgRating": "8,9",
                    "ratingPlace": "5",
                    "specialityName": "ПОИТ",
                }
            ]
        }

        normalized = normalize_grades_response(
            "123456",
            search_payload=None,
            rating_payload=rating_payload,
        )

        self.assertEqual(normalized["summary"], {"average": 8.9, "position": 5, "speciality": "ПОИТ"})

    def test_extract_grade_summary_ignores_subject_average_as_summary(self) -> None:
        rating_payload = {
            "subjects": [
                {
                    "disciplineName": "Математика",
                    "averageMark": 9,
                    "marks": [9, 10],
                }
            ]
        }

        normalized = normalize_grades_response(
            "123456",
            search_payload=None,
            rating_payload=rating_payload,
        )

        self.assertIsNone(normalized["summary"])
    def test_extract_grade_summary_handles_wrapped_rating_payload(self) -> None:
        rating_payload = {
            "value": [
                {
                    "studentCardNumber": "123456",
                    "avgRating": "8,9",
                    "ratingPlace": "5",
                    "specialityName": "ПОИТ",
                }
            ]
        }

        normalized = normalize_grades_response(
            "123456",
            search_payload=None,
            rating_payload=rating_payload,
        )

        self.assertEqual(normalized["summary"], {"speciality": "ПОИТ"})

    def test_extract_grade_summary_ignores_subject_average_as_summary(self) -> None:
        rating_payload = {
            "subjects": [
                {
                    "disciplineName": "Математика",
                    "averageMark": 9,
                    "marks": [9, 10],
                }
            ]
        }

        normalized = normalize_grades_response(
            "123456",
            search_payload=None,
            rating_payload=rating_payload,
        )

        self.assertEqual(normalized["summary"], {"average": 9.5})

    def test_extract_grade_subjects_handles_wrapped_list_payload(self) -> None:
        payload = {
            "value": [
                {
                    "id": "math",
                    "disciplineName": "Математика",
                    "teacher": "Иванов И.И.",
                    "values": ["9", 8],
                }
            ]
        }

        subjects = extract_grade_subjects(payload)

        self.assertEqual(len(subjects), 1)
        self.assertEqual(subjects[0]["subject"], "Математика")
        self.assertEqual(subjects[0]["teacher"], "Иванов И.И.")
        self.assertEqual(subjects[0]["marks"], [{"value": 9.0}, {"value": 8.0}])

    def test_extract_grade_subjects_aggregates_lesson_marks_payload(self) -> None:
        payload = {
            "lessons": [
                {
                    "id": 1,
                    "lessonNameAbbrev": "МА",
                    "lessonTypeAbbrev": "ПЗ",
                    "dateString": "13.02.2026",
                    "marks": [8],
                },
                {
                    "id": 2,
                    "lessonNameAbbrev": "МА",
                    "lessonTypeAbbrev": "ПЗ",
                    "dateString": "16.02.2026",
                    "marks": [10],
                },
                {
                    "id": 3,
                    "lessonNameAbbrev": "Физика",
                    "lessonTypeAbbrev": "ПЗ",
                    "dateString": "19.02.2026",
                    "marks": [9],
                },
                {
                    "id": 4,
                    "lessonNameAbbrev": "Логика",
                    "lessonTypeAbbrev": "ЛК",
                    "dateString": "20.02.2026",
                    "marks": [],
                },
            ]
        }

        subjects = extract_grade_subjects(payload)

        self.assertEqual(len(subjects), 2)
        self.assertEqual(subjects[0]["subject"], "МА")
        self.assertEqual(
            subjects[0]["marks"],
            [
                {"value": 8.0, "date": "13.02.2026", "type": "ПЗ"},
                {"value": 10.0, "date": "16.02.2026", "type": "ПЗ"},
            ],
        )
        self.assertEqual(subjects[1]["subject"], "Физика")
        self.assertEqual(
            subjects[1]["marks"],
            [{"value": 9.0, "date": "19.02.2026", "type": "ПЗ"}],
        )

    def test_extract_grade_subjects_preserves_mark_type_from_mark_payload(self) -> None:
        payload = {
            "subjects": [
                {
                    "id": "math",
                    "disciplineName": "Математика",
                    "marks": [
                        {
                            "value": 9,
                            "type": "ПЗ",
                        },
                        {
                            "value": 8,
                            "controlTypeAbbrev": "ЛК",
                        },
                    ],
                }
            ]
        }

        subjects = extract_grade_subjects(payload)

        self.assertEqual(len(subjects), 1)
        self.assertEqual(
            subjects[0]["marks"],
            [
                {"value": 9.0, "type": "ПЗ"},
                {"value": 8.0, "type": "ЛК"},
            ],
        )

    def test_grades_route_handles_partial_upstream_failure(self) -> None:
        def fetcher(path: str, _params: dict[str, str]):
            if path == "/rating/studentSearch":
                raise UpstreamRequestError("search unavailable", status=503)

            if path == "/rating/studentRating":
                return {
                    "subjects": [
                        {
                            "id": "math",
                            "disciplineName": "Математика",
                            "teacher": "Иванов И.И.",
                            "controlPoints": [{"score": 9}, {"value": 8}],
                        }
                    ]
                }

            raise AssertionError(f"Unexpected path: {path}")

        app = BackendApp(config=TEST_CONFIG, fetcher=fetcher)

        response = app.handle_request("GET", "/api/grades?studentCardNumber=123")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.payload["subjects"][0]["subject"], "Математика")
        self.assertEqual(response.payload["subjects"][0]["teacher"], "Иванов И.И.")
        self.assertEqual(len(response.payload["subjects"][0]["marks"]), 2)

    def test_grades_route_retries_search_before_falling_back(self) -> None:
        search_calls = 0

        def fetcher(path: str, _params: dict[str, str]):
            nonlocal search_calls
            if path == "/rating/studentSearch":
                search_calls += 1
                if search_calls == 1:
                    raise UpstreamRequestError("timed out")
                return {
                    "studentCardNumber": "123",
                    "averageMark": 8.4,
                    "place": 2,
                }

            if path == "/rating/studentRating":
                return {
                    "subjects": [
                        {
                            "id": "math",
                            "subject": "Math",
                            "marks": [{"value": 9}],
                        }
                    ]
                }

            raise AssertionError(f"Unexpected path: {path}")

        app = BackendApp(config=TEST_CONFIG, fetcher=fetcher)

        response = app.handle_request("GET", "/api/grades?studentCardNumber=123")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(search_calls, 2)
        self.assertEqual(response.payload["summary"]["average"], 9.0)
        self.assertNotIn("position", response.payload["summary"])

    def test_grades_route_computes_position_from_group_rating(self) -> None:
        def fetcher(path: str, params: dict[str, str]):
            if path == "/rating/studentSearch":
                return {"studentCardNumber": "123"}

            if path == "/rating/studentRating":
                return {
                    "subjects": [
                        {
                            "id": "math",
                            "subject": "Math",
                            "marks": [{"value": 9}],
                        }
                    ]
                }

            if path == "/student-groups/filters":
                self.assertEqual(params, {"name": "353502"})
                return [
                    {
                        "id": 1,
                        "name": "353502",
                        "specialityAbbrev": "CS",
                    }
                ]

            if path == "/schedule/faculties":
                return [{"id": 20040, "text": "Faculty"}]

            if path == "/rating/specialities":
                self.assertEqual(params, {"facultyId": "20040"})
                return [
                    {
                        "id": 20655,
                        "text": "(6-05-0611-06) CS (1 ступень дневная)",
                    }
                ]

            if path == "/rating/courses":
                self.assertEqual(
                    params,
                    {"facultyId": "20040", "specialityId": "20655"},
                )
                return [{"course": 3, "hasForeignPlan": False}]

            if path == "/rating":
                self.assertEqual(params, {"sdef": "20655", "course": "3"})
                return [
                    {"studentCardNumber": "321", "average": 9.1},
                    {"studentCardNumber": "123", "average": 8.4},
                    {"studentCardNumber": "222", "average": 7.9},
                ]

            raise AssertionError(f"Unexpected path: {path}")

        app = BackendApp(config=TEST_CONFIG, fetcher=fetcher)

        response = app.handle_request(
            "GET",
            "/api/grades?studentCardNumber=123&studentGroup=353502",
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.payload["summary"]["average"], 9.0)
        self.assertEqual(response.payload["summary"]["position"], 2)
        self.assertEqual(response.payload["summary"]["speciality"], "CS")
        self.assertEqual(response.payload["subjects"][0]["subject"], "Math")

    def test_rating_route_returns_frontend_contract(self) -> None:
        def fetcher(path: str, params: dict[str, str]):
            if path == "/rating/studentSearch":
                return {"studentCardNumber": "56841006", "average": 8.4}

            if path == "/rating/studentRating":
                return {
                    "subjects": [
                        {
                            "id": "math",
                            "subject": "Math",
                            "marks": [{"value": 9}],
                        }
                    ]
                }

            if path == "/student-groups/filters":
                self.assertEqual(params, {"name": "353502"})
                return [
                    {
                        "id": 1,
                        "name": "353502",
                        "specialityAbbrev": "CS",
                    }
                ]

            if path == "/schedule/faculties":
                return [{"id": 20040, "text": "Faculty"}]

            if path == "/rating/specialities":
                self.assertEqual(params, {"facultyId": "20040"})
                return [
                    {
                        "id": 20655,
                        "text": "(6-05-0611-06) CS (1 СЃС‚СѓРїРµРЅСЊ РґРЅРµРІРЅР°СЏ)",
                    }
                ]

            if path == "/rating/courses":
                self.assertEqual(
                    params,
                    {"facultyId": "20040", "specialityId": "20655"},
                )
                return [{"course": 3, "hasForeignPlan": False}]

            if path == "/rating":
                self.assertEqual(params, {"sdef": "20655", "course": "3"})
                return [
                    {"studentCardNumber": "11111111", "average": 9.1},
                    {"studentCardNumber": "56841006", "average": 8.4},
                ]

            raise AssertionError(f"Unexpected path: {path}")

        app = BackendApp(config=TEST_CONFIG, fetcher=fetcher)

        response = app.handle_request(
            "GET",
            "/api/rating/56841006?studentGroup=353502",
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.payload["summary"]["average"], 9.0)
        self.assertEqual(response.payload["summary"]["position"], 2)
        self.assertEqual(response.payload["summary"]["speciality"], "CS")
        self.assertEqual(response.payload["subjects"][0]["subject"], "Math")

    def test_rating_summary_route_skips_student_rating_payload(self) -> None:
        def fetcher(path: str, params: dict[str, str]):
            if path == "/rating/studentSearch":
                return {"studentCardNumber": "56841006", "average": 8.4}

            if path == "/rating/studentRating":
                self.fail("rating summary route should not request student rating payload")

            if path == "/student-groups/filters":
                self.assertEqual(params, {"name": "353502"})
                return [
                    {
                        "id": 1,
                        "name": "353502",
                        "specialityAbbrev": "CS",
                    }
                ]

            if path == "/schedule/faculties":
                return [{"id": 20040, "text": "Faculty"}]

            if path == "/rating/specialities":
                self.assertEqual(params, {"facultyId": "20040"})
                return [
                    {
                        "id": 20655,
                        "text": "(6-05-0611-06) CS (1 ступень дневная)",
                    }
                ]

            if path == "/rating/courses":
                self.assertEqual(
                    params,
                    {"facultyId": "20040", "specialityId": "20655"},
                )
                return [{"course": 3, "hasForeignPlan": False}]

            if path == "/rating":
                self.assertEqual(params, {"sdef": "20655", "course": "3"})
                return [
                    {"studentCardNumber": "11111111", "average": 9.1},
                    {"studentCardNumber": "56841006", "average": 8.4},
                ]

            raise AssertionError(f"Unexpected path: {path}")

        app = BackendApp(config=TEST_CONFIG, fetcher=fetcher)

        response = app.handle_request(
            "GET",
            "/api/rating-summary?studentCardNumber=56841006&studentGroup=353502",
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.payload["summary"],
            {"average": 8.4, "position": 2, "speciality": "CS"},
        )

    def test_rating_route_prefers_more_specific_speciality_name(self) -> None:
        def fetcher(path: str, params: dict[str, str]):
            if path == "/rating/studentRating":
                return {
                    "subjects": [
                        {
                            "id": "math",
                            "subject": "Math",
                            "marks": [{"value": 9}],
                        }
                    ]
                }

            if path == "/student-groups/filters":
                self.assertEqual(params, {"name": "520603"})
                return [
                    {
                        "id": 1,
                        "name": "520603",
                        "specialityAbbrev": "СУИ",
                    }
                ]

            if path == "/schedule/faculties":
                return [{"id": 20005, "text": "ФИТУ"}]

            if path == "/rating/specialities":
                self.assertEqual(params, {"facultyId": "20005"})
                return [
                    {
                        "id": 20501,
                        "text": "(6-05-0612-03) СУИ (АСОИ) (1 ступень дневная)",
                    }
                ]

            if path == "/rating/courses":
                self.assertEqual(
                    params,
                    {"facultyId": "20005", "specialityId": "20501"},
                )
                return [{"course": 2, "hasForeignPlan": False}]

            if path == "/rating":
                self.assertEqual(params, {"sdef": "20501", "course": "2"})
                return [
                    {"studentCardNumber": "52060066", "average": 8.9},
                    {"studentCardNumber": "52060067", "average": 7.0},
                ]

            raise AssertionError(f"Unexpected path: {path} {params}")

        app = BackendApp(config=TEST_CONFIG, fetcher=fetcher)

        response = app.handle_request(
            "GET",
            "/api/rating/52060066?studentGroup=520603",
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.payload["summary"]["average"], 9.0)
        self.assertEqual(response.payload["summary"]["position"], 1)
        self.assertEqual(response.payload["summary"]["speciality"], "СУИ (АСОИ)")
        self.assertEqual(response.payload["subjects"][0]["subject"], "Math")

    def test_rating_route_uses_student_card_summary_when_group_has_no_position(
        self,
    ) -> None:
        rating_list_calls = 0

        def fetcher(path: str, params: dict[str, str]):
            nonlocal rating_list_calls

            if path == "/rating/studentRating":
                return {
                    "subjects": [
                        {
                            "id": "math",
                            "subject": "Math",
                            "marks": [{"value": 9}],
                        }
                    ]
                }

            if path == "/student-groups/filters":
                self.assertEqual(params, {"name": "568403"})
                return [
                    {
                        "id": 1,
                        "name": "568403",
                        "specialityAbbrev": "СиСИ",
                    }
                ]

            if path == "/schedule/faculties":
                return [{"id": 20040, "text": "ФИБ"}]

            if path == "/rating/specialities":
                self.assertEqual(params, {"facultyId": "20040"})
                return [
                    {
                        "id": 20655,
                        "text": "(6-05-0611-06) СиСИ (1 ступень дневная)",
                    }
                ]

            if path == "/rating/courses":
                self.assertEqual(
                    params,
                    {"facultyId": "20040", "specialityId": "20655"},
                )
                return [{"course": 1, "hasForeignPlan": False}]

            if path == "/rating":
                rating_list_calls += 1
                self.assertEqual(params, {"sdef": "20655", "course": "1"})
                return [
                    {"studentCardNumber": "56841001", "average": 9.1},
                    {"studentCardNumber": "56841006", "average": 8.28},
                ]

            raise AssertionError(f"Unexpected path: {path} {params}")

        app = BackendApp(config=TEST_CONFIG, fetcher=fetcher)

        response = app.handle_request(
            "GET",
            "/api/rating/56841006?studentGroup=568403",
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.payload["summary"]["average"], 9.0)
        self.assertEqual(response.payload["summary"]["position"], 2)
        self.assertEqual(response.payload["summary"]["speciality"], "СиСИ")
        self.assertEqual(response.payload["subjects"][0]["subject"], "Math")
        self.assertEqual(rating_list_calls, 1)

    def test_rating_route_computes_position_from_student_card_without_group(self) -> None:
        def fetcher(path: str, params: dict[str, str]):
            if path == "/rating/studentSearch":
                return {"studentCardNumber": "56841006", "average": 8.4}

            if path == "/rating/studentRating":
                return {
                    "subjects": [
                        {
                            "id": "math",
                            "subject": "Math",
                            "marks": [{"value": 9}],
                        }
                    ]
                }

            if path == "/schedule/faculties":
                return [{"id": 20040, "text": "ФИБ"}]

            if path == "/rating/specialities":
                self.assertEqual(params, {"facultyId": "20040"})
                return [
                    {
                        "id": 20869,
                        "text": "(6-05-0611-02) ИБ (1 ступень дневная)",
                    },
                    {
                        "id": 20655,
                        "text": "(6-05-0611-06) СиСИ (1 ступень дневная)",
                    },
                ]

            if path == "/rating/courses":
                if params == {"facultyId": "20040", "specialityId": "20869"}:
                    return [{"course": 1, "hasForeignPlan": False}]
                if params == {"facultyId": "20040", "specialityId": "20655"}:
                    return [{"course": 1, "hasForeignPlan": False}]

            if path == "/rating":
                if params == {"sdef": "20869", "course": "1"}:
                    return [
                        {"studentCardNumber": "56141001", "average": 9.1},
                        {"studentCardNumber": "56141002", "average": 8.4},
                    ]

                if params == {"sdef": "20655", "course": "1"}:
                    return [
                        {"studentCardNumber": "56841001", "average": 9.1},
                        {"studentCardNumber": "56841006", "average": 8.4},
                    ]

            raise AssertionError(f"Unexpected path: {path} {params}")

        app = BackendApp(config=TEST_CONFIG, fetcher=fetcher)

        response = app.handle_request("GET", "/api/rating/56841006")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.payload["summary"]["average"], 9.0)
        self.assertEqual(response.payload["summary"]["position"], 2)
        self.assertEqual(response.payload["summary"]["speciality"], "СиСИ")
        self.assertEqual(response.payload["subjects"][0]["subject"], "Math")

    def test_rating_route_rejects_non_digit_student_card(self) -> None:
        app = BackendApp(config=TEST_CONFIG, fetcher=lambda *_: {})

        response = app.handle_request("GET", "/api/rating/56A84106")

        self.assertEqual(response.status_code, 400)
        self.assertIn("studentCard", response.payload["error"])

    def test_rating_route_falls_back_to_related_speciality_code(self) -> None:
        search_calls = 0

        def fetcher(path: str, params: dict[str, str]):
            nonlocal search_calls

            if path == "/rating/studentSearch":
                search_calls += 1
                return {"studentCardNumber": "56841006", "average": 8.28}

            if path == "/rating/studentRating":
                return {
                    "subjects": [
                        {
                            "id": "math",
                            "subject": "Math",
                            "marks": [{"value": 9}],
                        }
                    ]
                }

            if path == "/student-groups/filters":
                self.assertEqual(params, {"name": "151051"})
                return [
                    {
                        "id": 1,
                        "name": "151051",
                        "specialityAbbrev": "ПОИТ",
                    }
                ]

            if path == "/schedule/faculties":
                return [{"id": 20040, "text": "ФИБ"}]

            if path == "/rating/specialities":
                self.assertEqual(params, {"facultyId": "20040"})
                return [
                    {
                        "id": 20850,
                        "text": "(6-05-0611-06) СиСИ (ПОИ) (1 ступень дневная)",
                    },
                    {
                        "id": 20655,
                        "text": "(6-05-0611-06) СиСИ (1 ступень дневная)",
                    },
                ]

            if path == "/rating/courses":
                if params == {"facultyId": "20040", "specialityId": "20850"}:
                    return [{"course": 2, "hasForeignPlan": False}]
                if params == {"facultyId": "20040", "specialityId": "20655"}:
                    return [{"course": 1, "hasForeignPlan": False}]

            if path == "/rating":
                self.assertEqual(params, {"sdef": "20655", "course": "1"})
                return [
                    {"studentCardNumber": "56841001", "average": 9.1},
                    {"studentCardNumber": "56841006", "average": 8.47},
                ]

            raise AssertionError(f"Unexpected path: {path} {params}")

        app = BackendApp(config=TEST_CONFIG, fetcher=fetcher)

        response = app.handle_request(
            "GET",
            "/api/rating/56841006?studentGroup=151051",
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.payload["summary"]["average"], 9.0)
        self.assertEqual(response.payload["summary"]["position"], 2)
        self.assertEqual(response.payload["summary"]["speciality"], "ПОИТ")
        self.assertEqual(response.payload["subjects"][0]["subject"], "Math")
        self.assertEqual(search_calls, 0)

    def test_grades_route_requests_upstream_sources_in_parallel(self) -> None:
        release = Event()
        seen_paths: list[str] = []
        seen_lock = Lock()

        def fetcher(path: str, _params: dict[str, str]):
            with seen_lock:
                seen_paths.append(path)
                if len(seen_paths) == 2:
                    release.set()

            if not release.wait(timeout=0.1):
                self.fail("grades upstream requests were started sequentially")

            if path == "/rating/studentSearch":
                return {
                    "studentCardNumber": "123",
                    "averageMark": 8.4,
                }

            if path == "/rating/studentRating":
                return {
                    "subjects": [
                        {
                            "id": "math",
                            "subject": "Math",
                            "marks": [{"value": 9}],
                        }
                    ]
                }

            raise AssertionError(f"Unexpected path: {path}")

        app = BackendApp(config=TEST_CONFIG, fetcher=fetcher)

        response = app.handle_request("GET", "/api/grades?studentCardNumber=123")

        self.assertEqual(response.status_code, 200)
        self.assertCountEqual(
            seen_paths,
            ["/rating/studentSearch", "/rating/studentRating"],
        )
        self.assertEqual(response.payload["subjects"][0]["subject"], "Math")

    def test_grades_route_returns_marks_from_lessons_payload(self) -> None:
        def fetcher(path: str, _params: dict[str, str]):
            if path == "/rating/studentSearch":
                raise UpstreamRequestError("The read operation timed out")

            if path == "/rating/studentRating":
                return {
                    "id": 559394,
                    "lessons": [
                        {
                            "id": 1,
                            "lessonNameAbbrev": "МА",
                            "lessonTypeAbbrev": "ПЗ",
                            "dateString": "13.02.2026",
                            "marks": [8],
                        },
                        {
                            "id": 2,
                            "lessonNameAbbrev": "МА",
                            "lessonTypeAbbrev": "ПЗ",
                            "dateString": "16.02.2026",
                            "marks": [10],
                        },
                    ],
                }

            raise AssertionError(f"Unexpected path: {path}")

        app = BackendApp(config=TEST_CONFIG, fetcher=fetcher)

        response = app.handle_request("GET", "/api/grades?studentCardNumber=56841006")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.payload["summary"], {"average": 9.0})
        self.assertEqual(len(response.payload["subjects"]), 1)
        self.assertEqual(response.payload["subjects"][0]["subject"], "МА")
        self.assertEqual(
            response.payload["subjects"][0]["marks"],
            [
                {"value": 8.0, "date": "13.02.2026", "type": "ПЗ"},
                {"value": 10.0, "date": "16.02.2026", "type": "ПЗ"},
            ],
        )

    def test_grades_route_prefers_not_found_message_for_unknown_student_card(self) -> None:
        def fetcher(path: str, _params: dict[str, str]):
            if path == "/rating/studentSearch":
                raise UpstreamRequestError(
                    "По данному студенческому билету ничего не найдено",
                    status=404,
                )

            if path == "/rating/studentRating":
                raise UpstreamRequestError("Internal Server Error", status=500)

            raise AssertionError(f"Unexpected path: {path}")

        app = BackendApp(config=TEST_CONFIG, fetcher=fetcher)

        response = app.handle_request("GET", "/api/grades?studentCardNumber=123")

        self.assertEqual(response.status_code, 404)
        self.assertEqual(
            response.payload["error"],
            "По данному студенческому билету ничего не найдено",
        )


    def test_search_employee_alias_uses_query_param(self) -> None:
        def fetcher(path: str, _params: dict[str, str]):
            if path == "/employees/fio":
                return {
                    "value": [
                        {
                            "id": 15,
                            "urlId": "petrov-p-p",
                            "fio": "Petrov P. P.",
                        }
                    ]
                }

            raise AssertionError(f"Unexpected path: {path}")

        app = BackendApp(config=TEST_CONFIG, fetcher=fetcher)

        response = app.handle_request(
            "GET",
            "/api/search-employee?query=pe",
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.payload[0]["employeeId"], "15")
        self.assertEqual(response.payload[0]["urlId"], "petrov-p-p")

    def test_employee_search_uses_fast_timeout_without_retries(self) -> None:
        captured_calls: list[tuple[str, dict[str, str], int, int]] = []

        class FastSearchApp(BackendApp):
            def request_upstream_with_timeout(
                self,
                path: str,
                params: dict[str, str],
                *,
                timeout_ms: int,
                max_retries: int,
            ):
                captured_calls.append(
                    (path, params, timeout_ms, max_retries)
                )
                return {"value": []}

        app = FastSearchApp(config=TEST_CONFIG, fetcher=lambda *_: {})

        response = app.handle_request(
            "GET",
            "/api/search-employee?query=Пе",
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.payload, [])
        self.assertEqual(
            captured_calls,
            [
                (
                    "/employees/fio",
                    {"employee-fio": "Пе"},
                    TEST_CONFIG["request_timeout_ms"],
                    0,
                )
            ],
        )

    def test_employee_search_falls_back_for_initials_with_punctuation(self) -> None:
        seen_queries: list[str] = []

        def fetcher(path: str, params: dict[str, str]):
            self.assertEqual(path, "/employees/fio")
            query = params["employee-fio"]
            seen_queries.append(query)

            if query == "Кедо Е.С.":
                return {"value": []}

            if query == "Кедо Е С":
                return {
                    "value": [
                        {
                            "id": 21,
                            "urlId": "kedo-e-s",
                            "fio": "Кедо Е. С.",
                        },
                        {
                            "id": 22,
                            "urlId": "kedo-a-s",
                            "fio": "Кедо А. С.",
                        },
                    ]
                }

            raise AssertionError(f"Unexpected query: {query}")

        app = BackendApp(config=TEST_CONFIG, fetcher=fetcher)

        response = app.handle_request(
            "GET",
            "/api/search-employee?query=Кедо%20Е.С.",
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.payload,
            [
                {
                    "id": "kedo-e-s",
                    "employeeId": "21",
                    "urlId": "kedo-e-s",
                    "fullName": "Кедо Е. С.",
                    "position": None,
                    "department": None,
                    "avatarUrl": "https://iis.bsuir.by/api/v1/employees/photo/21",
                }
            ],
        )
        self.assertEqual(seen_queries, ["Кедо Е.С.", "Кедо Е С"])

    def test_teacher_schedule_route_uses_teacher_url_id(self) -> None:
        seen_paths: list[str] = []

        def fetcher(path: str, _params: dict[str, str]):
            seen_paths.append(path)
            if path == "/employees/schedule/petrov-p-p":
                return {
                    "schedules": {
                        "\u041f\u043e\u043d\u0435\u0434\u0435\u043b\u044c\u043d\u0438\u043a": [
                            {
                                "subjectFullName": "Discrete Math",
                                "startLessonTime": "09:00",
                                "endLessonTime": "10:20",
                                "lessonTypeAbbrev": "\u041b\u041a",
                                "auditories": ["101-1"],
                            }
                        ]
                    }
                }
            if path == "/schedule/current-week":
                return 3

            raise AssertionError(f"Unexpected path: {path}")

        app = BackendApp(
            config=TEST_CONFIG,
            fetcher=fetcher,
            today=lambda: date(2026, 3, 2),
        )

        response = app.handle_request(
            "GET",
            "/api/schedule?teacherUrlId=petrov-p-p&view=day&date=2026-03-02",
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.payload["view"], "day")
        self.assertEqual(len(response.payload["days"]), 1)
        self.assertEqual(
            response.payload["days"][0]["lessons"][0]["subject"],
            "Discrete Math",
        )
        self.assertCountEqual(
            seen_paths,
            ["/employees/schedule/petrov-p-p", "/schedule/current-week"],
        )

    def test_teacher_schedule_route_supports_semester_view(self) -> None:
        def fetcher(path: str, _params: dict[str, str]):
            if path == "/employees/schedule/petrov-p-p":
                return {
                    "schedules": {
                        "Понедельник": [
                            {
                                "subjectFullName": "Discrete Math",
                                "startLessonTime": "09:00",
                                "endLessonTime": "10:20",
                                "lessonTypeAbbrev": "ЛК",
                                "startLessonDate": "01.03.2026",
                                "endLessonDate": "30.04.2026",
                            }
                        ]
                    }
                }
            if path == "/schedule/current-week":
                return 3

            raise AssertionError(f"Unexpected path: {path}")

        app = BackendApp(
            config=TEST_CONFIG,
            fetcher=fetcher,
            today=lambda: date(2026, 3, 9),
        )

        response = app.handle_request(
            "GET",
            "/api/schedule?teacherUrlId=petrov-p-p&view=semester&date=2026-03-09",
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.payload["view"], "semester")
        self.assertEqual(response.payload["rangeStart"], "2026-03-09")
        self.assertEqual(response.payload["rangeEnd"], "2026-04-30")
        self.assertEqual(response.payload["days"][0]["date"], "2026-03-09")

    def test_profile_route_supports_put_get_and_delete(self) -> None:
        store_path = Path("backend") / "_profile_store_test.json"
        store_path.unlink(missing_ok=True)
        try:
            app = BackendApp(
                config=TEST_CONFIG,
                fetcher=lambda *_: {},
                profile_store=UserProfileStore(store_path),
            )
            payload = {
                "telegramUserId": "tg:42",
                "role": "teacher",
                "employeeId": "15",
                "urlId": "petrov-p-p",
                "fullName": "Petrov P. P.",
            }

            created = app.handle_request(
                "PUT",
                "/api/profile",
                body=json.dumps(payload).encode("utf-8"),
            )
            fetched = app.handle_request(
                "GET",
                "/api/profile?telegramUserId=tg:42",
            )
            deleted = app.handle_request(
                "DELETE",
                "/api/profile?telegramUserId=tg:42",
            )
            missing = app.handle_request(
                "GET",
                "/api/profile?telegramUserId=tg:42",
            )

            self.assertEqual(created.status_code, 200)
            self.assertEqual(created.payload["role"], "teacher")
            self.assertEqual(fetched.status_code, 200)
            self.assertEqual(fetched.payload["fullName"], "Petrov P. P.")
            self.assertEqual(deleted.status_code, 200)
            self.assertEqual(deleted.payload, {"ok": True})
            self.assertEqual(missing.status_code, 404)
        finally:
            store_path.unlink(missing_ok=True)

    def test_profile_route_preserves_iis_credentials_and_hides_password(self) -> None:
        store_path = Path("backend") / "_profile_store_iis_test.json"
        store_path.unlink(missing_ok=True)
        try:
            app = BackendApp(
                config=TEST_CONFIG,
                fetcher=lambda *_: {},
                profile_store=UserProfileStore(store_path),
            )
            created = app.handle_request(
                "PUT",
                "/api/profile",
                body=json.dumps(
                    {
                        "telegramUserId": "tg:77",
                        "role": "student",
                        "groupNumber": "568403",
                        "studentCardNumber": "56841017",
                        "subgroup": "2",
                        "iisLogin": "56841017",
                        "iisPassword": "secret",
                    }
                ).encode("utf-8"),
            )
            updated = app.handle_request(
                "PUT",
                "/api/profile",
                body=json.dumps(
                    {
                        "telegramUserId": "tg:77",
                        "role": "student",
                        "groupNumber": "568403",
                        "studentCardNumber": "56841017",
                        "subgroup": "1",
                    }
                ).encode("utf-8"),
            )
            fetched = app.handle_request(
                "GET",
                "/api/profile?telegramUserId=tg:77",
            )
            stored = app.profile_store.get("tg:77")

            self.assertEqual(created.status_code, 200)
            self.assertEqual(created.payload["iisLogin"], "56841017")
            self.assertTrue(created.payload["hasIisPassword"])
            self.assertNotIn("iisPassword", created.payload)
            self.assertEqual(updated.status_code, 200)
            self.assertEqual(updated.payload["iisLogin"], "56841017")
            self.assertTrue(updated.payload["hasIisPassword"])
            self.assertNotIn("iisPassword", updated.payload)
            self.assertEqual(fetched.status_code, 200)
            self.assertEqual(fetched.payload["iisLogin"], "56841017")
            self.assertTrue(fetched.payload["hasIisPassword"])
            self.assertNotIn("iisPassword", fetched.payload)
            self.assertIsNotNone(stored)
            self.assertEqual(stored.iis_login, "56841017")
            self.assertEqual(stored.iis_password, "secret")
        finally:
            store_path.unlink(missing_ok=True)

    def test_profile_route_uses_iis_login_as_student_card_number(self) -> None:
        store_path = Path("backend") / "_profile_store_iis_login_only_test.json"
        store_path.unlink(missing_ok=True)
        try:
            app = BackendApp(
                config=TEST_CONFIG,
                fetcher=lambda *_: {},
                profile_store=UserProfileStore(store_path),
            )
            created = app.handle_request(
                "PUT",
                "/api/profile",
                body=json.dumps(
                    {
                        "telegramUserId": "tg:78",
                        "role": "student",
                        "groupNumber": "568403",
                        "iisLogin": "56841017",
                    }
                ).encode("utf-8"),
            )
            stored = app.profile_store.get("tg:78")

            self.assertEqual(created.status_code, 200)
            self.assertEqual(created.payload["studentCardNumber"], "56841017")
            self.assertEqual(created.payload["iisLogin"], "56841017")
            self.assertIsNotNone(stored)
            self.assertEqual(stored.student_card_number, "56841017")
            self.assertEqual(stored.iis_login, "56841017")
            self.assertIsNone(stored.iis_password)
        finally:
            store_path.unlink(missing_ok=True)

    def test_profile_route_drops_saved_password_when_iis_login_changes(self) -> None:
        store_path = Path("backend") / "_profile_store_iis_login_change_test.json"
        store_path.unlink(missing_ok=True)
        try:
            app = BackendApp(
                config=TEST_CONFIG,
                fetcher=lambda *_: {},
                profile_store=UserProfileStore(store_path),
            )
            app.handle_request(
                "PUT",
                "/api/profile",
                body=json.dumps(
                    {
                        "telegramUserId": "tg:79",
                        "role": "student",
                        "groupNumber": "568403",
                        "studentCardNumber": "56841017",
                        "iisLogin": "56841017",
                        "iisPassword": "secret",
                    }
                ).encode("utf-8"),
            )
            updated = app.handle_request(
                "PUT",
                "/api/profile",
                body=json.dumps(
                    {
                        "telegramUserId": "tg:79",
                        "role": "student",
                        "groupNumber": "568403",
                        "iisLogin": "56841018",
                    }
                ).encode("utf-8"),
            )
            stored = app.profile_store.get("tg:79")

            self.assertEqual(updated.status_code, 200)
            self.assertEqual(updated.payload["iisLogin"], "56841018")
            self.assertEqual(updated.payload["studentCardNumber"], "56841018")
            self.assertNotIn("hasIisPassword", updated.payload)
            self.assertIsNotNone(stored)
            self.assertEqual(stored.iis_login, "56841018")
            self.assertEqual(stored.student_card_number, "56841018")
            self.assertIsNone(stored.iis_password)
        finally:
            store_path.unlink(missing_ok=True)

    def test_profile_route_moves_student_profile_from_previous_telegram_id(self) -> None:
        store_path = Path("backend") / "_profile_store_previous_id_test.json"
        store_path.unlink(missing_ok=True)
        try:
            app = BackendApp(
                config=TEST_CONFIG,
                fetcher=lambda *_: {},
                profile_store=UserProfileStore(store_path),
            )
            app.handle_request(
                "PUT",
                "/api/profile",
                body=json.dumps(
                    {
                        "telegramUserId": "local:legacy",
                        "role": "student",
                        "groupNumber": "568403",
                        "studentCardNumber": "56841017",
                        "iisLogin": "56841017",
                        "iisPassword": "secret",
                    }
                ).encode("utf-8"),
            )
            migrated = app.handle_request(
                "PUT",
                "/api/profile",
                body=json.dumps(
                    {
                        "telegramUserId": "tg:80",
                        "previousTelegramUserId": "local:legacy",
                        "role": "student",
                        "groupNumber": "568403",
                        "iisLogin": "56841017",
                    }
                ).encode("utf-8"),
            )
            old_profile = app.handle_request(
                "GET",
                "/api/profile?telegramUserId=local:legacy",
            )
            new_profile = app.handle_request(
                "GET",
                "/api/profile?telegramUserId=tg:80",
            )
            stored = app.profile_store.get("tg:80")

            self.assertEqual(migrated.status_code, 200)
            self.assertEqual(migrated.payload["telegramUserId"], "tg:80")
            self.assertTrue(migrated.payload["hasIisPassword"])
            self.assertEqual(old_profile.status_code, 404)
            self.assertEqual(new_profile.status_code, 200)
            self.assertTrue(new_profile.payload["hasIisPassword"])
            self.assertIsNotNone(stored)
            self.assertEqual(stored.iis_password, "secret")
        finally:
            store_path.unlink(missing_ok=True)

    def test_normalize_omissions_response_sums_month_counts(self) -> None:
        normalized = normalize_omissions_response(
            [
                {"month": "Февраль", "omissionCount": 2},
                {"month": "Март", "omissionCount": "0"},
                {"month": "Апрель", "omissionCount": None},
            ]
        )

        self.assertEqual(normalized["totalHours"], 2)
        self.assertEqual(len(normalized["months"]), 3)
        self.assertEqual(normalized["months"][0]["month"], "Февраль")
        self.assertEqual(normalized["subjects"], [])

    def test_normalize_omissions_response_extracts_subject_counts(self) -> None:
        normalized = normalize_omissions_response(
            {
                "monthStudentOmissionCounts": [
                    {"month": "Февраль", "omissionCount": 2},
                ],
                "gradeBook": {
                    "student": {
                        "lessons": [
                            {
                                "lessonName": "Математический анализ",
                                "gradeBookOmissions": 1,
                            },
                            {
                                "lessonName": "Математический анализ",
                                "gradeBookOmissions": "2",
                            },
                            {
                                "lessonName": "Физика",
                                "gradeBookOmissions": 0,
                            },
                        ]
                    }
                },
            }
        )

        self.assertEqual(normalized["totalHours"], 2)
        self.assertEqual(
            normalized["subjects"],
            [
                {"subject": "Математический анализ", "omissionCount": 3},
                {"subject": "Физика", "omissionCount": 0},
            ],
        )

    def test_omissions_route_returns_month_counts_for_student_profile(self) -> None:
        store_path = Path("backend") / "_profile_store_omissions_test.json"
        store_path.unlink(missing_ok=True)

        class FakeOmissionsService:
            def __init__(self) -> None:
                self.calls: list[tuple[str, str]] = []

            def fetch_month_student_omission_counts(
                self,
                username: str,
                password: str,
            ):
                self.calls.append((username, password))
                return [
                    {"month": "Февраль", "omissionCount": 2},
                    {"month": "Март", "omissionCount": 0},
                ]

        try:
            service = FakeOmissionsService()
            app = BackendApp(
                config=TEST_CONFIG,
                fetcher=lambda *_: {},
                profile_store=UserProfileStore(store_path),
                omissions_service=service,
            )
            app.handle_request(
                "PUT",
                "/api/profile",
                body=json.dumps(
                    {
                        "telegramUserId": "tg:91",
                        "role": "student",
                        "groupNumber": "568403",
                        "studentCardNumber": "56841017",
                        "iisLogin": "56841017",
                        "iisPassword": "secret",
                    }
                ).encode("utf-8"),
            )

            response = app.handle_request(
                "GET",
                "/api/omissions?telegramUserId=tg:91",
            )

            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.payload["totalHours"], 2)
            self.assertEqual(
                response.payload["months"],
                [
                    {"month": "Февраль", "omissionCount": 2},
                    {"month": "Март", "omissionCount": 0},
                ],
            )
            self.assertEqual(response.payload["subjects"], [])
            self.assertEqual(service.calls, [("56841017", "secret")])
        finally:
            store_path.unlink(missing_ok=True)

    def test_omissions_route_returns_subject_counts_from_gradebook(self) -> None:
        store_path = Path("backend") / "_profile_store_omissions_gradebook_test.json"
        store_path.unlink(missing_ok=True)

        class FakeOmissionsService:
            def __init__(self) -> None:
                self.calls: list[tuple[str, str]] = []

            def fetch_student_omissions_overview(
                self,
                username: str,
                password: str,
            ):
                self.calls.append((username, password))
                return {
                    "monthStudentOmissionCounts": [
                        {"month": "Февраль", "omissionCount": 2},
                    ],
                    "gradeBook": {
                        "student": {
                            "lessons": [
                                {
                                    "lessonName": "Математический анализ",
                                    "gradeBookOmissions": 2,
                                },
                                {
                                    "lessonName": "Физика",
                                    "gradeBookOmissions": 1,
                                },
                            ]
                        }
                    },
                }

        try:
            service = FakeOmissionsService()
            app = BackendApp(
                config=TEST_CONFIG,
                fetcher=lambda *_: {},
                profile_store=UserProfileStore(store_path),
                omissions_service=service,
            )
            app.handle_request(
                "PUT",
                "/api/profile",
                body=json.dumps(
                    {
                        "telegramUserId": "tg:93",
                        "role": "student",
                        "groupNumber": "568403",
                        "iisLogin": "56841017",
                        "iisPassword": "secret",
                    }
                ).encode("utf-8"),
            )

            response = app.handle_request(
                "GET",
                "/api/omissions?telegramUserId=tg:93",
            )

            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.payload["totalHours"], 2)
            self.assertEqual(
                response.payload["subjects"],
                [
                    {"subject": "Математический анализ", "omissionCount": 2},
                    {"subject": "Физика", "omissionCount": 1},
                ],
            )
            self.assertEqual(service.calls, [("56841017", "secret")])
        finally:
            store_path.unlink(missing_ok=True)

    def test_omissions_route_requires_iis_credentials(self) -> None:
        store_path = Path("backend") / "_profile_store_omissions_missing_test.json"
        store_path.unlink(missing_ok=True)
        try:
            app = BackendApp(
                config=TEST_CONFIG,
                fetcher=lambda *_: {},
                profile_store=UserProfileStore(store_path),
            )
            app.handle_request(
                "PUT",
                "/api/profile",
                body=json.dumps(
                    {
                        "telegramUserId": "tg:92",
                        "role": "student",
                        "groupNumber": "568403",
                        "studentCardNumber": "56841017",
                    }
                ).encode("utf-8"),
            )

            response = app.handle_request(
                "GET",
                "/api/omissions?telegramUserId=tg:92",
            )

            self.assertEqual(response.status_code, 400)
            self.assertIn("логин и пароль IIS", response.payload["error"])
        finally:
            store_path.unlink(missing_ok=True)

    def test_free_auditories_route_returns_room_statuses(self) -> None:
        now_value = datetime(2026, 3, 2, 10, 10)

        def fetcher(path: str, _params: dict[str, str]):
            if path == "/schedule":
                return {
                    "schedules": {
                        "\u041f\u043e\u043d\u0435\u0434\u0435\u043b\u044c\u043d\u0438\u043a": [
                            {
                                "subjectFullName": "Physics",
                                "startLessonTime": "10:05",
                                "endLessonTime": "11:30",
                                "lessonTypeAbbrev": "\u041b\u0420",
                                "auditories": ["303-3\u043a"],
                            },
                            {
                                "subjectFullName": "Math",
                                "startLessonTime": "12:00",
                                "endLessonTime": "13:20",
                                "lessonTypeAbbrev": "\u041b\u041a",
                                "auditories": ["101-1\u043a"],
                            }
                        ]
                    }
                }
            if path == "/schedule/current-week":
                return 3
            if path == "/auditories":
                return [
                    {
                        "id": 214,
                        "name": "303",
                        "buildingNumber": {"name": "3 \u043a."},
                    },
                    {
                        "id": 215,
                        "name": "101",
                        "buildingNumber": {"name": "1 \u043a."},
                    },
                ]

            raise AssertionError(f"Unexpected path: {path}")

        app = BackendApp(
            config=TEST_CONFIG,
            fetcher=fetcher,
            now_ms=lambda: int(now_value.timestamp() * 1000),
            today=lambda: date(2026, 3, 2),
        )

        response = app.handle_request(
            "GET",
            "/api/free-auditories?studentGroup=353502",
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.payload["items"]), 2)
        items_by_name = {
            item["name"]: item for item in response.payload["items"]
        }
        self.assertEqual(set(items_by_name), {"101", "303"})
        self.assertTrue(items_by_name["303"]["isBusy"])
        self.assertEqual(
            items_by_name["303"]["currentLesson"],
            {
                "subject": "Physics",
                "date": "2026-03-02",
                "startTime": "10:05",
                "endTime": "11:30",
            },
        )
        self.assertFalse(items_by_name["101"]["isBusy"])
        self.assertIsNone(items_by_name["101"]["currentLesson"])
        self.assertEqual(
            items_by_name["101"]["nextBusyLesson"],
            {
                "subject": "Math",
                "date": "2026-03-02",
                "startTime": "12:00",
                "endTime": "13:20",
            },
        )


if __name__ == "__main__":
    unittest.main()
