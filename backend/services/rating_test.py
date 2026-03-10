from __future__ import annotations

import unittest
from threading import Lock

from backend.services.rating import (
    RATING_CACHE_PRUNE_INTERVAL_MS,
    RatingService,
)


class DummyUpstreamError(Exception):
    def __init__(self, message: str, status: int | None = None) -> None:
        super().__init__(message)
        self.message = message
        self.status = status


class RatingServiceTests(unittest.TestCase):
    def create_service(self, *, now_value: int) -> RatingService:
        return RatingService(
            request_upstream=lambda *_: [],
            request_upstream_with_timeout=lambda *_: [],
            now_ms=lambda: now_value,
            lock=Lock(),
            request_timeout_ms=100,
            upstream_error_cls=DummyUpstreamError,
        )

    def test_prune_expired_caches_removes_only_stale_entries(self) -> None:
        service = self.create_service(now_value=100)
        service._cache_prune_due_ms = 0
        service._rating_courses_cache[("20", "20026")] = (50, [1, 2])
        service._group_info_cache["353502"] = (
            50,
            True,
            {"name": "353502"},
        )
        service._student_card_rating_summary_cache["56841017"] = (
            50,
            True,
            {"position": 2},
        )
        service._group_rating_summary_cache[("56841017", "353502", False)] = (
            150,
            True,
            {"position": 1},
        )

        with service.lock:
            service._prune_expired_caches_unlocked(100)

        self.assertEqual(service._rating_courses_cache, {})
        self.assertEqual(service._group_info_cache, {})
        self.assertEqual(service._student_card_rating_summary_cache, {})
        self.assertEqual(
            service._group_rating_summary_cache,
            {
                ("56841017", "353502", False): (
                    150,
                    True,
                    {"position": 1},
                )
            },
        )
        self.assertEqual(
            service._cache_prune_due_ms,
            100 + RATING_CACHE_PRUNE_INTERVAL_MS,
        )


if __name__ == "__main__":
    unittest.main()
