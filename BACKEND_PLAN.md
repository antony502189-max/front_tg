# Backend roadmap для BSUIR Nexus

Этот документ фиксирует текущее состояние backend и правила его дальнейшего развития. Это уже не план "когда-нибудь добавить backend": backend существует и является обязательным слоем между Mini App и IIS BSUIR API.

## 1. Роль backend

Backend нужен, чтобы:

- держать для frontend стабильный контракт `/api`;
- изолировать UI от форматов, ошибок и задержек IIS BSUIR API;
- централизовать timeout, retry, cache, stale fallback и логирование upstream-ошибок;
- хранить профили пользователей и чувствительные IIS-данные вне frontend;
- обслуживать Telegram webhook и long polling-режим бота;
- позволять развивать Mini App без прямой привязки frontend к upstream API.

Схема:

```text
Telegram Bot -> Mini App frontend -> Python backend -> IIS BSUIR API
```

## 2. Текущая реализация

Backend написан на Python и находится в `backend/`.

Основные файлы:

- `backend/server.py` — HTTP backend на `ThreadingHTTPServer`, ASGI adapter, маршруты, cache, нормализация ответов;
- `backend/env.py` — загрузка `.env` и `.env.local`;
- `backend/user_profiles.py` — файловое хранилище профилей;
- `backend/telegram_bot.py` — Telegram Bot API wrapper, long polling, webhook setup, `web_app`-кнопки;
- `backend/services/rating.py` — cache и вспомогательная логика рейтинга;
- `backend/services/omissions.py` — запросы пропусков через IIS/gradebook-источники;
- `server.py` — ASGI entry point для `uvicorn server:app`.

Текущий backend специально остаётся на стандартной библиотеке. Миграция на FastAPI или другой framework не является самоцелью.

## 3. Текущий контракт `/api`

Служебные:

- `GET /`
- `GET /api/health`
- `POST /telegram/webhook`

Расписание:

- `GET /api/schedule?studentGroup=...`
- `GET /api/schedule?teacherUrlId=...`

Поддерживаемые параметры расписания:

- `date`;
- `view=day|week|month|semester`;
- `week=1|2|3|4`;
- `subgroup=all|1|2`;
- `teacherEmployeeId` или `employeeId`.

Учёба:

- `GET /api/grades?studentCardNumber=...`
- `GET /api/rating-summary?studentCardNumber=...`
- `GET /api/rating/{studentCardNumber}`
- `GET /api/omissions?telegramUserId=...`

Поиск:

- `GET /api/search-employee?query=...`
- `GET /api/employees?q=...`
- `GET /api/auditories?q=...`
- `GET /api/free-auditories?query=...&studentGroup=...`
- `GET /api/free-auditories?query=...&teacherUrlId=...`

Профили:

- `GET /api/profile?telegramUserId=...`
- `PUT /api/profile`
- `POST /api/profile`
- `DELETE /api/profile?telegramUserId=...`

Frontend должен продолжать работать только с этими `/api`-endpoint'ами и не обращаться к IIS напрямую.

## 4. Что backend делает внутри

### Upstream-запросы

- ходит в `IIS_BASE_URL`, по умолчанию `https://iis.bsuir.by/api/v1`;
- использует отдельные timeout'ы для долгих запросов оценок, рейтинга и поиска сотрудников;
- повторяет временные ошибки: `429`, `5xx` и сетевые ошибки, кроме timeout-сценариев, которые не всегда полезно повторять;
- логирует upstream-ошибки для чувствительных учебных сценариев с маскированием `studentCardNumber` и `telegramUserId`.

### Нормализация

Backend нормализует:

- расписание группы и преподавателя;
- текущую учебную неделю;
- режимы расписания `day`, `week`, `month`, `semester`;
- подгруппы;
- сотрудников;
- аудитории;
- свободные аудитории с текущим и следующим занятием;
- оценки, предметы, marks, average, position, speciality;
- пропуски по месяцам и предметам.

### Cache и fallback

- fresh cache живёт `CACHE_TTL_MS`;
- stale cache может отдаваться ещё `STALE_TTL_MS`, если upstream временно недоступен;
- одинаковые параллельные запросы шарят один in-flight upstream-вызов;
- `refresh=1` обходит fresh cache для поддерживаемых учебных endpoint'ов;
- cache хранится в памяти процесса и сбрасывается при рестарте.

### Профили

- профили хранятся в `backend/data/user_profiles.json`;
- файл создаётся автоматически;
- студент требует `groupNumber` и `studentCardNumber` или `iisLogin`;
- преподаватель требует `employeeId`, `urlId`, `fullName`;
- IIS-пароль хранится только на backend и не возвращается клиенту;
- клиент получает `hasIisPassword`;
- при смене IIS-логина сохранённый пароль сбрасывается.

### Telegram

- long polling используется для локального `npm run dev:bot`;
- webhook используется при ASGI-запуске и публичном `BACKEND_PUBLIC_URL`;
- webhook проверяет `TELEGRAM_WEBHOOK_SECRET`, если секрет задан;
- бот отвечает на `/start`, `/app`, `/help`;
- Mini App открывается через inline `web_app`-кнопку и menu button.

