import type {
  ICrmAccountingLots,
  ICrmAccountingReconcile,
  ICrmCostHistoryView,
  ICrmCostProducts,
  ICrmCostSettings,
  ICrmTaxBaseRule,
  ICrmManualOperationChange,
  ICrmManualOperationsView,
  TCrmAccountingUploadView,
} from './crm-accounting.domain';
import type { IManualOperationActor } from '../../../database/postgres/repositories/accounting-manual-operation.repository';
import type { IAccountingStatus, IAccountingSyncView } from '../../accounting/accounting.service';
import type { IRequestWithCrmUser } from '../crm-jwt.guard';
import type { IUploadedFile } from '../price-list/crm-price-list.domain';

import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  Put,
  Query,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';

import {
  AccountingCostHistoryService,
  CostCorrectionValidationError,
  CostHistoryProductNotFoundError,
} from '../../accounting/accounting-cost-history.service';
import {
  AccountingCostSettingsService,
  CostMethodValidationError,
} from '../../accounting/accounting-cost-settings.service';
import { AccountingLotCostService } from '../../accounting/accounting-lot-cost.service';
import {
  AccountingManualOperationsService,
  ManualOperationNotFoundError,
  ManualOperationValidationError,
} from '../../accounting/accounting-manual-operations.service';
import {
  AccountingReconcileService,
  parseReconcileMonth,
} from '../../accounting/accounting-reconcile.service';
import {
  AccountingTaxSettingsService,
  TaxBaseRuleValidationError,
} from '../../accounting/accounting-tax-settings.service';
import { AccountingService } from '../../accounting/accounting.service';
import { ProductCatalogService } from '../../products/product-catalog.service';
import { FEATURE } from '../../telegram/bots/shared/features.domain';
import { WbFinanceService } from '../../wb/wb-finance.service';
import { RequireFeature } from '../crm-auth.decorators';
import { CrmJwtGuard } from '../crm-jwt.guard';
import {
  acceptedUpload,
  financeUploadError,
  FinanceUploadInterceptor,
} from '../finance/crm-finance-upload';

import {
  COST_PRODUCT_NOT_FOUND,
  COST_PRODUCT_SEARCH_LIMIT,
  INVALID_COST_CORRECTION,
  INVALID_MANUAL_OPERATION,
  INVALID_RECONCILE_MARKETPLACE,
  INVALID_RECONCILE_MONTH,
  INVALID_COST_METHOD,
  INVALID_TAX_BASE_RULE,
  MANUAL_OPERATION_NOT_FOUND,
  RECONCILE_MARKETPLACE_UNAVAILABLE,
  bodyObject,
  costProductQuery,
  parseReconcileMarketplace,
  pickReconcileMarketplace,
  toCrmAccountingReconcile,
  toCrmCostHistoryView,
  toCrmCostProducts,
  toCrmCostSettings,
  toCrmLots,
  toCrmTaxBaseRule,
  toCrmManualOperationChange,
  toCrmManualOperationsView,
  WB_PROMOTION_UPLOAD_BAD_EXTENSION_TEXT,
  WB_PROMOTION_UPLOAD_NO_FILE_TEXT,
} from './crm-accounting.domain';

/**
 * «Финучёт» CRM (TASK-206) — только доставка, класс закрыт зонтиком
 * `fin_accounting`. Журнал синхронизации — TASK-212, ручные операции реестра —
 * TASK-208. Маршруты будущих вкладок добавят M29–M33 — каждый со своей подфичей.
 */
@Controller('crm/ym/accounting')
@UseGuards(CrmJwtGuard)
@RequireFeature(FEATURE.FIN_ACCOUNTING)
export class CrmAccountingController {
  constructor(
    private readonly accounting: AccountingService,
    private readonly manual: AccountingManualOperationsService,
    private readonly reconciliation: AccountingReconcileService,
    private readonly costHistory: AccountingCostHistoryService,
    private readonly taxBaseRules: AccountingTaxSettingsService,
    private readonly costSettings: AccountingCostSettingsService,
    private readonly lotCost: AccountingLotCostService,
    private readonly wbFinance: WbFinanceService,
    private readonly catalog: ProductCatalogService,
  ) {}

  @Get()
  status(): IAccountingStatus {
    return this.accounting.status();
  }

