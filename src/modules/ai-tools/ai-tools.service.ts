import type { TAiToolName, TArgs } from './ai-tools.domain';
import type { IAiToolbox, IAiToolResult } from '../ai/ai-tools.types';
import type { TFeatureKey } from '../telegram/bots/shared/features.domain';
import type { IBrandSource } from '../yandex/reports/brands';

import { Injectable } from '@nestjs/common';

import { FINANCE_MARKETPLACES } from '../../database/postgres/finance.schema';
import { ProductService } from '../../database/services/product.service';
import { YandexMarketService } from '../../database/services/yandex-market.service';
import { ErrorReporter } from '../errors/error-reporter.service';
import { FinanceCashflowService } from '../finance/finance-cashflow.service';
import {
  ExpenseValidationError,
  FinanceExpensesService,
} from '../finance/finance-expenses.service';
import { FinanceForecastService } from '../finance/finance-forecast.service';
import { PurchaseValidationError } from '../finance/finance-purchases.service';
import {
  FinanceScreenService,
  FinanceScreenValidationError,
} from '../finance/finance-screen.service';
import { FinanceTaxYearService } from '../finance/finance-tax-year.service';
import { FinanceService } from '../finance/finance.service';
import { PriceCalcRatesService } from '../finance/price-calc-rates.service';
import { ReportGenerationError } from '../yandex/report-generation.error';
import { OrderReportsService } from '../yandex/reports/order-reports.service';
import { reportErrorMessage } from '../yandex/reports/report-message';
import { REPORT } from '../yandex/reports/report-status-map';
import { StockLevelsService } from '../yandex/stocks/stock-levels.service';
import { YandexApiError } from '../yandex/yandex-api.errors';

import {
  AI_TOOL,
  AI_TOOL_DEFINITIONS,
  allowedArgs,
  anomaliesResult,
  basisDaysArg,
  BRAND_INVALID_TEXT,
  brandArg,
  brandResult,
  cashflowResult,
  compareResult,
  expensesResult,
  FORECAST_BASIS_INVALID_TEXT,
  forecastResult,
  hasFinance,
  hiddenAiTools,
  insufficient,
  LIMIT_INVALID_TEXT,
  limitArg,
  liveStoreOf,
  marketplaceArg,
  MAX_SEARCH_RESULTS,
  MAX_TOOL_ANOMALIES,
  MAX_TOOL_OPERATION_IDS,
  monthArg,
  NO_FINANCE_FOR_MARKETPLACE,
  NO_TAX_JOURNAL_TEXT,
  openFinanceMarketplaces,
  operationsResult,
  parseToolArgs,
  PERIOD_INVALID_TEXT,
  periodArg,
  pickTopSkus,
  pnlResult,
  priceForArgs,
  priceForResult,
  RETURNS_PERIOD_INVALID_TEXT,
  returnsPeriodArg,
  returnsResult,
  SEARCH_QUERY_INVALID_TEXT,
  searchQueryArg,
  searchResult,
  skuResult,
  stocksFilterArg,
  stocksResult,
  TAX_YEAR_ARG_INVALID_TEXT,
  taxYearArg,
  taxYearResult,
  taxYearSpan,
  TOOL_FAILED_TEXT,
  toolError,
  topSkusArgs,
  topSkusResult,
} from './ai-tools.domain';

/** Что открыто продавцу сверх `ai` (решения `forecast_ai_by_feature`, `ai_tools_by_screen_feature`). */
export interface IAiToolboxOptions {
  /**
   * Открытые фичи из `AI_GATED_FEATURES`: инструмент экрана, чьей фичи здесь
   * нет (`AI_TOOL_FEATURE`), не виден модели и не вызывается; площадка, чьей
   * фичи нет (`AI_MARKETPLACE_FEATURES`), не читается сравнением. Не передано — все закрыты.
   */
  features?: ReadonlySet<TFeatureKey>;
}

type TToolRun = (
  telegramUserId: string,
  args: TArgs,
  now: Date,
  features: ReadonlySet<TFeatureKey>,
) => Promise<IAiToolResult>;

/**
 * Инструменты ИИ (TASK-147) — только чтение и только через двери, которыми
 * пользуются экраны: P&L — `FinanceService.build`, операции и аномалии —
 * `FinanceScreenService`, прогноз — `FinanceForecastService`, деньги —
 * `FinanceCashflowService`, налоговый год — `FinanceTaxYearService`, цена —
 * `PriceCalcRatesService` + `priceFor`, расходы — `FinanceExpensesService`
 * (TASK-165), площадки рядом — `FinanceService.compare` (TASK-173), живые остатки и
 * возвраты Маркета — `StockLevelsService`/`OrderReportsService` (TASK-166). Своих формул нет.
 *
 * Продавец приходит один раз — в `toolbox(uid)` — и живёт в замыкании. В
 * аргументах инструментов его нет, поэтому модель (и текст продавца, который
 * её уговаривает) не может попросить чужие данные: каждый вызов внизу уже в
 * скоупе `telegramUserId`.
 */
