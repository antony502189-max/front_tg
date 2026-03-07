from __future__ import annotations

import logging
import math
import re
from concurrent.futures import ThreadPoolExecutor, as_completed
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
    "время ожидания",
    "time out",
)
RATING_EXECUTOR = ThreadPoolExecutor(max_workers=4)
KNOWN_FACULTY_PREFIX_HINTS: dict[str, tuple[str, ...]] = {
    "45": ("20026",),
    "50": ("20002",),
    "51": ("20017",),
    "52": ("20005",),
    "53": ("20000",),
    "54": ("20035",),
    "55": ("20026",),
    "56": ("20040",),
    "57": ("20012",),
    "58": ("20033",),
}


@dataclass
class StudentRatingFetchResult:
    search_payload: JsonValue | None = None
    rating_payload: JsonValue | None = None
    search_error: Exception | None = None
    rating_error: Exception | None = None


@dataclass(frozen=True)
class RatingListCandidate:
    faculty_id: str
    speciality_id: str
    course: int
    speciality: str | None = None
    text: str | None = None

    def cache_entry(self) -> dict[str, str]:
        entry = {
            "facultyId": self.faculty_id,
            "specialityId": self.speciality_id,
            "course": str(self.course),
        }

        if self.speciality:
            entry["speciality"] = self.speciality

        return entry


@dataclass(frozen=True)
class RatingCandidateScanResult:
    summary: dict[str, Any] | None
    faculty_prefixes: tuple[str, ...]
    student_card_prefixes: tuple[str, ...]


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


def select_rating_candidate_courses(
    available_courses: list[int],
    inferred_course: int | None,
    *,
    allow_fallback_courses: bool = False,
) -> list[int]:
    if not available_courses:
        return []

    if inferred_course is None:
        return list(available_courses)

    if inferred_course in available_courses:
        return [inferred_course] + [
            course for course in available_courses if course != inferred_course
        ]

    return list(available_courses) if allow_fallback_courses else []


