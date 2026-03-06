from __future__ import annotations

import json
import math
import os
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, replace
from datetime import date, datetime, timedelta
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Lock
from typing import Any, Callable, Mapping
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, urlencode, urlparse
from urllib.request import Request, urlopen

try:
    from backend.env import load_project_env
    from backend.telegram_bot import (
        TelegramBotApp,
        TelegramBotError,
        WEBHOOK_PATH,
        build_webhook_url,
        load_webhook_config,
        matches_webhook_secret,
    )
except ModuleNotFoundError:  # pragma: no cover - fallback for direct script launch
    from env import load_project_env  # type: ignore
    from telegram_bot import (  # type: ignore
        TelegramBotApp,
        TelegramBotError,
        WEBHOOK_PATH,
        build_webhook_url,
        load_webhook_config,
        matches_webhook_secret,
    )


load_project_env()


JsonValue = Any
Fetcher = Callable[[str, dict[str, str]], JsonValue]
NowFn = Callable[[], int]
TodayFn = Callable[[], date]


@dataclass(frozen=True)
class AppConfig:
    host: str
    port: int
    iis_base_url: str
    cache_ttl_ms: int
    stale_ttl_ms: int
    request_timeout_ms: int
    max_retries: int
    retry_delay_ms: int

    @classmethod
    def from_mapping(cls, values: Mapping[str, Any]) -> "AppConfig":
        return cls(
            host=str(values["host"]),
            port=int(values["port"]),
            iis_base_url=str(values["iis_base_url"]),
            cache_ttl_ms=int(values["cache_ttl_ms"]),
            stale_ttl_ms=int(values["stale_ttl_ms"]),
            request_timeout_ms=int(values["request_timeout_ms"]),
            max_retries=int(values["max_retries"]),
            retry_delay_ms=int(values["retry_delay_ms"]),
        )


RUSSIAN_WEEKDAY_TO_INDEX = {
    "Понедельник": 0,
    "Вторник": 1,
    "Среда": 2,
    "Четверг": 3,
    "Пятница": 4,
    "Суббота": 5,
}

GRADES_SEARCH_TIMEOUT_MS = 2_500


def parse_number_env(name: str, fallback: int) -> int:
    raw = os.getenv(name)

    if raw is None:
        return fallback

    try:
        parsed = int(raw)
    except ValueError:
        return fallback

    return parsed if parsed >= 0 else fallback


def load_config() -> AppConfig:
    return AppConfig(
        host=os.getenv("HOST", "127.0.0.1"),
        port=parse_number_env("PORT", 8787),
        iis_base_url=os.getenv("IIS_BASE_URL", "https://iis.bsuir.by/api/v1"),
        cache_ttl_ms=parse_number_env("CACHE_TTL_MS", 60_000),
        stale_ttl_ms=parse_number_env("STALE_TTL_MS", 300_000),
        request_timeout_ms=parse_number_env("REQUEST_TIMEOUT_MS", 10_000),
        max_retries=parse_number_env("MAX_RETRIES", 2),
        retry_delay_ms=parse_number_env("RETRY_DELAY_MS", 250),
    )


CONFIG = load_config()


def coerce_config(config: AppConfig | Mapping[str, Any] | None) -> AppConfig:
    if config is None:
        return CONFIG

    if isinstance(config, AppConfig):
        return config

    merged_config = {
        "host": CONFIG.host,
        "port": CONFIG.port,
        "iis_base_url": CONFIG.iis_base_url,
        "cache_ttl_ms": CONFIG.cache_ttl_ms,
        "stale_ttl_ms": CONFIG.stale_ttl_ms,
        "request_timeout_ms": CONFIG.request_timeout_ms,
        "max_retries": CONFIG.max_retries,
        "retry_delay_ms": CONFIG.retry_delay_ms,
    }
    merged_config.update(config)

    return AppConfig.from_mapping(merged_config)


@dataclass(frozen=True)
class RouteConfig:
    kind: str
    cache_namespace: str
    query_param: str
    min_length: int


ROUTE_CONFIGS = {
    "/api/schedule": RouteConfig(
        kind="schedule",
        cache_namespace="/schedule",
        query_param="studentGroup",
        min_length=1,
    ),
    "/api/grades": RouteConfig(
        kind="grades",
        cache_namespace="/grades",
        query_param="studentCardNumber",
        min_length=1,
    ),
    "/api/employees": RouteConfig(
        kind="employees",
        cache_namespace="/employees",
        query_param="q",
        min_length=2,
    ),
    "/api/auditories": RouteConfig(
        kind="auditories",
        cache_namespace="/auditories",
        query_param="q",
        min_length=1,
    ),
}


@dataclass
class CacheEntry:
    payload: JsonValue
    fresh_until: int
    stale_until: int


@dataclass
class Response:
    status_code: int
    payload: JsonValue | None = None


