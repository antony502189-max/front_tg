# Telegram Mini App Frontend

Привет! Это фронтенд моего Telegram Mini App для учебных сценариев: расписание, учеба, планировщик задач и быстрый доступ к университетской информации.

Проект написан как SPA и оптимизирован под запуск внутри Telegram WebApp.

## Что есть в приложении

- онбординг пользователя при первом запуске;
- раздел с планировщиком задач;
- раздел с учебной статистикой/оценками;
- расписание занятий;
- поиск по преподавателям;
- экран настроек и работа с темой Telegram.

## Технологии

Основной стек:

- **React 19** — UI;
- **TypeScript** — типобезопасность;
- **Vite** — сборка и dev-сервер;
- **React Router** — маршрутизация внутри приложения;
- **Zustand** — управление состоянием;
- **Tailwind CSS** — стили;
- **Axios** — HTTP-клиент;
- **@twa-dev/sdk** — интеграция с Telegram Mini App API.

Дополнительно используются:

- **Framer Motion** для анимаций;
- **Lucide React** для иконок;
- **ESLint** для статического анализа кода.

## Структура проекта (кратко)

- `src/pages` — страницы приложения;
- `src/components` — переиспользуемые UI-компоненты;
- `src/store` — Zustand-сторы;
- `src/api` — работа с API;
- `src/hooks` — кастомные хуки;
- `src/telegram` — Telegram provider/обертки.

## API и backend

Сейчас фронтенд может работать с `https://iis.bsuir.by/api`, но для production обычно лучше использовать собственный backend-прокси.

Почему это полезно:

- безопаснее (секреты и служебная логика остаются на сервере);
- проще контролировать ошибки, ретраи и таймауты;
- можно добавить кэш и снизить нагрузку на внешний API;
- проще масштабировать и наблюдать за системой.

Подробный пошаговый план backend (с акцентом на **Python/FastAPI** и локальную разработку): [BACKEND_PLAN.md](./BACKEND_PLAN.md).

## Запуск локально (Windows)

> Ниже команды для **Windows PowerShell**.

```powershell
npm install
npm run dev
```

По умолчанию Vite поднимется на локальном порту (обычно `5173`).

## Доступные команды (Windows)

```powershell
npm run dev      # запуск в режиме разработки
npm run build    # production-сборка
npm run preview  # просмотр production-сборки
npm run lint     # проверка eslint
```

## Быстрая настройка backend на Python в Windows (PowerShell)

```powershell
py -3.11 -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -U pip
pip install fastapi uvicorn[standard] httpx pydantic pydantic-settings
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

---

Если нужно, следующим шагом могу добавить в README:
- раздел по env-переменным,
- пример конфигурации API base URL,
- чек-лист для деплоя frontend + backend.
