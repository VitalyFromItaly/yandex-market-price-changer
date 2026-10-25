import type {
  ICrmCashflowView,
  ICrmFinanceAnomaliesView,
  ICrmFinanceCorrectionView,
  ICrmFinanceDiscrepancyView,
  ICrmFinanceMonthView,
  ICrmFinanceOperationView,
  ICrmFinanceUnsupportedView,
  TCrmFinanceUploadView,
} from './crm-finance.domain';
import type { TFinanceMarketplace } from '../../../database/postgres/finance.schema';
import type { IFinancePullResult } from '../../telegram/queue/services/finance-import.scheduler';
import type { IUploadedFile } from '../price-list/crm-price-list.domain';

import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';

import {
  FINANCE_MARKETPLACES,
  FINANCE_ORIGINAL_MAX_BYTES,
} from '../../../database/postgres/finance.schema';
import { labelResolver } from '../../finance/expense.domain';
import { FinanceCashflowService } from '../../finance/finance-cashflow.service';
import { FinanceExpensesService } from '../../finance/finance-expenses.service';
import {
  FinanceImportBusyError,
  FinanceImportService,
  FinanceNoStoreError,
} from '../../finance/finance-import.service';
import { financeToday } from '../../finance/finance-period';
import { parseScreenMonth, screenMonths } from '../../finance/finance-screen';
import {
  FinanceScreenService,
  FinanceScreenValidationError,
} from '../../finance/finance-screen.service';
import { NettingFileError } from '../../finance/ym-netting-file';
import { FEATURE } from '../../telegram/bots/shared/features.domain';
import {
  FinanceImportScheduler,
  FinancePullNotAllowedError,
} from '../../telegram/queue/services/finance-import.scheduler';
import { RequireFeature } from '../crm-auth.decorators';
import { FEATURE_DISABLED } from '../crm-features.domain';
import { CrmJwtGuard, IRequestWithCrmUser } from '../crm-jwt.guard';
import { createUploadInterceptor } from '../crm-upload.interceptor';
import { contentDisposition } from '../jobs/crm-jobs.controller';
import { decodeFileName, INVALID_FILE } from '../price-list/crm-price-list.domain';

import {
  FINANCE_DOCUMENT_NOT_FOUND,
  FINANCE_DOCUMENT_NOT_FOUND_TEXT,
  FINANCE_FILE_BAD_ROW,
  FINANCE_FILE_UNRECOGNIZED,
  FINANCE_FILE_WRONG_REPORT,
  FINANCE_IMPORT_BUSY,
  FINANCE_MARKETPLACE_INVALID_TEXT,
  FINANCE_NO_STORE,
  FINANCE_PULL_MONTHS_TEXT,
  FINANCE_PULL_NOT_ALLOWED,
  FINANCE_UPLOAD_BAD_EXTENSION_TEXT,
  FINANCE_UPLOAD_EXTENSIONS,
  FINANCE_UPLOAD_MONTH_TEXT,
  FINANCE_UPLOAD_NO_FILE_TEXT,
  FINANCE_UPLOAD_TOO_LARGE_TEXT,
  financeMarketplaceClosedText,
  financeUnsupportedView,
  INVALID_FINANCE_REQUEST,
  isFinanceMarketplaceOpen,
  parsePullMonths,
  toCrmCashflowView,
  toCrmFinanceAnomaly,
  toCrmFinanceCorrection,
  toCrmFinanceDiscrepancy,
  toCrmFinanceMonths,
  toCrmFinanceOperation,
} from './crm-finance.domain';
import { FINANCE_MONTH_INVALID_TEXT } from './crm-finance.kinds';

/** Число из query: мусор — умолчание, а не NaN в запросе к базе. */
const intOf = (value: unknown): number | undefined => {
  const n = Number(value);
  return typeof value === 'string' && value !== '' && Number.isFinite(n)
    ? Math.trunc(n)
    : undefined;
};

/**
 * Финотчёт файлом (TASK-114): лимит — потолок оригинала в документе, чтобы
 * загруженный файл сохранялся всегда и его можно было скачать из операции.
 */
const FinanceUploadInterceptor = createUploadInterceptor({
  maxBytes: FINANCE_ORIGINAL_MAX_BYTES,
  tooLargeMessage: FINANCE_UPLOAD_TOO_LARGE_TEXT,
});

interface IPage<T> {
  total: number;
  items: T[];
}

