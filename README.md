# approval-service

Сервис согласования контента перед публикацией: заявки на согласование, решения ревьюеров (approve / reject), отмена создателем, аудит-след и outbox-события для интеграций. В комплекте — демо-клиент (React SPA).

Внешние сущности (публикации, пользователи, workspace) передаются только как строковые идентификаторы; соседние сервисы не реализуются. Архитектура и компромиссы — в [DESIGN.md](DESIGN.md).

## Стек

- Backend: NestJS (TypeScript, Node 22), Prisma, PostgreSQL 16, nestjs-pino
- Frontend: React + Vite + TypeScript (без UI-библиотек)
- Тесты: Jest (unit), Jest + supertest (e2e против реального Postgres)
- Инфраструктура: Docker, docker-compose

## Требования

- Docker с compose plugin — для запуска полного стека.
- Node.js 22 и npm — только для режима разработки и запуска тестов.

## Быстрый старт (Docker)

```bash
docker compose up -d --build
```

Поднимает postgres, применяет миграции, запускает API и клиент:

- UI: http://localhost:8080
- API (через nginx-proxy клиента): http://localhost:8080/api/v1/...
- Health / readiness: http://localhost:8080/health, http://localhost:8080/ready

Порт клиента и параметры БД можно переопределить через корневой `.env` (см. [.env.example](.env.example)); значения по умолчанию заданы в `docker-compose.yml`, поэтому стек стартует и без `.env`. Если 8080 занят — задайте `CLIENT_PORT` в `.env`.

Остановка: `docker compose down` (с удалением данных БД — `docker compose down -v`).

## Режим разработки

```bash
# 1. Postgres (публикуется на хост-порт 15432)
docker compose -f docker-compose.dev.yml up -d

# 2. API на :3000 (использует server/.env; образец — server/.env.example)
cd server
npm install
npx prisma migrate deploy
npm run start:dev

# 3. Клиент на :5173 (vite dev server, проксирует /api, /health, /ready на :3000)
cd client
npm install
npm run dev
```

## Переменные окружения

Корневой `.env` — используется docker-compose (образец: [.env.example](.env.example)):

| Переменная | По умолчанию | Назначение |
|---|---|---|
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | `approval` / `approval` / `approval` | учётные данные Postgres (в проде пароль обязательно сменить) |
| `CLIENT_PORT` | `8080` | хост-порт клиента (nginx) |
| `LOG_LEVEL` | `info` | уровень логов API |

`server/.env` — используется при локальном запуске API (образец: `server/.env.example`):

| Переменная | Пример | Назначение |
|---|---|---|
| `DATABASE_URL` | `postgresql://approval:approval@localhost:15432/approval?schema=public` | строка подключения Prisma |
| `PORT` | `3000` | порт API |
| `LOG_LEVEL` | `info` | уровень логов |

## Аутентификация (заглушка)

Реальной аутентификации нет — сервис доверяет заголовкам запроса (в проде их проставлял бы API-gateway после проверки токена):

```
X-User-Id:      usr_1
X-Workspace-Id: ws_1
X-Actions:      approval:read,approval:create,approval:decide,approval:cancel
```

- Нет `X-User-Id` или `X-Workspace-Id` → **401 UNAUTHORIZED**.
- `workspace_id` из пути ≠ `X-Workspace-Id` → **403 FORBIDDEN** (изоляция workspace).
- В `X-Actions` нет действия, требуемого ручкой → **403 FORBIDDEN**.

Соответствие ручек действиям:

| Действие | Ручки |
|---|---|
| `approval:read` | `GET /approval-requests`, `GET /approval-requests/{id}` |
| `approval:create` | `POST /approval-requests` |
| `approval:decide` | `POST .../approve`, `POST .../reject` |
| `approval:cancel` | `POST .../cancel` |

Доменные правила поверх действий: approve/reject доступны только пользователям из `reviewerUserIds` заявки (иначе 403 `NOT_A_REVIEWER`), cancel — только создателю (иначе 403 `NOT_A_REQUESTER`).

## Идемпотентность