class UpstreamRequestError(Exception):
    def __init__(self, message: str, status: int | None = None) -> None:
        super().__init__(message)
        self.message = message
        self.status = status


def cache_key(path: str, params: dict[str, str]) -> str:
    serialized = urlencode(
        sorted(
            (key, str(value))
            for key, value in params.items()
            if value is not None
        )
    )
    return f"{path}?{serialized}"


def read_fresh_cache(
    store: dict[str, CacheEntry],
    key: str,
    now_ms: int,
) -> JsonValue | None:
    item = store.get(key)

    if item is None:
        return None

    if now_ms <= item.fresh_until:
        return item.payload

    return None


def read_stale_cache(
    store: dict[str, CacheEntry],
    key: str,
    now_ms: int,
) -> JsonValue | None:
    item = store.get(key)

    if item is None:
        return None

    if now_ms <= item.stale_until:
        return item.payload

    store.pop(key, None)
    return None


def write_cache(
    store: dict[str, CacheEntry],
    key: str,
    payload: JsonValue,
    cache_ttl_ms: int,
    stale_ttl_ms: int,
    now_ms: int,
) -> None:
    store[key] = CacheEntry(
        payload=payload,
        fresh_until=now_ms + cache_ttl_ms,
        stale_until=now_ms + cache_ttl_ms + stale_ttl_ms,
    )


def route_config(pathname: str) -> RouteConfig | None:
    return ROUTE_CONFIGS.get(pathname)


def should_retry(error: UpstreamRequestError) -> bool:
    if error.status == 429:
        return True

    if error.status is not None:
        return error.status >= 500

    normalized_message = error.message.lower()
    timeout_markers = (
        "timed out",
        "timeout",
        "время ожидания",
        "time out",
    )

    return not any(marker in normalized_message for marker in timeout_markers)


