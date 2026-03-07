from __future__ import annotations

import logging
import math
import re
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from threading import Lock
from typing import Any, Callable, Mapping


JsonValue = Any
NowFn = Callable[[], int]
RequestUpstream = Callable[[str, dict[str, str]], JsonValue]
RequestUpstreamWithTimeout = Callable[[str, dict[str, str], int, int], JsonValue]

LOGGER = logging.getLogger(__name__)

GRADES_SEARCH_TIMEOUT_MS = 4_000
GRADES_RATING_LIST_TIMEOUT_MS = 60_000
RATING_DIRECTORY_CACHE_TTL_MS = 3_600_000
TIMEOUT_ERROR_MARKERS = (
    "timed out",
    "timeout",
    "РІСЂРµРјСЏ РѕР¶РёРґР°РЅРёСЏ",
    "time out",
)
RATING_EXECUTOR = ThreadPoolExecutor(max_workers=4)


@dataclass
class StudentRatingFetchResult:
    search_payload: JsonValue | None = None
    rating_payload: JsonValue | None = None
    search_error: Exception | None = None
    rating_error: Exception | None = None


def unwrap_value_list(payload: Any) -> list[Any] | None:
    if isinstance(payload, list):
        return payload

    if not isinstance(payload, dict):
        return None

    items = payload.get("value")
    return items if isinstance(items, list) else None


def first_non_empty_string(*values: Any) -> str | None:
    for value in values:
        if isinstance(value, str) and value.strip():
            return value.strip()
    return None


def first_non_empty_field(raw: Mapping[str, Any], *fields: str) -> str | None:
    return first_non_empty_string(*(raw.get(field) for field in fields))


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


def error_message(error: Exception) -> str:
    message = getattr(error, "message", None)
    if isinstance(message, str) and message.strip():
        return message.strip()
    return str(error).strip() or "Upstream API request failed"


def error_status(error: Exception) -> int | None:
    status = getattr(error, "status", None)
    return status if isinstance(status, int) else None


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


def extract_rating_speciality_name(text: str | None) -> str | None:
    if not isinstance(text, str):
        return None

    normalized_text = text.strip()
    if not normalized_text:
        return None

    match = re.match(
        r"^\([^)]+\)\s*(.+?)\s+\(\d+\s+СЃС‚СѓРїРµРЅСЊ",
        normalized_text,
        flags=re.IGNORECASE,
    )
    if match is not None:
        return match.group(1).strip() or None

    return normalized_text


def extract_rating_speciality_code(text: str | None) -> str | None:
    if not isinstance(text, str):
        return None

    normalized_text = text.strip()
    if not normalized_text:
        return None

    match = re.match(r"^\(([^)]+)\)", normalized_text)
    if match is None:
        return None

    code = match.group(1).strip()
    return code or None


def matches_rating_speciality(text: str, speciality_abbrev: str) -> bool:
    normalized_abbrev = normalize_lookup_value(speciality_abbrev)
    if not normalized_abbrev:
        return False

    candidates = [
        extract_rating_speciality_name(text),
        re.sub(r"^\([^)]+\)\s*", "", text).strip() if isinstance(text, str) else "",
        text,
    ]

    for candidate in candidates:
        normalized_text = normalize_lookup_value(candidate)
        if not normalized_text:
            continue
        if normalized_text == normalized_abbrev:
            return True
        if normalized_text.startswith(f"{normalized_abbrev}("):
            return True

    track_tokens = re.findall(r"\(([^)]+)\)", re.sub(r"^\([^)]+\)\s*", "", text))
    for token in track_tokens:
        normalized_token = normalize_lookup_value(token)
        if len(normalized_token) < 3:
            continue
        if normalized_token.startswith(normalized_abbrev):
            return True
        if normalized_abbrev.startswith(normalized_token):
            return True

    return False


def extract_grade_summary_from_record(
    payload: Mapping[str, Any],
) -> dict[str, Any] | None:
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


def build_rating_list_summary(
    payload: Any,
    student_card_number: str,
    *,
    speciality: str | None = None,
) -> dict[str, Any] | None:
    items = unwrap_value_list(payload) or payload
    if not isinstance(items, list):
        return None

    normalized_items = [item for item in items if isinstance(item, dict)]
    normalized_items.sort(
        key=lambda item: first_finite_number(
            item.get("average"),
            item.get("averageMark"),
            item.get("avgRating"),
            item.get("averageScore"),
            item.get("gpa"),
        )
        or float("-inf"),
        reverse=True,
    )

    normalized_student_card_number = normalize_lookup_value(student_card_number)
    for index, item in enumerate(normalized_items):
        if (
            normalize_lookup_value(item.get("studentCardNumber"))
            != normalized_student_card_number
        ):
            continue

        summary = extract_grade_summary_from_record(item) or {}
        summary["position"] = index + 1

        if speciality is not None and "speciality" not in summary:
            summary["speciality"] = speciality

        return summary

    return None


