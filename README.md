# BSUIR Nexus

Telegram Mini App для БГУИР с frontend на React + Vite и backend на Python.

Проект решает одну задачу: дать студенту или преподавателю единый интерфейс для расписания, учебных данных, поиска по университету и личного профиля. Frontend не ходит в IIS БГУИР напрямую. Все запросы идут через свой backend, который кэширует ответы, повторяет временно неудачные запросы и приводит внешние данные к стабильному формату.

## Что умеет приложение

### Для студента

- планер задач с привязкой к сегодняшним занятиям;
- расписание по группе с режимами `day`, `week`, `month`, `semester`;
- фильтрация расписания по подгруппе;
- раздел `Учёба`: средний балл, место в рейтинге, оценки по предметам, пропуски по неуважительной причине;
- поиск преподавателей;
- поиск свободных аудиторий с учётом текущего расписания группы;
- редактирование и сброс профиля.

### Для преподавателя

- планер задач;
- расписание по профилю преподавателя;
- поиск преподавателей;
- поиск свободных аудиторий с учётом расписания преподавателя;
- редактирование и сброс профиля.

Важно: раздел `Учёба` сейчас ориентирован только на студента. Для преподавателя он показывает заглушку, потому что backend пока не получает для этой роли нужные учебные данные.

## Как устроен проект

Схема работы:

`Telegram Bot -> Mini App frontend -> Python backend -> IIS BSUIR API`

Что делает backend:

- проксирует запросы к `https://iis.bsuir.by/api/v1`;
- нормализует ответы под нужды интерфейса;
- кэширует данные в памяти;
- делает retry на временных ошибках;
- может отдавать устаревший кэш, если upstream временно недоступен;
- хранит пользовательские профили для Mini App и Telegram-бота.

## Стек

- frontend: `Rios`, `Tailwind CSS`, `Lucide React`, `@twa-dev/sdk`;eact 19`, `TypeScript`, `Vite`, `React Router`, `Zustand`, `Ax
- backend: `Python 3.13`, стандартная библиотека Python для локального HTTP-сервера, `uvicorn` для ASGI-запуска;
- деплой: `Render` через [`render.yaml`](./render.yaml).

## Структура репозитория

```text
.
|-- backend/
|   |-- data/                 # профили пользователей
|   |-- services/             # сервисы для рейтинга и пропусков
|   |-- env.py                # загрузка .env
|   |-- server.py             # основной backend
|   |-- telegram_bot.py       # Telegram bot wrapper
|   |-- *_test.py             # backend unit tests
|-- frontend/
|   |-- src/                  # интерфейс Mini App
|   |-- package.json          # frontend scripts
|   `-- vite.config.ts        # dev proxy на backend
|-- server.py                 # ASGI entry point для uvicorn/Render
|-- render.yaml               # Render Blueprint
|-- .env.example
|-- BACKEND_PLAN.md
`-- README.md
```

Ключевые точки входа:

- [`frontend/package.json`](./frontend/package.json) — запуск frontend, backend и тестов;
- [`backend/server.py`](./backend/server.py) — локальный сервер и логика API;
- [`server.py`](./server.py) — экспортирует `app` для команды `uvicorn server:app`.

## Что хранится где

- задачи планера и часть клиентских настроек сохраняются в `localStorage`;
- профиль пользователя хранится и на клиенте, и на backend;
- backend сохраняет профили в `backend/data/user_profiles.json` и создаёт этот файл при первом сохранении профиля;
- пароль IIS не возвращается обратно в API профиля: вместо него frontend получает только признак `hasIisPassword`.

Если вы деплоите проект в прод, это важно учитывать: сейчас хранилище профилей файловое, без БД и без внешнего secret storage.

## Локальный запуск

### Требования

- `Node.js` и `npm`;
- `Python 3.13`.

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

В первом терминале:

```powershell
cd frontend
npm run dev:backend
```

Backend поднимется на `http://localhost:8787`.

### 4. Запустите frontend

Во втором терминале:

```powershell
cd frontend
npm run dev
```

Frontend будет доступен на `http://localhost:5173`.

В `vite.config.ts` настроен proxy: все запросы на `/api` автоматически уходят на `http://localhost:8787`.

### 5. При необходимости запустите Telegram-бота

В третьем терминале:

```powershell
cd frontend
npm run dev:bot
```

Это режим long polling для локальной разработки. Для публичного деплоя лучше использовать webhook через backend.

### 6. Проверьте backend

Откройте:

- `http://localhost:8787/`
- `http://localhost:8787/api/health`

## Скрипты

Все основные команды живут в [`frontend/package.json`](./frontend/package.json):

```powershell
cd frontend
npm run dev
npm run dev:backend
npm run dev:bot
npm run build
npm run lint
npm run test:backend
```

Важно: для обычной локальной разработки backend не требует сторонних Python-библиотек, потому что локальный сервер построен на стандартной библиотеке. `uvicorn` из [`backend/requirements.txt`](./backend/requirements.txt) нужен для ASGI-запуска и деплоя.