def extract_error_message(raw_body: bytes) -> str:
    if not raw_body:
        return "Upstream API request failed"

    try:
        payload = json.loads(raw_body.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        decoded = raw_body.decode("utf-8", errors="replace").strip()
        return decoded or "Upstream API request failed"

    if isinstance(payload, dict):
        message = payload.get("message") or payload.get("error")
        if isinstance(message, str) and message.strip():
            return message.strip()

    return "Upstream API request failed"


def create_fetcher(config: AppConfig) -> Fetcher:
    base_url = config.iis_base_url.rstrip("/")
    timeout_seconds = max(config.request_timeout_ms, 1) / 1000

    def fetch(path: str, params: dict[str, str]) -> JsonValue:
        query = urlencode(params)
        request_url = f"{base_url}{path}"
        if query:
            request_url = f"{request_url}?{query}"

        request = Request(
            request_url,
            headers={
                "Accept": "application/json",
                "User-Agent": "front_tg_python_backend/1.0",
            },
        )

        try:
            with urlopen(request, timeout=timeout_seconds) as response:
                charset = response.headers.get_content_charset() or "utf-8"
                raw_body = response.read()
                payload = raw_body.decode(charset)
                return json.loads(payload) if payload else None
        except HTTPError as error:
            message = extract_error_message(error.read())
            raise UpstreamRequestError(message=message, status=error.code) from error
        except TimeoutError as error:
            raise UpstreamRequestError(
                message=str(error) or "Upstream API request timed out"
            ) from error
        except URLError as error:
            raise UpstreamRequestError(
                message=str(error.reason or "Upstream API request failed")
            ) from error

    return fetch


def fetch_with_retry(
    fetcher: Fetcher,
    path: str,
    params: dict[str, str],
    max_retries: int,
    retry_delay_ms: int,
) -> JsonValue:
    last_error: UpstreamRequestError | None = None

    for attempt in range(max_retries + 1):
        try:
            return fetcher(path, params)
        except UpstreamRequestError as error:
            last_error = error

            if not should_retry(error) or attempt == max_retries:
                raise

            time.sleep(retry_delay_ms * (attempt + 1) / 1000)

    raise last_error or UpstreamRequestError("Upstream API request failed")


def first_non_empty_string(*values: Any) -> str | None:
    for value in values:
        if isinstance(value, str) and value.strip():
            return value.strip()
    return None


def normalize_lookup_value(value: Any) -> str:
    if value is None:
        return ""
    return "".join(str(value).split()).lower()


def first_finite_number(*values: Any) -> float | None:
    for value in values:
        if isinstance(value, bool):
            continue
        if isinstance(value, (int, float)) and math.isfinite(value):
            return float(value)
    return None


def parse_dot_date(raw_value: Any) -> date | None:
    if not isinstance(raw_value, str) or not raw_value.strip():
        return None

    for fmt in ("%d.%m.%Y", "%Y-%m-%d"):
        try:
            return datetime.strptime(raw_value.strip(), fmt).date()
        except ValueError:
            continue

    return None


def normalize_current_week(payload: Any) -> int:
    if isinstance(payload, int):
        return payload

    if isinstance(payload, float) and math.isfinite(payload):
        return int(payload)

    if isinstance(payload, str):
        try:
            return int(payload)
        except ValueError:
            pass

    return 1


def compose_full_name(raw: dict[str, Any]) -> str | None:
    fio = first_non_empty_string(raw.get("fio"))
    if fio is not None:
        return fio

    parts = [
        first_non_empty_string(raw.get("lastName")),
        first_non_empty_string(raw.get("firstName")),
        first_non_empty_string(raw.get("middleName")),
    ]
    normalized_parts = [part for part in parts if part]
    return " ".join(normalized_parts) if normalized_parts else None


def lesson_matches_week(raw_lesson: dict[str, Any], current_week: int) -> bool:
    week_numbers = raw_lesson.get("weekNumber")

    if not isinstance(week_numbers, list) or not week_numbers:
        return True

    normalized = []
    for item in week_numbers:
        if isinstance(item, int):
            normalized.append(item)
        elif isinstance(item, float) and math.isfinite(item):
            normalized.append(int(item))

    return not normalized or current_week in normalized


def lesson_matches_date(raw_lesson: dict[str, Any], lesson_date: date) -> bool:
    fixed_date = parse_dot_date(raw_lesson.get("dateLesson"))
    if fixed_date is not None:
        return fixed_date == lesson_date

    start_date = parse_dot_date(raw_lesson.get("startLessonDate"))
    end_date = parse_dot_date(raw_lesson.get("endLessonDate"))

    if start_date is not None and lesson_date < start_date:
        return False

    if end_date is not None and lesson_date > end_date:
        return False

    return True


def normalize_schedule_lesson(
    raw_lesson: dict[str, Any],
    lesson_date: date,
    index: int,
) -> dict[str, Any]:
    subject = first_non_empty_string(
        raw_lesson.get("subjectFullName"),
        raw_lesson.get("subject"),
    ) or "Дисциплина"

    employees = raw_lesson.get("employees")
    teacher = None
    if isinstance(employees, list) and employees:
        first_employee = employees[0]
        if isinstance(first_employee, dict):
            teacher = compose_full_name(first_employee)

    auditories = raw_lesson.get("auditories")
    room = None
    if isinstance(auditories, list):
        normalized_rooms = [
            value.strip()
            for value in auditories
            if isinstance(value, str) and value.strip()
        ]
        if normalized_rooms:
            room = ", ".join(normalized_rooms)

    lesson_type = first_non_empty_string(
        raw_lesson.get("lessonTypeAbbrev"),
        raw_lesson.get("lessonType"),
    )
    start_time = first_non_empty_string(raw_lesson.get("startLessonTime")) or ""
    end_time = first_non_empty_string(raw_lesson.get("endLessonTime")) or ""
    date_value = lesson_date.isoformat()

    return {
        "id": str(
            raw_lesson.get("id")
            or f"{date_value}-{start_time}-{subject}-{room or 'room'}-{index}"
        ),
        "subject": subject,
        "teacher": teacher,
        "room": room,
        "type": lesson_type,
        "startTime": start_time,
        "endTime": end_time,
        "date": date_value,
    }


def normalize_schedule_response(
    payload: Any,
    current_week: int,
    today_value: date,
) -> dict[str, Any]:
    schedules = payload.get("schedules") if isinstance(payload, dict) else None
    if not isinstance(schedules, dict):
        return {"days": []}

    monday = today_value - timedelta(days=today_value.weekday())
    days = []

    for day_name, day_index in sorted(
        RUSSIAN_WEEKDAY_TO_INDEX.items(),
        key=lambda item: item[1],
    ):
        lesson_date = monday + timedelta(days=day_index)
        raw_lessons = schedules.get(day_name)
        lessons = []

        if isinstance(raw_lessons, list):
            for index, item in enumerate(raw_lessons):
                if not isinstance(item, dict):
                    continue
                if not lesson_matches_week(item, current_week):
                    continue
                if not lesson_matches_date(item, lesson_date):
                    continue
                lessons.append(
                    normalize_schedule_lesson(item, lesson_date, index)
                )

        lessons.sort(key=lambda lesson: (lesson["startTime"], lesson["subject"]))
        days.append({"date": lesson_date.isoformat(), "lessons": lessons})

    return {"days": days}


def normalize_employees_response(
    payload: Any,
    config: AppConfig | Mapping[str, Any],
) -> list[dict[str, Any]]:
    items = payload
    if isinstance(payload, dict):
        items = payload.get("value", [])

    if not isinstance(items, list):
        return []

    base_url = coerce_config(config).iis_base_url.rstrip("/")
    result = []

    for item in items:
        if not isinstance(item, dict):
            continue

        full_name = compose_full_name(item) or "Преподаватель"
        employee_id = item.get("id")
        avatar_url = first_non_empty_string(item.get("photoLink"))

        if avatar_url is None and employee_id is not None:
            avatar_url = f"{base_url}/employees/photo/{employee_id}"

        result.append(
            {
                "id": str(employee_id or full_name),
                "fullName": full_name,
                "position": first_non_empty_string(
                    item.get("jobPosition"),
                    item.get("position"),
                    item.get("rank"),
                    item.get("degree"),
                ),
                "department": first_non_empty_string(item.get("academicDepartment")),
                "avatarUrl": avatar_url,
            }
        )

    return result


def normalize_auditories_response(payload: Any, query: str) -> list[dict[str, Any]]:
    items = payload
    if isinstance(payload, dict):
        items = payload.get("value", [])

    if not isinstance(items, list):
        return []

    normalized_query = normalize_lookup_value(query)
    result = []

    for item in items:
        if not isinstance(item, dict):
            continue

        building = item.get("buildingNumber")
        building_name = first_non_empty_string(
            building.get("name") if isinstance(building, dict) else building
        )
        auditory_type = item.get("auditoryType")
        type_name = first_non_empty_string(
            auditory_type.get("name") if isinstance(auditory_type, dict) else auditory_type
        )
        type_abbrev = first_non_empty_string(
            auditory_type.get("abbrev") if isinstance(auditory_type, dict) else None
        )
        department = item.get("department")
        department_name = first_non_empty_string(
            department.get("nameAndAbbrev") if isinstance(department, dict) else department,
            department.get("name") if isinstance(department, dict) else None,
            department.get("abbrev") if isinstance(department, dict) else None,
        )
        name = first_non_empty_string(item.get("name"))

        if name is None:
            continue

        full_name = " ".join(part for part in (name, building_name) if part)
        search_blob = normalize_lookup_value(
            " ".join(
                value
                for value in (
                    name,
                    full_name,
                    building_name,
                    type_name,
                    type_abbrev,
                    department_name,
                    first_non_empty_string(item.get("note")),
                )
                if value
            )
        )

        if normalized_query and normalized_query not in search_blob:
            continue

        result.append(
            {
                "id": str(item.get("id", full_name)),
                "name": name,
                "building": building_name,
                "fullName": full_name,
                "type": type_name,
                "typeAbbrev": type_abbrev,
                "capacity": item.get("capacity"),
                "department": department_name,
                "note": first_non_empty_string(item.get("note")),
            }
        )

    result.sort(
        key=lambda item: (
            not normalize_lookup_value(item["fullName"]).startswith(normalized_query),
            item["fullName"],
        )
    )
    return result[:50]


def find_student_card_match(
    payload: Any,
    student_card_number: str,
) -> dict[str, Any] | None:
    normalized_student_card_number = normalize_lookup_value(student_card_number)

    if isinstance(payload, dict):
        wrapped = payload.get("value")
        if isinstance(wrapped, list):
            payload = wrapped
        elif payload.get("studentCardNumber") is not None:
            payload = [payload]

    if not isinstance(payload, list):
        return None

    for item in payload:
        if not isinstance(item, dict):
            continue
        if (
            normalize_lookup_value(item.get("studentCardNumber", ""))
            == normalized_student_card_number
        ):
            return item

    for item in payload:
        if isinstance(item, dict):
            return item

    return None


def normalize_mark(raw_mark: Any) -> dict[str, Any] | None:
    if isinstance(raw_mark, bool):
        return None

    if isinstance(raw_mark, (int, float)) and math.isfinite(raw_mark):
        return {"value": float(raw_mark)}

    if isinstance(raw_mark, str):
        try:
            return {"value": float(raw_mark.replace(",", "."))}
        except ValueError:
            return None

    if not isinstance(raw_mark, dict):
        return None

    numeric_value = first_finite_number(
        raw_mark.get("value"),
        raw_mark.get("mark"),
        raw_mark.get("score"),
        raw_mark.get("averageMark"),
        raw_mark.get("avgMark"),
    )

    if numeric_value is None:
        return None

    mark = {"value": numeric_value}
    mark_date = first_non_empty_string(
        raw_mark.get("date"),
        raw_mark.get("markDate"),
        raw_mark.get("lessonDate"),
        raw_mark.get("createdAt"),
    )

    if mark_date is not None:
        mark["date"] = mark_date

    return mark


def unwrap_grade_payload(payload: Any) -> Any:
    current = payload

    for _ in range(4):
        if not isinstance(current, dict):
            return current

        nested = (
            current.get("studentRating")
            or current.get("rating")
            or current.get("data")
            or current.get("result")
            or current.get("value")
        )

        if isinstance(nested, dict):
            current = nested
            continue

        return current

    return current


def extract_grade_subjects(payload: Any) -> list[dict[str, Any]]:
    candidates = unwrap_grade_payload(payload)
    if isinstance(candidates, dict):
        lesson_items = candidates.get("lessons")
        if isinstance(lesson_items, list):
            grouped_subjects: dict[str, dict[str, Any]] = {}

            for index, item in enumerate(lesson_items):
                if not isinstance(item, dict):
                    continue

                raw_marks = item.get("marks")
                marks = []
                if isinstance(raw_marks, list):
                    for raw_mark in raw_marks:
                        normalized_mark = normalize_mark(raw_mark)
                        if normalized_mark is None:
                            continue

                        if "date" not in normalized_mark:
                            lesson_date = first_non_empty_string(
                                item.get("dateString"),
                                item.get("date"),
                            )
                            if lesson_date is not None:
                                normalized_mark["date"] = lesson_date

                        marks.append(normalized_mark)

                if not marks:
                    average_mark = first_finite_number(
                        item.get("averageMark"),
                        item.get("avgMark"),
                        item.get("mark"),
                        item.get("value"),
                    )
                    if average_mark is not None:
                        mark: dict[str, Any] = {"value": average_mark}
                        lesson_date = first_non_empty_string(
                            item.get("dateString"),
                            item.get("date"),
                        )
                        if lesson_date is not None:
                            mark["date"] = lesson_date
                        marks.append(mark)

                if not marks:
                    continue

                subject_name = first_non_empty_string(
                    item.get("lessonName"),
                    item.get("lessonNameFull"),
                    item.get("lessonNameAbbrev"),
                    item.get("subject"),
                    item.get("discipline"),
                    item.get("disciplineName"),
                    item.get("name"),
                    item.get("title"),
                ) or "Дисциплина"
                subject_key = normalize_lookup_value(subject_name) or str(index)

                if subject_key not in grouped_subjects:
                    grouped_subjects[subject_key] = {
                        "id": str(item.get("id", subject_key)),
                        "subject": subject_name,
                        "teacher": first_non_empty_string(
                            item.get("teacher"),
                            item.get("employee"),
                            item.get("fio"),
                        ),
                        "marks": [],
                    }

                grouped_subjects[subject_key]["marks"].extend(marks)

            result = list(grouped_subjects.values())
            result.sort(key=lambda item: item["subject"])
            return result

        candidates = (
            candidates.get("subjects")
            or candidates.get("disciplines")
            or candidates.get("items")
            or candidates.get("results")
            or candidates.get("ratingItems")
            or candidates.get("value")
            or []
        )

    if not isinstance(candidates, list):
        return []

    subjects = []

    for index, item in enumerate(candidates):
        if not isinstance(item, dict):
            continue

        subject_name = first_non_empty_string(
            item.get("subject"),
            item.get("name"),
            item.get("discipline"),
            item.get("disciplineName"),
            item.get("title"),
        ) or "Дисциплина"

        raw_marks = (
            item.get("marks")
            or item.get("grades")
            or item.get("controlPoints")
            or item.get("points")
            or item.get("values")
            or []
        )

        marks = []
        if isinstance(raw_marks, list):
            for raw_mark in raw_marks:
                normalized_mark = normalize_mark(raw_mark)
                if normalized_mark is not None:
                    marks.append(normalized_mark)

        if not marks:
            average_mark = first_finite_number(
                item.get("averageMark"),
                item.get("avgMark"),
                item.get("mark"),
                item.get("value"),
            )
            if average_mark is not None:
                marks.append({"value": average_mark})

        subjects.append(
            {
                "id": str(item.get("id", index)),
                "subject": subject_name,
                "teacher": first_non_empty_string(
                    item.get("teacher"),
                    item.get("employee"),
                    item.get("fio"),
                ),
                "marks": marks,
            }
        )

    return subjects


def extract_grade_summary(payload: Any) -> dict[str, Any] | None:
    payload = unwrap_grade_payload(payload)

    if not isinstance(payload, dict):
        return None

    average = first_finite_number(
        payload.get("average"),
        payload.get("avgRating"),
        payload.get("averageMark"),
    )
    position = first_finite_number(
        payload.get("position"),
        payload.get("ratingPlace"),
        payload.get("place"),
    )
    speciality = first_non_empty_string(
        payload.get("speciality"),
        payload.get("specialty"),
        payload.get("specialityAbbrev"),
        payload.get("specialityName"),
    )

    if average is None and position is None and speciality is None:
        return None

    summary: dict[str, Any] = {}
    if average is not None:
        summary["average"] = average
    if position is not None:
        summary["position"] = int(position)
    if speciality is not None:
        summary["speciality"] = speciality

    return summary


def normalize_grades_response(
    student_card_number: str,
    search_payload: Any,
    rating_payload: Any,
    warning: str | None = None,
) -> dict[str, Any]:
    matched_student = find_student_card_match(search_payload, student_card_number)
    summary = extract_grade_summary(matched_student) or extract_grade_summary(
        rating_payload
    )
    subjects = extract_grade_subjects(rating_payload)

    response = {
        "summary": summary,
        "subjects": subjects,
    }

    if warning is not None:
        response["warning"] = warning

    return response


class BackendApp:
    def __init__(
        self,
        *,
        config: AppConfig | Mapping[str, Any] | None = None,
        store: dict[str, CacheEntry] | None = None,
        fetcher: Fetcher | None = None,
        now_ms: NowFn | None = None,
        today: TodayFn | None = None,
        telegram_bot_app: TelegramBotApp | None = None,
    ) -> None:
        self.config = self._resolve_config(config)
        self.store = {} if store is None else store
        self.fetcher = fetcher or create_fetcher(self.config)
        self.uses_default_fetcher = fetcher is None
        self.now_ms = now_ms or (lambda: int(time.time() * 1000))
        self.today = today or (lambda: datetime.now().date())
        self.started_at_ms = self.now_ms()
        self.lock = Lock()
        self.telegram_bot_app = (
            telegram_bot_app
            if telegram_bot_app is not None
            else self._build_telegram_bot_app()
        )

    @staticmethod
    def _resolve_config(
        config: AppConfig | Mapping[str, Any] | None,
    ) -> AppConfig:
        return coerce_config(config)

    @staticmethod
    def _build_telegram_bot_app() -> TelegramBotApp | None:
        config = load_webhook_config()

        if config is None:
            return None

        return TelegramBotApp(config)

    def cache_entries(self) -> int:
        with self.lock:
            return len(self.store)

    def configure_telegram_webhook(self) -> None:
        if self.telegram_bot_app is None or self.telegram_bot_app.is_configured:
            return

        try:
            self.telegram_bot_app.ensure_webhook_setup()
            print(
                "[telegram-webhook] configured at "
                f"{build_webhook_url(self.telegram_bot_app.config)}"
            )
        except TelegramBotError as error:
            print(f"[telegram-webhook] setup error: {error.message}")

    def request_upstream(self, path: str, params: dict[str, str]) -> JsonValue:
        return fetch_with_retry(
            self.fetcher,
            path,
            params,
            self.config.max_retries,
            self.config.retry_delay_ms,
        )

    def request_upstream_with_timeout(
        self,
        path: str,
        params: dict[str, str],
        *,
        timeout_ms: int,
        max_retries: int,
    ) -> JsonValue:
        fetcher = (
            create_fetcher(
                replace(
                    self.config,
                    request_timeout_ms=max(timeout_ms, 1),
                )
            )
            if self.uses_default_fetcher
            else self.fetcher
        )
        return fetch_with_retry(
            fetcher,
            path,
            params,
            max_retries,
            self.config.retry_delay_ms,
        )

    def _build_schedule_payload(self, query_value: str) -> JsonValue:
        schedule_payload = self.request_upstream(
            "/schedule",
            {"studentGroup": query_value},
        )
        current_week = normalize_current_week(
            self.request_upstream("/schedule/current-week", {})
        )

        return normalize_schedule_response(
            schedule_payload,
            current_week,
            self.today(),
        )

    def _build_employees_payload(self, query_value: str) -> JsonValue:
        employees_payload = self.request_upstream(
            "/employees/fio",
            {"employee-fio": query_value},
        )
        return normalize_employees_response(employees_payload, self.config)

    def _build_auditories_payload(self, query_value: str) -> JsonValue:
        auditories_payload = self.request_upstream("/auditories", {})
        return normalize_auditories_response(auditories_payload, query_value)

    def _build_grades_payload(self, query_value: str) -> JsonValue:
        search_payload = None
        rating_payload = None
        search_error: UpstreamRequestError | None = None
        rating_error: UpstreamRequestError | None = None

        requests = {
            "search": (
                "/rating/studentSearch",
                {"studentCardNumber": query_value},
            ),
            "rating": (
                "/rating/studentRating",
                {"studentCardNumber": query_value},
            ),
        }

        with ThreadPoolExecutor(max_workers=2) as executor:
            futures = {
                "search": executor.submit(
                    self.request_upstream_with_timeout,
                    requests["search"][0],
                    requests["search"][1],
                    timeout_ms=min(
                        self.config.request_timeout_ms,
                        GRADES_SEARCH_TIMEOUT_MS,
                    ),
                    max_retries=0,
                ),
                "rating": executor.submit(
                    self.request_upstream,
                    requests["rating"][0],
                    requests["rating"][1],
                ),
            }

            for key, future in futures.items():
                try:
                    result = future.result()
                except UpstreamRequestError as error:
                    if key == "search":
                        search_error = error
                    else:
                        rating_error = error
                    continue

                if key == "search":
                    search_payload = result
                else:
                    rating_payload = result

        if search_payload is None and rating_payload is None:
            if search_error is not None and search_error.status == 404:
                raise search_error
            if rating_error is not None:
                raise rating_error
            if search_error is not None:
                raise search_error

        warning = None
        if rating_payload is None:
            warning = (
                search_error.message
                if search_error is not None and search_error.status == 404
                else rating_error.message if rating_error is not None else None
            )

        return normalize_grades_response(
            query_value,
            search_payload,
            rating_payload,
            warning=warning,
        )

    def build_route_payload(self, route: RouteConfig, query_value: str) -> JsonValue:
        if route.kind == "schedule":
            return self._build_schedule_payload(query_value)

        if route.kind == "employees":
            return self._build_employees_payload(query_value)

        if route.kind == "auditories":
            return self._build_auditories_payload(query_value)

        if route.kind == "grades":
            return self._build_grades_payload(query_value)

        raise UpstreamRequestError("Unsupported route", status=500)

    @staticmethod
    def _extract_query_value(parsed_url: Any, route: RouteConfig) -> str | None:
        query_value = parse_qs(parsed_url.query).get(route.query_param, [None])[0]

        if query_value is None:
            return None

        normalized = query_value.strip()
        if len(normalized) < route.min_length:
            return None

        return normalized

    def _handle_telegram_webhook(
        self,
        body: bytes,
        headers: Mapping[str, str] | None,
    ) -> Response:
        if self.telegram_bot_app is None:
            return Response(404, {"error": "Not found"})

        normalized_headers = {
            str(key).lower(): str(value)
            for key, value in (headers or {}).items()
        }

        if not matches_webhook_secret(
            normalized_headers,
            self.telegram_bot_app.config.webhook_secret,
        ):
            return Response(403, {"error": "Forbidden"})

        try:
            payload = json.loads(body.decode("utf-8")) if body else None
        except (UnicodeDecodeError, json.JSONDecodeError):
            return Response(400, {"error": "Invalid JSON"})

        if not isinstance(payload, dict):
            return Response(400, {"error": "Invalid Telegram update"})

        try:
            self.telegram_bot_app.handle_update(payload)
        except TelegramBotError as error:
            return Response(502, {"error": error.message})

        return Response(200, {"ok": True})

    def handle_request(
        self,
        method: str,
        raw_path: str | None,
        *,
        body: bytes | None = None,
        headers: Mapping[str, str] | None = None,
    ) -> Response:
        if raw_path is None:
            return Response(400, {"error": "Bad request"})

        parsed_url = urlparse(raw_path)

        if method == "OPTIONS":
            return Response(204)

        if parsed_url.path == WEBHOOK_PATH:
            if method != "POST":
                return Response(405, {"error": "Method not allowed"})

            return self._handle_telegram_webhook(body or b"", headers)

        if method not in {"GET", "HEAD"}:
            return Response(405, {"error": "Method not allowed"})

        if parsed_url.path == "/":
            payload: dict[str, Any] = {
                "ok": True,
                "service": "front_tg_backend_python",
                "message": "Backend is running. Use /api/health or /api/* endpoints.",
                "healthPath": "/api/health",
            }

            if self.telegram_bot_app is not None:
                payload["telegramWebhookPath"] = WEBHOOK_PATH

            return Response(200, payload)

        if parsed_url.path == "/api/health":
            return Response(
                200,
                {
                    "ok": True,
                    "service": "front_tg_backend_python",
                    "iisBaseUrl": self.config.iis_base_url,
                    "uptimeMs": self.now_ms() - self.started_at_ms,
                    "cacheEntries": self.cache_entries(),
                },
            )

        route = route_config(parsed_url.path)

        if route is None:
            return Response(404, {"error": "Not found"})

        normalized = self._extract_query_value(parsed_url, route)

        if normalized is None:
            return Response(
                400,
                {"error": f'Query param "{route.query_param}" is required'},
            )

        params = {route.query_param: normalized}
        key = cache_key(route.cache_namespace, params)
        now_value = self.now_ms()

        with self.lock:
            cached = read_fresh_cache(self.store, key, now_value)

        if cached is not None:
            return Response(200, cached)

        try:
            payload = self.build_route_payload(route, normalized)

            with self.lock:
                write_cache(
                    self.store,
                    key,
                    payload,
                    self.config.cache_ttl_ms,
                    self.config.stale_ttl_ms,
                    self.now_ms(),
                )

            return Response(200, payload)
        except UpstreamRequestError as error:
            with self.lock:
                stale_payload = read_stale_cache(self.store, key, self.now_ms())

            if stale_payload is not None:
                return Response(200, stale_payload)

            return Response(
                error.status or 502,
                {"error": error.message, "upstreamStatus": error.status},
            )


CORS_HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
}


