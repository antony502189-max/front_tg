from __future__ import annotations

import json
from dataclasses import dataclass, replace
from datetime import datetime, timezone
from pathlib import Path
from threading import Lock
from typing import Any, Literal, Mapping


UserRole = Literal["student", "teacher"]
Subgroup = Literal["all", "1", "2"]
VALID_ROLES = frozenset({"student", "teacher"})
VALID_SUBGROUPS = frozenset({"all", "1", "2"})
DEFAULT_STORE_PATH = (
    Path(__file__).resolve().parent / "data" / "user_profiles.json"
)


class ProfileValidationError(Exception):
    def __init__(self, message: str) -> None:
        super().__init__(message)
        self.message = message


def _as_string(value: Any) -> str | None:
    if value is None:
        return None

    normalized = str(value).strip()
    return normalized or None


def _normalize_subgroup(value: Any) -> Subgroup:
    normalized = _as_string(value)
    if normalized in VALID_SUBGROUPS:
        return normalized
    return "all"


@dataclass(frozen=True)
class UserProfile:
    telegram_user_id: str
    role: UserRole
    subgroup: Subgroup = "all"
    group_number: str | None = None
    student_card_number: str | None = None
    iis_login: str | None = None
    iis_password: str | None = None
    employee_id: str | None = None
    url_id: str | None = None
    full_name: str | None = None
    position: str | None = None
    department: str | None = None
    avatar_url: str | None = None
    updated_at: str | None = None

    @classmethod
    def from_payload(cls, payload: Mapping[str, Any]) -> "UserProfile":
        telegram_user_id = _as_string(payload.get("telegramUserId"))
        if telegram_user_id is None:
            raise ProfileValidationError('Field "telegramUserId" is required')

        role = _as_string(payload.get("role"))
        if role not in VALID_ROLES:
            raise ProfileValidationError(
                'Field "role" must be "student" or "teacher"'
            )

        subgroup = _normalize_subgroup(payload.get("subgroup"))
        updated_at = _as_string(payload.get("updatedAt")) or datetime.now(
            timezone.utc
        ).isoformat()

        if role == "student":
            group_number = _as_string(payload.get("groupNumber"))
            student_card_number = _as_string(payload.get("studentCardNumber"))
            if group_number is None:
                raise ProfileValidationError(
                    'Field "groupNumber" is required for student profiles'
                )
            if student_card_number is None:
                raise ProfileValidationError(
                    'Field "studentCardNumber" is required for student profiles'
                )

            return cls(
                telegram_user_id=telegram_user_id,
                role="student",
                subgroup=subgroup,
                group_number=group_number,
                student_card_number=student_card_number,
                iis_login=_as_string(payload.get("iisLogin")),
                iis_password=_as_string(payload.get("iisPassword")),
                updated_at=updated_at,
            )

        employee_id = _as_string(payload.get("employeeId"))
        url_id = _as_string(payload.get("urlId"))
        full_name = _as_string(payload.get("fullName"))
        if employee_id is None:
            raise ProfileValidationError(
                'Field "employeeId" is required for teacher profiles'
            )
        if url_id is None:
            raise ProfileValidationError(
                'Field "urlId" is required for teacher profiles'
            )
        if full_name is None:
            raise ProfileValidationError(
                'Field "fullName" is required for teacher profiles'
            )

        return cls(
            telegram_user_id=telegram_user_id,
            role="teacher",
            subgroup=subgroup,
            employee_id=employee_id,
            url_id=url_id,
            full_name=full_name,
            position=_as_string(payload.get("position")),
            department=_as_string(payload.get("department")),
            avatar_url=_as_string(payload.get("avatarUrl")),
            updated_at=updated_at,
        )

    @classmethod
    def from_mapping(cls, payload: Mapping[str, Any]) -> "UserProfile":
        return cls.from_payload(payload)

    def to_dict(self, *, include_sensitive: bool = False) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "telegramUserId": self.telegram_user_id,
            "role": self.role,
            "subgroup": self.subgroup,
            "updatedAt": self.updated_at,
        }

        if self.group_number is not None:
            payload["groupNumber"] = self.group_number
        if self.student_card_number is not None:
            payload["studentCardNumber"] = self.student_card_number
        if self.iis_login is not None:
            payload["iisLogin"] = self.iis_login
        if include_sensitive:
            if self.iis_password is not None:
                payload["iisPassword"] = self.iis_password
        elif self.iis_password is not None:
            payload["hasIisPassword"] = True
        if self.employee_id is not None:
            payload["employeeId"] = self.employee_id
        if self.url_id is not None:
            payload["urlId"] = self.url_id
        if self.full_name is not None:
            payload["fullName"] = self.full_name
        if self.position is not None:
            payload["position"] = self.position
        if self.department is not None:
            payload["department"] = self.department
        if self.avatar_url is not None:
            payload["avatarUrl"] = self.avatar_url

        return payload


