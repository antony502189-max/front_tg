# Telegram Mini App для БГУИР

Это проект Telegram Mini App на React + Vite с backend на Python.

Фронтенд отвечает за интерфейс, а backend берет на себя работу с IIS БГУИР:
- ходит в `https://iis.bsuir.by/api/v1`;
- кэширует ответы;
- делает retry на временные ошибки;
- приводит ответы к формату, который ожидает интерфейс.

Идея простая: фронт не должен знать детали внешнего API. Он работает только со своим стабильным `/api`.

## Как это работает

Схема такая:

`Telegram Mini App -> Python backend -> IIS BSUIR API`

Backend поднимается локально на `http://localhost:8787`, а Vite в dev-режиме проксирует туда запросы с `/api`.

## Структура проекта

```text
.
|-- backend
|   |-- server.py
|   |-- server_test.py
|   `-- __init__.py
|-- public
|-- src
|   |-- api
|   |-- assets
|   |-- components
|   |-- hooks
|   |-- layouts
|   |-- mocks
|   |-- pages
|   |-- store
|   `-- telegram
|-- .env.example
|-- index.html
|-- package.json
|-- postcss.config.cjs
|-- tailwind.config.cjs
|-- tsconfig.json
`-- vite.config.ts
```

Что где лежит:
- `src/` — весь frontend.
- `backend/` — весь backend на Python.
- корневые конфиги остаются в корне, потому что их так ожидают Vite, TypeScript и npm.

## Backend API

Локальный backend отдает:
- `GET /api/health`
- `GET /api/schedule?studentGroup=...`
- `GET /api/grades?studentCardNumber=...`
- `GET /api/employees?q=...`

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
npm install
npm run dev:backend
npm run dev
```

Проверка backend:

```bash
npm run test:backend
```

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

## Коротко по сути

Сейчас backend в проекте один и он полностью на Python. Node-вариант из репозитория убран.
