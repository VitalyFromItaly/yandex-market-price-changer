import type {
  ICrmPurchasePricesView,
  ICrmUploadAccepted,
  IUploadedFile,
} from './crm-price-list.domain';
import type { ICrmStockSyncJob } from '../../telegram/queue/processors/stock-sync.processor';

import { InjectQueue } from '@nestjs/bull';
import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Post,
  Query,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { Queue } from 'bull';
import { randomUUID } from 'node:crypto';

import { CrmJobResultService } from '../../../database/services/crm-job-result.service';
import {
  PURCHASE_PRICE_PAGE_MAX,
  PurchasePriceService,
} from '../../../database/services/purchase-price.service';
import { YandexMarketService } from '../../../database/services/yandex-market.service';
import { JOB_TYPES, QUEUE_NAMES } from '../../telegram';
import { FEATURE, isFeatureEnabled } from '../../telegram/bots/shared/features.domain';
import { applyDiscounts, ratesOf } from '../../yandex/reports/profit';
import { bothHalvesOff, checkUploadFile } from '../../yandex/stocks/stock-upload-policy';
import {
  StockUploadPolicyService,
  uploadCredentials,
} from '../../yandex/stocks/stock-upload-policy.service';
import {
  UPLOAD_DISABLED_TEXT,
  uploadFileErrorText,
  uploadProgressText,
  uploadWarningText,
} from '../../yandex/stocks/stock-upload.texts';
import { StoresService } from '../../yandex/stores/stores.service';
import { RequireFeature } from '../crm-auth.decorators';
import { FEATURE_DISABLED } from '../crm-features.domain';
import { CrmJwtGuard, IRequestWithCrmUser } from '../crm-jwt.guard';
import { NO_STORE, NO_STORE_TEXT } from '../settings/crm-settings.domain';
import { STORE_NOT_FOUND, STORE_NOT_FOUND_TEXT } from '../stores/crm-stores.domain';

import {
  INVALID_FILE,
  NO_FILE_TEXT,
  PRICE_LIST_UPLOAD_KIND,
  UPLOAD_RUNNING,
  UPLOAD_RUNNING_TEXT,
  decodeFileName,
  parseDryRun,
  parseListQuery,
} from './crm-price-list.domain';
import { PriceListUploadInterceptor } from './price-list-upload.interceptor';

/**
 * «Прайс» CRM: /api/crm/ym/price-list.
 *
 * Загрузка идёт ТЕМ ЖЕ путём, что у бота: барьеры — `StockUploadPolicyService`,
 * очередь — `file-processing`, джоба — `SYNC_STOCKS`, обработка —
 * `StockSyncProcessor` → `StockSyncService.sync`. Отличаются только источник
 * файла (`CrmJobResult.input` вместо file_id) и доставка итога (тот же
 * документ, веб опрашивает его через /api/crm/ym/jobs/:id). Одна очередь с
 * ботом — ради «одна запись остатков за раз» на оба канала.
 *
 * В payload Redis — ни буфера, ни токена: файл лежит в Mongo под TTL задачи,
 * креды процессор перечитывает сам.
 */
@Controller('crm/ym/price-list')
@UseGuards(CrmJwtGuard)
export class CrmPriceListController {
  constructor(
    private readonly policy: StockUploadPolicyService,
    private readonly yandexMarket: YandexMarketService,
    private readonly stores: StoresService,
    private readonly results: CrmJobResultService,
    private readonly purchasePrices: PurchasePriceService,
    @InjectQueue(QUEUE_NAMES.FILE_PROCESSING) private readonly queue: Queue,
  ) {}

