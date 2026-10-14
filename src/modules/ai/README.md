# Модуль ИИ (Polza.ai)

Конфигурация (TASK-101), доступ продавца (TASK-102), HTTP-клиент `PolzaClient` (TASK-103) и `AiService` —
единственная точка любого ИИ-функционала (TASK-104).

## Переменные окружения

| Переменная                  | Обязательность                      | Смысл                                                                              |
| --------------------------- | ----------------------------------- | ---------------------------------------------------------------------------------- |
| `POLZA_AI_TOKEN`            | необязательна                       | ключ Polza.ai. Пусто или нет — **ИИ выключен**, бот стартует и работает как обычно |
| `POLZA_AI_MODEL`            | обязательна, **если задан токен**   | идентификатор модели. Умолчания нет: выбор модели — выбор цены                     |
| `POLZA_AI_BASE_URL`         | по умолчанию `https://polza.ai/api` | база API: ровно `<схема>://<хост>[:порт]/api`                                      |
| `POLZA_AI_PROXY_URL`        | необязательна                       | HTTP-прокси только для Polza, `http://хост:порт`. Пусто — напрямую                 |
| `AI_USER_DAILY_LIMIT_RUB`   | по умолчанию `50`                   | дневной лимит расхода на продавца, ₽ за московские сутки. `0` — без лимита         |
| `POLZA_AI_BALANCE_WARN_RUB` | по умолчанию `200`                  | порог самопроверки баланса, ₽: ниже — warn админам. `0` — без warn, ≤ 0 ₽ — авария |

Правила:

- **Включён ли ИИ — спрашивать `AppConfigService.polzaAiEnabled`.** Токен руками не проверять:
  точка решения одна.
- `process.env` и `config.get` вне `src/config/app-config.service.ts` не читать — геттеры
  `polzaAiToken`, `polzaAiModel`, `polzaAiBaseUrl` (без хвостового слеша).
- База кончается на `/api`, путь метода (`/v1/...`) дописывает клиент. `https://polza.ai` и
  `https://polza.ai/api/v1` отвергаются на старте — иначе каждый запрос молча уходит в 404.
- Ключ без модели роняет старт с текстом, называющим `POLZA_AI_MODEL`: незаконченная настройка
  видна сразу, а не по первому отказу в рантайме.

## Доступ продавца

ИИ работает у продавца, только если выполнены **оба** условия:

1. `AppConfigService.polzaAiEnabled` — ИИ включён на сервере (есть ключ и модель);
2. фича `ai` открыта продавцу (`FEATURE.AI`, `defaultEnabled: false`) — из админ-панели.

Правила:

- Кнопки `MENU` у фичи нет, `featureGate` её не проверяет: апдейта «ИИ» не бывает, ИИ живёт
  внутри других экранов.
- Флаг фичи проверяет `AiService` (TASK-104) как последний барьер, но **не читает его сам**:
  вызывающий передаёт готовый `boolean` (админ уже разрешён через `allFeaturesEnabled`).
- Модуль `ai` **не импортирует** `features.domain.ts` и `UserAccess` — реестр фич принадлежит боту.

## Клиент `PolzaClient`

`polza.client.ts`, ошибки — `polza.errors.ts`, повторы — `polza-retry.ts`.

| Метод              | Запрос                      | Что отдаёт                                                                                                |
| ------------------ | --------------------------- | --------------------------------------------------------------------------------------------------------- |
| `chatCompletion()` | `POST /v1/chat/completions` | `content`, `usage` (токены, `cachedTokens`, `reasoningTokens`, `costRub`), `model`, `provider`, `traceId` |
| `getBalance()`     | `GET /v2/balance`           | `amount`, `available`, `reservedAmount`, `spentAmount` — числа (у Polza строки с 8 знаками)               |
| `listModels()`     | `GET /v1/models`            | `{id, name?, type?, contextLength, pricing, structuredOutputs}[]` — цена ₽ за 1M или `null`               |

Правила:

- **Наружу модуль клиент не отдаёт** (`exports: [AiService]`, пиннит тест). Всё ИИ — через `AiService`.
- Клиент **не знает про фичу `ai`** и про продавцов. Без ключа любой метод бросает `PolzaDisabledError`
  до HTTP, модуль при этом поднимается.
