# Где мы сейчас

> Сводка, не журнал. Что сделано и почему — в сообщениях коммитов; чего проверить не удалось — в
> `docs/known-gaps.md`. Старый журнал работ (до TASK-057) лежит в `progress.archive.md`, читать не нужно.

**Проект:** Telegram-бот для продавцов Яндекс.Маркета (NestJS + telegraf, Mongo, Bull/Redis) и
Vue-админка `web/`. Всё, что было в бэклоге (M0–M9, TASK-001…056), выполнено; TASK-057…067 сделаны
ad-hoc, в git.

**Текущий майлстоун:** M28 — «Установка цен» закрыт 2026-10-30 (TASK-199…204, план `~/.claude/plans/dazzling-toasting-hare.md`, решения `price_set_*`): запись цен в ЯМ/Ozon/WB со страницы CRM — наценка от закупа по площадке или файл «артикул | цена». До него M19 — Ozon закрыт (подключение, товары, остатки, отправления, финоперации и сверка TASK-132), параллельно M20 — WB (подключение, карточки, остатки, заказы и отчёт реализации в финжурнал готовы). Владелец 2026-10-14 прислал ТЗ «финансовая аналитика по трём маркетплейсам» (14 разделов), оно заведено целиком: M16–M25, TASK-108…152, решения `tz_finance_scope`, `finance_actual_beside_flat`, `finance_per_seller`, `ai_explains_not_computes`. Порядок такой: журнал операций ЯМ → товары и себестоимость → финдвижок и «Финансы» → Ozon → WB → сравнение/юнит/калькулятор → продажи/склад/заказы → налоги → ИИ-финансист → уведомления. Ранее — M15, ИИ через Polza.ai (TASK-101…107), он завершён; прогон `diagnose-polza` на проде остаётся за владельцем (known-gaps). До него M14 — главная CRM по MarketHub, M13 — экраны бота в CRM, M12 — настройки и прайс в CRM.
Из M10 закрыт хвост — TASK-073 («Профиль» и «Помощь» в CRM).

