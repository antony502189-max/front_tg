import os
import json
import time
import unittest
from pathlib import Path

from backend.user_profiles import UserProfileStore


def build_student_payload(group_number: str) -> dict[str, dict[str, str]]:
    return {
        "tg:1": {
            "telegramUserId": "tg:1",
            "role": "student",
            "groupNumber": group_number,
            "studentCardNumber": "56841017",
        }
    }


class UserProfileStoreTests(unittest.TestCase):
    def test_get_reuses_cached_payload_when_file_is_unchanged(self) -> None:
        store_path = Path("backend") / "_profile_store_cache_test.json"
        store_path.unlink(missing_ok=True)

        try:
            store_path.write_text(
                json.dumps(build_student_payload("568403")),
                encoding="utf-8",
            )
            store = UserProfileStore(store_path)
            read_count = 0
            original_reader = store._read_file_payload_unlocked

            def counted_reader() -> dict[str, dict[str, str]]:
                nonlocal read_count
                read_count += 1
                return original_reader()

            store._read_file_payload_unlocked = counted_reader  # type: ignore[method-assign]

            first = store.get("tg:1")
            second = store.get("tg:1")

            self.assertIsNotNone(first)
            self.assertIsNotNone(second)
            self.assertEqual(read_count, 1)
        finally:
            store_path.unlink(missing_ok=True)

    def test_get_reloads_payload_after_external_file_change(self) -> None:
        store_path = Path("backend") / "_profile_store_reload_test.json"
        store_path.unlink(missing_ok=True)

        try:
            store_path.write_text(
                json.dumps(build_student_payload("568403")),
                encoding="utf-8",
            )
            store = UserProfileStore(store_path)

            first = store.get("tg:1")
            store_path.write_text(
                json.dumps(build_student_payload("568404")),
                encoding="utf-8",
            )
            future_mtime = time.time() + 1
            os.utime(store_path, (future_mtime, future_mtime))
            second = store.get("tg:1")

            self.assertIsNotNone(first)
            self.assertEqual(first.group_number, "568403")
            self.assertIsNotNone(second)
            self.assertEqual(second.group_number, "568404")
        finally:
            store_path.unlink(missing_ok=True)


if __name__ == "__main__":
    unittest.main()