  /**
   * Журнал синхронизации (TASK-212): по площадке и месяцу окна — последняя
   * попытка, последний успех, ошибка, пропуск. Читает только Postgres и Mongo.
   */
  @Get('sync')
  sync(@Req() request: IRequestWithCrmUser): Promise<IAccountingSyncView> {
    const { telegramUserId, features } = request.crmUser;
    return this.accounting.syncStatus(telegramUserId, features);
  }

  /**
   * Сверка v2 (ЯМ — TASK-226, Ozon/WB — TASK-227): статьи реестра против
   * документов площадки за месяц «ГГГГ-ММ», разница — до операций. Только чтение
   * базы, площадка не зовётся. `marketplace` — ym|ozon|wb, пусто — первая
   * доступная; Ozon/WB не подключён или закрыт фичей — 403.
   * Метод заменяет фичи класса (`getAllAndOverride`), поэтому зонтик — тоже здесь.
   */
  @Get('reconcile')
  @RequireFeature(FEATURE.FIN_ACCOUNTING, FEATURE.FIN_ACCOUNTING_RECONCILE)
  async reconcile(
    @Req() request: IRequestWithCrmUser,
    @Query('month') month: unknown,
    @Query('marketplace') marketplaceQuery: unknown,
  ): Promise<ICrmAccountingReconcile> {
    const period = parseReconcileMonth(month);
    if (!period) {
      throw new BadRequestException({
        statusCode: 400,
        code: INVALID_RECONCILE_MONTH,
        message: 'Месяц ожидается в виде ГГГГ-ММ',
      });
    }
    const requested = parseReconcileMarketplace(marketplaceQuery);
    if (requested === undefined) {
      throw new BadRequestException({
        statusCode: 400,
        code: INVALID_RECONCILE_MARKETPLACE,
        message: 'Площадка ожидается: ym, ozon или wb',
      });
    }
    const { telegramUserId, features } = request.crmUser;
    const available = await this.accounting.marketplacesOf(telegramUserId, features);
    const marketplace = pickReconcileMarketplace(requested, available);
    if (!marketplace) {
      throw new ForbiddenException({
        statusCode: 403,
        code: RECONCILE_MARKETPLACE_UNAVAILABLE,
        message: 'Площадка не подключена или закрыта для «Финучёта»',
      });
    }
    const result = await this.reconciliation.reconcile(
      telegramUserId,
      period,
      new Date(),
      marketplace,
    );
    return toCrmAccountingReconcile(result, available);
  }

  /**
   * Отчёт кабинета WB «Продвижение» файлом (TASK-209) → справочные строки
   * рекламы `promotion_report` за выбранный месяц. Разбор и запись — в запросе
   * (секунды), сверки и статуса месяца у файла нет. Метод перекрывает фичи
   * класса, поэтому зонтик повторён.
   */
  @Post('uploads/wb-promotion')
  @HttpCode(200)
  @RequireFeature(FEATURE.FIN_ACCOUNTING, FEATURE.FIN_ACCOUNTING_UPLOADS)
  @UseInterceptors(FinanceUploadInterceptor)
  async uploadWbPromotion(
    @Req() request: IRequestWithCrmUser,
    @UploadedFile() file: IUploadedFile | undefined,
    @Body() body: { month?: unknown } | undefined,
  ): Promise<TCrmAccountingUploadView> {
    const { filename, month } = acceptedUpload(file, body?.month, {
      noFile: WB_PROMOTION_UPLOAD_NO_FILE_TEXT,
      badExtension: WB_PROMOTION_UPLOAD_BAD_EXTENSION_TEXT,
    });
    try {
      const result = await this.wbFinance.importPromotionFile(
        request.crmUser.telegramUserId,
        month.period,
        { buffer: file.buffer, filename },
      );
      if (result.status === 'unchanged') {
        return { status: 'unchanged', month: month.month, rows: result.rows };
      }
      return {
        status: 'imported',
        month: month.month,
        rows: result.rows,
        inserted: result.inserted,
        matched: result.matched,
      };
    } catch (error) {
      throw financeUploadError(error);
    }
  }

  /** Ручные операции (TASK-208): список и варианты формы. */
  @Get('manual-operations')
  async manualOperations(@Req() request: IRequestWithCrmUser): Promise<ICrmManualOperationsView> {
    return this.manualView(request);
  }