def build_raw_path_from_scope(scope: Mapping[str, Any]) -> str:
    path = str(scope.get("path") or "/")
    query_string = scope.get("query_string", b"")

    if isinstance(query_string, bytes) and query_string:
        return f"{path}?{query_string.decode('utf-8', errors='ignore')}"

    return path


def encode_response_headers(
    response: Response,
    body: bytes,
) -> list[tuple[bytes, bytes]]:
    headers = [
        (key.lower().encode("ascii"), value.encode("utf-8"))
        for key, value in CORS_HEADERS.items()
    ]

    if response.payload is None:
        headers.append((b"content-length", b"0"))
        return headers

    headers.extend(
        [
            (b"content-type", b"application/json; charset=utf-8"),
            (b"content-length", str(len(body)).encode("ascii")),
        ]
    )
    return headers


def encode_response_body(response: Response) -> bytes:
    if response.payload is None:
        return b""

    return json.dumps(response.payload, ensure_ascii=False).encode("utf-8")


def build_headers_from_scope(scope: Mapping[str, Any]) -> dict[str, str]:
    raw_headers = scope.get("headers") or []
    headers: dict[str, str] = {}

    if not isinstance(raw_headers, list):
        return headers

    for key, value in raw_headers:
        if not isinstance(key, bytes) or not isinstance(value, bytes):
            continue

        headers[key.decode("utf-8", errors="ignore").lower()] = value.decode(
            "utf-8",
            errors="ignore",
        )

    return headers


