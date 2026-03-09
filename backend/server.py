from __future__ import annotations

import json
import logging
import math
import re
import time
from concurrent.futures import Future, ThreadPoolExecutor
from dataclasses import dataclass, replace
from datetime import date, datetime, timedelta
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Lock
from typing import Any, Callable, Mapping
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, quote, urlencode, urlparse
from urllib.request import Request, urlopen

try:
    from backend.env import load_project_env, parse_number_env, parse_string_env
    from backend.services.rating import (
        RatingService,
        StudentRatingFetchResult,
        extract_rating_speciality_name,
        matches_rating_speciality,
    )
    from backend.telegram_bot import (
        TelegramBotApp,
        TelegramBotError,
        WEBHOOK_PATH,
        build_webhook_url,
        load_webhook_config,
        matches_webhook_secret,
    )
    from backend.user_profiles import (
        ProfileValidationError,
        UserProfile,
        UserProfileStore,
    )
except ModuleNotFoundError:  # pragma: no cover - fallback for direct script launch
    from env import load_project_env, parse_number_env, parse_string_env  # type: ignore
    from services.rating import (  # type: ignore
        RatingService,
        StudentRatingFetchResult,
        extract_rating_speciality_name,
        matches_rating_speciality,
    )
    from telegram_bot import (  # type: ignore
        TelegramBotApp,
        TelegramBotError,
        WEBHOOK_PATH,
        build_webhook_url,
        load_webhook_config,
        matches_webhook_secret,
    )
    from user_profiles import (  # type: ignore
        ProfileValidationError,
        UserProfile,
        UserProfileStore,
    )


load_project_env()


JsonValue = Any
Fetcher = Callable[[str, dict[str, str]], JsonValue]
NowFn = Callable[[], int]
TodayFn = Callable[[], date]
SERVICE_NAME = "front_tg_backend_python"
LOGGER = logging.getLogger(__name__)


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

GRADES_SEARCH_TIMEOUT_MS = 4_000
GRADES_RATING_LIST_TIMEOUT_MS = 60_000
RATING_DIRECTORY_CACHE_TTL_MS = 3_600_000
TIMEOUT_ERROR_MARKERS = (
    "timed out",
    "timeout",
    "время ожидания",
    "time out",
)
ORDERED_WEEKDAYS = tuple(
    day_name
    for day_name, _ in sorted(
        RUSSIAN_WEEKDAY_TO_INDEX.items(),
        key=lambda item: item[1],
    )
)
INDEX_TO_RUSSIAN_WEEKDAY = {
    index: day_name for day_name, index in RUSSIAN_WEEKDAY_TO_INDEX.items()
}
SUPPORTED_SCHEDULE_VIEWS = frozenset({"day", "week", "month", "semester"})
LESSON_TYPE_ALIASES = {
    "лк": "lecture",
    "лек": "lecture",
    "лекция": "lecture",
    "пз": "practice",
    "практика": "practice",
    "сем": "practice",
    "сз": "practice",
    "лр": "lab",
    "лб": "lab",
    "лаб": "lab",
    "лабораторная": "lab",
}
GRADES_EXECUTOR = ThreadPoolExecutor(max_workers=4)