- Ключ — только в заголовке `Authorization: Bearer` экземпляра axios. В лог идут статус, метод, путь,
  `code`, `trace_id`, текст — **никогда** `config.headers` и тело запроса. Маскировщика Bearer в проекте нет.
- Ошибка Polza — `{ error: { code, message, trace_id }, trace_id }`; тело целиком в ошибке не хранится.
- `provider` в ответе бывает не у всех моделей (у `google/gemini-2.5-flash-lite` его нет, проверено вживую) —
  тогда это пустая строка, а не ошибка.
- Без стриминга, без OpenAI SDK. Таймаут 620 с (потолок запроса у Polza — 600 с).

### Ошибки и повторы

| Код                 | Класс                         | Повтор                                    |
| ------------------- | ----------------------------- | ----------------------------------------- |
| 401                 | `PolzaAuthError`              | нет                                       |
| 402                 | `PolzaInsufficientFundsError` | нет — денег от повтора не прибавится      |
| 403                 | `PolzaModerationError`        | нет                                       |
| 429                 | `PolzaRateLimitError`         | да                                        |
| 408/502/503         | `PolzaServerError`            | да                                        |
| 400/404/409/413/500 | `PolzaApiError`               | нет                                       |
| нет ответа          | `PolzaNetworkError`           | **нет** — запрос мог дойти и быть оплачен |
| нет ключа           | `PolzaDisabledError`          | —                                         |

Пауза — `Retry-After` (секунды или HTTP-дата), без него 1/2/4 с; всего 4 попытки. `Retry-After` длиннее
60 с не ждём — ошибка уходит сразу. `ErrorReporter` ставит таким ошибкам `source: 'polza'`.

## Диагностика: `scripts/diagnose-polza.ts`

Используется, чтобы выбрать `POLZA_AI_MODEL` по цене и проверить, что Polza доступна (TASK-107).

```bash
npx ts-node scripts/diagnose-polza.ts                   # баланс, текущая модель с ценой — бесплатно
npx ts-node scripts/diagnose-polza.ts --models=flash    # chat-модели с ценами ₽/1M, фильтр по id/имени
npx ts-node scripts/diagnose-polza.ts --chat            # ПЛАТНО: короткий запрос — цена, токены, trace_id
npx ts-node scripts/diagnose-polza.ts --json            # ПЛАТНО: проба response_format json_schema
npx ts-node scripts/diagnose-polza.ts --chat --model=z-ai/glm-5.3-flash   # кандидат до правки .env
```

Правила:

- **Платные шаги включаются только флагом.** Запуск без флагов делает только бесплатные GET. У проб `max_tokens`
  16 и 64, поэтому цена ограничена сверху.
- **Скрипт идёт мимо `AiService`**, прямо в `PolzaClient`, поэтому **не пишет `AiUsage`** и Mongo не трогает.
  Nest он не поднимает: `AppModule` переставил бы вебхук боевого бота.
- **Цена модели — `top_provider.pricing` из `/v1/models`, в ₽ за 1M токенов.** Если потокенной цены нет (tts,
  image, video) или валюта не рубли, это `pricing: null`, а не 0. В таблице такая модель стоит в конце.
- Флаг `structured_outputs` в списке — только заявка модели. Работает ли схема на деле, показывает проба `--json`.
- **В прод-образе скрипта нет**: там нет `scripts/` и ts-node. Доступность с прод-хоста проверяется бесплатно,
  из контейнера:

  ```bash
  node -e "fetch((process.env.POLZA_AI_BASE_URL||'https://polza.ai/api')+'/v2/balance',{headers:{Authorization:'Bearer '+process.env.POLZA_AI_TOKEN}}).then(r=>r.text()).then(t=>console.log(t))"
  ```

  Ответ с `available` означает, что Polza доступна. Этот `fetch` идёт **напрямую**, мимо
  `POLZA_AI_PROXY_URL`. Если задан прокси, проверка через него с хоста:
  `curl -x "$POLZA_AI_PROXY_URL" -sS -m 15 -o /dev/null -w '%{http_code}\n' https://polza.ai/api/v2/balance`
  (`401` без ключа — прокси и Polza отвечают).