  /**
   * Создать. Повтор той же формы (тот же `clientKey`) отвечает тем же видом и
   * дубля не заводит. Ответ — полный вид раздела, как у «Расходов».
   */
  @Post('manual-operations')
  async createManual(
    @Req() request: IRequestWithCrmUser,
    @Body() body: unknown,
  ): Promise<ICrmManualOperationsView> {
    await this.guarded(() =>
      this.manual.create(request.crmUser.telegramUserId, bodyObject(body), this.actorOf(request)),
    );
    return this.manualView(request);
  }

  @Put('manual-operations/:id')
  async updateManual(
    @Req() request: IRequestWithCrmUser,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<ICrmManualOperationsView> {
    await this.guarded(() =>
      this.manual.update(
        request.crmUser.telegramUserId,
        id,
        bodyObject(body),
        this.actorOf(request),
      ),
    );
    return this.manualView(request);
  }

  @Delete('manual-operations/:id')
  async removeManual(
    @Req() request: IRequestWithCrmUser,
    @Param('id') id: string,
  ): Promise<ICrmManualOperationsView> {
    await this.guarded(() =>
      this.manual.remove(request.crmUser.telegramUserId, id, this.actorOf(request)),
    );
    return this.manualView(request);
  }

  /** Журнал изменений операции — и удалённой тоже: история не теряется. */
  @Get('manual-operations/:id/history')
  async manualHistory(
    @Req() request: IRequestWithCrmUser,
    @Param('id') id: string,
  ): Promise<{ items: ICrmManualOperationChange[] }> {
    const rows = await this.guarded(() => this.manual.history(request.crmUser.telegramUserId, id));
    return { items: rows.map(toCrmManualOperationChange) };
  }

  /**
   * Поиск товара для истории закупа v2 (TASK-235): тот же список, что у «Товаров»,
   * но под `fin_accounting` — «Финучёт» от фичи `products` не зависит (решение
   * `accounting_cost_history_product_search`). Объявлен до `cost-history/:productId`,
   * иначе `products` ушло бы туда как id.
   */
  @Get('cost-history/products')
  async costProducts(
    @Req() request: IRequestWithCrmUser,
    @Query('q') q?: string,
  ): Promise<ICrmCostProducts> {
    return toCrmCostProducts(
      await this.catalog.list(request.crmUser.telegramUserId, {
        q: costProductQuery(q),
        brand: null,
        page: 1,
        limit: COST_PRODUCT_SEARCH_LIMIT,
      }),
    );
  }

  /**
   * История закупа v2 товара (TASK-213): записи с моментом начала и журнал
   * исправлений. Текущая история себестоимости «Товаров» — другая и здесь не видна.
   */
  @Get('cost-history/:productId')
  async costHistoryOf(
    @Req() request: IRequestWithCrmUser,
    @Param('productId') productId: string,
  ): Promise<ICrmCostHistoryView> {
    return this.costGuarded(async () =>
      toCrmCostHistoryView(
        await this.costHistory.history(request.crmUser.telegramUserId, productId),
      ),
    );
  }

  /**
   * Исправление прошлой цены: `{ validFrom, price, currency?, rate?, extraCosts?, reason }`.
   * Автор — из токена, не из тела. Ответ — история товара целиком.
   */
  @Post('cost-history/:productId/corrections')
  async correctCost(
    @Req() request: IRequestWithCrmUser,
    @Param('productId') productId: string,
    @Body() body: unknown,
  ): Promise<ICrmCostHistoryView> {
    const telegramUserId = request.crmUser.telegramUserId;
    return this.costGuarded(async () => {
      await this.costHistory.correct(
        telegramUserId,
        productId,
        bodyObject(body),
        this.actorOf(request),
      );
      return toCrmCostHistoryView(await this.costHistory.history(telegramUserId, productId));
    });
  }

  /**
   * Правило агентской базы налога «Финучёта» (TASK-221) и варианты выбора. Сам
   * налог года — фоновая задача `accounting:tax-year` (журнал всех площадок).
   */
  @Get('tax/settings')
  async taxSettings(@Req() request: IRequestWithCrmUser): Promise<ICrmTaxBaseRule> {
    return toCrmTaxBaseRule(await this.taxBaseRules.snapshot(request.crmUser.telegramUserId));
  }

  /** `{ baseRule: 'gross' | 'net' }`; другое — 400 `INVALID_TAX_BASE_RULE`. */
  @Post('tax/settings')
  async saveTaxSettings(
    @Req() request: IRequestWithCrmUser,
    @Body() body: unknown,
  ): Promise<ICrmTaxBaseRule> {
    const { baseRule } = bodyObject(body);
    try {
      return toCrmTaxBaseRule(
        await this.taxBaseRules.set(request.crmUser.telegramUserId, baseRule),
      );
    } catch (error) {
      if (error instanceof TaxBaseRuleValidationError) {
        throw new BadRequestException({
          statusCode: 400,
          code: INVALID_TAX_BASE_RULE,
          field: 'baseRule',
          message: error.message,
        });
      }
      throw error;
    }
  }

  /**
   * Режим себестоимости (TASK-215): А — закуп из прайса, Б — партии FIFO. Под
   * `fin_accounting_lots`: без партий выбирать нечего. Хранится выбор продавца;
   * действующий режим Б — только при открытой фиче.
   */
  @Get('cost/settings')
  @RequireFeature(FEATURE.FIN_ACCOUNTING, FEATURE.FIN_ACCOUNTING_LOTS)
  async costSettingsView(@Req() request: IRequestWithCrmUser): Promise<ICrmCostSettings> {
    return toCrmCostSettings(await this.costSettings.snapshot(request.crmUser.telegramUserId));
  }

  /** `{ method: 'historical_price' | 'lot_fifo' }`; другое — 400 `INVALID_COST_METHOD`. */
  @Post('cost/settings')
  @RequireFeature(FEATURE.FIN_ACCOUNTING, FEATURE.FIN_ACCOUNTING_LOTS)
  async saveCostSettings(
    @Req() request: IRequestWithCrmUser,
    @Body() body: unknown,
  ): Promise<ICrmCostSettings> {
    const { method } = bodyObject(body);
    try {
      return toCrmCostSettings(await this.costSettings.set(request.crmUser.telegramUserId, method));
    } catch (error) {
      if (error instanceof CostMethodValidationError) {
        throw new BadRequestException({
          statusCode: 400,
          code: INVALID_COST_METHOD,
          field: 'method',
          message: error.message,
        });
      }
      throw error;
    }
  }

  /**
   * Партии с остатками (TASK-216): остаток — тот же FIFO, что себестоимость
   * режима Б (колонка `remaining` не истина). Уровень аккаунта: склад один на
   * все площадки, магазин из URL не нужен.
   */
  @Get('lots')
  @RequireFeature(FEATURE.FIN_ACCOUNTING, FEATURE.FIN_ACCOUNTING_LOTS)
  async lots(@Req() request: IRequestWithCrmUser): Promise<ICrmAccountingLots> {
    return toCrmLots(await this.lotCost.lotsWithRemaining(request.crmUser.telegramUserId));
  }

  private async costGuarded<T>(run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (error) {
      if (error instanceof CostCorrectionValidationError) {
        throw new BadRequestException({
          statusCode: 400,
          code: INVALID_COST_CORRECTION,
          field: error.field,
          message: error.message,
        });
      }
      if (error instanceof CostHistoryProductNotFoundError) {
        throw new NotFoundException({
          statusCode: 404,
          code: COST_PRODUCT_NOT_FOUND,
          message: error.message,
        });
      }
      throw error;
    }
  }

  private async manualView(request: IRequestWithCrmUser): Promise<ICrmManualOperationsView> {
    return toCrmManualOperationsView(await this.manual.list(request.crmUser.telegramUserId));
  }

  private actorOf(request: IRequestWithCrmUser): IManualOperationActor {
    return {
      author: request.crmUser.telegramUserId,
      impersonatedBy: request.crmUser.impersonatedBy ?? null,
    };
  }

  /** Ошибки сервиса → коды раздела; прочее уходит общему фильтру как есть. */
  private async guarded<T>(run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (error) {
      if (error instanceof ManualOperationValidationError) {
        throw new BadRequestException({
          statusCode: 400,
          code: INVALID_MANUAL_OPERATION,
          field: error.field,
          message: error.message,
        });
      }
      if (error instanceof ManualOperationNotFoundError) {
        throw new NotFoundException({
          statusCode: 404,
          code: MANUAL_OPERATION_NOT_FOUND,
          message: error.message,
        });
      }
      throw error;
    }
  }
}
