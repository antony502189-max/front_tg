# BSUIR Nexus

Telegram Mini App для БГУИР с frontend на React + Vite и backend на Python.

Приложение даёт студенту или преподавателю единый интерфейс для расписания, учебных данных, поиска по университету, планера задач и профиля. Frontend не обращается к IIS БГУИР напрямую: все запросы идут через backend, который кэширует ответы, повторяет временно неудачные запросы и приводит внешние данные к стабильному формату.

## Возможности

### Студент

- расписание группы в режимах `day`, `week`, `month`, `semester`;
- фильтрация расписания по подгруппе;
- раздел `Учёба`: оценки, средний балл, позиция в рейтинге и пропуски;
- поиск преподавателей;
- поиск аудиторий и свободных аудиторий с учётом текущего расписания группы;
- планер задач;
- сохранение профиля, номера группы, подгруппы, номера зачётки и IIS-данных.

### Преподаватель

- расписание по профилю преподавателя;
- поиск преподавателей;
- поиск аудиторий и свободных аудиторий с учётом расписания преподавателя;
- планер задач;
- сохранение профиля преподавателя.

Раздел `Учёба` ориентирован на студента. Для преподавателя в интерфейсе нет полноценного учебного отчёта, потому что backend не получает для этой роли оценки, рейтинг и пропуски.

## Архитектура

```text
Telegram Bot -> Mini App frontend -> Python backend -> IIS BSUIR API
```

Backend делает следующее:

- проксирует запросы к `https://iis.bsuir.by/api/v1`;
- нормализует расписание, оценки, рейтинг, пропуски, преподавателей и аудитории;
- хранит in-memory cache и умеет отдавать stale cache при временных ошибках upstream API;
- повторяет временно неудачные upstream-запросы;
- дедуплицирует одинаковые параллельные backend-запросы;
- хранит пользовательские профили в файловом JSON-хранилище;
- обслуживает Telegram webhook для Mini App-бота.

## Стек

- frontend: `React 19`, `TypeScript`, `Vite`, `React Router`, `Zustand`, `Axios`, `Tailwind CSS`, `Lucide React`, `@twa-dev/sdk`;
- backend: `Python 3.13`, стандартная библиотека Python для локального HTTP-сервера, `uvicorn` для ASGI-запуска;
- деплой: Render Blueprint через [`render.yaml`](./render.yaml).

## Структура

```text
.
|-- backend/
|   |-- data/                 # создаётся автоматически для user_profiles.json
|   |-- services/             # сервисы рейтинга и пропусков
|   |-- env.py                # загрузка .env и .env.local
|   |-- server.py             # основной backend, API, cache, ASGI wrapper
|   |-- telegram_bot.py       # Telegram bot wrapper
|   |-- *_test.py             # backend unit tests
|-- frontend/
|   |-- src/                  # интерфейс Mini App
|   |-- package.json          # frontend, backend и test scripts
|   `-- vite.config.ts        # proxy /api на локальный backend
|-- server.py                 # ASGI entry point для uvicorn/Render
|-- render.yaml               # Render Blueprint
|-- .env.example              # пример переменных окружения
|-- BACKEND_PLAN.md
`-- README.md
```

Ключевые точки входа:

- [`frontend/package.json`](./frontend/package.json) — команды разработки;
- [`frontend/vite.config.ts`](./frontend/vite.config.ts) — Vite proxy и сборка;
- [`backend/server.py`](./backend/server.py) — backend API, нормализация, cache, ASGI adapter;
- [`backend/telegram_bot.py`](./backend/telegram_bot.py) — long polling, webhook и кнопка Mini App;
- [`server.py`](./server.py) — экспорт `app` для `uvicorn server:app`.

## Локальный запуск

### Требования

- Node.js и npm;
- Python 3.13.

### 1. Подготовьте `.env`

```powershell
copy .env.example .env
```

### 2. Установите frontend-зависимости

```powershell
cd frontend
npm install
```

### 3. Запустите backend