@Injectable()
export class AiToolsService {
  private readonly runs: Record<TAiToolName, TToolRun>;

  // max-params отключено осознанно: каждый инструмент зовёт сервис СВОЕГО экрана (своей формулы
  // нет), и набор инструментов — это и есть список этих сервисов; обёртка-агрегат спрятала бы его.
  // eslint-disable-next-line max-params
  constructor(
    private readonly finance: FinanceService,
    private readonly screen: FinanceScreenService,
    private readonly products: ProductService,
    private readonly errors: ErrorReporter,
    private readonly forecasts: FinanceForecastService,
    private readonly cashflows: FinanceCashflowService,
    private readonly expenses: FinanceExpensesService,
    private readonly taxYears: FinanceTaxYearService,
    private readonly priceRates: PriceCalcRatesService,
    private readonly stores: YandexMarketService,
    private readonly stockLevels: StockLevelsService,
    private readonly orderReports: OrderReportsService,
  ) {
    this.runs = {
      [AI_TOOL.PNL]: (uid, args, now) => this.pnl(uid, args, now),
      [AI_TOOL.SKU]: (uid, args, now) => this.sku(uid, args, now),
      [AI_TOOL.SEARCH]: (uid, args) => this.search(uid, args),
      [AI_TOOL.TOP]: (uid, args, now) => this.top(uid, args, now),
      [AI_TOOL.BRAND]: (uid, args, now) => this.brand(uid, args, now),
      [AI_TOOL.COMPARE]: (uid, args, _now, features) => this.compare(uid, args, features),
      [AI_TOOL.ANOMALIES]: (uid, args) => this.anomalies(uid, args),
      [AI_TOOL.OPERATIONS]: (uid, args) => this.operations(uid, args),
      [AI_TOOL.FORECAST]: (uid, args, now) => this.forecast(uid, args, now),
      [AI_TOOL.CASHFLOW]: (uid, args, now) => this.cashflow(uid, args, now),
      [AI_TOOL.TAX_YEAR]: (uid, args, now) => this.taxYear(uid, args, now),
      [AI_TOOL.PRICE]: (uid, args, now) => this.price(uid, args, now),
      [AI_TOOL.EXPENSES]: (uid, args) => this.expensesFor(uid, args),
      [AI_TOOL.STOCKS]: (uid, args, now) => this.stocks(uid, args, now),
      [AI_TOOL.RETURNS]: (uid, args, now) => this.returns(uid, args, now),
    };
  }

  /**
   * Набор на одного продавца; `now` — для тестов. Инструмент за закрытой фичей
   * не попадает в определения и отказывает в `call`: скрытое определение не
   * мешает модели назвать имя.
   */
  toolbox(
    telegramUserId: string,
    now: () => Date = () => new Date(),
    options: IAiToolboxOptions = {},
  ): IAiToolbox {
    if (!telegramUserId) throw new Error('AiToolsService.toolbox: не передан telegramUserId');
    const features = options.features ?? new Set<TFeatureKey>();
    const hidden = hiddenAiTools(features);
    return {
      telegramUserId,
      definitions: AI_TOOL_DEFINITIONS.filter((tool) => !hidden.has(tool.function.name)),
      call: (name, raw) =>
        hidden.has(name)
          ? Promise.resolve(toolError(`Неизвестный инструмент: ${name}`))
          : this.call(telegramUserId, name, raw, now(), features),
    };
  }

  private async call(
    telegramUserId: string,
    name: string,
    raw: string,
    now: Date,
    features: ReadonlySet<TFeatureKey>,
  ): Promise<IAiToolResult> {
    if (!Object.prototype.hasOwnProperty.call(this.runs, name)) {
      return toolError(`Неизвестный инструмент: ${name}`);
    }
    const tool = name as TAiToolName;
    const args = parseToolArgs(raw, allowedArgs(tool));
    if (typeof args === 'string') return toolError(args);
    try {
      return await this.runs[tool](telegramUserId, args, now, features);
    } catch (error) {
      if (
        error instanceof FinanceScreenValidationError ||
        error instanceof PurchaseValidationError ||
        error instanceof ExpenseValidationError
      ) {
        return toolError(error.message);
      }
      // Маркет не ответил, квота, отказ токена — текст бота (`reportErrorMessage`), а не
      // общий: «лимит запросов, попробуйте через минуту» модель перескажет продавцу честно.
      // Контекст — имя инструмента: ErrorReporter глушит повтор пары «тип + context».
      if (error instanceof YandexApiError || error instanceof ReportGenerationError) {
        void this.errors.report({
          error,
          source: 'yandex',
          context: `ai-tool:${tool}`,
          telegramUserId,
        });
        return toolError(reportErrorMessage(error));
      }
      // Сбой базы — не вина модели: журнал и алерт, а модели — честный отказ вместо догадки.
      void this.errors.report({
        error,
        source: 'ai',
        context: `ai-tool:${tool}`,
        telegramUserId,
      });
      return toolError(TOOL_FAILED_TEXT);
    }
  }