**Счётчики:** активных 5, в архиве 188. 2026-10-30 закрыта TASK-204 — документация «Установки цен»: `src/modules/price-set/README.md` (правила, барьеры, доводы), раздел в `src/modules/crm/README.md`, ссылки из README yandex/ozon/wb/web/crm, строка карты в CLAUDE.md. Готовых задач нет: TASK-186/187 (живые проверки Ozon/WB) blocked — нужны ключи владельца, TASK-189/190 ждут их. Ранее в тот же день закрыта TASK-203 — страница CRM «Установка цен» (`web/crm/src/modules/price-set`, `/ym/price-set`): наценка по площадке или файл → план по карточке на площадку → снятие строк (risky — по умолчанию, ключи в `excluded`) → «Записать цены (N)» → ConfirmDialog → итог по площадкам; опрос — `useJob`, не `useReportJob` (нужен id плана, кэш дал бы чужой отпечаток); `MarketplacePicker` «Прайса» принимает заголовок и подпись строки; браузер — known-gaps. Ранее в тот же день закрыта TASK-202 — `PriceSetService` (`src/modules/price-set/price-set.service.ts`): `plan` только читает (товары справочника, текущие цены выбранных площадок через `priceWrite.currentPrices`, закуп — `Product.purchase.price` как есть, решение `price_set_purchase_raw`), `apply` пересчитывает план по сохранённому запросу и пишет только при совпавшем отпечатке, площадки независимо, итог — `actionlogs` kind `price-set`. Фичи `price_set` + `price_set_write_{ym,ozon,wb}` (все выключены), раздел `ym-price-set`, kind `price-set:plan` (наценка — `POST crm/jobs` с `params.markups`, файл — `POST crm/ym/price-set/upload` во вход задачи), `POST crm/ym/price-set/apply` → `SYNC_STOCKS` с `source: 'price-set'`, `attempts: 1`, 409 `PRICE_SET_RUNNING`; скрипт `scripts/preview-price-set.ts`. Живой прогон — known-gaps. Ранее, 2026-10-29, закрыта TASK-201 — цены Ozon и WB как `priceWrite`: `OzonPriceWriteService` (чтение `/v5/product/info/prices`, запись `/v1/product/import/prices` без `old_price`, построчные отказы — в ошибках) и `WbPriceWriteService` (чтение `list/goods/filter`, запись `upload/task` только `{nmID, price}`, товар с разными ценами размеров пропускается); обе записи через `callWrite` без повторов. Право WB «Цены и скидки» вне `WB_REQUIRED_CATEGORIES` (решение `price_set_wb_prices_scope`): без него чтение — `WbPricesAccessError` с понятным текстом, запись — `skipReason: 'no-access'`; живая запись и асинхронность WB — known-gaps. Ранее в тот же день закрыта TASK-200 — цены ЯМ: возможность реестра `priceWrite` (`currentPrices`/`writePrices`), `YmPriceWriteService` (чтение из offer-mappings, запись в business-level `offer-prices/updates` через `postWrite` батчами по 500), обязательный `PRICE_WRITE_ENABLED` без умолчания, зачёркнутая цена возвращается как есть в окне 5–99% (решение `price_set_ym_discount_base`); живая запись — known-gaps. 2026-10-28 закрыта TASK-199 — чистый домен «Установки цен» (`src/modules/price-set/price-set.domain.ts`: наценка = закуп × %/100 до рубля, WB — базовая под текущую скидку, риск при |Δ| > 50% или без текущей цены, отпечаток плана) и парсер файла цен (`price-set-file.ts`); чтение таблиц вынесено в `src/shared/spreadsheet.ts`. Ранее в тот же день закрыта TASK-198 — сбой заказов WB закрывает только цель WB (`own-orders-unknown`, решение `stock_push_wb_orders_isolated`), ЯМ и Ozon пишутся; 403 «additional requirements» — текст про персональный токен. Ранее в тот же день закрыта TASK-197 — остатки FBW WB переведены с отключённого `supplier/stocks` на `POST seller-analytics-api/api/analytics/v1/stocks-report/wb-warehouses` (по снимку OpenAPI WB, артикул — по `nmId` карточки), 429 «Статистики» повторяется только через очередь `WbStatisticsPacer`, 429 и 4xx WB — честный текст (`WbRequestError`); живой прогон у 406937947 — за владельцем (known-gaps). Ранее в тот же день закрыта TASK-196 — клиент Ozon переведён с отключённых методов (`/v2/warehouse/list`, `/v4/posting/fbs/list`, `/v3/posting/fbo/list` по официальной схеме), 400/404 — `OzonRequestError` с честным текстом; живьём заказы Ozon читаются, план ЯМ больше не блокируется, склад Ozon у 309809755 в архиве. Ранее в тот же день закрыта TASK-195 — Ozon/WB в плане «Прайса» как ЯМ (решения `stock_push_ozon_wb_same_as_ym`, `stock_push_no_per_store_pick`): план не зависит от фичи записи, пропуски WB видны в плане, сбой одной цели не теряет записанное; живой предпросмотр нашёл, что Ozon не читается (устаревшие методы) — TASK-196. Ранее: 2026-10-20 закрыта TASK-193 — одобренный продавец без площадок входит в CRM (решение `crm_audience_no_platform`): `isAllowed` = одобрен/админ, `hasPlatform` сторожит `CrmJwtGuard` (403 `NO_PLATFORM` вне `@AllowWithoutPlatform`), `me.sections` = `NO_PLATFORM_SECTIONS`, фронт уводит на «Подключения» по 403; браузер — known-gaps. Следующая — по `node tools/backlog.mjs next`.
(вход в CRM на бэкенде), TASK-068 (фронтовые скилы), TASK-071 (UI входа — модуль `auth`, образец для
остальных модулей) и TASK-072 (гейт фич `@RequireFeature` в `CrmJwtGuard`, разделы навигации из `/auth/me`,
журнал CRM-запросов в `actionlogs` с `source: crm`) и TASK-074 (фоновые задачи CRM: очередь `crm-jobs`,
`CrmJobResult` с TTL, `/api/crm/ym/jobs`, фронтовый `useJob`) и TASK-075 (отчёты о заказах в CRM: kind-ы
`orders:<report>`, общая с ботом `reportWorkbook`, модуль фронта `orders`) и TASK-076 («Прибыль» и
«Калькулятор» в CRM: kind-ы `profit:<report>`, plain-хелперы форматтеров бота, модуль фронта `profit`,
общие `shared/period` и `useRouteTabs`) и TASK-078 («Настройки» в CRM: `StoreSettingsService` — один путь
записи ставок, скидок и продвижения для бота и CRM, `/api/crm/ym/settings`, модуль фронта `settings`) и TASK-073
(«Профиль» и «Помощь» в CRM из `profileView`/`helpModel` — тех же функций, что экраны бота; «Безопасность» — вкладка профиля)
и TASK-077 (главная CRM: плитки из тех же задач `orders:*`/`profit:profit`, общий `useReportJob`, период в отчёт — query `?period=`)
и TASK-082 («Карантин цен» в CRM: `QuarantineService` на оба канала, подтверждение — пересечение с живым
карантином, частичный сбой батчей — 502 `QUARANTINE_PARTIAL` с числом подтверждённых, модуль фронта `quarantine`)
и TASK-083 («Отзывы» в CRM: `FeedbackService` на оба канала, ответ — поле → превью → «Опубликовать», 409
`FEEDBACK_GONE` против второго публичного комментария, товара в спеке нет — показан номер заказа, модуль фронта `feedback`)
и TASK-084 («Платежи» и «Отчёты Маркета» в CRM: kind-ы `payments:report` / `market-reports:<key>` поверх сервисов
бота, опции форм с сервера из констант доменов, два раздела, шесть отчётов — вкладки; примитив `OptionGroup`)
и TASK-085 («Рекомендации цен» и «Карточки» в CRM: `RecommendationsService`/`CardsService` на оба канала,
kind-ы `recommendations:report`/`cards:report`, два раздела — таблица с поиском и фильтром плюс xlsx бота)
и TASK-087 (сброс пароля CRM с карточки продавца в админке, последний вход и состояние пароля; ссылку на CRM в боте владелец снял — решение `crm_bot_link_dropped`) и TASK-086 («FBY» и «Склады» в CRM: `FbyService.buildData` — структура под ботом и CRM, kind-ы `fby:overview`/
`warehouses:overview` под FBY-only фичами, два раздела; xlsx только у FBY) и TASK-088 (паритет «бот ↔ CRM» пинится
`crm-parity.test.ts` по таблицам `crm-parity.domain.ts`; README бэкенда и фронта CRM, обзор CRM в CLAUDE.md) и TASK-089–091 (видимые скелетоны и подписи плиток,
`crm-jobs` с concurrency 4, разделы магазина не пропадают из сайдбара).