```powershell
cd frontend
npm run dev:backend
```

Backend будет доступен на `http://localhost:8787`.

### 4. Запустите frontend

```powershell
cd frontend
npm run dev
```

Frontend будет доступен на `http://localhost:5173`.

Vite читает env из корня проекта и проксирует `/api` на `http://localhost:8787`.

### 5. При необходимости запустите Telegram-бота

```powershell
cd frontend
npm run dev:bot
```

Это long polling-режим для локальной разработки. Для публичного деплоя используется webhook через backend.

### 6. Проверьте backend

Откройте:

- `http://localhost:8787/`
- `http://localhost:8787/api/health`

## Скрипты

Основные команды находятся в [`frontend/package.json`](./frontend/package.json):

```powershell
cd frontend
npm run dev
npm run dev:backend
npm run dev:bot
npm run build
npm run lint
npm run test:backend
```

`npm run test:backend` сейчас запускает основные backend-тесты: `server_test`, `telegram_bot_test`, `env_test`, `user_profiles_test`.

Если нужно проверить сервисные тесты отдельно:

```powershell
cd ..
python -m unittest -v backend.services.rating_test backend.services.omissions_test
```

## Данные и хранение

- задачи планера и часть UI-настроек хранятся в `localStorage`;
- профиль пользователя хранится на клиенте и в backend;
- backend сохраняет профили в `backend/data/user_profiles.json`;
- файл профилей создаётся автоматически при первом сохранении;
- IIS-пароль не возвращается в API профиля, вместо него frontend получает `hasIisPassword`;
- при изменении IIS-логина сохранённый IIS-пароль сбрасывается.

Для production это важное ограничение: сейчас профили хранятся в файле, без БД и внешнего secret storage.

## Переменные окружения

Полный пример находится в [`.env.example`](./.env.example).

### Frontend

- `VITE_API_BASE_URL` — базовый URL backend API. Локально обычно `/api`.

### Backend

- `HOST` — адрес локального backend-сервера;
- `PORT` — порт локального backend-сервера;
- `IIS_BASE_URL` — upstream API БГУИР;
- `CACHE_TTL_MS` — время жизни свежего backend cache;
- `STALE_TTL_MS` — сколько backend может отдавать stale cache после истечения fresh cache;
- `REQUEST_TIMEOUT_MS` — timeout upstream-запросов;
- `MAX_RETRIES` — количество повторных попыток для временных upstream-ошибок;
- `RETRY_DELAY_MS` — базовая задержка между retry.

### Telegram

- `BOT_TOKEN` — токен Telegram-бота;
- `MINI_APP_URL` — публичный HTTPS URL frontend;
- `BACKEND_PUBLIC_URL` — публичный HTTPS URL backend для webhook;
- `TELEGRAM_WEBHOOK_SECRET` — секрет для проверки Telegram webhook;
- `TELEGRAM_API_BASE_URL` — базовый URL Telegram Bot API;
- `TELEGRAM_POLLING_TIMEOUT_S` — timeout long polling;
- `TELEGRAM_RETRY_DELAY_MS` — задержка retry в Telegram wrapper;
- `TELEGRAM_DROP_PENDING_UPDATES` — сбрасывать pending updates при настройке;
- `TELEGRAM_SET_CHAT_MENU_BUTTON` — устанавливать кнопку Mini App в меню чата;
- `TELEGRAM_MINI_APP_BUTTON_TEXT` — текст кнопки открытия Mini App;
- `TELEGRAM_START_TEXT` — текст ответа на `/start`, `/app`, `/help`.

## Backend API

### Служебные endpoint'ы

- `GET /` — информация о backend-сервисе;
- `GET /api/health` — health-check, uptime, текущий `iisBaseUrl`, количество cache entries;
- `POST /telegram/webhook` — Telegram webhook.

### Расписание

- `GET /api/schedule`

Параметры:

- `studentGroup` — группа студента;
- `teacherUrlId` или `urlId` — URL ID преподавателя;
- `teacherEmployeeId` или `employeeId` — employee ID преподавателя, если есть;
- `date` — опорная дата в формате `YYYY-MM-DD`;
- `view` — `day`, `week`, `month` или `semester`;
- `week` — номер учебной недели `1..4`;
- `subgroup` — `all`, `1` или `2`.

Нужен либо `studentGroup`, либо `teacherUrlId`.

### Учёба

- `GET /api/grades?studentCardNumber=...` — оценки и summary;
- `GET /api/rating-summary?studentCardNumber=...` — облегчённый summary рейтинга;
- `GET /api/rating/{studentCardNumber}` — совместимая точка рейтинга и оценок;
- `GET /api/omissions?telegramUserId=...` — пропуски по сохранённому профилю студента.

Дополнительно поддерживаются:

- `studentGroup` — помогает вычислить позицию в рейтинге;
- `telegramUserId` — привязывает запрос к сохранённому профилю;
- `refresh=1` — обходит fresh cache для поддерживаемых учебных endpoint'ов.

Для пропусков нужен сохранённый студенческий профиль с IIS-логином и IIS-паролем.

### Университетский поиск

- `GET /api/search-employee?query=...` — поиск преподавателей;
- `GET /api/employees?q=...` — alias для поиска преподавателей;
- `GET /api/auditories?q=...` — поиск аудиторий;
- `GET /api/free-auditories?...` — аудитории с текущим и следующим занятием по расписанию группы или преподавателя.

`/api/free-auditories` принимает `query` или `q`, а также `studentGroup` либо `teacherUrlId`.

### Профиль

- `GET /api/profile?telegramUserId=...` — получить профиль;
- `PUT /api/profile` — создать или обновить профиль;
- `POST /api/profile` — совместимый alias для сохранения профиля;
- `DELETE /api/profile?telegramUserId=...` — удалить профиль.

Профиль студента требует `telegramUserId`, `role=student`, `groupNumber` и `studentCardNumber` или `iisLogin`.

Профиль преподавателя требует `telegramUserId`, `role=teacher`, `employeeId`, `urlId` и `fullName`.

## Telegram-бот

Telegram wrapper находится в [`backend/telegram_bot.py`](./backend/telegram_bot.py).

Он:

- отвечает на `/start`, `/app`, `/help`;
- отправляет inline-кнопку `web_app`;
- может установить Mini App в меню чата;
- работает через long polling локально;
- автоматически регистрирует webhook при старте ASGI-приложения, если заданы `BOT_TOKEN`, `MINI_APP_URL` и `BACKEND_PUBLIC_URL`.

Для реального открытия Mini App внутри Telegram нужен публичный `HTTPS` URL. `http://localhost:5173` подходит только для разработки в браузере.

## Деплой на Render

[`render.yaml`](./render.yaml) описывает два сервиса:

- `frontend-tg` — Static Site для Vite frontend;
- `backend-tg-u57f` — Python Web Service для backend.

Render-сборка:

- frontend: `cd frontend && npm ci && npm run build`;
- frontend publish path: `frontend/dist`;
- backend: `pip install -r backend/requirements.txt`;
- backend start command: `uvicorn server:app --host 0.0.0.0 --port $PORT`;
- backend health check: `/api/health`.

При смене доменов или имён сервисов обновите:

- `VITE_API_BASE_URL`;
- `MINI_APP_URL`;
- `BACKEND_PUBLIC_URL`;
- при необходимости `BOT_TOKEN` и `TELEGRAM_WEBHOOK_SECRET`.

## Проверка качества

Backend:

```powershell
cd frontend
npm run test:backend
```

Frontend lint:

```powershell
cd frontend
npm run lint
```

Frontend build:

```powershell
cd frontend
npm run build
```

## Дополнительно

- Backend roadmap и правила развития: [`BACKEND_PLAN.md`](./BACKEND_PLAN.md)
- Upstream API БГУИР: `https://iis.bsuir.by/api/v1`
- Swagger upstream API: `https://iis.bsuir.by/api/v1/swagger`
