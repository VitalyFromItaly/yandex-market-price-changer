import type {
  ICrmCashflowView,
  ICrmFinanceAnomaliesView,
  ICrmFinanceCorrectionView,
  ICrmFinanceDiscrepancyView,
  ICrmFinanceMonthView,
  ICrmFinanceOperationView,
  TCrmFinanceUploadView,
} from './crm-finance.domain';
import type { IUploadedFile } from '../price-list/crm-price-list.domain';

import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
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

import { FINANCE_ORIGINAL_MAX_BYTES } from '../../../database/postgres/finance.schema';
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
import { RequireFeature } from '../crm-auth.decorators';
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
  FINANCE_NO_STORE,
  FINANCE_UPLOAD_BAD_EXTENSION_TEXT,
  FINANCE_UPLOAD_EXTENSIONS,
  FINANCE_UPLOAD_MONTH_TEXT,
  FINANCE_UPLOAD_NO_FILE_TEXT,
  FINANCE_UPLOAD_TOO_LARGE_TEXT,
  INVALID_FINANCE_REQUEST,
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
  ) {}

  @Get('months')
  async months(@Req() request: IRequestWithCrmUser): Promise<{ months: ICrmFinanceMonthView[] }> {
    return { months: toCrmFinanceMonths(await this.screen.months(request.crmUser.telegramUserId)) };
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
  ): Promise<ICrmCashflowView> {
    const parsed = monthOf(month);
    const userId = request.crmUser.telegramUserId;
    const [report, expenses] = await Promise.all([
      this.cashflow.build(userId, parsed.period),
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
  ): Promise<IPage<ICrmFinanceDiscrepancyView>> {
    const { items, total } = await this.screen.discrepancies(
      request.crmUser.telegramUserId,
      monthOf(month),
      { limit: intOf(limit), skip: intOf(skip) },
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
  ): Promise<ICrmFinanceAnomaliesView> {
    const page = await this.screen.anomalies(request.crmUser.telegramUserId, monthOf(month), {
      limit: intOf(limit),
      skip: intOf(skip),
      unreviewedOnly: unreviewed === '1' || unreviewed === 'true',
    });
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
  ): Promise<{ updated: number }> {
    try {
      const updated = await this.screen.reviewAnomalies(
        request.crmUser.telegramUserId,
        body?.keys,
        body?.reviewed,
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

  @Get('corrections')
  async corrections(
    @Req() request: IRequestWithCrmUser,
    @Query('month') month: unknown,
    @Query('limit') limit: unknown,
    @Query('skip') skip: unknown,
  ): Promise<IPage<ICrmFinanceCorrectionView>> {
    const { items, total } = await this.screen.corrections(
      request.crmUser.telegramUserId,
      monthOf(month),
      { limit: intOf(limit), skip: intOf(skip) },
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

function monthOf(value: unknown) {
  const month = parseScreenMonth(value);
  if (!month) throw invalid('month', FINANCE_MONTH_INVALID_TEXT);
  return month;
}
