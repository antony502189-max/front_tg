from __future__ import annotations

import unittest

from backend.services.omissions import LOGIN_ERROR_MESSAGE, OmissionsService


class DummyUpstreamError(Exception):
    def __init__(self, message: str, status: int | None = None) -> None:
        super().__init__(message)
        self.message = message
        self.status = status


class _FakeHeaders:
    @staticmethod
    def get_content_charset() -> str:
        return "utf-8"


class _FakeResponse:
    def __init__(self, body: bytes) -> None:
        self._body = body
        self.headers = _FakeHeaders()

    def __enter__(self) -> "_FakeResponse":
        return self

    def __exit__(self, exc_type, exc, tb) -> None:
        return None

    def read(self) -> bytes:
        return self._body


class _FakeOpener:
    def __init__(self, body: bytes) -> None:
        self.body = body

    def open(self, _request, timeout: float):  # noqa: ANN001
        return _FakeResponse(self.body)


class OmissionsServiceTests(unittest.TestCase):
    def create_service(self) -> OmissionsService:
        return OmissionsService(
            iis_base_url="https://example.com/api/v1",
            request_timeout_ms=100,
            max_retries=2,
            retry_delay_ms=1,
            upstream_error_cls=DummyUpstreamError,
        )

    def test_request_json_wraps_invalid_json_as_upstream_error(self) -> None:
        service = self.create_service()

        with self.assertRaises(DummyUpstreamError) as error_context:
            service._request_json(_FakeOpener(b"{not-json}"), "/grade-book")

        self.assertEqual(
            error_context.exception.message,
            "Upstream API returned invalid JSON",
        )

    def test_run_with_retries_does_not_retry_non_upstream_errors(self) -> None:
        service = self.create_service()
        attempts = {"value": 0}

        def loader(_username: str, _password: str):
            attempts["value"] += 1
            raise ValueError("boom")

        with self.assertRaises(ValueError):
            service._run_with_retries("56841017", "secret", loader)

        self.assertEqual(attempts["value"], 1)

    def test_fetch_student_omissions_overview_ignores_gradebook_upstream_errors(
        self,
    ) -> None:
        service = self.create_service()
        service._create_authenticated_opener = lambda *_: object()  # type: ignore[method-assign]

        def fake_request_json(_opener, path: str, **_kwargs):  # noqa: ANN001
            if path == "/omission-count-by-student-for-semester":
                return [{"month": "Февраль", "omissionCount": 2}]
            if path == "/grade-book":
                raise DummyUpstreamError(LOGIN_ERROR_MESSAGE, 502)
            raise AssertionError(f"Unexpected path: {path}")

        service._request_json = fake_request_json  # type: ignore[method-assign]

        payload = service._fetch_student_omissions_overview(
            "56841017",
            "secret",
        )

        self.assertEqual(
            payload,
            {
                "monthStudentOmissionCounts": [
                    {"month": "Февраль", "omissionCount": 2}
                ],
                "gradeBook": None,
            },
        )

    def test_fetch_student_omissions_overview_does_not_hide_programming_errors(
        self,
    ) -> None:
        service = self.create_service()
        service._create_authenticated_opener = lambda *_: object()  # type: ignore[method-assign]

        def fake_request_json(_opener, path: str, **_kwargs):  # noqa: ANN001
            if path == "/omission-count-by-student-for-semester":
                return [{"month": "Февраль", "omissionCount": 2}]
            if path == "/grade-book":
                raise ValueError("boom")
            raise AssertionError(f"Unexpected path: {path}")

        service._request_json = fake_request_json  # type: ignore[method-assign]

        with self.assertRaises(ValueError):
            service._fetch_student_omissions_overview("56841017", "secret")


if __name__ == "__main__":
    unittest.main()