- **Прокси — когда сеть хостинга Polza не пускает IP сервера бота** (14-10-2026 с NL-хоста TCP до polza.ai
  не устанавливался). Прямой прокси, а не зеркало через `POLZA_AI_BASE_URL`: TLS до Polza идёт сквозь
  `CONNECT`, промежуточный узел ключа не видит, и ему не нужны домен и сертификат. Прокси обязан пускать
  только IP сервера бота (`Allow` в tinyproxy), иначе это открытый прокси.

## `AiService`

`ai.service.ts`, отказы — `ai.errors.ts`, учёт — `AiUsage` (`src/database/schemas/ai-usage.schema.ts`).

```ts
const result = await ai.complete(
  { telegramUserId, aiAllowed, purpose: 'feedback-reply' },
  { messages },
);
```

Барьеры — по порядку, все **до HTTP**:

| Условие                                   | Что бросает              | Строка `AiUsage` |
| ----------------------------------------- | ------------------------ | ---------------- |
| нет `telegramUserId` или `purpose`        | `Error` (ошибка кода)    | нет              |
| `aiAllowed === false`                     | `AiFeatureDisabledError` | нет              |
| `polzaAiEnabled === false`                | `AiUnavailableError`     | нет              |
| потрачено за сутки ≥ лимита               | `AiDailyLimitError`      | нет              |
| сумму за сутки не прочитать (Mongo лежит) | `AiUnavailableError`     | нет              |

Правила:

- **Любой ИИ-запрос — только через `AiService.complete`.** `aiAllowed` передаёт вызывающий готовым boolean;
  сервис `UserAccess` не читает.
- **Каждый запрос к Polza — одна строка `AiUsage`**, успешный (`status: 'ok'`) и упавший (`status: 'error'`,
  `httpStatus`, `errorCode`, `traceId`). Токены, `costRub` (ровно `usage.cost_rub`, без пересчёта; у упавшего — 0),
  запрошенная и ответившая модель, провайдер, длительность. **Текста промпта и ответа нет** — не добавлять.
- Запись учёта не блокирует ответ и не бросает. TTL — 180 дней.
- Лимит — сумма `costRub` с начала московских суток (`moscowDayStart`), проверка до запроса. `0` — без лимита.
- Отказы `AiError` (`AiFeatureDisabledError`, `AiDailyLimitError`, `AiUnavailableError`) — не сбои: показать продавцу
  `userMessage`, в `ErrorReporter` не слать.
- **Сбой Polza сервис сам отправляет в `ErrorReporter`** (`context: ai:<purpose>`) и пробрасывает ту же ошибку.
  Вызывающий показывает `userMessage` и **повторно не репортит**. Алерт админам — на всё, кроме 403 (модерация);
  402 «нет денег» — алерт. Повторов в сервисе нет.

### `AiService.balance()` — только для самопроверки

Баланс Polza для `HealthMonitorService` (шестая проверка, только при `polzaAiEnabled`). Без продавца, фичи и
лимита, **строки `AiUsage` не пишет** (запрос бесплатный и ничей), **в `ErrorReporter` не шлёт** — ошибку судит
монитор (`shouldNotify`, журнал с `alert: false`). Без ключа — `AiUnavailableError`. Для продуктовых экранов не
использовать: продавцу баланс владельца не показывается.

### Страница «ИИ» админ-панели (`AiAdminModule`)

`GET /api/ai/usage?range=24h|7d|30d` и `GET /api/ai/requests?telegramUserId=&purpose=&status=&since=&until=&limit=&skip=`,
`AdminJwtGuard` на весь `AiAdminController`.

- Суммы — только из Mongo: `AiUsageService.summary` (один `aggregate` с `$facet`, дни по Москве). Не считать
  расход в JS по страницам журнала.
- `list` и `count` журнала — один `filterOf`; потолок страницы `MAX_AI_PAGE_SIZE` (100). Мусор в `range`,
  `status`, датах и числах — 400.
- Баланс — `AiService.balance()` в гонке `AI_BALANCE_TIMEOUT_MS` (10 с); сбой → `balance: null` + `balanceError`,
  страница открывается, в `ErrorReporter` не шлётся.
- Ники — один `access.list()` на ответ, по `telegramUserId`.
- Ответ журнала собирается перечислением полей; текста промпта и ответа нет и не будет.

Причины решений — в `CLAUDE.md`, разделы «Environment» и «Self-checks». Страница «ИИ» — там же, «Environment».
