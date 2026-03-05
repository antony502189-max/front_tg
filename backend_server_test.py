import unittest
from datetime import date

from backend_server import (
    BackendApp,
    CacheEntry,
    UpstreamRequestError,
    cache_key,
    normalize_employees_response,
    normalize_grades_response,
    normalize_schedule_response,
    read_fresh_cache,
    read_stale_cache,
    route_config,
    write_cache,
)


TEST_CONFIG = {
    "port": 8787,
    "iis_base_url": "https://iis.bsuir.by/api/v1",
    "cache_ttl_ms": 60_000,
    "stale_ttl_ms": 300_000,
    "request_timeout_ms": 100,
    "max_retries": 0,
    "retry_delay_ms": 1,
}


class BackendServerTests(unittest.TestCase):
    def test_route_config_resolves_known_routes(self) -> None:
        self.assertEqual(route_config("/api/schedule").upstream_path, "/schedule")
        self.assertEqual(route_config("/api/grades").query_param, "studentCardNumber")
        self.assertEqual(route_config("/api/employees").min_length, 2)
        self.assertIsNone(route_config("/unknown"))

    def test_returns_400_when_required_query_is_missing(self) -> None:
        app = BackendApp(config=TEST_CONFIG, fetcher=lambda *_: {})

        response = app.handle_request("GET", "/api/schedule")

        self.assertEqual(response.status_code, 400)
        self.assertIn("studentGroup", response.payload["error"])

    def test_serves_fresh_cache_without_calling_upstream(self) -> None:
        fetch_count = {"value": 0}
        store: dict[str, CacheEntry] = {}
        now_ms = lambda: 1_000
        key = cache_key("/schedule", {"studentGroup": "353502"})

        write_cache(
            store,
            key,
            {"days": [{"date": "2026-01-01", "lessons": []}]},
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
        )

        response = app.handle_request("GET", "/api/schedule?studentGroup=353502")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(fetch_count["value"], 0)
        self.assertEqual(
            response.payload,
            {"days": [{"date": "2026-01-01", "lessons": []}]},
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

    def test_cache_helpers_respect_fresh_and_stale_windows(self) -> None:
        store = {}
        key = cache_key("/employees", {"q": "ivan"})

        write_cache(store, key, [{"id": "1"}], 5, 10, 100)

        self.assertIsNotNone(read_fresh_cache(store, key, 102))
        self.assertIsNotNone(read_stale_cache(store, key, 108))
        self.assertIsNone(read_stale_cache(store, key, 116))

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

        self.assertEqual(len(normalized["days"]), 6)
        monday = normalized["days"][0]
        self.assertEqual(monday["date"], "2026-03-02")
        self.assertEqual(len(monday["lessons"]), 1)
        self.assertEqual(monday["lessons"][0]["subject"], "Higher Math")
        self.assertEqual(monday["lessons"][0]["teacher"], "Ivanov Ivan Ivanovich")

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
        self.assertEqual(normalized[0]["department"], "POIT")
        self.assertEqual(
            normalized[0]["avatarUrl"],
            "https://iis.bsuir.by/api/v1/employees/photo/42",
        )

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
        )

        self.assertEqual(normalized["summary"]["average"], 8.4)
        self.assertEqual(normalized["summary"]["position"], 12)
        self.assertEqual(normalized["summary"]["speciality"], "CS")
        self.assertEqual(normalized["subjects"][0]["subject"], "Math")
        self.assertEqual(len(normalized["subjects"][0]["marks"]), 2)


if __name__ == "__main__":
    unittest.main()
