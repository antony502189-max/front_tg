from __future__ import annotations

import os
from pathlib import Path
from typing import AbstractSet

TRUE_ENV_VALUES = frozenset({"1", "true", "yes", "on"})


def project_root() -> Path:
    return Path(__file__).resolve().parent.parent


def _normalize_env_value(raw_value: str) -> str:
    value = raw_value.strip()

    if len(value) >= 2 and value[0] == value[-1] and value[0] in {'"', "'"}:
        return value[1:-1]

    return value


def parse_string_env(name: str, fallback: str | None = None) -> str | None:
    raw = os.getenv(name)

    if raw is None:
        return fallback

    normalized = raw.strip()
    return normalized or fallback


def parse_number_env(name: str, fallback: int, *, minimum: int = 0) -> int:
    raw = parse_string_env(name)

    if raw is None:
        return fallback

    try:
        parsed = int(raw)
    except ValueError:
        return fallback

    return parsed if parsed >= minimum else fallback


def parse_bool_env(name: str, fallback: bool) -> bool:
    raw = parse_string_env(name)

    if raw is None:
        return fallback

    return raw.lower() in TRUE_ENV_VALUES


def _should_write_env_value(
    key: str,
    *,
    override: bool,
    protected_keys: AbstractSet[str],
) -> bool:
    if override or key not in os.environ:
        return True

    return key not in protected_keys


def load_env_file(
    path: Path,
    *,
    override: bool = False,
    protected_keys: AbstractSet[str] | None = None,
) -> dict[str, str]:
    if not path.exists():
        return {}

    loaded: dict[str, str] = {}
    immutable_keys = protected_keys or set()

    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()

        if not line or line.startswith("#"):
            continue

        if line.startswith("export "):
            line = line[len("export ") :].strip()

        if "=" not in line:
            continue

        key, raw_value = line.split("=", 1)
        normalized_key = key.strip()

        if not normalized_key:
            continue

        normalized_value = _normalize_env_value(raw_value)

        if _should_write_env_value(
            normalized_key,
            override=override,
            protected_keys=immutable_keys,
        ):
            os.environ[normalized_key] = normalized_value

        loaded[normalized_key] = os.environ[normalized_key]

    return loaded


def load_project_env(*, override: bool = False) -> dict[str, str]:
    root = project_root()
    loaded: dict[str, str] = {}
    initial_env_keys = set(os.environ)

    for filename in (".env", ".env.local"):
        loaded.update(
            load_env_file(
                root / filename,
                override=override,
                protected_keys=initial_env_keys,
            )
        )

    return loaded