Все POST-запросы требуют заголовок `Idempotency-Key` (UUID, свой на каждую операцию; без него — 400). Повтор с тем же ключом и тем же телом возвращает сохранённый ответ без побочных эффектов; тот же ключ с другим телом → **422 IDEMPOTENCY_KEY_REUSE**.

## API

Базовый префикс — `/api/v1` (`/health` и `/ready` — без префикса). Ниже примеры против Docker-стека (`localhost:8080`); в dev-режиме замените на `localhost:3000`.

```bash
AUTH='-H "X-User-Id: usr_alice" -H "X-Workspace-Id: ws_1"'
# для краткости в примерах ниже заголовки выписаны полностью
```

### Health / readiness

```bash
curl http://localhost:8080/health   # {"status":"ok"} — всегда 200
curl http://localhost:8080/ready    # {"status":"ready"} | 503, если БД недоступна
```

### Создать заявку — `POST /api/v1/workspaces/{workspace_id}/approval-requests`

```bash
curl -X POST http://localhost:8080/api/v1/workspaces/ws_1/approval-requests \
  -H "Content-Type: application/json" \
  -H "X-User-Id: usr_alice" \
  -H "X-Workspace-Id: ws_1" \
  -H "X-Actions: approval:create" \
  -H "Idempotency-Key: 5f6d0b1e-6c9a-4a70-9c4e-2f1a4b8c9d01" \
  -d '{
    "sourceType": "publication",
    "sourceId": "pub_42",
    "title": "Post for Monday",
    "description": "Announcement draft",
    "reviewerUserIds": ["usr_bob", "usr_carol"]
  }'
# → 201 + JSON заявки (id, status: "pending", ...)
```

`sourceType` ∈ `publication | scenario | edit | external`. Ограничения: `title` 1..200, `description` 0..2000, `sourceId` 1..100, `reviewerUserIds` — 1..50 строк.

### Список заявок — `GET /api/v1/workspaces/{workspace_id}/approval-requests`

```bash
curl "http://localhost:8080/api/v1/workspaces/ws_1/approval-requests?status=pending&sourceType=publication&limit=20&offset=0" \
  -H "X-User-Id: usr_alice" \
  -H "X-Workspace-Id: ws_1" \
  -H "X-Actions: approval:read"
# → 200 {"items":[...],"total":1,"limit":20,"offset":0}, сортировка createdAt desc
```

Фильтры `status`, `sourceType` опциональны; `limit` — max 100, по умолчанию 20.

### Деталка — `GET /api/v1/workspaces/{workspace_id}/approval-requests/{request_id}`

```bash
curl http://localhost:8080/api/v1/workspaces/ws_1/approval-requests/<REQUEST_ID> \
  -H "X-User-Id: usr_alice" \
  -H "X-Workspace-Id: ws_1" \
  -H "X-Actions: approval:read"
# → 200, поля заявки + history[] (аудит-след)
```

### Согласовать — `POST .../approval-requests/{request_id}/approve`

```bash
curl -X POST http://localhost:8080/api/v1/workspaces/ws_1/approval-requests/<REQUEST_ID>/approve \
  -H "Content-Type: application/json" \
  -H "X-User-Id: usr_bob" \
  -H "X-Workspace-Id: ws_1" \
  -H "X-Actions: approval:decide" \
  -H "Idempotency-Key: 0b2c7c8a-3f43-4b19-8f0d-6a5e9c1d2e02" \
  -d '{"comment": "LGTM"}'
# → 200 + обновлённая заявка (status: "approved")
```

### Отклонить — `POST .../approval-requests/{request_id}/reject`

```bash
curl -X POST http://localhost:8080/api/v1/workspaces/ws_1/approval-requests/<REQUEST_ID>/reject \
  -H "Content-Type: application/json" \
  -H "X-User-Id: usr_bob" \
  -H "X-Workspace-Id: ws_1" \
  -H "X-Actions: approval:decide" \
  -H "Idempotency-Key: 9d1e5a3b-7c26-4e88-b0f1-3c4d5e6f7a03" \
  -d '{"reason": "Wrong image"}'
# → 200 (reason обязателен, 1..2000)
```