/**
 * «Финансы» CRM (TASK-124): /api/crm/ym/finance. Раздел аккаунта целиком под
 * фичей `finance` (решение `finance_crm_feature_finance`). P&L месяца — фоновая
 * задача `finance:pnl`; здесь — быстрое: месяцы со статусом, раскрытие статьи
 * до операций, оригинал отчёта, ДДС (переехал из «Закупок»), расхождения и
 * корректировки месяца. Всё — только Postgres, в скоупе продавца.
 *
 * Площадка экрана — `?marketplace=` (TASK-180; нет — ЯМ, адрес остаётся
 * `ym/finance`). Вкладка, которой у площадки нет, отвечает причиной
 * (`{ unsupported, note }`), а не нулями. Загрузка файла — только ЯМ.
 */
@Controller('crm/ym/finance')
@UseGuards(CrmJwtGuard)
@RequireFeature(FEATURE.FINANCE)
export class CrmFinanceController {
  constructor(
    private readonly screen: FinanceScreenService,
    private readonly cashflow: FinanceCashflowService,
    private readonly expenses: FinanceExpensesService,
    private readonly imports: FinanceImportService,
    private readonly pulls: FinanceImportScheduler,
  ) {}

  @Get('months')
  async months(
    @Req() request: IRequestWithCrmUser,
    @Query('marketplace') marketplace: unknown,
  ): Promise<{ months: ICrmFinanceMonthView[] }> {
    const mp = marketplaceOf(request, marketplace);
    const months = await this.screen.months(request.crmUser.telegramUserId, new Date(), mp);
    return { months: toCrmFinanceMonths(months) };
  }

  /** Раскрытие статьи: страница id из `operationIds` P&L — сумма та же по построению. */
  @Post('operations')
  async operations(
    @Req() request: IRequestWithCrmUser,
    @Body() body: { ids?: unknown } | undefined,
  ): Promise<{ items: ICrmFinanceOperationView[] }> {
    try {
      const rows = await this.screen.operationsByIds(request.crmUser.telegramUserId, body?.ids);
      return { items: rows.map(toCrmFinanceOperation) };
    } catch (error) {
      if (error instanceof FinanceScreenValidationError) throw invalid(error.field, error.message);
      throw error;
    }
  }

  @Get('documents/:id/original')
  async original(
    @Req() request: IRequestWithCrmUser,
    @Param('id') id: string,
  ): Promise<StreamableFile> {
    const file = await this.screen.original(request.crmUser.telegramUserId, id);
    if (!file) {
      throw new NotFoundException({
        statusCode: 404,
        code: FINANCE_DOCUMENT_NOT_FOUND,
        message: FINANCE_DOCUMENT_NOT_FOUND_TEXT,
      });
    }
    // pg отдаёт bytea Buffer-ом, PGlite — Uint8Array; колонка уже приводит, но не полагаемся.
    const buffer = Buffer.from(file.buffer);
    return new StreamableFile(buffer, {
      type: file.contentType,
      length: buffer.length,
      disposition: contentDisposition(file.filename),
    });
  }

  @Get('cashflow')
  async cashflowView(
    @Req() request: IRequestWithCrmUser,
    @Query('month') month: unknown,
    @Query('marketplace') marketplace: unknown,
  ): Promise<ICrmCashflowView | ICrmFinanceUnsupportedView> {
    const mp = marketplaceOf(request, marketplace);
    const parsed = monthOf(month);
    const unsupported = financeUnsupportedView('cashflow', mp);
    if (unsupported) return unsupported;
    const userId = request.crmUser.telegramUserId;
    const [report, expenses] = await Promise.all([
      this.cashflow.build(userId, parsed.period, undefined, mp),
      this.expenses.snapshot(userId),
    ]);
    return toCrmCashflowView(report, labelResolver(expenses.categories));
  }

  @Get('discrepancies')
  async discrepancies(
    @Req() request: IRequestWithCrmUser,
    @Query('month') month: unknown,
    @Query('limit') limit: unknown,
    @Query('skip') skip: unknown,
    @Query('marketplace') marketplace: unknown,
  ): Promise<IPage<ICrmFinanceDiscrepancyView> | ICrmFinanceUnsupportedView> {
    const mp = marketplaceOf(request, marketplace);
    const parsed = monthOf(month);
    const unsupported = financeUnsupportedView('reconcile', mp);
    if (unsupported) return unsupported;
    const { items, total } = await this.screen.discrepancies(
      request.crmUser.telegramUserId,
      parsed,
      { limit: intOf(limit), skip: intOf(skip) },
      mp,
    );
    return { total, items: items.map(toCrmFinanceDiscrepancy) };
  }