  private async pnl(uid: string, args: TArgs, now: Date): Promise<IAiToolResult> {
    const marketplace = marketplaceArg(args);
    if (!marketplace) return toolError('Неизвестная площадка');
    if (!hasFinance(marketplace)) return insufficient(NO_FINANCE_FOR_MARKETPLACE(marketplace));
    const period = periodArg(args);
    if (!period) return toolError(PERIOD_INVALID_TEXT);
    // flat: false — плоская оценка ходит в Маркет десятки секунд, а ИИ она не нужна.
    return pnlResult(await this.finance.build(uid, period, now, { flat: false }));
  }

  private async sku(uid: string, args: TArgs, now: Date): Promise<IAiToolResult> {
    const sku = typeof args.sku === 'string' ? args.sku.trim() : '';
    if (!sku) return toolError('Не передан артикул');
    const period = periodArg(args);
    if (!period) return toolError(PERIOD_INVALID_TEXT);
    const report = await this.finance.build(uid, period, now, { flat: false });
    const [product] = await this.products.findByYmSkus(uid, [sku]);
    return skuResult(report, sku, product?.name ?? null);
  }

  private async search(uid: string, args: TArgs): Promise<IAiToolResult> {
    const query = searchQueryArg(args);
    if (!query) return toolError(SEARCH_QUERY_INVALID_TEXT);
    const limit = limitArg(args, MAX_SEARCH_RESULTS);
    if (limit === null) return toolError(LIMIT_INVALID_TEXT(MAX_SEARCH_RESULTS));
    return searchResult(query, await this.products.search(uid, query, limit));
  }

  private async top(uid: string, args: TArgs, now: Date): Promise<IAiToolResult> {
    const parsed = topSkusArgs(args);
    if (typeof parsed === 'string') return toolError(parsed);
    const report = await this.finance.build(uid, parsed.period, now, { flat: false });
    const pick = pickTopSkus(report.pnl, parsed);
    // Имена — только выбранным: весь разрез — тысячи артикулов.
    const found = pick.rows.length
      ? await this.products.findByYmSkus(
          uid,
          pick.rows.map((row) => row.sku),
        )
      : [];
    const names = new Map<string, string>();
    for (const product of found) {
      const ym = product.marketplaceSkus?.ym;
      if (ym && product.name) names.set(ym, product.name);
    }
    return topSkusResult(report, parsed, pick, names);
  }

  private async brand(uid: string, args: TArgs, now: Date): Promise<IAiToolResult> {
    const brand = brandArg(args);
    if (brand === false) return toolError(BRAND_INVALID_TEXT);
    const period = periodArg(args);
    if (!period) return toolError(PERIOD_INVALID_TEXT);
    const report = await this.finance.build(uid, period, now, { flat: false });
    // Бренд не хранится — выводится из названия и категории (как в «Аналитике продаж»).
    const skus = report.pnl.skus.skus.map((s) => s.sku);
    const found = skus.length ? await this.products.findByYmSkus(uid, skus) : [];
    const products = new Map<string, IBrandSource>();
    for (const product of found) {
      const ym = product.marketplaceSkus?.ym;
      if (ym) products.set(ym, { name: product.name, category: product.category });
    }
    return brandResult(report, products, brand);
  }

  /** Та же дверь, что экран «Сравнение площадок»: закрытая площадка не читается вовсе. */
  private async compare(
    uid: string,
    args: TArgs,
    features: ReadonlySet<TFeatureKey>,
  ): Promise<IAiToolResult> {
    const period = periodArg(args);
    if (!period) return toolError(PERIOD_INVALID_TEXT);
    const open = openFinanceMarketplaces(features);
    return compareResult(FINANCE_MARKETPLACES, await this.finance.compare(uid, period, open));
  }

  private async anomalies(uid: string, args: TArgs): Promise<IAiToolResult> {
    const month = monthArg(args);
    if (!month) return toolError('Месяц: нужен ГГГГ-ММ');
    if (args.unreviewedOnly !== undefined && typeof args.unreviewedOnly !== 'boolean') {
      return toolError('unreviewedOnly — да или нет');
    }
    const page = await this.screen.anomalies(uid, month, {
      limit: MAX_TOOL_ANOMALIES,
      unreviewedOnly: args.unreviewedOnly === true,
    });
    return anomaliesResult({ month, ...page });
  }

