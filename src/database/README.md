# Слой данных (Mongo)

Mongoose через `@nestjs/mongoose`; финансы — в `postgres/` (см. `src/modules/finance/README.md`).

## Доводы и история решений

> Перенесено дословно из корневого `CLAUDE.md` (2026-10-18), чтобы он не грузил в каждую
> сессию то, что нужно только при работе в этом модуле. Здесь и правила, и почему они такие.

### Data layer

> **Финансы (M16–M25) — не здесь, а в Postgres** — см. `src/modules/finance/README.md`, «Postgres для финансов». Всё остальное — Mongo.

Mongoose via `@nestjs/mongoose`. `database/database.module.ts` does `MongooseModule.forRootAsync`
(uri/dbName from `AppConfigService`) + `forFeature([Bot, User, UserAccess, ReportSchedule,
PurchasePrice, YandexMarket, ActionLog, AdminCredential, CrmCredential, CrmJobResult,
TelegramApiBucket, HealthSample, AiUsage, AiTurn, Product, CostHistory, ProductCardIssue,
MarketplaceConnection])` and
re-exports `MongooseModule` so feature modules can `@InjectModel`. Schemas are decorator classes in
`database/schemas/*.schema.ts` with imperative `schema.index/methods/statics` appended after
`SchemaFactory.createForClass`.

There are **no Mongoose refs** — relations are implicit:

- `UserAccess` is keyed by `(telegramUserId, botId)` — unique compound index. It also carries
  `telegramChatId`, which is a **different thing**: `botId` is the tenant, `telegramChatId` is
  `ctx.chat.id` and the only value you may pass to `sendMessage`. Do not conflate them —
  `YandexMarket.telegramChatId` historically holds the _bot's_ id and is useless for messaging.
  It also carries `features` — the per-user feature flags (see `src/modules/telegram/README.md`, "Per-feature access"), a plain
  `Record<string, boolean>` with **no index**: nothing ever queries by a flag, only by the user.
- `YandexMarket` is keyed by `telegramUserId` (typed `string`). Its `campaign_id`/`business_id`/`token`
  are `required`, so the document is created **once, complete** — partial writes throw. It also carries
  the profit rates: `commissionPercent` (23), `taxPercent` (7), `discountPercent` (10), the
  per-brand map `brandDiscounts` and the legacy `vostokDiscountPercent` (4, fallback of the
  `vostok` brand) — see `src/modules/yandex/README.md`, "Profit".
- `PurchasePrice` is keyed by `(telegramUserId, sku)` — unique compound index, ~4100 docs per seller.
  `sku` is the **catalog** `offerId` produced by `sku-resolver`, not the price-list name: order items
  carry `offerId`, and that is the only key on which cost joins to revenue. No `botId` — the store is
  scoped per user too.
- `User` has no service and is unreachable from the live code path.

Adding an entity means **five** registrations plus the index script: `schemas/index.ts`, `forFeature`,
the service in `providers` **and** `exports`, `services/index.ts`, and the `MODELS` list in
`scripts/sync-indexes.ts` — then `npm run db:sync-indexes` once (mongoose creates missing indexes at
connect but never alters an existing one with the same key set).