  @Post('upload')
  @HttpCode(HttpStatus.ACCEPTED)
  @UseInterceptors(PriceListUploadInterceptor)
  async upload(
    @Req() request: IRequestWithCrmUser,
    @UploadedFile() file: IUploadedFile | undefined,
    @Body() body: Record<string, unknown>,
  ): Promise<ICrmUploadAccepted> {
    const user = request.crmUser;

    if (!file) throw invalidFile(NO_FILE_TEXT);
    const fileName = decodeFileName(file.originalname ?? '');
    const fileError = checkUploadFile(fileName, file.size);
    if (fileError) throw invalidFile(uploadFileErrorText(fileError, fileName));

    // Фичи — из того же снимка, что гейт; у админа там allFeaturesEnabled().
    const savePrices = isFeatureEnabled(user.features, FEATURE.PURCHASE_PRICES);
    const stockFeatureOn = isFeatureEnabled(user.features, FEATURE.STOCK_UPDATE);
    if (bothHalvesOff(savePrices, stockFeatureOn)) throw uploadDisabled();

    // Остатки пишутся на склад магазина, открытого в вебе, — не активного в боте.
    const storeKey = typeof body?.store === 'string' ? body.store : '';
    if (!storeKey) throw new BadRequestException('Не выбран магазин');
    const resolved = await this.stores.resolve(user.telegramUserId, storeKey, {
      telegramUserId: user.telegramUserId,
      source: 'crm',
      context: 'crm-price-list:upload',
    });
    if (!resolved) {
      throw new NotFoundException({
        statusCode: 404,
        code: STORE_NOT_FOUND,
        message: STORE_NOT_FOUND_TEXT,
      });
    }
    const { store } = resolved;
    const credentials = uploadCredentials(store);
    if (!credentials) {
      throw new ConflictException({ statusCode: 409, code: NO_STORE, message: NO_STORE_TEXT });
    }

    const dryRun = parseDryRun(body?.dryRun);
    const decision = await this.policy.decide(store, credentials, {
      savePrices,
      stockFeatureOn,
      dryRun,
    });
    if (!decision.accepted) throw uploadDisabled();

    const claim = await this.results.claim({
      jobId: randomUUID(),
      telegramUserId: user.telegramUserId,
      kind: PRICE_LIST_UPLOAD_KIND,
      params: { fileName, dryRun },
      input: { buffer: file.buffer, filename: fileName },
    });
    // Дедуп здесь — отказ, а не «вот идущая задача»: у отчётов повторный POST
    // того же отчёта безвреден, а здесь молча подменить новый файл старым
    // значило бы соврать о том, что загружено.
    if (!claim.created) {
      throw new ConflictException({
        statusCode: 409,
        code: UPLOAD_RUNNING,
        jobId: claim.jobId,
        message: UPLOAD_RUNNING_TEXT,
      });
    }

    // Сколько впереди — ДО постановки своей джобы, иначе она посчитала бы себя.
    const ahead = await this.jobsAhead();
    const payload: ICrmStockSyncJob = {
      source: 'crm',
      jobId: claim.jobId,
      telegramUserId: user.telegramUserId,
      fileName,
      dryRun,
      savePurchasePrices: decision.savePurchasePrices,
      stockWriteAllowed: decision.stockWriteAllowed,
      campaignId: resolved.entry.campaignId,
    };
    try {
      // attempts: 1 — авто-повтор записи остатков жжёт квоту Partner API.
      await this.queue.add(JOB_TYPES.SYNC_STOCKS, payload, { attempts: 1, jobId: claim.jobId });
    } catch (error) {
      // Redis недоступен: без этого замок висел бы до TTL, а файл — в Mongo.
      await this.results.finishFailed(claim.jobId, 'Очередь недоступна. Попробуйте позже.');
      throw error;
    }

    return {
      jobId: claim.jobId,
      warning: decision.warning
        ? { code: decision.warning, text: uploadWarningText(decision.warning, 'crm') }
        : null,
      progress: uploadProgressText(decision.progress),
      ahead,
    };
  }

  /**
   * Закупочные цены продавца. Закуп считается скидкой бренда при чтении
   * (`applyDiscounts`, как в «Прибыли»), поэтому экран показывает ровно то,
   * чем считается прибыль, и смена процента видна сразу.
   */
  @Get('purchase-prices')
  @RequireFeature(FEATURE.PURCHASE_PRICES)
  async purchasePricesList(
    @Req() request: IRequestWithCrmUser,
    @Query() query: Record<string, unknown>,
  ): Promise<ICrmPurchasePricesView> {
    const telegramUserId = request.crmUser.telegramUserId;
    const { q, page, limit } = parseListQuery(query);

    const [store, list, lastUpdatedAt] = await Promise.all([
      this.yandexMarket.findByTelegramUser(telegramUserId),
      this.purchasePrices.list(telegramUserId, { q, page, limit }),
      this.purchasePrices.lastUpdatedAt(telegramUserId),
    ]);

    const rows = new Map(list.items.map((item) => [item.sku, item]));
    const costs = applyDiscounts(rows, ratesOf(store ?? {}));

    return {
      items: list.items.map((item) => ({
        sku: item.sku,
        name: item.name ?? null,
        category: item.category ?? null,
        price: item.price,
        cost: costs.get(item.sku) ?? item.price,
        updatedAt: item.updatedAt ? item.updatedAt.toISOString() : null,
      })),
      total: list.total,
      page,
      limit: Math.min(limit, PURCHASE_PRICE_PAGE_MAX),
      lastUpdatedAt: lastUpdatedAt ? lastUpdatedAt.toISOString() : null,
    };
  }

  private async jobsAhead(): Promise<number> {
    const [waiting, active] = await Promise.all([
      this.queue.getWaitingCount(),
      this.queue.getActiveCount(),
    ]);
    return waiting + active;
  }
}

function invalidFile(message: string): BadRequestException {
  return new BadRequestException({ statusCode: 400, code: INVALID_FILE, field: 'file', message });
}

function uploadDisabled(): ForbiddenException {
  return new ForbiddenException({
    statusCode: 403,
    code: FEATURE_DISABLED,
    message: UPLOAD_DISABLED_TEXT,
  });
}