**Следующая задача:** готовых нет — бэклог ждёт живых проверок Ozon/WB (TASK-186/187, blocked), затем TASK-189/190.

## Что решено и не обсуждается заново

- CRM — вторая SPA `crm/` рядом с админкой `web/`, отдаётся Nest по `/crm` на том же домене (2026-09-23).
- Логин — ник (без @, без регистра) или Telegram id; стартовый пароль `tg_rules_2026`, смена
  обязательна при первом входе (2026-09-23).
- В CRM пускаем только тех, кто уже пользуется ботом; онбординг новичков остаётся в боте (2026-09-23).
- Другие маркетплейсы — только каркас (`ym` в URL и API, переключатель с одним пунктом) (2026-09-23).
- Стек CRM: Vue 3 + Tailwind + shadcn-vue (+ Pinia, hash-роутер), без CDN; vite 5.x (2026-09-23).
- JWT CRM — обычный, секрет общий с админкой, различие по `aud: crm`; `CRM_INITIAL_PASSWORD` по умолчанию `tg_rules_2026` (2026-09-23).
- Одна логика — два канала: бизнес-логика выносится в сервисы, бот и CRM зовут одни и те же.
- «Калькулятор» в CRM — вкладка раздела «Прибыль», не отдельный раздел (2026-09-24).
- Вход без доступа при верном пароле — отдельный 403 «нет доступа» (2026-09-24).
- «Безопасность» — вкладка `/profile/:tab?`; «Помощь» = `/help` бота целиком; админу в профиле — «👑 Администратор» в обоих каналах (2026-09-24).
- ТЗ финансовой аналитики принято целиком, одной волной; площадки ЯМ → Ozon → WB, это пересматривает «другие маркетплейсы — только каркас» (2026-10-14).
- Фактическая прибыль из журнала операций — рядом с плоской, для неопубликованного периода остаётся плоская с меткой «Предварительные данные». Всё финансовое настраивается на продавца, у ALL BEST WATCH УСН «Доходы» 6 %. ИИ ничего не считает, только объясняет со ссылками на операции (2026-10-14).
- Полные решения с формулировками — `node tools/backlog.mjs decisions`.