## Переменные окружения

Полный список есть в [`.env.example`](./.env.example). Ниже только основные переменные.

### Frontend

- `VITE_API_BASE_URL` — базовый URL backend API. Локально по умолчанию используется `/api`.

### Backend

- `HOST` — адрес локального backend-сервера;
- `PORT` — порт backend-сервера;
- `IIS_BASE_URL` — upstream API БГУИР;
- `CACHE_TTL_MS` — время жизни свежего кэша;
- `STALE_TTL_MS` — сколько можно отдавать устаревший кэш;
- `REQUEST_TIMEOUT_MS` — timeout запроса к upstream;
- `MAX_RETRIES` и `RETRY_DELAY_MS` — настройки повторных попыток.

### Telegram

- `BOT_TOKEN` — токен бота;
- `MINI_APP_URL` — публичный HTTPS URL frontend;
- `BACKEND_PUBLIC_URL` — публичный HTTPS URL backend;
- `TELEGRAM_WEBHOOK_SECRET` — секрет для проверки Telegram webhook;
- `TELEGRAM_MINI_APP_BUTTON_TEXT` — текст кнопки открытия Mini App;
- `TELEGRAM_START_TEXT` — текст сообщений `/start`, `/app`, `/help`;
- `TELEGRAM_POLLING_TIMEOUT_S`, `TELEGRAM_RETRY_DELAY_MS`, `TELEGRAM_DROP_PENDING_UPDATES`, `TELEGRAM_SET_CHAT_MENU_BUTTON` — параметры работы Telegram wrapper.

## Backend API

Основные endpoint'ы:

- `GET /` — краткая информация о сервисе;
- `GET /api/health` — health-check backend;
- `GET /api/schedule` — расписание по группе или преподавателю;
- `GET /api/rating/{studentCardNumber}` — оценки, средний балл, позиция в рейтинге;
- `GET /api/grades?studentCardNumber=...` — альтернативная точка для оценок;
- `GET /api/omissions?telegramUserId=...` — пропуски по профилю студента;
- `GET /api/search-employee?query=...` — поиск преподавателей;
- `GET /api/employees?q=...` — совместимый alias для поиска преподавателей;
- `GET /api/auditories?q=...` — поиск аудиторий;
- `GET /api/free-auditories?...` — поиск свободных аудиторий;
- `GET /api/profile?telegramUserId=...` — получить профиль;
- `PUT /api/profile` и `POST /api/profile` — создать или обновить профиль;
- `DELETE /api/profile?telegramUserId=...` — удалить профиль;
- `POST /telegram/webhook` — Telegram webhook.

Ключевые параметры расписания:

- для студента нужен `studentGroup`;
- для преподавателя нужен `teacherUrlId`;
- дополнительно поддерживаются `teacherEmployeeId`, `subgroup`, `date`, `view`, `week`.

## Telegram-бот

Telegram wrapper находится в [`backend/telegram_bot.py`](./backend/telegram_bot.py).

Что он умеет:

- отвечает на `/start`, `/app`, `/help`;
- отправляет кнопку `web_app` для открытия Mini App;
- умеет работать через long polling;
- умеет автоматически регистрировать webhook;
- может установить кнопку Mini App в меню чата.

Webhook на backend настраивается автоматически при старте ASGI-приложения, если заданы `BOT_TOKEN`, `MINI_APP_URL` и `BACKEND_PUBLIC_URL`.

Важно: для реального открытия Mini App внутри Telegram нужен публичный `HTTPS` URL. Локальный `http://localhost:5173` подходит только для разработки в браузере.

## Деплой на Render

В репозитории уже есть [`render.yaml`](./render.yaml). Он создаёт два сервиса:

- `frontend-tg` — `Static Site` для Vite frontend;
- `backend-tg-u57f` — `Web Service` для Python backend.

Что важно при деплое:

- frontend публикуется из `frontend/dist`;
- backend стартует командой `uvicorn server:app --host 0.0.0.0 --port $PORT`;
- `server.py` в корне нужен именно для такого запуска;
- `VITE_API_BASE_URL` на frontend должен указывать на публичный backend `/api`;
- `MINI_APP_URL` должен указывать на публичный frontend;
- `BACKEND_PUBLIC_URL` должен указывать на публичный backend;
- если нужен бот, задайте `BOT_TOKEN` и `TELEGRAM_WEBHOOK_SECRET`.

Если имена сервисов или домены меняются, не забудьте обновить соответствующие env-переменные.

## Тесты и проверка качества

Backend тесты:

```powershell
cd frontend
npm run test:backend
```

Проверка frontend-кода:

```powershell
cd frontend
npm run lint
```

## Дополнительно

- Детали по backend и дальнейшему развитию: [`BACKEND_PLAN.md`](./BACKEND_PLAN.md)
- Upstream API БГУИР: `https://iis.bsuir.by/api/v1`
- Swagger upstream API: `https://iis.bsuir.by/api/v1/swagger`
