# План backend для BSUIR Nexus

## 1. Зачем backend уже сейчас

Текущий backend в проекте не «будущий», а уже рабочий слой между frontend и `https://iis.bsuir.by/api/v1`.

Его задача:

- держать для frontend стабильный контракт `/api`;
- изолировать UI от особенностей IIS BSUIR API;
- централизовать retry, timeout, кэш и fallback-логику;
- не хранить Telegram- и служебную логику во frontend;
- упростить дальнейшее развитие без переписывания клиента.

## 2. Текущая реализация

Сейчас backend полностью написан на Python и живёт в `backend/`.

Основные части:

- `backend/server.py` — HTTP backend на стандартной библиотеке Python (`ThreadingHTTPServer`);
- `backend/env.py` — загрузка `.env` и `.env.local`;
- `backend/telegram_bot.py` — Telegram-обёртка с long polling и кнопкой `web_app`;
- `backend/server_test.py`, `backend/telegram_bot_test.py`, `backend/env_test.py` — базовые unit-тесты.

Важно: текущий план не предлагает срочно мигрировать на `FastAPI` или другой фреймворк. Сначала имеет смысл развивать уже существующую реализацию.

## 3. Текущий контракт backend

Backend отдаёт:

- `GET /api/health`
- `GET /api/schedule?studentGroup=...`
- `GET /api/grades?studentCardNumber=...`
- `GET /api/employees?q=...`

Frontend должен продолжать работать только с этими `/api`-эндпоинтами, не обращаясь к IIS напрямую.

## 4. Что backend делает внутри

### Прокси и нормализация

- ходит в `IIS_BASE_URL`;
- валидирует входные query-параметры;
- нормализует ответы IIS под текущие потребности frontend;
- скрывает от клиента нестабильные детали upstream API.

### Надёжность

- использует таймауты на внешние запросы;
- повторяет временные ошибки (`5xx`, `429`, сетевые сбои);
- держит in-memory cache;
- умеет возвращать stale cache, если upstream временно недоступен.

### Telegram-слой

- снимает webhook перед long polling;
- обрабатывает `/start`, `/app`, `/help`;
- отправляет кнопку открытия Mini App;
- может выставлять `menu_button` автоматически.

## 5. Локальная архитектура

Актуальная схема разработки:

`Telegram Bot -> Mini App frontend -> Python backend -> IIS BSUIR API`

В dev-режиме:

- `vite` поднимает frontend;
- Vite читает общий корневой `.env`;
- Vite проксирует `/api` на `http://localhost:8787`;
- `backend.server` обслуживает backend-запросы;
- `backend.telegram_bot` отдаёт ссылку на публичный HTTPS URL Mini App.

## 6. Команды разработки

Подготовка:

```bash
copy .env.example .env
cd frontend
npm install
```

Запуск backend:

```bash
npm run dev:backend
```

Запуск frontend:

```bash
npm run dev
```

Запуск Telegram-бота:

```bash
npm run dev:bot
```

Проверка backend:

```bash
npm run test:backend
```

## 7. Ключевые env-переменные

### Backend

- `PORT`
- `IIS_BASE_URL`
- `CACHE_TTL_MS`
- `STALE_TTL_MS`
- `REQUEST_TIMEOUT_MS`
- `MAX_RETRIES`
- `RETRY_DELAY_MS`

### Telegram

- `BOT_TOKEN`
- `MINI_APP_URL`
- `TELEGRAM_API_BASE_URL`
- `TELEGRAM_POLLING_TIMEOUT_S`
- `TELEGRAM_RETRY_DELAY_MS`
- `TELEGRAM_DROP_PENDING_UPDATES`
- `TELEGRAM_SET_CHAT_MENU_BUTTON`
- `TELEGRAM_MINI_APP_BUTTON_TEXT`
- `TELEGRAM_START_TEXT`

## 8. План ближайшего развития

### Этап 1 — стабилизация текущего backend

- удерживать контракт `/api` стабильным;
- продолжать покрывать тестами нормализацию schedule, grades и employees;
- не дублировать логику IIS API во frontend;
- улучшать сообщения об ошибках и наблюдаемость.

### Этап 2 — декомпозиция `backend/server.py`

Когда логика станет тяжелее поддерживаться в одном файле, имеет смысл вынести:

- `config.py` — конфигурация и env;
- `routes.py` — маршруты и валидация параметров;
- `cache.py` — кэш и stale-стратегии;
- `clients/` — вызовы upstream API;
- `normalizers/` — преобразование IIS payload в формат frontend.

Это нужно делать без смены внешнего API контракта.

### Этап 3 — операционная удобность

- добавить единый dev-скрипт для запуска frontend, backend, bot и tunnel;
- добавить более явные логи ошибок и retry-событий;
- при необходимости добавить health-check для bot/tunnel на уровне dev tooling.

### Этап 4 — только при реальной необходимости

Переход на `FastAPI` или другой framework стоит рассматривать только если появятся реальные ограничения:

- нужен OpenAPI/Swagger для внешних интеграций;
- появится сложная middleware-цепочка;
- понадобится auth/roles/admin API;
- появятся дополнительные клиенты помимо текущего Mini App;
- текущая stdlib-реализация станет мешать скорости изменений.

До этого момента приоритет — не migration ради migration, а предсказуемый backend для текущего продукта.

## 9. Что не стоит делать сейчас

- не убирать Python backend в пользу прямых вызовов IIS из frontend;
- не менять `/api` контракт без синхронного обновления frontend;
- не тащить новый framework только ради «современности»;
- не хранить Telegram token и другие чувствительные данные во frontend.

## 10. Definition of Done для backend-изменений

Любая следующая доработка backend считается завершённой, если:

- frontend продолжает работать через `/api`;
- сценарии `schedule`, `grades`, `employees` не ломаются;
- есть проверка хотя бы на уровне существующих backend-тестов;
- новые env-переменные описаны в `.env.example` и README;
- изменение не заставляет frontend знать детали IIS API.
