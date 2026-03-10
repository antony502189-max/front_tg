from __future__ import annotations

import json
import time
from http.cookiejar import CookieJar
from typing import Any, Callable
from urllib.error import HTTPError, URLError
from urllib.request import (
    HTTPCookieProcessor,
    Request,
    build_opener,
)


JsonValue = Any
UpstreamErrorFactory = Callable[..., Exception]
LOGIN_ERROR_MESSAGE = "Не удалось авторизоваться в IIS. Проверьте логин и пароль."


def _extract_error_message(raw_body: bytes) -> str:
    if not raw_body:
        return "Upstream API request failed"

    decoded = raw_body.decode("utf-8", errors="ignore").strip()
    if not decoded:
        return "Upstream API request failed"

    try:
        payload = json.loads(decoded)
    except json.JSONDecodeError:
        return decoded

    if isinstance(payload, dict):
        for key in ("error", "message", "warning"):
            value = payload.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()

    return decoded


class OmissionsService:
    def __init__(
        self,
        *,
        iis_base_url: str,
        request_timeout_ms: int,
        max_retries: int,
        retry_delay_ms: int,
        upstream_error_cls: UpstreamErrorFactory,
    ) -> None:
        self.iis_base_url = iis_base_url.rstrip("/")
        self.timeout_seconds = max(request_timeout_ms, 1) / 1000
        self.max_retries = max(max_retries, 0)
        self.retry_delay_ms = max(retry_delay_ms, 0)
        self.upstream_error_cls = upstream_error_cls

    def fetch_month_student_omission_counts(
        self,
        username: str,
        password: str,
    ) -> JsonValue:
        return self._run_with_retries(
            username,
            password,
            self._fetch_month_student_omission_counts,
        )

    def fetch_student_omissions_overview(
        self,
        username: str,
        password: str,
    ) -> JsonValue:
        return self._run_with_retries(
            username,
            password,
            self._fetch_student_omissions_overview,
        )

    def _run_with_retries(
        self,
        username: str,
        password: str,
        loader: Callable[[str, str], JsonValue],
    ) -> JsonValue:
        normalized_username = str(username).strip()
        normalized_password = str(password)

        if not normalized_username or not normalized_password:
            raise self.upstream_error_cls(
                "Добавьте логин и пароль IIS в профиле, чтобы загружать пропуски.",
                400,
            )

        last_error: Exception | None = None

        for attempt in range(self.max_retries + 1):
            try:
                return loader(normalized_username, normalized_password)
            except Exception as error:
                last_error = error
                status = getattr(error, "status", None)
                should_retry = status is None or status == 429 or status >= 500
                if not should_retry or attempt == self.max_retries:
                    raise

                time.sleep(self.retry_delay_ms * (attempt + 1) / 1000)

        raise last_error or self.upstream_error_cls("Upstream API request failed")

    def _create_authenticated_opener(
        self,
        username: str,
        password: str,
    ) -> Any:
        cookie_jar = CookieJar()
        opener = build_opener(HTTPCookieProcessor(cookie_jar))

        self._request_json(
            opener,
            "/auth/login",
            method="POST",
            payload={
                "username": username,
                "password": password,
                "rememberDevice": True,
            },
        )

        return opener

    def _fetch_month_student_omission_counts(
        self,
        username: str,
        password: str,
    ) -> JsonValue:
        opener = self._create_authenticated_opener(username, password)
        return self._request_json(
            opener,
            "/omission-count-by-student-for-semester",
        )

    def _fetch_student_omissions_overview(
        self,
        username: str,
        password: str,
    ) -> JsonValue:
        opener = self._create_authenticated_opener(username, password)
        omission_counts = self._request_json(
            opener,
            "/omission-count-by-student-for-semester",
        )

        grade_book = None
        try:
            grade_book = self._request_json(opener, "/grade-book")
        except Exception:
            grade_book = None

        return {
            "monthStudentOmissionCounts": omission_counts,
            "gradeBook": grade_book,
        }

    def _request_json(
        self,
        opener: Any,
        path: str,
        *,
        method: str = "GET",
        payload: JsonValue | None = None,
    ) -> JsonValue:
        body = None
        headers = {
            "Accept": "application/json",
            "User-Agent": "front_tg_python_backend/1.0",
        }

        if payload is not None:
            body = json.dumps(payload).encode("utf-8")
            headers["Content-Type"] = "application/json"

        request = Request(
            f"{self.iis_base_url}{path}",
            data=body,
            headers=headers,
            method=method,
        )

        try:
            with opener.open(request, timeout=self.timeout_seconds) as response:
                charset = response.headers.get_content_charset() or "utf-8"
                raw_body = response.read()
                decoded = raw_body.decode(charset, errors="ignore")
                return json.loads(decoded) if decoded else None
        except HTTPError as error:
            if path == "/auth/login" and error.code in {401, 403}:
                raise self.upstream_error_cls(
                    LOGIN_ERROR_MESSAGE,
                    error.code,
                ) from error

            raise self.upstream_error_cls(
                _extract_error_message(error.read()),
                error.code,
            ) from error
        except TimeoutError as error:
            raise self.upstream_error_cls(
                str(error) or "Upstream API request timed out"
            ) from error
        except URLError as error:
            raise self.upstream_error_cls(
                str(error.reason or "Upstream API request failed")
            ) from error