  /**
   * Аномалии месяца (TASK-149). Метод перекрывает `@RequireFeature` класса
   * (`getAllAndOverride`), поэтому `finance` повторён: без журнала аномалий нет.
   */
  @Get('anomalies')
  @RequireFeature(FEATURE.FINANCE, FEATURE.FINANCE_ANOMALIES)
  async anomalies(
    @Req() request: IRequestWithCrmUser,
    @Query('month') month: unknown,
    @Query('limit') limit: unknown,
    @Query('skip') skip: unknown,
    @Query('unreviewed') unreviewed: unknown,
    @Query('marketplace') marketplace: unknown,
  ): Promise<ICrmFinanceAnomaliesView | ICrmFinanceUnsupportedView> {
    const mp = marketplaceOf(request, marketplace);
    const parsed = monthOf(month);
    const unsupported = financeUnsupportedView('anomalies', mp);
    if (unsupported) return unsupported;
    const page = await this.screen.anomalies(
      request.crmUser.telegramUserId,
      parsed,
      {
        limit: intOf(limit),
        skip: intOf(skip),
        unreviewedOnly: unreviewed === '1' || unreviewed === 'true',
      },
      mp,
    );
    return {
      total: page.total,
      unreviewed: page.unreviewed,
      checkedAt: page.checkedAt ? page.checkedAt.toISOString() : null,
      items: page.items.map(toCrmFinanceAnomaly),
    };
  }

  /** «Просмотрено» / «вернуть» — по ключам аномалий; ответ — сколько ключей нашлось у продавца. */
  @Post('anomalies/review')
  @RequireFeature(FEATURE.FINANCE, FEATURE.FINANCE_ANOMALIES)
  async reviewAnomalies(
    @Req() request: IRequestWithCrmUser,
    @Body() body: { keys?: unknown; reviewed?: unknown },
    @Query('marketplace') marketplace: unknown,
  ): Promise<{ updated: number }> {
    const mp = marketplaceOf(request, marketplace);
    const unsupported = financeUnsupportedView('anomalies', mp);
    if (unsupported) throw invalid('marketplace', unsupported.note);
    try {
      const updated = await this.screen.reviewAnomalies(
        request.crmUser.telegramUserId,
        body?.keys,
        body?.reviewed,
        mp,
      );
      return { updated };
    } catch (error) {
      if (error instanceof FinanceScreenValidationError) throw invalid(error.field, error.message);
      throw error;
    }
  }

  /**
   * Ручная загрузка отчёта по платежам (TASK-114). Разбор и запись — в запросе
   * (секунды на месяц), сверка и статус месяца — следом, без ожидания: сверка
   * ходит в Маркет. Метод перекрывает `@RequireFeature` класса, поэтому `finance`
   * повторён.
   */
  @Post('upload')
  @HttpCode(200)
  @RequireFeature(FEATURE.FINANCE, FEATURE.FINANCE_UPLOAD)
  @UseInterceptors(FinanceUploadInterceptor)
  async upload(
    @Req() request: IRequestWithCrmUser,
    @UploadedFile() file: IUploadedFile | undefined,
    @Body() body: { month?: unknown } | undefined,
  ): Promise<TCrmFinanceUploadView> {
    if (!file) throw invalidFile(FINANCE_UPLOAD_NO_FILE_TEXT);
    const filename = decodeFileName(file.originalname);
    const ext = /\.([a-z0-9]+)$/i.exec(filename)?.[1]?.toLowerCase();
    if (!FINANCE_UPLOAD_EXTENSIONS.some((allowed) => allowed === ext)) {
      throw invalidFile(FINANCE_UPLOAD_BAD_EXTENSION_TEXT);
    }
    const month = parseScreenMonth(body?.month);
    const allowed = screenMonths(financeToday(new Date())).map((m) => m.month);
    if (!month || !allowed.includes(month.month)) throw invalid('month', FINANCE_UPLOAD_MONTH_TEXT);

    try {
      const { result } = await this.imports.importManual({
        telegramUserId: request.crmUser.telegramUserId,
        period: month.period,
        buffer: file.buffer,
        filename,
      });
      if (result.status === 'unchanged') {
        return { status: 'unchanged', month: month.month, rows: result.rows };
      }
      return {
        status: 'imported',
        month: month.month,
        documentId: result.documentId,
        rows: result.rows,
        inserted: result.inserted,
        matched: result.matched,
        skippedSuperseded: result.skippedSuperseded,
        unknown: result.unknown,
      };
    } catch (error) {
      throw uploadError(error);
    }
  }