def load_config() -> AppConfig:
    return AppConfig(
        host=parse_string_env("HOST", "127.0.0.1") or "127.0.0.1",
        port=parse_number_env("PORT", 8787),
        iis_base_url=parse_string_env(
            "IIS_BASE_URL",
            "https://iis.bsuir.by/api/v1",
        )
        or "https://iis.bsuir.by/api/v1",
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

    merged_config = vars(CONFIG).copy()
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
    return not any(
        marker in normalized_message for marker in TIMEOUT_ERROR_MARKERS
    )


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


def unwrap_value_list(payload: Any) -> list[Any] | None:
    if isinstance(payload, list):
        return payload

    if not isinstance(payload, dict):
        return None

    items = payload.get("value")
    return items if isinstance(items, list) else None


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


def first_non_empty_field(raw: Mapping[str, Any], *fields: str) -> str | None:
    return first_non_empty_string(*(raw.get(field) for field in fields))


def first_list_field(raw: Mapping[str, Any], *fields: str) -> list[Any] | None:
    for field in fields:
        value = raw.get(field)
        if isinstance(value, list):
            return value

    return None


def normalize_lookup_value(value: Any) -> str:
    if value is None:
        return ""
    return "".join(str(value).split()).lower()


def split_employee_name_parts(value: Any) -> list[str]:
    if value is None:
        return []

    normalized = str(value).strip().replace("Ё", "Е").replace("ё", "е")
    if not normalized:
        return []

    return [
        part
        for part in re.split(r"[\s,.;:()/_-]+", normalized)
        if part
    ]


def normalize_employee_search_value(value: Any) -> str:
    return "".join(
        part.casefold() for part in split_employee_name_parts(value)
    )


def build_employee_search_signature(value: Any) -> str:
    parts = split_employee_name_parts(value)
    if not parts:
        return ""

    surname = parts[0].casefold()
    initials = "".join(
        part[:1].casefold() for part in parts[1:] if part
    )
    return f"{surname}{initials}"


def build_employee_search_candidates(query_value: str) -> list[str]:
    trimmed = query_value.strip()
    if not trimmed:
        return []

    candidates: list[str] = []
    seen: set[str] = set()

    def add_candidate(candidate: str) -> None:
        normalized_candidate = candidate.strip()
        if not normalized_candidate:
            return
        key = normalized_candidate.casefold()
        if key in seen:
            return
        seen.add(key)
        candidates.append(normalized_candidate)

    add_candidate(trimmed)

    parts = split_employee_name_parts(trimmed)
    if not parts:
        return candidates

    add_candidate(" ".join(parts))

    if len(parts) > 1:
        add_candidate(f"{parts[0]} {''.join(parts[1:])}")

    add_candidate(parts[0])
    return candidates


def employee_matches_search_query(full_name: Any, query_value: str) -> bool:
    normalized_query = normalize_employee_search_value(query_value)
    if not normalized_query:
        return True

    normalized_name = normalize_employee_search_value(full_name)
    if normalized_name.startswith(normalized_query):
        return True

    query_signature = build_employee_search_signature(query_value)
    if not query_signature:
        return False

    name_signature = build_employee_search_signature(full_name)
    return name_signature.startswith(query_signature)


def first_finite_number(*values: Any) -> float | None:
    for value in values:
        if isinstance(value, bool):
            continue
        if isinstance(value, (int, float)) and math.isfinite(value):
            return float(value)
        if isinstance(value, str):
            normalized_value = value.replace(",", ".").strip()
            if not normalized_value:
                continue

            try:
                numeric_value = float(normalized_value)
            except ValueError:
                continue

            if math.isfinite(numeric_value):
                return numeric_value
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


def normalize_schedule_view(value: Any) -> str:
    if not isinstance(value, str):
        return "week"

    normalized = value.strip().lower()
    return normalized if normalized in SUPPORTED_SCHEDULE_VIEWS else "week"


def parse_iso_date(raw_value: Any) -> date | None:
    if not isinstance(raw_value, str) or not raw_value.strip():
        return None

    try:
        return datetime.strptime(raw_value.strip(), "%Y-%m-%d").date()
    except ValueError:
        return None


def week_start(value: date) -> date:
    return value - timedelta(days=value.weekday())


def resolve_schedule_semester_end(payload: Any, reference_date: date) -> date:
    schedules = payload.get("schedules") if isinstance(payload, dict) else None
    if not isinstance(schedules, dict):
        return reference_date

    latest_date: date | None = None

    for raw_lessons in schedules.values():
        if not isinstance(raw_lessons, list):
            continue

        for raw_lesson in raw_lessons:
            if not isinstance(raw_lesson, dict):
                continue

            for candidate in (
                parse_dot_date(raw_lesson.get("endLessonDate")),
                parse_dot_date(raw_lesson.get("dateLesson")),
                parse_dot_date(raw_lesson.get("startLessonDate")),
            ):
                if candidate is None or candidate < reference_date:
                    continue

                if latest_date is None or candidate > latest_date:
                    latest_date = candidate

    return latest_date or reference_date


def schedule_week_for_date(
    current_week: int,
    today_value: date,
    lesson_date: date,
) -> int:
    base_monday = week_start(today_value)
    lesson_monday = week_start(lesson_date)
    offset_weeks = (lesson_monday - base_monday).days // 7
    return ((current_week - 1 + offset_weeks) % 4) + 1


def resolve_schedule_range(
    reference_date: date,
    view: str,
    payload: Any | None = None,
) -> tuple[date, date]:
    normalized_view = normalize_schedule_view(view)

    if normalized_view == "day":
        return reference_date, reference_date

    if normalized_view == "semester":
        return reference_date, resolve_schedule_semester_end(payload, reference_date)

    if normalized_view == "month":
        month_start = reference_date.replace(day=1)
        if reference_date.month == 12:
            next_month = reference_date.replace(
                year=reference_date.year + 1,
                month=1,
                day=1,
            )
        else:
            next_month = reference_date.replace(
                month=reference_date.month + 1,
                day=1,
            )
        return month_start, next_month - timedelta(days=1)

    start = week_start(reference_date)
    return start, start + timedelta(days=6)


def iterate_schedule_dates(start_date: date, end_date: date) -> list[date]:
    days: list[date] = []
    current = start_date
    while current <= end_date:
        days.append(current)
        current += timedelta(days=1)
    return days


def weekday_name_for_date(value: date) -> str | None:
    return INDEX_TO_RUSSIAN_WEEKDAY.get(value.weekday())


def normalize_lesson_kind(raw_type: str | None) -> str:
    normalized = normalize_lookup_value(raw_type)
    for key, lesson_kind in LESSON_TYPE_ALIASES.items():
        if normalized.startswith(key):
            return lesson_kind
    return "other"


def compose_full_name(raw: dict[str, Any]) -> str | None:
    fio = first_non_empty_field(raw, "fio")
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


def normalize_subgroup(value: Any) -> str:
    normalized = str(value).strip() if value is not None else ""
    if normalized in {"1", "2"}:
        return normalized
    return "all"


def extract_lesson_subgroups(raw_lesson: dict[str, Any]) -> set[str]:
    raw_subgroup = first_non_empty_field(
        raw_lesson,
        "numSubgroup",
        "subgroup",
        "subGroup",
    )

    values: list[str] = []
    if isinstance(raw_subgroup, list):
        values = [str(item) for item in raw_subgroup]
    elif raw_subgroup is not None:
        values = [str(raw_subgroup)]

    result: set[str] = set()
    for value in values:
        normalized = value.strip()
        if not normalized:
            continue
        if "1" in normalized:
            result.add("1")
        if "2" in normalized:
            result.add("2")

    return result


def lesson_matches_subgroup(raw_lesson: dict[str, Any], subgroup: str) -> bool:
    if subgroup == "all":
        return True

    lesson_subgroups = extract_lesson_subgroups(raw_lesson)
    if not lesson_subgroups:
        return True

    return subgroup in lesson_subgroups


def normalize_schedule_lesson(
    raw_lesson: dict[str, Any],
    lesson_date: date,
    index: int,
) -> dict[str, Any]:
    subject = (
        first_non_empty_field(raw_lesson, "subjectFullName", "subject")
        or "\u0414\u0438\u0441\u0446\u0438\u043f\u043b\u0438\u043d\u0430"
    )

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

    lesson_type = first_non_empty_field(
        raw_lesson,
        "lessonTypeAbbrev",
        "lessonType",
    )
    start_time = first_non_empty_field(raw_lesson, "startLessonTime") or ""
    end_time = first_non_empty_field(raw_lesson, "endLessonTime") or ""
    date_value = lesson_date.isoformat()
    lesson_subgroups = extract_lesson_subgroups(raw_lesson)
    subgroup = (
        next(iter(lesson_subgroups))
        if len(lesson_subgroups) == 1
        else None
    )

    return {
        "id": str(
            raw_lesson.get("id")
            or f"{date_value}-{start_time}-{subject}-{room or 'room'}-{index}"
        ),
        "subject": subject,
        "teacher": teacher,
        "room": room,
        "type": lesson_type,
        "typeLabel": lesson_type,
        "typeKey": normalize_lesson_kind(lesson_type),
        "startTime": start_time,
        "endTime": end_time,
        "date": date_value,
        "subgroup": subgroup,
    }


def normalize_schedule_response(
    payload: Any,
    current_week: int,
    today_value: date,
    *,
    reference_date: date | None = None,
    view: str = "week",
    subgroup: str = "all",
) -> dict[str, Any]:
    schedules = payload.get("schedules") if isinstance(payload, dict) else None
    normalized_view = normalize_schedule_view(view)
    target_date = reference_date or today_value
    range_start, range_end = resolve_schedule_range(
        target_date,
        normalized_view,
        payload,
    )

    if not isinstance(schedules, dict):
        return {
            "view": normalized_view,
            "rangeStart": range_start.isoformat(),
            "rangeEnd": range_end.isoformat(),
            "days": [],
        }

    days = []

    for lesson_date in iterate_schedule_dates(range_start, range_end):
        day_name = weekday_name_for_date(lesson_date)
        raw_lessons = schedules.get(day_name) if day_name is not None else None
        lessons = []
        lesson_week = schedule_week_for_date(
            current_week,
            today_value,
            lesson_date,
        )

        if isinstance(raw_lessons, list):
            for index, item in enumerate(raw_lessons):
                if not isinstance(item, dict):
                    continue
                if not lesson_matches_week(item, lesson_week):
                    continue
                if not lesson_matches_date(item, lesson_date):
                    continue
                if not lesson_matches_subgroup(item, subgroup):
                    continue
                lessons.append(
                    normalize_schedule_lesson(item, lesson_date, index)
                )

        lessons.sort(key=lambda lesson: (lesson["startTime"], lesson["subject"]))
        days.append({"date": lesson_date.isoformat(), "lessons": lessons})

    return {
        "view": normalized_view,
        "rangeStart": range_start.isoformat(),
        "rangeEnd": range_end.isoformat(),
        "days": days,
    }


def normalize_employees_response(
    payload: Any,
    config: AppConfig | Mapping[str, Any],
) -> list[dict[str, Any]]:
    items = unwrap_value_list(payload) or payload
    if not isinstance(items, list):
        return []

    base_url = coerce_config(config).iis_base_url.rstrip("/")
    result = []

    for item in items:
        if not isinstance(item, dict):
            continue

        full_name = compose_full_name(item) or "\u041f\u0440\u0435\u043f\u043e\u0434\u0430\u0432\u0430\u0442\u0435\u043b\u044c"
        raw_employee_id = item.get("id")
        if raw_employee_id is None:
            raw_employee_id = item.get("employeeId")
        employee_id = (
            str(raw_employee_id).strip()
            if raw_employee_id is not None and str(raw_employee_id).strip()
            else None
        )
        raw_url_id = item.get("urlId")
        if raw_url_id is None:
            raw_url_id = item.get("urlID")
        if raw_url_id is None:
            raw_url_id = item.get("url_id")
        url_id = (
            str(raw_url_id).strip()
            if raw_url_id is not None and str(raw_url_id).strip()
            else None
        )
        avatar_url = first_non_empty_field(item, "photoLink")

        if avatar_url is None and employee_id is not None:
            avatar_url = f"{base_url}/employees/photo/{employee_id}"

        normalized_url_id = url_id or employee_id
        normalized_employee_id = employee_id or normalized_url_id

        result.append(
            {
                "id": str(normalized_url_id or full_name),
                "employeeId": str(normalized_employee_id or full_name),
                "urlId": str(normalized_url_id or normalized_employee_id or full_name),
                "fullName": full_name,
                "position": first_non_empty_field(
                    item,
                    "jobPosition",
                    "position",
                    "rank",
                    "degree",
                ),
                "department": first_non_empty_field(item, "academicDepartment"),
                "avatarUrl": avatar_url,
            }
        )

    return result


def normalize_auditories_response(payload: Any, query: str) -> list[dict[str, Any]]:
    items = unwrap_value_list(payload) or payload
    if not isinstance(items, list):
        return []

    normalized_query = normalize_lookup_value(query)
    ranked_result: list[tuple[bool, str, dict[str, Any]]] = []

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
        name = first_non_empty_field(item, "name")

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

        ranked_result.append(
            (
                not normalize_lookup_value(full_name).startswith(normalized_query),
                full_name,
                {
                    "id": str(item.get("id", full_name)),
                    "name": name,
                    "building": building_name,
                    "fullName": full_name,
                    "type": type_name,
                    "typeAbbrev": type_abbrev,
                    "capacity": item.get("capacity"),
                    "department": department_name,
                    "note": first_non_empty_field(item, "note"),
                },
            )
        )

    ranked_result.sort(key=lambda item: (item[0], item[1]))
    return [item[2] for item in ranked_result[:50]]


def normalize_room_token(value: str) -> str:
    return (
        value.lower()
        .replace(" ", "")
        .replace(",", "")
        .replace(".", "")
        .replace("-", "")
        .replace("корпус", "к")
    )


def extract_room_digits(value: str) -> str:
    return "".join(character for character in value if character.isdigit())


def get_auditory_tokens(auditory: Mapping[str, Any]) -> list[str]:
    building_value = first_non_empty_string(auditory.get("building"))
    building_digits = ""
    room_name = first_non_empty_string(auditory.get("name"))
    if isinstance(building_value, str):
        matches = [character for character in building_value if character.isdigit()]
        building_digits = "".join(matches)

    tokens = [
        first_non_empty_string(auditory.get("fullName")),
        room_name,
        "-".join(
            part
            for part in (
                room_name,
                building_value,
            )
            if part
        ),
    ]

    if building_digits and room_name:
        tokens.append(f"{room_name}-{building_digits}к")
        tokens.append(f"{room_name}{building_digits}")

    return [normalize_room_token(token) for token in tokens if isinstance(token, str) and token]


def lesson_matches_auditory(room_value: str | None, auditory_tokens: list[str]) -> bool:
    if room_value is None:
        return False

    room_tokens = [
        normalize_room_token(item)
        for item in room_value.split(",")
        if isinstance(item, str) and item.strip()
    ]
    auditory_digit_tokens = [
        extract_room_digits(token) for token in auditory_tokens if extract_room_digits(token)
    ]

    for room_token in room_tokens:
        room_digits = extract_room_digits(room_token)
        for auditory_token in auditory_tokens:
            if (
                room_token == auditory_token
                or room_token in auditory_token
                or auditory_token in room_token
            ):
                return True
        if room_digits and room_digits in auditory_digit_tokens:
            return True

    return False


def build_date_time(date_key: str, time_value: str) -> datetime | None:
    lesson_date = parse_iso_date(date_key)
    if lesson_date is None:
        return None

    if not isinstance(time_value, str):
        return None

    parts = time_value.split(":")
    if len(parts) != 2:
        return None

    try:
        hour = int(parts[0])
        minute = int(parts[1])
    except ValueError:
        return None

    return datetime(
        lesson_date.year,
        lesson_date.month,
        lesson_date.day,
        hour,
        minute,
    )


def normalize_free_auditories_response(
    auditories_payload: Any,
    schedule_payload: Mapping[str, Any],
    query: str,
    now_value: datetime,
) -> dict[str, Any]:
    auditories = normalize_auditories_response(auditories_payload, query)
    days = schedule_payload.get("days") if isinstance(schedule_payload, dict) else None
    if not isinstance(days, list):
        days = []

    free_items = []

    for auditory in auditories:
        if not isinstance(auditory, dict):
            continue

        auditory_tokens = get_auditory_tokens(auditory)
        current_lesson = None
        next_lesson = None

        for day in days:
            if not isinstance(day, dict):
                continue

            day_key = first_non_empty_field(day, "date")
            lessons = day.get("lessons")
            if day_key is None or not isinstance(lessons, list):
                continue

            for lesson in lessons:
                if not isinstance(lesson, dict):
                    continue
                if not lesson_matches_auditory(
                    first_non_empty_field(lesson, "room"),
                    auditory_tokens,
                ):
                    continue

                start_value = build_date_time(
                    day_key,
                    first_non_empty_field(lesson, "startTime") or "",
                )
                end_value = build_date_time(
                    day_key,
                    first_non_empty_field(lesson, "endTime") or "",
                )
                if start_value is None or end_value is None:
                    continue

                if start_value <= now_value <= end_value:
                    current_lesson = {
                        "subject": first_non_empty_field(lesson, "subject"),
                        "date": day_key,
                        "startTime": first_non_empty_field(lesson, "startTime"),
                        "endTime": first_non_empty_field(lesson, "endTime"),
                    }
                    break

                if now_value < start_value and next_lesson is None:
                    next_lesson = {
                        "subject": first_non_empty_field(lesson, "subject"),
                        "date": day_key,
                        "startTime": first_non_empty_field(lesson, "startTime"),
                        "endTime": first_non_empty_field(lesson, "endTime"),
                    }

            if current_lesson is not None:
                break

        if current_lesson is not None:
            continue

        free_items.append(
            {
                **auditory,
                "nextBusyLesson": next_lesson,
            }
        )

    return {
        "generatedAt": now_value.isoformat(),
        "items": free_items,
    }


def find_student_card_match(
    payload: Any,
    student_card_number: str,
) -> dict[str, Any] | None:
    normalized_student_card_number = normalize_lookup_value(student_card_number)

    if isinstance(payload, dict):
        wrapped = unwrap_value_list(payload)
        if wrapped is not None:
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


def merge_grade_summaries(*summaries: Mapping[str, Any] | None) -> dict[str, Any] | None:
    merged: dict[str, Any] = {}

    for summary in summaries:
        if not isinstance(summary, Mapping):
            continue

        average = first_finite_number(summary.get("average"))
        if average is not None and "average" not in merged:
            merged["average"] = average

        position = first_finite_number(summary.get("position"))
        if position is not None and "position" not in merged:
            merged["position"] = int(position)

        speciality = first_non_empty_string(summary.get("speciality"))
        if speciality is not None and "speciality" not in merged:
            merged["speciality"] = speciality

    return merged or None


def infer_course_from_group(student_group: str | None) -> int | None:
    if not isinstance(student_group, str):
        return None

    normalized_group = student_group.strip()
    if not normalized_group or not normalized_group[0].isdigit():
        return None

    course = int(normalized_group[0])
    return course if 1 <= course <= 6 else None


def normalize_course_values(payload: Any) -> list[int]:
    items = unwrap_value_list(payload) or payload
    if not isinstance(items, list):
        return []

    normalized_courses: list[int] = []
    for item in items:
        if not isinstance(item, dict):
            continue

        course = first_finite_number(item.get("course"))
        if course is None:
            continue

        course_value = int(course)
        if course_value not in normalized_courses:
            normalized_courses.append(course_value)

    return normalized_courses


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


def extract_marks_from_item(
    raw: Mapping[str, Any],
    *,
    raw_mark_fields: tuple[str, ...],
    average_fields: tuple[str, ...],
    date_fields: tuple[str, ...] = (),
) -> list[dict[str, Any]]:
    mark_date = first_non_empty_field(raw, *date_fields) if date_fields else None
    raw_marks = first_list_field(raw, *raw_mark_fields)
    marks: list[dict[str, Any]] = []

    if raw_marks is not None:
        for raw_mark in raw_marks:
            normalized_mark = normalize_mark(raw_mark)
            if normalized_mark is None:
                continue

            if mark_date is not None and "date" not in normalized_mark:
                normalized_mark = {**normalized_mark, "date": mark_date}

            marks.append(normalized_mark)

    if marks:
        return marks

    average_mark = first_finite_number(*(raw.get(field) for field in average_fields))
    if average_mark is None:
        return []

    mark: dict[str, Any] = {"value": average_mark}
    if mark_date is not None:
        mark["date"] = mark_date

    return [mark]


def extract_grade_subject_name(
    raw: Mapping[str, Any],
    index: int,
    *fields: str,
) -> tuple[str, str]:
    subject_name = first_non_empty_field(raw, *fields) or "Дисциплина"
    subject_key = normalize_lookup_value(subject_name) or str(index)
    return subject_name, subject_key


def extract_grade_teacher(raw: Mapping[str, Any]) -> str | None:
    return first_non_empty_field(raw, "teacher", "employee", "fio")


def iter_nested_dicts(payload: Any, *, max_depth: int = 5) -> list[dict[str, Any]]:
    queue: list[tuple[Any, int]] = [(payload, 0)]
    items: list[dict[str, Any]] = []

    while queue:
        current, depth = queue.pop(0)

        if isinstance(current, dict):
            items.append(current)
            if depth >= max_depth:
                continue
            queue.extend((value, depth + 1) for value in current.values())
            continue

        if isinstance(current, list) and depth < max_depth:
            queue.extend((value, depth + 1) for value in current)

    return items


def extract_grade_summary_from_record(payload: Mapping[str, Any]) -> dict[str, Any] | None:
    average = first_finite_number(
        payload.get("average"),
        payload.get("avgRating"),
        payload.get("averageMark"),
        payload.get("avgMark"),
        payload.get("averageScore"),
        payload.get("gpa"),
    )
    position = first_finite_number(
        payload.get("position"),
        payload.get("ratingPlace"),
        payload.get("place"),
        payload.get("rank"),
        payload.get("ratingPosition"),
    )
    speciality = first_non_empty_field(
        payload,
        "speciality",
        "specialty",
        "specialityAbbrev",
        "specialityName",
        "specialization",
        "specializationName",
        "specAbbrev",
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


def is_probable_subject_grade_record(payload: Mapping[str, Any]) -> bool:
    subject_markers = {
        "subject",
        "discipline",
        "disciplineName",
        "lessonName",
        "lessonNameAbbrev",
        "lessonNameFull",
        "marks",
        "grades",
        "controlPoints",
    }
    return any(marker in payload for marker in subject_markers)


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
        lesson_items = first_list_field(candidates, "lessons")
        if lesson_items is not None:
            grouped_subjects: dict[str, dict[str, Any]] = {}

            for index, item in enumerate(lesson_items):
                if not isinstance(item, dict):
                    continue

                marks = extract_marks_from_item(
                    item,
                    raw_mark_fields=("marks",),
                    average_fields=("averageMark", "avgMark", "mark", "value"),
                    date_fields=("dateString", "date"),
                )
                if not marks:
                    continue

                subject_name, subject_key = extract_grade_subject_name(
                    item,
                    index,
                    "lessonName",
                    "lessonNameFull",
                    "lessonNameAbbrev",
                    "subject",
                    "discipline",
                    "disciplineName",
                    "name",
                    "title",
                )
                teacher = extract_grade_teacher(item)
                subject = grouped_subjects.setdefault(
                    subject_key,
                    {
                        "id": str(item.get("id", subject_key)),
                        "subject": subject_name,
                        "teacher": teacher,
                        "marks": [],
                    },
                )
                if subject["teacher"] is None and teacher is not None:
                    subject["teacher"] = teacher
                subject["marks"].extend(marks)

            result = list(grouped_subjects.values())
            result.sort(key=lambda item: item["subject"])
            return result

        candidates = (
            first_list_field(
                candidates,
                "subjects",
                "disciplines",
                "items",
                "results",
                "ratingItems",
                "value",
            )
            or []
        )

    if not isinstance(candidates, list):
        return []

    subjects = []

    for index, item in enumerate(candidates):
        if not isinstance(item, dict):
            continue

        subject_name, _ = extract_grade_subject_name(
            item,
            index,
            "subject",
            "name",
            "discipline",
            "disciplineName",
            "title",
        )
        marks = extract_marks_from_item(
            item,
            raw_mark_fields=("marks", "grades", "controlPoints", "points", "values"),
            average_fields=("averageMark", "avgMark", "mark", "value"),
        )

        subjects.append(
            {
                "id": str(item.get("id", index)),
                "subject": subject_name,
                "teacher": extract_grade_teacher(item),
                "marks": marks,
            }
        )

    return subjects


def calculate_subject_marks_average(subjects: list[Mapping[str, Any]]) -> float | None:
    marks_total = 0.0
    marks_count = 0

    for subject in subjects:
        marks = subject.get("marks")
        if not isinstance(marks, list):
            continue

        for mark in marks:
            numeric_value = None
            if isinstance(mark, Mapping):
                numeric_value = first_finite_number(mark.get("value"))
            else:
                numeric_value = first_finite_number(mark)

            if numeric_value is None:
                continue

            marks_total += numeric_value
            marks_count += 1

    if marks_count == 0:
        return None

    return marks_total / marks_count


def extract_grade_summary(payload: Any) -> dict[str, Any] | None:
    payload = unwrap_grade_payload(payload)

    candidates = iter_nested_dicts(payload)
    if not candidates:
        return None

    best_summary: dict[str, Any] | None = None
    best_score = 0

    for index, candidate in enumerate(candidates):
        summary = extract_grade_summary_from_record(candidate)
        if summary is None:
            continue

        score = len(summary)

        if score == 1 and index > 0 and is_probable_subject_grade_record(candidate):
            continue

        if score > best_score:
            best_summary = summary
            best_score = score

        if best_score == 3:
            break

    return best_summary


def normalize_grades_response(
    student_card_number: str,
    search_payload: Any,
    rating_payload: Any,
    extra_summary: Mapping[str, Any] | None = None,
    warning: str | None = None,
) -> dict[str, Any]:
    matched_student = find_student_card_match(search_payload, student_card_number)
    subjects = extract_grade_subjects(rating_payload)
    search_summary = extract_grade_summary(matched_student)
    rating_summary = extract_grade_summary(rating_payload)
    average = calculate_subject_marks_average(subjects)
    position = (
        first_finite_number(extra_summary.get("position"))
        if isinstance(extra_summary, Mapping)
        else None
    )
    speciality = first_non_empty_string(
        extra_summary.get("speciality") if isinstance(extra_summary, Mapping) else None,
        rating_summary.get("speciality") if rating_summary is not None else None,
        search_summary.get("speciality") if search_summary is not None else None,
    )

    summary = None
    if average is not None or position is not None or speciality is not None:
        summary = {}
        if average is not None:
            summary["average"] = average
        if position is not None:
            summary["position"] = int(position)
        if speciality is not None:
            summary["speciality"] = speciality

    response = {
        "summary": summary,
        "subjects": subjects,
    }

    if warning is not None:
        response["warning"] = warning

    return response



def parse_json_request_body(body: bytes | None) -> dict[str, Any]:
    if not body:
        raise ProfileValidationError("Request body is required")

    try:
        payload = json.loads(body.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ProfileValidationError("Request body must be valid JSON") from error

    if not isinstance(payload, dict):
        raise ProfileValidationError("JSON body must be an object")

    return payload


def first_query_value(parsed_url: Any, *names: str) -> str | None:
    query = parse_qs(parsed_url.query)
    for name in names:
        value = query.get(name, [None])[0]
        if not isinstance(value, str):
            continue
        normalized = value.strip()
        if normalized:
            return normalized
    return None


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
        profile_store: UserProfileStore | None = None,
    ) -> None:
        self.config = self._resolve_config(config)
        self.store = {} if store is None else store
        self.fetcher = fetcher or create_fetcher(self.config)
        self.uses_default_fetcher = fetcher is None
        self.now_ms = now_ms or (lambda: int(time.time() * 1000))
        self.today = today or (lambda: datetime.now().date())
        self.started_at_ms = self.now_ms()
        self.lock = Lock()
        self.profile_store = profile_store or UserProfileStore()
        self._inflight_requests: dict[str, Future[JsonValue]] = {}
        self._timeout_fetchers: dict[int, Fetcher] = {}
        self.rating_service = RatingService(
            request_upstream=self.request_upstream,
            request_upstream_with_timeout=lambda path, params, timeout_ms, max_retries: self.request_upstream_with_timeout(
                path,
                params,
                timeout_ms=timeout_ms,
                max_retries=max_retries,
            ),
            now_ms=self.now_ms,
            lock=self.lock,
            request_timeout_ms=self.config.request_timeout_ms,
            upstream_error_cls=UpstreamRequestError,
        )
        self._route_payload_builders = {
            "employees": self._build_employees_payload,
            "auditories": self._build_auditories_payload,
            "grades": self._build_grades_payload,
        }
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

    def _timeout_fetcher(self, timeout_ms: int) -> Fetcher:
        if not self.uses_default_fetcher:
            return self.fetcher

        normalized_timeout = max(timeout_ms, 1)

        with self.lock:
            fetcher = self._timeout_fetchers.get(normalized_timeout)
            if fetcher is None:
                fetcher = create_fetcher(
                    replace(
                        self.config,
                        request_timeout_ms=normalized_timeout,
                    )
                )
                self._timeout_fetchers[normalized_timeout] = fetcher

        return fetcher

    def request_upstream_with_timeout(
        self,
        path: str,
        params: dict[str, str],
        *,
        timeout_ms: int,
        max_retries: int,
    ) -> JsonValue:
        return fetch_with_retry(
            self._timeout_fetcher(timeout_ms),
            path,
            params,
            max_retries,
            self.config.retry_delay_ms,
        )

    def _request_grades_search(self, student_card_number: str) -> JsonValue:
        return self.rating_service.request_grades_search(student_card_number)

    def _get_rating_speciality_index(self) -> list[dict[str, str]]:
        return self.rating_service.get_rating_speciality_index()

    def _get_rating_courses(self, faculty_id: str, speciality_id: str) -> list[int]:
        return self.rating_service.get_rating_courses(faculty_id, speciality_id)

    def _find_group_info(self, student_group: str) -> dict[str, Any] | None:
        return self.rating_service.find_group_info(student_group)

    def _find_group_rating_summary(
        self,
        student_card_number: str,
        student_group: str | None,
    ) -> dict[str, Any] | None:
        return self.rating_service.find_group_rating_summary(
            student_card_number,
            student_group,
        )

    def _find_student_rating_summary(
        self,
        student_card_number: str,
        student_group: str | None,
    ) -> dict[str, Any] | None:
        return self.rating_service.find_student_rating_summary(
            student_card_number,
            student_group,
        )

    def _fetch_current_week(self) -> int:
        return normalize_current_week(
            self.request_upstream("/schedule/current-week", {})
        )

    def _request_teacher_schedule(
        self,
        url_id: str,
        employee_id: str | None = None,
    ) -> JsonValue:
        candidate_paths = [f"/employees/schedule/{quote(url_id, safe='')}"]

        if employee_id and employee_id != url_id:
            candidate_paths.append(
                f"/employees/schedule/{quote(employee_id, safe='')}"
            )

        last_error: UpstreamRequestError | None = None
        for path in candidate_paths:
            try:
                return self.request_upstream(path, {})
            except UpstreamRequestError as error:
                last_error = error
                if error.status != 404:
                    raise

        raise last_error or UpstreamRequestError("Teacher schedule not found", status=404)

    def _build_schedule_payload(
        self,
        query_value: str,
    ) -> JsonValue:
        return self._build_schedule_payload_for_request(student_group=query_value)

    def _build_schedule_payload_for_request(
        self,
        *,
        student_group: str | None = None,
        teacher_url_id: str | None = None,
        teacher_employee_id: str | None = None,
        reference_date: date | None = None,
        view: str = "week",
        subgroup: str = "all",
    ) -> JsonValue:
        today_value = self.today()
        normalized_view = normalize_schedule_view(view)

        if student_group is not None:
            schedule_payload = self.request_upstream(
                "/schedule",
                {"studentGroup": student_group},
            )
        elif teacher_url_id is not None:
            schedule_payload = self._request_teacher_schedule(
                teacher_url_id,
                teacher_employee_id,
            )
        else:
            raise UpstreamRequestError(
                "Either studentGroup or teacherUrlId is required",
                status=400,
            )

        return normalize_schedule_response(
            schedule_payload,
            self._fetch_current_week(),
            today_value,
            reference_date=reference_date or today_value,
            view=normalized_view,
            subgroup=normalize_subgroup(subgroup),
        )

    def _build_free_auditories_payload(
        self,
        *,
        query_value: str,
        student_group: str | None = None,
        teacher_url_id: str | None = None,
        teacher_employee_id: str | None = None,
    ) -> JsonValue:
        schedule_payload = self._build_schedule_payload_for_request(
            student_group=student_group,
            teacher_url_id=teacher_url_id,
            teacher_employee_id=teacher_employee_id,
            reference_date=self.today(),
            view="week",
        )
        auditories_payload = self.request_upstream("/auditories", {})
        now_value = datetime.fromtimestamp(self.now_ms() / 1000)
        return normalize_free_auditories_response(
            auditories_payload,
            schedule_payload,
            query_value,
            now_value,
        )

    def _build_employees_payload(self, query_value: str) -> JsonValue:
        search_candidates = build_employee_search_candidates(query_value)

        for index, candidate in enumerate(search_candidates):
            employees_payload = self.request_upstream(
                "/employees/fio",
                {"employee-fio": candidate},
            )
            normalized_payload = normalize_employees_response(
                employees_payload,
                self.config,
            )

            if not normalized_payload:
                continue

            if index == 0:
                return normalized_payload

            filtered_payload = [
                employee
                for employee in normalized_payload
                if employee_matches_search_query(
                    employee.get("fullName"),
                    query_value,
                )
            ]
            if filtered_payload:
                return filtered_payload

        return []

    def _build_auditories_payload(self, query_value: str) -> JsonValue:
        auditories_payload = self.request_upstream("/auditories", {})
        return normalize_auditories_response(auditories_payload, query_value)

    def _build_grades_payload(
        self,
        query_value: str,
        *,
        student_group: str | None = None,
        resolve_student_card_summary: bool = False,
    ) -> JsonValue:
        search_payload = None
        rating_payload = None
        search_error: UpstreamRequestError | None = None
        rating_error: UpstreamRequestError | None = None
        extra_summary = None

        if student_group is not None:
            summary_builder = (
                self._find_student_rating_summary
                if resolve_student_card_summary
                else self._find_group_rating_summary
            )
            futures = {
                "rating": GRADES_EXECUTOR.submit(
                    self.request_upstream,
                    "/rating/studentRating",
                    {"studentCardNumber": query_value},
                ),
                "summary": GRADES_EXECUTOR.submit(
                    summary_builder,
                    query_value,
                    student_group,
                ),
            }

            for key, future in futures.items():
                try:
                    result = future.result()
                except UpstreamRequestError as error:
                    if key == "rating":
                        rating_error = error
                    continue

                if key == "rating":
                    rating_payload = result
                else:
                    extra_summary = result

            if rating_payload is None:
                try:
                    search_payload = self._request_grades_search(query_value)
                except UpstreamRequestError as error:
                    search_error = error
        else:
            summary_error: UpstreamRequestError | None = None

            if resolve_student_card_summary:
                futures = {
                    "sources": GRADES_EXECUTOR.submit(
                        self.rating_service.fetch_student_rating_sources,
                        query_value,
                    ),
                    "summary": GRADES_EXECUTOR.submit(
                        self._find_student_rating_summary,
                        query_value,
                        None,
                    ),
                }

                for key, future in futures.items():
                    try:
                        result = future.result()
                    except UpstreamRequestError as error:
                        if key == "summary":
                            summary_error = error
                        else:
                            raise
                        continue

                    if key == "summary":
                        extra_summary = result
                        continue

                    fetch_result = result
                    search_payload = fetch_result.search_payload
                    rating_payload = fetch_result.rating_payload
                    search_error = fetch_result.search_error
                    rating_error = fetch_result.rating_error
            else:
                fetch_result = self.rating_service.fetch_student_rating_sources(
                    query_value
                )
                search_payload = fetch_result.search_payload
                rating_payload = fetch_result.rating_payload
                search_error = fetch_result.search_error
                rating_error = fetch_result.rating_error

            if summary_error is not None:
                LOGGER.warning(
                    "Student rating summary lookup failed for %s: %s",
                    query_value,
                    summary_error.message,
                )

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

        if student_group is None and not resolve_student_card_summary:
            extra_summary = self._find_group_rating_summary(query_value, student_group)

        return normalize_grades_response(
            query_value,
            search_payload,
            rating_payload,
            extra_summary=extra_summary,
            warning=warning,
        )

    def build_route_payload(self, route: RouteConfig, query_value: str) -> JsonValue:
        builder = self._route_payload_builders.get(route.kind)

        if builder is None:
            raise UpstreamRequestError("Unsupported route", status=500)

        return builder(query_value)

    @staticmethod
    def _extract_query_value(parsed_url: Any, route: RouteConfig) -> str | None:
        query_value = parse_qs(parsed_url.query).get(route.query_param, [None])[0]

        if query_value is None:
            return None

        normalized = query_value.strip()
        if len(normalized) < route.min_length:
            return None

        return normalized

    def _serve_cached_payload(
        self,
        cache_key_value: str,
        builder: Callable[[], JsonValue],
    ) -> Response:
        now_value = self.now_ms()
        cached = self._read_fresh_cache(cache_key_value, now_value)

        if cached is not None:
            return Response(200, cached)

        inflight_request, is_leader = self._get_or_create_inflight_request(
            cache_key_value
        )

        if not is_leader:
            try:
                return Response(200, inflight_request.result())
            except UpstreamRequestError as error:
                return self._upstream_error_response(error)

        try:
            payload = builder()
            self._write_cached_payload(cache_key_value, payload)
            inflight_request.set_result(payload)
            return Response(200, payload)
        except UpstreamRequestError as error:
            stale_payload = self._read_stale_cache(
                cache_key_value,
                self.now_ms(),
            )

            if stale_payload is not None:
                inflight_request.set_result(stale_payload)
                return Response(200, stale_payload)

            inflight_request.set_exception(error)
            return self._upstream_error_response(error)
        except Exception as error:
            inflight_request.set_exception(error)
            raise
        finally:
            self._clear_inflight_request(cache_key_value, inflight_request)

    def _handle_profile_request(
        self,
        method: str,
        parsed_url: Any,
        body: bytes | None,
    ) -> Response:
        if method == "GET":
            telegram_user_id = first_query_value(parsed_url, "telegramUserId")
            if telegram_user_id is None:
                return Response(
                    400,
                    {"error": 'Query param "telegramUserId" is required'},
                )

            profile = self.profile_store.get(telegram_user_id)
            if profile is None:
                return Response(404, {"error": "Profile not found"})

            return Response(200, profile.to_dict())

        if method in {"PUT", "POST"}:
            try:
                payload = parse_json_request_body(body)
                profile = UserProfile.from_payload(payload)
            except ProfileValidationError as error:
                return Response(400, {"error": error.message})

            return Response(200, self.profile_store.upsert(profile).to_dict())

        if method == "DELETE":
            telegram_user_id = first_query_value(parsed_url, "telegramUserId")
            if telegram_user_id is None:
                return Response(
                    400,
                    {"error": 'Query param "telegramUserId" is required'},
                )

            self.profile_store.delete(telegram_user_id)
            return Response(200, {"ok": True})

        return Response(405, {"error": "Method not allowed"})

    def _handle_schedule_request(self, parsed_url: Any) -> Response:
        student_group = first_query_value(parsed_url, "studentGroup")
        teacher_url_id = first_query_value(parsed_url, "teacherUrlId", "urlId")
        teacher_employee_id = first_query_value(
            parsed_url,
            "teacherEmployeeId",
            "employeeId",
        )
        subgroup = normalize_subgroup(first_query_value(parsed_url, "subgroup"))

        if student_group is None and teacher_url_id is None:
            return Response(
                400,
                {
                    "error": 'Query param "studentGroup" or "teacherUrlId" is required'
                },
            )

        view = normalize_schedule_view(first_query_value(parsed_url, "view") or "week")
        reference_date = parse_iso_date(first_query_value(parsed_url, "date")) or self.today()
        params = {
            "studentGroup": student_group or "",
            "teacherUrlId": teacher_url_id or "",
            "teacherEmployeeId": teacher_employee_id or "",
            "subgroup": subgroup,
            "view": view,
            "date": reference_date.isoformat(),
        }
        key = cache_key("/schedule", params)

        return self._serve_cached_payload(
            key,
            lambda: self._build_schedule_payload_for_request(
                student_group=student_group,
                teacher_url_id=teacher_url_id,
                teacher_employee_id=teacher_employee_id,
                reference_date=reference_date,
                view=view,
                subgroup=subgroup,
            ),
        )

    def _handle_grades_request(self, parsed_url: Any) -> Response:
        student_card_number = first_query_value(parsed_url, "studentCardNumber")
        if student_card_number is None:
            return Response(
                400,
                {"error": 'Query param "studentCardNumber" is required'},
            )

        student_group = first_query_value(parsed_url, "studentGroup")
        params = {"studentCardNumber": student_card_number}
        if student_group is not None:
            params["studentGroup"] = student_group

        key = cache_key("/grades", params)
        return self._serve_cached_payload(
            key,
            lambda: self._build_grades_payload(
                student_card_number,
                student_group=student_group,
            ),
        )

    def _handle_rating_request(self, parsed_url: Any) -> Response:
        prefix = "/api/rating/"
        student_card_number = parsed_url.path[len(prefix) :].strip("/")
        if not re.fullmatch(r"\d{4,32}", student_card_number):
            return Response(
                400,
                {
                    "error": 'Path param "studentCard" must contain digits only',
                },
            )

        student_group = first_query_value(parsed_url, "studentGroup")
        params = {"studentCardNumber": student_card_number}
        if student_group is not None:
            params["studentGroup"] = student_group

        key = cache_key("/rating", params)
        return self._serve_cached_payload(
            key,
            lambda: self._build_grades_payload(
                student_card_number,
                student_group=student_group,
                resolve_student_card_summary=True,
            ),
        )

    def _handle_employee_search_request(self, parsed_url: Any) -> Response:
        query_value = first_query_value(parsed_url, "query", "q")
        if query_value is None or len(query_value) < 2:
            return Response(
                400,
                {"error": 'Query param "query" is required'},
            )

        key = cache_key("/employees", {"query": query_value})
        return self._serve_cached_payload(
            key,
            lambda: self._build_employees_payload(query_value),
        )

    def _handle_free_auditories_request(self, parsed_url: Any) -> Response:
        query_value = first_query_value(parsed_url, "query", "q") or ""
        student_group = first_query_value(parsed_url, "studentGroup")
        teacher_url_id = first_query_value(parsed_url, "teacherUrlId", "urlId")
        teacher_employee_id = first_query_value(
            parsed_url,
            "teacherEmployeeId",
            "employeeId",
        )

        if student_group is None and teacher_url_id is None:
            return Response(
                400,
                {
                    "error": 'Query param "studentGroup" or "teacherUrlId" is required'
                },
            )

        params = {
            "query": query_value,
            "studentGroup": student_group or "",
            "teacherUrlId": teacher_url_id or "",
            "teacherEmployeeId": teacher_employee_id or "",
        }
        key = cache_key("/free-auditories", params)
        return self._serve_cached_payload(
            key,
            lambda: self._build_free_auditories_payload(
                query_value=query_value,
                student_group=student_group,
                teacher_url_id=teacher_url_id,
                teacher_employee_id=teacher_employee_id,
            ),
        )

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

    def _read_fresh_cache(self, key: str, now_value: int) -> JsonValue | None:
        with self.lock:
            return read_fresh_cache(self.store, key, now_value)

    def _read_stale_cache(self, key: str, now_value: int) -> JsonValue | None:
        with self.lock:
            return read_stale_cache(self.store, key, now_value)

    def _write_cached_payload(self, key: str, payload: JsonValue) -> None:
        with self.lock:
            write_cache(
                self.store,
                key,
                payload,
                self.config.cache_ttl_ms,
                self.config.stale_ttl_ms,
                self.now_ms(),
            )

    def _get_or_create_inflight_request(
        self,
        key: str,
    ) -> tuple[Future[JsonValue], bool]:
        with self.lock:
            future = self._inflight_requests.get(key)
            if future is None:
                future = Future()
                self._inflight_requests[key] = future
                return future, True

        return future, False

    def _clear_inflight_request(self, key: str, future: Future[JsonValue]) -> None:
        with self.lock:
            if self._inflight_requests.get(key) is future:
                self._inflight_requests.pop(key, None)

    @staticmethod
    def _upstream_error_response(error: UpstreamRequestError) -> Response:
        return Response(
            error.status or 502,
            {"error": error.message, "upstreamStatus": error.status},
        )

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

        if parsed_url.path == "/api/profile":
            return self._handle_profile_request(method, parsed_url, body)

        if method not in {"GET", "HEAD"}:
            return Response(405, {"error": "Method not allowed"})

        if parsed_url.path == "/":
            payload: dict[str, Any] = {
                "ok": True,
                "service": SERVICE_NAME,
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
                    "service": SERVICE_NAME,
                    "iisBaseUrl": self.config.iis_base_url,
                    "uptimeMs": self.now_ms() - self.started_at_ms,
                    "cacheEntries": self.cache_entries(),
                },
            )

        if parsed_url.path == "/api/schedule":
            return self._handle_schedule_request(parsed_url)

        if parsed_url.path == "/api/grades":
            return self._handle_grades_request(parsed_url)

        if parsed_url.path.startswith("/api/rating/"):
            return self._handle_rating_request(parsed_url)

        if parsed_url.path in {"/api/search-employee", "/api/employees"}:
            return self._handle_employee_search_request(parsed_url)

        if parsed_url.path == "/api/free-auditories":
            return self._handle_free_auditories_request(parsed_url)

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
        return self._serve_cached_payload(
            key,
            lambda: self.build_route_payload(route, normalized),
        )


CORS_HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
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

    return json.dumps(
        response.payload,
        ensure_ascii=False,
        separators=(",", ":"),
    ).encode("utf-8")


def build_headers_from_scope(scope: Mapping[str, Any]) -> dict[str, str]:
    raw_headers = scope.get("headers") or []
    headers: dict[str, str] = {}

    if not isinstance(raw_headers, (list, tuple)):
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