## 5. Локальная разработка

Подготовка:

```powershell
copy .env.example .env
cd frontend
npm install
```

Backend:

```powershell
npm run dev:backend
```

Frontend:

```powershell
npm run dev
```

Telegram bot в long polling:

```powershell
npm run dev:bot
```

Vite читает env из корня проекта и проксирует `/api` на `http://localhost:8787`.

## 6. Env-переменные

Backend:

- `HOST`
- `PORT`
- `IIS_BASE_URL`
- `CACHE_TTL_MS`
- `STALE_TTL_MS`
- `REQUEST_TIMEOUT_MS`
- `MAX_RETRIES`
- `RETRY_DELAY_MS`

Telegram:

- `BOT_TOKEN`
- `MINI_APP_URL`
- `BACKEND_PUBLIC_URL`
- `TELEGRAM_WEBHOOK_SECRET`
- `TELEGRAM_API_BASE_URL`
- `TELEGRAM_POLLING_TIMEOUT_S`
- `TELEGRAM_RETRY_DELAY_MS`
- `TELEGRAM_DROP_PENDING_UPDATES`
- `TELEGRAM_SET_CHAT_MENU_BUTTON`
- `TELEGRAM_MINI_APP_BUTTON_TEXT`
- `TELEGRAM_START_TEXT`

Frontend:

- `VITE_API_BASE_URL`

Новые переменные нужно добавлять одновременно в `.env.example`, README и Render config, если они нужны в production.

## 7. Тесты

Основная команда:

```powershell
cd frontend
npm run test:backend
```

Она запускает:

- `backend.server_test`;
- `backend.telegram_bot_test`;
- `backend.env_test`;
- `backend.user_profiles_test`.

Дополнительные сервисные тесты:

```powershell
cd ..
python -m unittest -v backend.services.rating_test backend.services.omissions_test
```

При backend-изменениях минимум нужно запускать релевантные unit-тесты. Если меняется общий контракт, cache, профили или Telegram webhook, нужно запускать весь backend-набор.

## 8. Ближайшие направления развития

### Этап 1 — удерживать контракт стабильным

- не допускать прямых IIS-запросов из frontend;
- сохранять совместимость существующих `/api` endpoint'ов;
- добавлять новые поля ответов без удаления старых;
- явно тестировать ошибки валидации и fallback на stale cache.

### Этап 2 — улучшить тестовый запуск

- включить `backend.services.rating_test` и `backend.services.omissions_test` в `npm run test:backend`;
- при необходимости добавить отдельные npm-скрипты для `test:backend:all` и быстрых тестов;
- документировать новые сценарии в README сразу вместе с кодом.

### Этап 3 — декомпозиция `backend/server.py`

`backend/server.py` стал большим. Когда изменения в нём начнут тормозить разработку, имеет смысл выносить модули без смены внешнего API:

- `config.py` — конфигурация и env;
- `routes.py` — маршруты и валидация;
- `cache.py` — cache, stale fallback, in-flight dedupe;
- `clients/iis.py` — upstream HTTP client;
- `normalizers/` — расписание, сотрудники, аудитории, оценки;
- `asgi.py` — ASGI adapter;
- `telegram_webhook.py` — webhook glue.

Разносить файл стоит небольшими шагами, с тестами после каждого шага.

### Этап 4 — production-хранилище профилей

Файловый JSON подходит для текущего прототипа, но имеет ограничения:

- не подходит для нескольких backend-инстансов;
- чувствительные IIS-данные лежат на файловой системе сервиса;
- нет миграций и аудита изменений.

Если приложение пойдёт в production с реальными пользователями, приоритетнее всего заменить хранение профилей на БД и нормальное secret storage.

### Этап 5 — framework только при реальной необходимости

FastAPI или другой framework стоит рассматривать, если появятся:

- внешний OpenAPI-контракт;
- auth/roles/admin API;
- сложная middleware-цепочка;
- несколько независимых клиентов;
- реальные ограничения текущего `ThreadingHTTPServer`/ASGI adapter.

До этого приоритет — стабильный backend и понятный контракт.

## 9. Что не стоит делать

- не возвращать прямые IIS-вызовы во frontend;
- не менять `/api` контракт без синхронного обновления frontend и тестов;
- не хранить Telegram token, IIS-пароли и другие секреты во frontend;
- не добавлять framework только ради "современности";
- не расширять профиль пользователя без обновления маскирования и документации;
- не логировать полные `studentCardNumber`, `telegramUserId`, IIS login или password.

## 10. Definition of Done для backend-изменений

Backend-изменение считается завершённым, если:

- frontend продолжает работать через `/api`;
- обновлены тесты для изменённого сценария;
- пройдены релевантные backend-тесты;
- новые env-переменные описаны в `.env.example`, README и Render config при необходимости;
- чувствительные данные не уходят в frontend-ответы и логи;
- README или этот roadmap обновлены, если изменился контракт, запуск, деплой или хранение данных.