async def read_request_body(receive: Any) -> bytes:
    chunks: list[bytes] = []

    while True:
        message = await receive()
        if message.get("type") != "http.request":
            return b"".join(chunks)

        body = message.get("body", b"")
        if isinstance(body, bytes) and body:
            chunks.append(body)

        if not message.get("more_body", False):
            return b"".join(chunks)


class BackendASGIApp:
    def __init__(self, backend_app: BackendApp | None = None) -> None:
        self.backend_app = backend_app or BackendApp()

    async def handle_lifespan(self, receive: Any, send: Any) -> None:
        while True:
            message = await receive()
            message_type = message.get("type")

            if message_type == "lifespan.startup":
                self.backend_app.configure_telegram_webhook()
                await send({"type": "lifespan.startup.complete"})
                continue

            if message_type == "lifespan.shutdown":
                await send({"type": "lifespan.shutdown.complete"})
                return

    async def __call__(self, scope: Mapping[str, Any], receive: Any, send: Any) -> None:
        scope_type = scope.get("type")

        if scope_type == "lifespan":
            await self.handle_lifespan(receive, send)
            return

        if scope_type != "http":
            return

        body_bytes = await read_request_body(receive)

        method = str(scope.get("method") or "GET")
        response = self.backend_app.handle_request(
            method,
            build_raw_path_from_scope(scope),
            body=body_bytes,
            headers=build_headers_from_scope(scope),
        )
        body = encode_response_body(response)

        await send(
            {
                "type": "http.response.start",
                "status": response.status_code,
                "headers": encode_response_headers(response, body),
            }
        )
        await send(
            {
                "type": "http.response.body",
                "body": b"" if method == "HEAD" else body,
            }
        )