### Отменить — `POST .../approval-requests/{request_id}/cancel`

```bash
curl -X POST http://localhost:8080/api/v1/workspaces/ws_1/approval-requests/<REQUEST_ID>/cancel \
  -H "Content-Type: application/json" \
  -H "X-User-Id: usr_alice" \
  -H "X-Workspace-Id: ws_1" \
  -H "X-Actions: approval:cancel" \
  -H "Idempotency-Key: 4e8f2b6c-1a57-4d39-9e0a-8b7c6d5e4f04" \
  -d '{"reason": "No longer needed"}'
# → 200 (reason опционален; отменить может только создатель)
```

### Формат ошибок

```json
{ "error": { "code": "STRING_CODE", "message": "Human readable message" } }
```

| Код | HTTP | Когда |
|---|---|---|
| `VALIDATION_ERROR` | 400 | невалидное тело/квери или отсутствует `Idempotency-Key` |
| `UNAUTHORIZED` | 401 | нет auth-заголовков |
| `FORBIDDEN` | 403 | чужой workspace или нет нужного действия в `X-Actions` |
| `NOT_A_REVIEWER` | 403 | approve/reject не от ревьюера заявки |
| `NOT_A_REQUESTER` | 403 | cancel не от создателя заявки |
| `NOT_FOUND` | 404 | заявки нет (или она в другом workspace) |
| `CONFLICT` | 409 | решение по заявке в финальном статусе |
| `IDEMPOTENCY_KEY_REUSE` | 422 | тот же ключ с другим телом запроса |

Статусы заявки: `pending → approved | rejected | canceled` (все правые — финальные, повторное решение невозможно).

## Тесты

Все команды — из каталога `server/`. E2e-тестам нужен запущенный dev-postgres (`docker compose -f docker-compose.dev.yml up -d`): базу `approval_test` они создают сами и применяют миграции перед прогоном.

```bash
npm test          # unit
npm run test:e2e  # e2e против реального Postgres
```

URL тестовой БД переопределяется переменной `TEST_DATABASE_URL` (по умолчанию `postgresql://approval:approval@localhost:15432/approval_test?schema=public`).

## Деплой

Нужен Linux-сервер с Docker (compose plugin входит в современные установки Docker):

```bash
git clone https://github.com/TrojanDll/client4business.git /opt/approval-service
cd /opt/approval-service

# .env: сгенерировать пароль БД, открыть клиент на :80
printf 'POSTGRES_USER=approval\nPOSTGRES_PASSWORD=%s\nPOSTGRES_DB=approval\nCLIENT_PORT=80\nLOG_LEVEL=info\n' "$(openssl rand -hex 16)" > .env
chmod 600 .env

docker compose up -d --build
```

Наружу публикуется только клиент (nginx, порт из `CLIENT_PORT`); Postgres и API доступны только внутри compose-сети. Firewall (ufw): разрешить `22/tcp` и `80/tcp`. Обновление: `git pull && docker compose up -d --build`.

## Структура проекта

```
├── docker-compose.yml       # полный стек: postgres + server + client (nginx)
├── docker-compose.dev.yml   # только postgres для разработки (хост-порт 15432)
├── DESIGN.md                # модель данных, идемпотентность, outbox, компромиссы
├── server/                  # NestJS API
│   ├── prisma/              # schema.prisma + миграции
│   ├── src/
│   │   ├── approvals/       # заявки: DTO, сервис, контроллер
│   │   ├── auth/            # guard заголовков-заглушки, декораторы
│   │   ├── idempotency/     # Idempotency-Key: fingerprint, replay, 422
│   │   ├── outbox/          # запись событий + фоновый publisher
│   │   ├── health/          # /health, /ready
│   │   ├── prisma/          # PrismaService
│   │   └── common/          # фильтр ошибок, ValidationPipe, ApiError
│   └── test/                # e2e (supertest) + подготовка тестовой БД
└── client/                  # React SPA (список, создание, деталка, auth-панель)
```