def extract_rating_speciality_name(text: str | None) -> str | None:
    if not isinstance(text, str):
        return None

    normalized_text = text.strip()
    if not normalized_text:
        return None

    match = re.match(
        r"^\([^)]+\)\s*(.+?)\s+\(\d+\s+ступень",
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


def resolve_speciality_name(
    preferred_speciality: str | None,
    resolved_speciality: str | None,
) -> str | None:
    preferred = first_non_empty_string(preferred_speciality)
    resolved = first_non_empty_string(resolved_speciality)

    if preferred is None:
        return resolved

    if resolved is None:
        return preferred

    normalized_preferred = normalize_lookup_value(preferred)
    normalized_resolved = normalize_lookup_value(resolved)
    if normalized_resolved.startswith(f"{normalized_preferred}("):
        return resolved

    return preferred


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

    normalized_student_card_number = normalize_lookup_value(student_card_number)
    target_index: int | None = None
    target_summary: Mapping[str, Any] | None = None
    parsed_summaries: list[Mapping[str, Any] | None] = []

    for index, item in enumerate(items):
        if not isinstance(item, dict):
            parsed_summaries.append(None)
            continue

        record_summary = extract_grade_summary_from_record(item)
        parsed_summaries.append(record_summary)

        if (
            normalize_lookup_value(item.get("studentCardNumber"))
            != normalized_student_card_number
        ):
            continue

        target_index = index
        target_summary = record_summary or {}

    if target_index is None or target_summary is None:
        return None

    summary: dict[str, Any] = {}
    position = first_finite_number(target_summary.get("position"))
    if position is not None:
        summary["position"] = int(position)
    else:
        target_average = first_finite_number(target_summary.get("average"))
        if target_average is None:
            summary["position"] = target_index + 1
        else:
            summary["position"] = 1 + sum(
                1
                for parsed_summary in parsed_summaries
                if isinstance(parsed_summary, Mapping)
                and (average := first_finite_number(parsed_summary.get("average")))
                is not None
                and average > target_average
            )

    resolved_speciality = first_non_empty_string(
        target_summary.get("speciality"),
        speciality,
    )
    if resolved_speciality is not None:
        summary["speciality"] = resolved_speciality

    return summary


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
        self._student_card_prefix_candidates: dict[str, list[dict[str, str]]] = {}
        self._faculty_prefix_candidates: dict[str, list[str]] = {}
        self._student_card_prefix_index_fresh_until = 0

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
        *,
        allow_fallback_courses: bool = False,
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
        rating_candidates: list[RatingListCandidate] = []
        seen_candidates: set[tuple[str, str, int]] = set()

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

            candidate_courses = select_rating_candidate_courses(
                available_courses,
                inferred_course,
                allow_fallback_courses=allow_fallback_courses,
            )
            if not candidate_courses:
                continue

            speciality_name = extract_rating_speciality_name(speciality_candidate["text"])
            for course in candidate_courses:
                candidate_key = (faculty_id, speciality_id, course)
                if candidate_key in seen_candidates:
                    continue

                seen_candidates.add(candidate_key)
                rating_candidates.append(
                    RatingListCandidate(
                        faculty_id=faculty_id,
                        speciality_id=speciality_id,
                        course=course,
                        speciality=speciality_name,
                        text=speciality_candidate["text"],
                    )
                )

        if inferred_course is not None:
            rating_candidates.sort(
                key=lambda candidate: candidate.course != inferred_course
            )

        summary = self._scan_rating_candidates(student_card_number, rating_candidates)
        if summary is not None:
            summary = dict(summary)
            summary["speciality"] = resolve_speciality_name(
                speciality_abbrev,
                first_non_empty_string(summary.get("speciality")),
            )
            return summary

        return fallback_summary

    def find_student_rating_summary(
        self,
        student_card_number: str,
        student_group: str | None = None,
    ) -> dict[str, Any] | None:
        group_summary = None
        normalized_group = first_non_empty_string(student_group)
        if normalized_group is not None:
            group_summary = self.find_group_rating_summary(
                student_card_number,
                normalized_group,
                allow_fallback_courses=True,
            )
            if isinstance(group_summary, Mapping) and group_summary.get("position") is not None:
                return dict(group_summary)

        card_summary = self.find_student_card_rating_summary(student_card_number)
        if card_summary is None:
            return dict(group_summary) if isinstance(group_summary, Mapping) else None

        if not isinstance(group_summary, Mapping):
            return card_summary

        merged_summary = dict(card_summary)
        speciality = resolve_speciality_name(
            first_non_empty_string(group_summary.get("speciality")),
            first_non_empty_string(card_summary.get("speciality")),
        )
        if speciality is not None:
            merged_summary["speciality"] = speciality

        return merged_summary

    def find_student_card_rating_summary(
        self,
        student_card_number: str,
    ) -> dict[str, Any] | None:
        normalized_student_card_number = "".join(str(student_card_number).split())
        if not re.fullmatch(r"\d{5,32}", normalized_student_card_number):
            return None

        student_card_prefix = normalized_student_card_number[:5]
        faculty_prefix = normalized_student_card_number[:2]

        cached_candidates = self._get_cached_student_card_candidates(student_card_prefix)
        if cached_candidates:
            summary = self._scan_rating_candidates(
                normalized_student_card_number,
                cached_candidates,
            )
            if summary is not None:
                return summary

        faculty_ids = self._get_faculty_candidates_for_prefix(faculty_prefix)
        summary = self._scan_rating_candidates(
            normalized_student_card_number,
            self._build_rating_candidates_for_faculties(faculty_ids),
        )
        if summary is not None:
            return summary

        all_faculty_ids = self._get_all_faculty_ids()
        remaining_faculty_ids = [
            faculty_id for faculty_id in all_faculty_ids if faculty_id not in faculty_ids
        ]
        if not remaining_faculty_ids:
            return None

        return self._scan_rating_candidates(
            normalized_student_card_number,
            self._build_rating_candidates_for_faculties(remaining_faculty_ids),
        )

    def _fetch_rating_candidate(
        self,
        candidate: RatingListCandidate,
        student_card_number: str,
    ) -> RatingCandidateScanResult:
        payload = self.request_upstream_with_timeout(
            "/rating",
            {
                "sdef": candidate.speciality_id,
                "course": str(candidate.course),
            },
            max(self.request_timeout_ms, GRADES_RATING_LIST_TIMEOUT_MS),
            0,
        )
        items = unwrap_value_list(payload) or payload
        faculty_prefixes: set[str] = set()
        student_card_prefixes: set[str] = set()

        if isinstance(items, list):
            for item in items:
                if not isinstance(item, dict):
                    continue

                raw_student_card = first_non_empty_string(item.get("studentCardNumber"))
                if raw_student_card is None:
                    continue

                normalized_student_card = "".join(raw_student_card.split())
                if len(normalized_student_card) >= 2:
                    faculty_prefixes.add(normalized_student_card[:2])
                if len(normalized_student_card) >= 5:
                    student_card_prefixes.add(normalized_student_card[:5])

        return RatingCandidateScanResult(
            summary=build_rating_list_summary(
                payload,
                student_card_number,
                speciality=candidate.speciality,
            ),
            faculty_prefixes=tuple(sorted(faculty_prefixes)),
            student_card_prefixes=tuple(sorted(student_card_prefixes)),
        )

    def _scan_rating_candidates(
        self,
        student_card_number: str,
        candidates: list[RatingListCandidate],
    ) -> dict[str, Any] | None:
        if not candidates:
            return None

        futures = {
            RATING_EXECUTOR.submit(
                self._fetch_rating_candidate,
                candidate,
                student_card_number,
            ): candidate
            for candidate in candidates
        }

        try:
            for future in as_completed(futures):
                candidate = futures[future]

                try:
                    result = future.result()
                except Exception as error:
                    if not isinstance(error, self.upstream_error_cls):
                        raise

                    LOGGER.debug(
                        "Rating list lookup failed for faculty %s speciality %s course %s: %s",
                        candidate.faculty_id,
                        candidate.speciality_id,
                        candidate.course,
                        error_message(error),
                    )
                    continue

                self._remember_candidate_prefixes(candidate, result)
                if result.summary is not None:
                    return result.summary
        finally:
            for future in futures:
                future.cancel()

        return None

    def _build_rating_candidates_for_faculties(
        self,
        faculty_ids: list[str],
    ) -> list[RatingListCandidate]:
        if not faculty_ids:
            return []

        faculty_id_set = set(faculty_ids)
        speciality_index = self.get_rating_speciality_index()
        candidates: list[RatingListCandidate] = []

        for item in speciality_index:
            faculty_id = item["facultyId"]
            if faculty_id not in faculty_id_set:
                continue

            speciality_id = item["specialityId"]
            try:
                courses = self.get_rating_courses(faculty_id, speciality_id)
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

            speciality_name = extract_rating_speciality_name(item["text"])
            for course in courses:
                candidates.append(
                    RatingListCandidate(
                        faculty_id=faculty_id,
                        speciality_id=speciality_id,
                        course=course,
                        speciality=speciality_name,
                        text=item["text"],
                    )
                )

        return candidates

    def _get_all_faculty_ids(self) -> list[str]:
        faculty_ids = {
            item["facultyId"]
            for item in self.get_rating_speciality_index()
            if item.get("facultyId")
        }
        return sorted(faculty_ids)

    def _get_cached_student_card_candidates(
        self,
        student_card_prefix: str,
    ) -> list[RatingListCandidate]:
        now_value = self.now_ms()

        with self.lock:
            self._reset_student_card_prefix_index_if_stale(now_value)
            cached_entries = list(
                self._student_card_prefix_candidates.get(student_card_prefix, [])
            )

        result: list[RatingListCandidate] = []
        for entry in cached_entries:
            course = first_finite_number(entry.get("course"))
            faculty_id = first_non_empty_string(entry.get("facultyId"))
            speciality_id = first_non_empty_string(entry.get("specialityId"))
            if course is None or faculty_id is None or speciality_id is None:
                continue

            result.append(
                RatingListCandidate(
                    faculty_id=faculty_id,
                    speciality_id=speciality_id,
                    course=int(course),
                    speciality=first_non_empty_string(entry.get("speciality")),
                )
            )

        return result

    def _get_faculty_candidates_for_prefix(self, faculty_prefix: str) -> list[str]:
        normalized_prefix = faculty_prefix.strip()
        seeded_candidates = list(KNOWN_FACULTY_PREFIX_HINTS.get(normalized_prefix, ()))
        now_value = self.now_ms()

        with self.lock:
            self._reset_student_card_prefix_index_if_stale(now_value)
            cached_candidates = list(
                self._faculty_prefix_candidates.get(normalized_prefix, [])
            )

        ordered_candidates: list[str] = []
        for faculty_id in [*seeded_candidates, *cached_candidates]:
            if faculty_id and faculty_id not in ordered_candidates:
                ordered_candidates.append(faculty_id)

        return ordered_candidates or self._get_all_faculty_ids()

    def _remember_candidate_prefixes(
        self,
        candidate: RatingListCandidate,
        result: RatingCandidateScanResult,
    ) -> None:
        if not result.faculty_prefixes and not result.student_card_prefixes:
            return

        cache_entry = candidate.cache_entry()
        now_value = self.now_ms()

        with self.lock:
            self._reset_student_card_prefix_index_if_stale(now_value)

            for faculty_prefix in result.faculty_prefixes:
                cached_faculty_ids = self._faculty_prefix_candidates.setdefault(
                    faculty_prefix,
                    [],
                )
                if candidate.faculty_id not in cached_faculty_ids:
                    cached_faculty_ids.append(candidate.faculty_id)

            for student_card_prefix in result.student_card_prefixes:
                cached_candidates = self._student_card_prefix_candidates.setdefault(
                    student_card_prefix,
                    [],
                )
                if cache_entry not in cached_candidates:
                    cached_candidates.append(dict(cache_entry))

    def _reset_student_card_prefix_index_if_stale(self, now_value: int) -> None:
        if now_value <= self._student_card_prefix_index_fresh_until:
            return

        self._student_card_prefix_candidates = {}
        self._faculty_prefix_candidates = {}
        self._student_card_prefix_index_fresh_until = (
            now_value + RATING_DIRECTORY_CACHE_TTL_MS
        )


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
    "resolve_speciality_name",
]