def create_asgi_app(backend_app: BackendApp | None = None) -> BackendASGIApp:
    return BackendASGIApp(backend_app)


def create_handler(app: BackendApp) -> type[BaseHTTPRequestHandler]:
    class RequestHandler(BaseHTTPRequestHandler):
        def respond(self) -> None:
            content_length = int(self.headers.get("Content-Length", "0") or "0")
            body = self.rfile.read(content_length) if content_length > 0 else b""
            headers = {
                key.lower(): value
                for key, value in self.headers.items()
            }
            response = app.handle_request(
                self.command,
                self.path,
                body=body,
                headers=headers,
            )
            self.send_response(response.status_code)

            for key, value in CORS_HEADERS.items():
                self.send_header(key, value)

            if response.payload is None:
                self.send_header("Content-Length", "0")
                self.end_headers()
                return

            body = encode_response_body(response)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()

            if self.command != "HEAD":
                self.wfile.write(body)

        def do_OPTIONS(self) -> None:  # noqa: N802
            self.respond()

        def do_GET(self) -> None:  # noqa: N802
            self.respond()

        def do_HEAD(self) -> None:  # noqa: N802
            self.respond()

        def do_POST(self) -> None:  # noqa: N802
            self.respond()

        def do_PUT(self) -> None:  # noqa: N802
            self.respond()

        def do_PATCH(self) -> None:  # noqa: N802
            self.respond()

        def do_DELETE(self) -> None:  # noqa: N802
            self.respond()

        def log_message(self, format: str, *args: object) -> None:
            return None

    return RequestHandler


def run_server() -> None:
    app = BackendApp()
    app.configure_telegram_webhook()
    server = ThreadingHTTPServer(
        (app.config.host, app.config.port),
        create_handler(app),
    )

    print(
        f"[backend:python] listening on http://{app.config.host}:{app.config.port}"
    )

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    run_server()
