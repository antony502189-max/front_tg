import os
import tempfile
import unittest
from pathlib import Path

from backend.env import load_env_file


class EnvLoaderTests(unittest.TestCase):
    def test_local_file_can_override_value_loaded_from_env_file(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            env_path = Path(temp_dir) / ".env"
            env_local_path = Path(temp_dir) / ".env.local"
            env_path.write_text("BOT_TOKEN=from-env\n", encoding="utf-8")
            env_local_path.write_text("BOT_TOKEN=from-local\n", encoding="utf-8")

            original_value = os.environ.pop("BOT_TOKEN", None)

            try:
                protected_keys = set(os.environ)

                load_env_file(env_path, protected_keys=protected_keys)
                load_env_file(env_local_path, protected_keys=protected_keys)

                self.assertEqual(os.environ["BOT_TOKEN"], "from-local")
            finally:
                if original_value is None:
                    os.environ.pop("BOT_TOKEN", None)
                else:
                    os.environ["BOT_TOKEN"] = original_value

    def test_existing_process_env_has_priority_without_override(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            env_path = Path(temp_dir) / ".env"
            env_path.write_text("BOT_TOKEN=from-env\n", encoding="utf-8")

            original_value = os.environ.get("BOT_TOKEN")
            os.environ["BOT_TOKEN"] = "from-process"

            try:
                load_env_file(
                    env_path,
                    protected_keys={"BOT_TOKEN"},
                )

                self.assertEqual(os.environ["BOT_TOKEN"], "from-process")
            finally:
                if original_value is None:
                    os.environ.pop("BOT_TOKEN", None)
                else:
                    os.environ["BOT_TOKEN"] = original_value

    def test_override_can_replace_existing_process_env(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            env_path = Path(temp_dir) / ".env"
            env_path.write_text("BOT_TOKEN=from-env\n", encoding="utf-8")

            original_value = os.environ.get("BOT_TOKEN")
            os.environ["BOT_TOKEN"] = "from-process"

            try:
                load_env_file(
                    env_path,
                    override=True,
                    protected_keys={"BOT_TOKEN"},
                )

                self.assertEqual(os.environ["BOT_TOKEN"], "from-env")
            finally:
                if original_value is None:
                    os.environ.pop("BOT_TOKEN", None)
                else:
                    os.environ["BOT_TOKEN"] = original_value


if __name__ == "__main__":
    unittest.main()
