from __future__ import annotations

import os
from pathlib import Path
from typing import AbstractSet


def project_root() -> Path:
    return Path(__file__).resolve().parent.parent


def _normalize_env_value(raw_value: str) -> str:
    value = raw_value.strip()

    if len(value) >= 2 and value[0] == value[-1] and value[0] in {'"', "'"}:
        return value[1:-1]

    return value


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

        if override or normalized_key not in os.environ or normalized_key not in immutable_keys:
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