  /**
   * «Загрузить из Маркета»: журнал месяцев периода — разовыми задачами очереди
   * `finance-import`, не дожидаясь ночи. Ответ сразу (202): генерация отчёта у
   * Маркета — минуты; готовность фронт видит по `checkedAt` в `months`. Месяц,
   * который грузили меньше 15 минут назад, приходит в `cooldown`. Метод
   * перекрывает `@RequireFeature` класса, поэтому `finance` повторён.
   */
  @Post('pull')
  @HttpCode(202)
  @RequireFeature(FEATURE.FINANCE, FEATURE.FINANCE_PULL)
  async pull(
    @Req() request: IRequestWithCrmUser,
    @Body() body: { months?: unknown; marketplace?: unknown } | undefined,
  ): Promise<IFinancePullResult> {
    const mp = marketplaceOf(request, body?.marketplace);
    const months = parsePullMonths(body?.months, screenMonths(financeToday(new Date())));
    if (!months) throw invalid('months', FINANCE_PULL_MONTHS_TEXT);
    try {
      return await this.pulls.pullNow(request.crmUser.telegramUserId, mp, months);
    } catch (error) {
      if (error instanceof FinancePullNotAllowedError) {
        throw new ConflictException({
          statusCode: 409,
          code: FINANCE_PULL_NOT_ALLOWED,
          message: error.message,
        });
      }
      throw error;
    }
  }

  @Get('corrections')
  async corrections(
    @Req() request: IRequestWithCrmUser,
    @Query('month') month: unknown,
    @Query('limit') limit: unknown,
    @Query('skip') skip: unknown,
    @Query('marketplace') marketplace: unknown,
  ): Promise<IPage<ICrmFinanceCorrectionView>> {
    const mp = marketplaceOf(request, marketplace);
    const { items, total } = await this.screen.corrections(
      request.crmUser.telegramUserId,
      monthOf(month),
      { limit: intOf(limit), skip: intOf(skip) },
      mp,
    );
    return { total, items: items.map(toCrmFinanceCorrection) };
  }
}

function invalid(field: string, message: string): BadRequestException {
  return new BadRequestException({
    statusCode: 400,
    code: INVALID_FINANCE_REQUEST,
    field,
    message,
  });
}

function invalidFile(message: string): BadRequestException {
  return new BadRequestException({ statusCode: 400, code: INVALID_FILE, field: 'file', message });
}

const NETTING_FILE_ERROR_CODE: Record<NettingFileError['kind'], string> = {
  unrecognized: FINANCE_FILE_UNRECOGNIZED,
  'wrong-report': FINANCE_FILE_WRONG_REPORT,
  'bad-row': FINANCE_FILE_BAD_ROW,
  empty: INVALID_FILE,
  unreadable: INVALID_FILE,
};

/** Отказы загрузки → коды для фронта; остальное уходит общим фильтром (500 + журнал). */
function uploadError(error: unknown): unknown {
  if (error instanceof NettingFileError) {
    const code = NETTING_FILE_ERROR_CODE[error.kind];
    return new BadRequestException({
      statusCode: 400,
      code,
      field: 'file',
      message: error.message,
      ...error.details,
    });
  }
  if (error instanceof FinanceImportBusyError) {
    return new ConflictException({
      statusCode: 409,
      code: FINANCE_IMPORT_BUSY,
      message: error.message,
    });
  }
  if (error instanceof FinanceNoStoreError) {
    return new ConflictException({
      statusCode: 409,
      code: FINANCE_NO_STORE,
      message: error.message,
    });
  }
  return error;
}

/**
 * Площадка экрана из `?marketplace=`: нет — ЯМ, мусор — 400, закрытая фича
 * площадки — 403 (как деталь «Ленты заказов»).
 */
function marketplaceOf(request: IRequestWithCrmUser, value: unknown): TFinanceMarketplace {
  if (value === undefined || value === '') return 'ym';
  const mp = FINANCE_MARKETPLACES.find((key) => key === value);
  if (!mp) throw invalid('marketplace', FINANCE_MARKETPLACE_INVALID_TEXT);
  if (!isFinanceMarketplaceOpen(request.crmUser.features, mp)) {
    throw new ForbiddenException({
      statusCode: 403,
      code: FEATURE_DISABLED,
      message: financeMarketplaceClosedText(mp),
    });
  }
  return mp;
}

function monthOf(value: unknown) {
  const month = parseScreenMonth(value);
  if (!month) throw invalid('month', FINANCE_MONTH_INVALID_TEXT);
  return month;
}
