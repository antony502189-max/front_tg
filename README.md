# Frontend для Telegram Mini App

Этот репозиторий содержит фронтенд (React + TypeScript + Vite) и базовый backend-прокси для Telegram Mini App.

## Нужен ли отдельный backend?

Короткий ответ: **зависит от задач**, но для production обычно backend нужен.

### Когда можно без backend

Если API `https://iis.bsuir.by/api`:
- доступен из браузера,
- корректно настроен по CORS,
- не требует хранения секретов,
- и вам хватает простого чтения данных,

то фронтенд может ходить в него напрямую.

### Когда backend обязателен (рекомендуется)

Делайте backend-прокси между фронтом и `https://iis.bsuir.by/api`, если нужно:
- хранить секреты/токены (нельзя держать в клиенте),
- централизованно кэшировать данные и снижать нагрузку,
- добавить бизнес-логику и валидацию,
- унифицировать обработку ошибок и ретраи,
- логировать запросы/метрики,
- избегать проблем CORS и ограничений стороннего API.

## Рекомендуемая схема

`Telegram Mini App (frontend) -> ваш backend -> https://iis.bsuir.by/api`

Так фронтенд остается «тонким», а интеграция с внешним API становится управляемой и безопасной.

## Что уже реализовано в backend

`backend.server.mjs` поднимает API на `http://localhost:8787`:
- `GET /api/health`
- `GET /api/schedule?studentGroup=...`
- `GET /api/grades?studentCardNumber=...`
- `GET /api/employees?q=...`

Функции backend:
- проксирование запросов к IIS API,
- валидация query-параметров,
- retry на сетевые/5xx/429 ошибки,
- in-memory cache по URL+query,
- stale-cache fallback (если upstream временно недоступен, возвращается устаревший кэш).

## Быстрый старт

```bash
npm install
npm run dev:backend
npm run dev

# backend smoke/unit checks
npm run test:backend
```

По умолчанию фронтенд использует `VITE_API_BASE_URL=/api`, а Vite проксирует `/api` на `http://localhost:8787`.
