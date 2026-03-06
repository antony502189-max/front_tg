# Telegram Mini App для БГУИР

Это проект Telegram Mini App на React + Vite с backend на Python и простой Python-обёрткой для Telegram-бота.

Внутреннее имя проекта — `BSUIR Nexus`: это mobile-first помощник студента с планером, учебной статистикой, расписанием, университетским поиском и настройками профиля.

## Самое важное

- вкладки приложения: `Планер`, `Учёба`, `Расписание`, `Универ`, `Настройки`;
- стек: `React 19`, `TypeScript`, `Vite`, `React Router`, `Zustand`, `Axios`, `Framer Motion`, `Lucide React`, `@twa-dev/sdk`;
- Telegram-интеграция: приложение инициализируется через `WebApp.ready()` и подстраивает тему из `WebApp.themeParams`;
- пользовательские данные (`groupNumber`, `studentCardNumber`, `subgroup`) сохраняются в `localStorage` через Zustand-store;
- frontend работает через локальный Python backend, а не ходит в IIS API напрямую.

Фронтенд отвечает за интерфейс, а backend берет на себя работу с IIS БГУИР:
- ходит в `https://iis.bsuir.by/api/v1`;
- кэширует ответы;
- делает retry на временные ошибки;
- приводит ответы к формату, который ожидает интерфейс.

Идея простая: фронт не должен знать детали внешнего API. Он работает только со своим стабильным `/api`.

Детальный план развития и рефакторинга backend: [`BACKEND_PLAN.md`](./BACKEND_PLAN.md).

## Как это работает

Схема такая:

`Telegram Bot -> Mini App frontend -> Python backend -> IIS BSUIR API`

Backend поднимается локально на `http://localhost:8787`, Vite в dev-режиме проксирует туда запросы с `/api`, а обёртка бота умеет отдавать кнопку для открытия Mini App.

## Структура проекта

```text
.
|-- frontend
|   |-- package.json
|   |-- vite.config.ts
|   |-- tsconfig.json
|   |-- tailwind.config.cjs
|   |-- postcss.config.cjs
|   |-- eslint.config.js
|   |-- public
|   |-- src
|   `-- index.html
|-- backend
|   |-- env.py
|   |-- server.py
|   |-- server_test.py
|   |-- telegram_bot.py
|   |-- telegram_bot_test.py
|   `-- __init__.py
|-- .env.example
|-- BACKEND_PLAN.md
`-- README.md
```

Что где лежит:
- `frontend/` — весь frontend: исходники, `index.html`, `package.json` и Vite/TS/CSS-конфиги.
- `backend/` — Python backend, загрузка `.env` и Telegram-обёртка.
- корень проекта теперь в основном содержит backend, документацию и общий `.env`, который читает и backend, и Vite frontend.

## Backend API

Локальный backend отдает:
- `GET /api/health`
- `GET /api/schedule?studentGroup=...`
- `GET /api/grades?studentCardNumber=...`
- `GET /api/employees?q=...`

Telegram-обёртка:
- работает через long polling;
- автоматически снимает webhook перед запуском polling;
- отвечает на `/start`, `/app`, `/help`;
- отправляет кнопку `web_app` для открытия Mini App;
- может выставить menu button у бота автоматически.

Что он делает внутри:
- валидирует параметры;
- делает retry на сетевые ошибки и `5xx/429`;
- использует in-memory cache;
- возвращает stale cache, если upstream временно недоступен;
- нормализует ответы IIS под frontend.

Актуальный upstream:
- base URL: `https://iis.bsuir.by/api/v1`
- swagger: `https://iis.bsuir.by/api/v1/swagger`

## Быстрый старт

```bash
copy .env.example .env
cd frontend
npm install
npm run dev:backend
npm run dev
```

Если нужен запуск обёртки бота:

```bash
npm run dev:bot
```

Проверка backend:

```bash
npm run test:backend
```

## Render

Для нормального деплоя Mini App на Render проект лучше поднимать как **2 сервиса**:

- `front-tg-frontend` — `Static Site` для Vite frontend;
- `front-tg-backend` — `Web Service` для Python backend.

В репозитории для этого есть:

- `render.yaml` — Blueprint сразу для двух Render-сервисов;
- `backend/requirements.txt` — файл Python-зависимостей;
- `.python-version` — фиксирует ветку Python `3.13`.

Что делает blueprint:

- frontend собирается из `frontend/` как static site;
- frontend использует `VITE_API_BASE_URL=https://front-tg-backend.onrender.com/api`;
- backend стартует командой `uvicorn server:app --host 0.0.0.0 --port $PORT`.

Важно для Telegram:

- `MINI_APP_URL` у бота должен указывать уже на публичный URL frontend-сервиса Render, например `https://front-tg-frontend.onrender.com`;
- backend URL можно открывать как сервисный endpoint: `/api/health` для health-check и `/` для краткого описания сервиса.

## Переменные окружения

Смотри `.env.example`. Основные настройки:
- `VITE_API_BASE_URL`
- `PORT`
- `IIS_BASE_URL`
- `CACHE_TTL_MS`
- `STALE_TTL_MS`
- `REQUEST_TIMEOUT_MS`
- `MAX_RETRIES`
- `RETRY_DELAY_MS`
- `BOT_TOKEN`
- `MINI_APP_URL`
- `TELEGRAM_API_BASE_URL`
- `TELEGRAM_POLLING_TIMEOUT_S`
- `TELEGRAM_RETRY_DELAY_MS`
- `TELEGRAM_DROP_PENDING_UPDATES`
- `TELEGRAM_SET_CHAT_MENU_BUTTON`

## Коротко по сути

Сейчас backend в проекте один и он полностью на Python. Node-вариант из репозитория убран, а Telegram-обёртка тоже живёт рядом в Python.

Важно для Telegram:
- для реального запуска Mini App внутри Telegram нужен публичный HTTPS URL в `MINI_APP_URL`;
- локальный `http://localhost:5173` подходит только для браузерной разработки, но не для нормального открытия Mini App у пользователей.
