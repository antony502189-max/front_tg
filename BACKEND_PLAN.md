# План разработки backend для Telegram Mini App

## 1) Цель backend

Сделать локальный backend-прокси между фронтендом и `https://iis.bsuir.by/api`, чтобы:
- убрать прямую зависимость фронтенда от внешнего API;
- централизовать обработку ошибок/таймаутов/ретраев;
- добавить кэширование;
- подготовить базу для будущей бизнес-логики.

> Текущий фокус: **локальная разработка** (без CI/CD и прод-деплоя на этом этапе).

## 2) Что уже нужно фронтенду (MVP)

По текущему фронту нужны минимум 3 направления:
1. Расписание по группе (`/schedule?studentGroup=...`).
2. Оценки по номеру студенческого (`/grades?studentCardNumber=...`).
3. Поиск преподавателей (`/employees?q=...`).

## 3) Рекомендуемый стек (**backend на Python**)

- **Python 3.11+**.
- Фреймворк: **FastAPI**.
- HTTP-клиент к BSUIR API: `httpx` (async).
- Валидация/схемы: `pydantic`.
- Конфигурация: `pydantic-settings`.
- Кэш: in-memory (локально), Redis — позже при необходимости.
- Логи: стандартный `logging` (или `structlog` по желанию).

## 4) Архитектура

`Telegram Mini App frontend -> локальный backend (/api/*) -> iis.bsuir.by/api`

В backend разделить слои:
- `routers`: внешние эндпоинты для фронта;
- `services`: бизнес-правила;
- `clients`: интеграция с BSUIR API;
- `schemas`: pydantic-схемы запросов/ответов;
- `mappers`: нормализация/преобразование ответов.

## 5) Контракт эндпоинтов backend (MVP)

Префикс: `/api/v1`

1. `GET /api/v1/schedule?groupNumber=123456`
   - backend делает запрос в BSUIR schedule;
   - нормализует поля под формат фронта (`date`, `lessons[]`, `subject`, `startTime`, и т.д.).

2. `GET /api/v1/grades?studentCardNumber=1234567`
   - backend делает запрос в BSUIR grades;
   - возвращает единый формат `summary + subjects + marks`;
   - при недоступности внешнего API возвращает контролируемую ошибку.

3. `GET /api/v1/employees?query=иванов`
   - backend делает запрос в BSUIR employees;
   - нормализует ФИО, должность, кафедру, avatar.

## 6) Нефункциональные требования (для локального этапа)

- Таймаут внешнего запроса: 5–10 сек.
- Retry для 5xx/timeout: 1–2 повтора с backoff.
- Кэш:
  - расписание: 5–10 минут;
  - сотрудники (поиск): 1–5 минут;
  - оценки: короткий TTL (1–3 минуты) или без кэша.
- Единый формат ошибок:
  - `code`, `message`, `details`, `requestId`.

## 7) Безопасность

- Не хранить секреты в фронтенде.
- Конфиги только через env (`BSUIR_BASE_URL`, `PORT`, `CACHE_TTL` и т.д.).
- CORS: для локальной разработки разрешить `http://localhost:5173`.
- Валидация входных параметров (`groupNumber`, `studentCardNumber`, `query`).
- Санитизация персональных данных в логах.

## 8) Критерии готовности локального MVP

- Все 3 эндпоинта работают и возвращают стабильный формат.
- Фронтенд работает через backend (без прямых вызовов BSUIR API).
- Ошибки внешнего API не «роняют» UI и обрабатываются предсказуемо.
- Есть health-check (`/health`) и запуск через локальные команды.

## 9) Windows-first команды для старта backend (PowerShell)

```powershell
# 1) Создать папку backend и перейти в нее
mkdir backend
cd backend

# 2) Создать и активировать виртуальное окружение
py -3.11 -m venv .venv
.\.venv\Scripts\Activate.ps1

# 3) Установить зависимости
pip install -U pip
pip install fastapi uvicorn[standard] httpx pydantic pydantic-settings

# 4) Запуск dev-сервера
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

Если используется **CMD**, активация окружения:

```cmd
.venv\Scripts\activate.bat
```