class UserProfileStore:
    def __init__(self, file_path: Path | None = None) -> None:
        self.file_path = file_path or DEFAULT_STORE_PATH
        self.lock = Lock()
        self._cached_payload: dict[str, dict[str, Any]] | None = None
        self._cached_mtime_ns: int | None = None

    def _stat_mtime_ns_unlocked(self) -> int | None:
        try:
            return self.file_path.stat().st_mtime_ns
        except OSError:
            return None

    def _read_file_payload_unlocked(self) -> dict[str, dict[str, Any]]:
        try:
            raw = self.file_path.read_text(encoding="utf-8")
        except OSError:
            return {}

        if not raw.strip():
            return {}

        try:
            payload = json.loads(raw)
        except json.JSONDecodeError:
            return {}

        if not isinstance(payload, dict):
            return {}

        normalized: dict[str, dict[str, Any]] = {}
        for key, value in payload.items():
            if not isinstance(key, str) or not isinstance(value, dict):
                continue
            normalized[key] = value

        return normalized

    def _load_unlocked(self) -> dict[str, dict[str, Any]]:
        current_mtime_ns = self._stat_mtime_ns_unlocked()
        if (
            self._cached_payload is not None
            and current_mtime_ns == self._cached_mtime_ns
        ):
            return self._cached_payload

        payload = (
            self._read_file_payload_unlocked()
            if current_mtime_ns is not None
            else {}
        )
        self._cached_payload = payload
        self._cached_mtime_ns = current_mtime_ns
        return payload

    def _save_unlocked(self, payload: dict[str, dict[str, Any]]) -> None:
        self.file_path.parent.mkdir(parents=True, exist_ok=True)
        temporary_path = self.file_path.with_suffix(".tmp")
        temporary_path.write_text(
            json.dumps(payload, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        temporary_path.replace(self.file_path)
        self._cached_payload = payload
        self._cached_mtime_ns = self._stat_mtime_ns_unlocked()

    def get(self, telegram_user_id: str) -> UserProfile | None:
        normalized_id = _as_string(telegram_user_id)
        if normalized_id is None:
            return None

        with self.lock:
            payload = self._load_unlocked().get(normalized_id)

        if not isinstance(payload, dict):
            return None

        try:
            return UserProfile.from_mapping(payload)
        except ProfileValidationError:
            return None

    def upsert(self, profile: UserProfile) -> UserProfile:
        with self.lock:
            payload = self._load_unlocked()
            existing_profile = None
            existing_payload = payload.get(profile.telegram_user_id)
            if isinstance(existing_payload, dict):
                try:
                    existing_profile = UserProfile.from_mapping(existing_payload)
                except ProfileValidationError:
                    existing_profile = None

            stored_profile = profile
            if (
                existing_profile is not None
                and existing_profile.role == "student"
                and profile.role == "student"
            ):
                stored_profile = replace(
                    profile,
                    iis_login=profile.iis_login or existing_profile.iis_login,
                    iis_password=profile.iis_password or existing_profile.iis_password,
                )

            payload[profile.telegram_user_id] = stored_profile.to_dict(
                include_sensitive=True
            )
            self._save_unlocked(payload)

        return stored_profile

    def delete(self, telegram_user_id: str) -> bool:
        normalized_id = _as_string(telegram_user_id)
        if normalized_id is None:
            return False

        with self.lock:
            payload = self._load_unlocked()
            existed = payload.pop(normalized_id, None) is not None
            if existed:
                self._save_unlocked(payload)

        return existed