class RatingService:
    def __init__(
        self,
        *,
        request_upstream: RequestUpstream,
        request_upstream_with_timeout: RequestUpstreamWithTimeout,
        now_ms: NowFn,
        lock: Lock,
        request_timeout_ms: int,
        upstream_error_cls: type[Exception],
    ) -> None:
        self.request_upstream = request_upstream
        self.request_upstream_with_timeout = request_upstream_with_timeout
        self.now_ms = now_ms
        self.lock = lock
        self.request_timeout_ms = request_timeout_ms
        self.upstream_error_cls = upstream_error_cls
        self._rating_speciality_index: list[dict[str, str]] = []
        self._rating_speciality_index_fresh_until = 0
        self._rating_courses_cache: dict[tuple[str, str], tuple[int, list[int]]] = {}

    def request_grades_search(self, student_card_number: str) -> JsonValue:
        search_path = "/rating/studentSearch"
        search_params = {"studentCardNumber": student_card_number}

        try:
            return self.request_upstream_with_timeout(
                search_path,
                search_params,
                min(self.request_timeout_ms, GRADES_SEARCH_TIMEOUT_MS),
                1,
            )
        except Exception as error:
            if not isinstance(error, self.upstream_error_cls):
                raise

            if error_status(error) is not None:
                raise

            normalized_message = error_message(error).lower()
            if any(marker in normalized_message for marker in TIMEOUT_ERROR_MARKERS):
                return self.request_upstream(search_path, search_params)

            raise

    def fetch_student_rating_sources(
        self,
        student_card_number: str,
    ) -> StudentRatingFetchResult:
        result = StudentRatingFetchResult()
        futures = {
            "search": RATING_EXECUTOR.submit(
                self.request_grades_search,
                student_card_number,
            ),
            "rating": RATING_EXECUTOR.submit(
                self.request_upstream,
                "/rating/studentRating",
                {"studentCardNumber": student_card_number},
            ),
        }

        for key, future in futures.items():
            try:
                payload = future.result()
            except Exception as error:
                if not isinstance(error, self.upstream_error_cls):
                    raise

                if key == "search":
                    result.search_error = error
                else:
                    result.rating_error = error
                continue

            if key == "search":
                result.search_payload = payload
            else:
                result.rating_payload = payload

        return result

    def get_rating_speciality_index(self) -> list[dict[str, str]]:
        now_value = self.now_ms()

        with self.lock:
            if now_value <= self._rating_speciality_index_fresh_until:
                return list(self._rating_speciality_index)

        faculties_payload = self.request_upstream("/schedule/faculties", {})
        faculty_items = unwrap_value_list(faculties_payload) or faculties_payload
        if not isinstance(faculty_items, list):
            return []

        futures: dict[str, Any] = {}
        faculty_ids: list[str] = []

        for item in faculty_items:
            if not isinstance(item, dict):
                continue

            raw_faculty_id = item.get("id")
            if raw_faculty_id is None:
                continue

            faculty_id = str(raw_faculty_id).strip()
            if not faculty_id:
                continue

            faculty_ids.append(faculty_id)
            futures[faculty_id] = RATING_EXECUTOR.submit(
                self.request_upstream,
                "/rating/specialities",
                {"facultyId": faculty_id},
            )

        index: list[dict[str, str]] = []
        for faculty_id in faculty_ids:
            future = futures.get(faculty_id)
            if future is None:
                continue

            try:
                payload = future.result()
            except Exception as error:
                if not isinstance(error, self.upstream_error_cls):
                    raise

                LOGGER.debug(
                    "Rating specialities request failed for faculty %s: %s",
                    faculty_id,
                    error_message(error),
                )
                continue

            speciality_items = unwrap_value_list(payload) or payload
            if not isinstance(speciality_items, list):
                continue

            for item in speciality_items:
                if not isinstance(item, dict):
                    continue

                raw_speciality_id = item.get("id")
                text = first_non_empty_field(item, "text", "name")
                if raw_speciality_id is None or text is None:
                    continue

                speciality_id = str(raw_speciality_id).strip()
                if not speciality_id:
                    continue

                index.append(
                    {
                        "facultyId": faculty_id,
                        "specialityId": speciality_id,
                        "text": text,
                    }
                )

        fresh_until = now_value + RATING_DIRECTORY_CACHE_TTL_MS
        with self.lock:
            if now_value > self._rating_speciality_index_fresh_until:
                self._rating_speciality_index = index
                self._rating_speciality_index_fresh_until = fresh_until

            return list(self._rating_speciality_index)

    def get_rating_courses(self, faculty_id: str, speciality_id: str) -> list[int]:
        cache_key_value = (faculty_id, speciality_id)
        now_value = self.now_ms()

        with self.lock:
            cached_entry = self._rating_courses_cache.get(cache_key_value)
            if cached_entry is not None:
                fresh_until, cached_courses = cached_entry
                if now_value <= fresh_until:
                    return list(cached_courses)

        payload = self.request_upstream(
            "/rating/courses",
            {
                "facultyId": faculty_id,
                "specialityId": speciality_id,
            },
        )
        courses = normalize_course_values(payload)

        with self.lock:
            self._rating_courses_cache[cache_key_value] = (
                now_value + RATING_DIRECTORY_CACHE_TTL_MS,
                list(courses),
            )

        return courses

    def find_group_info(self, student_group: str) -> dict[str, Any] | None:
        payload = self.request_upstream(
            "/student-groups/filters",
            {"name": student_group},
        )
        items = unwrap_value_list(payload) or payload
        if not isinstance(items, list):
            return None

        normalized_group = normalize_lookup_value(student_group)
        partial_match: dict[str, Any] | None = None

        for item in items:
            if not isinstance(item, dict):
                continue

            name = first_non_empty_field(item, "name", "text")
            if name is None:
                continue

            normalized_name = normalize_lookup_value(name)
            if normalized_name == normalized_group:
                return item

            if partial_match is None and normalized_group in normalized_name:
                partial_match = item

        return partial_match

    def find_group_rating_summary(
        self,
        student_card_number: str,
        student_group: str | None,
    ) -> dict[str, Any] | None:
        normalized_group = first_non_empty_string(student_group)
        if normalized_group is None:
            return None

        try:
            group_info = self.find_group_info(normalized_group)
        except Exception as error:
            if not isinstance(error, self.upstream_error_cls):
                raise

            LOGGER.debug(
                "Student group lookup failed for %s: %s",
                normalized_group,
                error_message(error),
            )
            return None

        if group_info is None:
            return None

        speciality_abbrev = first_non_empty_field(
            group_info,
            "specialityAbbrev",
            "speciality",
            "specialityName",
        )
        fallback_summary = (
            {"speciality": speciality_abbrev} if speciality_abbrev is not None else None
        )
        if speciality_abbrev is None:
            return None

        try:
            speciality_index = self.get_rating_speciality_index()
        except Exception as error:
            if not isinstance(error, self.upstream_error_cls):
                raise

            LOGGER.debug(
                "Rating speciality index lookup failed for %s: %s",
                normalized_group,
                error_message(error),
            )
            return fallback_summary

        speciality_candidates = [
            item
            for item in speciality_index
            if matches_rating_speciality(item["text"], speciality_abbrev)
        ]
        if not speciality_candidates:
            return fallback_summary

        related_candidates: list[dict[str, str]] = []
        related_codes = {
            extract_rating_speciality_code(item["text"])
            for item in speciality_candidates
        }
        related_codes.discard(None)
        if related_codes:
            related_candidates = [
                item
                for item in speciality_index
                if item not in speciality_candidates
                and extract_rating_speciality_code(item["text"]) in related_codes
            ]

        inferred_course = infer_course_from_group(normalized_group)
        rating_candidates: list[tuple[dict[str, str], list[int]]] = []

        for speciality_candidate in [*speciality_candidates, *related_candidates]:
            faculty_id = speciality_candidate["facultyId"]
            speciality_id = speciality_candidate["specialityId"]

            try:
                available_courses = self.get_rating_courses(faculty_id, speciality_id)
            except Exception as error:
                if not isinstance(error, self.upstream_error_cls):
                    raise

                LOGGER.debug(
                    "Rating courses lookup failed for faculty %s speciality %s: %s",
                    faculty_id,
                    speciality_id,
                    error_message(error),
                )
                continue

            if inferred_course is not None and inferred_course not in available_courses:
                continue

            candidate_courses = (
                [inferred_course] if inferred_course is not None else list(available_courses)
            )
            if not candidate_courses:
                continue

            rating_candidates.append((speciality_candidate, candidate_courses))

        for speciality_candidate, candidate_courses in rating_candidates:
            speciality_id = speciality_candidate["specialityId"]

            for course in candidate_courses:
                try:
                    payload = self.request_upstream_with_timeout(
                        "/rating",
                        {
                            "sdef": speciality_id,
                            "course": str(course),
                        },
                        max(self.request_timeout_ms, GRADES_RATING_LIST_TIMEOUT_MS),
                        0,
                    )
                except Exception as error:
                    if not isinstance(error, self.upstream_error_cls):
                        raise

                    LOGGER.debug(
                        "Rating list lookup failed for faculty %s speciality %s course %s: %s",
                        faculty_id,
                        speciality_id,
                        course,
                        error_message(error),
                    )
                    continue

                summary = build_rating_list_summary(
                    payload,
                    student_card_number,
                    speciality=speciality_abbrev,
                )
                if summary is not None:
                    return summary

        return fallback_summary


__all__ = [
    "GRADES_RATING_LIST_TIMEOUT_MS",
    "GRADES_SEARCH_TIMEOUT_MS",
    "RATING_DIRECTORY_CACHE_TTL_MS",
    "RatingService",
    "StudentRatingFetchResult",
    "build_rating_list_summary",
    "extract_rating_speciality_name",
    "infer_course_from_group",
    "matches_rating_speciality",
    "normalize_course_values",
]