  private async operations(uid: string, args: TArgs): Promise<IAiToolResult> {
    const ids = args.ids;
    if (Array.isArray(ids) && ids.length > MAX_TOOL_OPERATION_IDS) {
      return toolError(`Не больше ${MAX_TOOL_OPERATION_IDS} операций за раз`);
    }
    // Проверку формы id и фильтр по продавцу делает дверь экрана — та же, что у «Финансов».
    return operationsResult(await this.screen.operationsByIds(uid, ids));
  }

  private async forecast(uid: string, args: TArgs, now: Date): Promise<IAiToolResult> {
    const basisDays = basisDaysArg(args);
    if (!basisDays) return toolError(FORECAST_BASIS_INVALID_TEXT);
    const built = await this.forecasts.build(uid, basisDays, now);
    return forecastResult(built.result, built.basis, built.basisOperationIds);
  }

  private async cashflow(uid: string, args: TArgs, now: Date): Promise<IAiToolResult> {
    const month = monthArg(args);
    if (!month) return toolError('Месяц: нужен ГГГГ-ММ');
    const [report, snapshot, months] = await Promise.all([
      this.cashflows.build(uid, month.period, now),
      this.expenses.snapshot(uid),
      this.finance.monthStatuses(uid, month.period),
    ]);
    return cashflowResult(month, report, snapshot.categories, months);
  }

  private async taxYear(uid: string, args: TArgs, now: Date): Promise<IAiToolResult> {
    const year = taxYearArg(args, now);
    if (year === null) return toolError(TAX_YEAR_ARG_INVALID_TEXT);
    const span = taxYearSpan(year, now);
    const months = await this.finance.monthStatuses(uid, span);
    // Без журнала налоговый год — шесть запросов ради нулей: отказ сразу.
    if (months.every((m) => m.status === null)) return insufficient(NO_TAX_JOURNAL_TEXT);
    return taxYearResult(await this.taxYears.build(uid, year, now), span, months);
  }

  private async price(uid: string, args: TArgs, now: Date): Promise<IAiToolResult> {
    const parsed = priceForArgs(args);
    if (typeof parsed === 'string') return toolError(parsed);
    // Скидки брендов — поля документа уровня аккаунта (как `FinanceService.costOfSkus`).
    const store = await this.stores.findByTelegramUser(uid);
    return priceForResult(parsed, await this.priceRates.forSku(uid, store, parsed.sku, now));
  }

  /**
   * Живые остатки (TASK-166) — `StockLevelsService.levels`, та же дверь, что «Склад» и
   * главная CRM: FBY — через мемо и single-flight `FbyStockService.safeLoad`, сбой —
   * `stocks: null` с причиной (levels сам не бросает и сам пишет в ErrorReporter).
   */
  private async stocks(uid: string, args: TArgs, now: Date): Promise<IAiToolResult> {
    const filter = stocksFilterArg(args);
    if (typeof filter === 'string') return toolError(filter);
    const live = liveStoreOf(await this.stores.findByTelegramUser(uid), args.store);
    if (typeof live === 'string') return toolError(live);
    const levels = await this.stockLevels.levels(live.store, now);
    const skus = Object.keys(levels.stocks ?? {});
    const found = skus.length ? await this.products.findByYmSkus(uid, skus) : [];
    const products = new Map<string, IBrandSource>();
    for (const product of found) {
      const ym = product.marketplaceSkus?.ym;
      if (ym) products.set(ym, { name: product.name, category: product.category });
    }
    return stocksResult(levels, products, filter, live);
  }

  /** Живые возвраты (TASK-166) — `build(RETURNING)`, тот же вызов, что «Едет обратно» бота и CRM. */
  private async returns(uid: string, args: TArgs, now: Date): Promise<IAiToolResult> {
    const period = returnsPeriodArg(args);
    if (!period) return toolError(RETURNS_PERIOD_INVALID_TEXT);
    const live = liveStoreOf(await this.stores.findByTelegramUser(uid), args.store);
    if (typeof live === 'string') return toolError(live);
    const report = await this.orderReports.build(live.store, REPORT.RETURNING, now, {
      key: period,
    });
    return returnsResult(report, live, now);
  }

  private async expensesFor(uid: string, args: TArgs): Promise<IAiToolResult> {
    const period = periodArg(args);
    if (!period) return toolError(PERIOD_INVALID_TEXT);
    const [allocation, snapshot] = await Promise.all([
      this.expenses.allocatedFor(uid, period),
      this.expenses.snapshot(uid),
    ]);
    return expensesResult(period, allocation, snapshot.categories);
  }
}
