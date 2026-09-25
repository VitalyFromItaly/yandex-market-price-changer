import type { ICrmMarketReportsOptions } from './crm-market-reports.domain';
import type {
  IStoreEntry,
  YandexMarketDocument,
} from '../../../database/schemas/yandex-market.schema';
import type { ITopCategory } from '../../yandex/market-reports/market-categories.service';

import {
  BadGatewayException,
  BadRequestException,
  Controller,
  Get,
  NotFoundException,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';

import { ErrorReporter } from '../../errors/error-reporter.service';
import { FEATURE } from '../../telegram/bots/shared/features.domain';
import { MarketCategoriesService } from '../../yandex/market-reports/market-categories.service';
import { mktNoCategoriesText } from '../../yandex/market-reports/market-reports.domain';
import { StoresService } from '../../yandex/stores/stores.service';
import { RequireFeature } from '../crm-auth.decorators';
import { CrmJwtGuard, IRequestWithCrmUser } from '../crm-jwt.guard';
import { withoutIcon } from '../jobs/crm-jobs.domain';
import { STORE_NOT_FOUND, STORE_NOT_FOUND_TEXT } from '../stores/crm-stores.domain';

import { marketReportsOptions } from './crm-market-reports.domain';

export const MARKET_ERROR = 'MARKET_ERROR';

/**
 * Опции форм «Отчётов Маркета»: /api/crm/ym/market-reports. Сами отчёты —
 * фоновые задачи `market-reports:<key>` через /api/crm/ym/jobs.
 *
 * Опции отдаёт сервер из констант домена бота (копия у веба разошлась бы), а
 * список отчётов — по модели ОТКРЫТОГО магазина: оборачиваемость только FBY.
 * Категории — отдельный адрес: это запрос в Маркет, и нужен он одной вкладке.
 */
@Controller('crm/ym/market-reports')
@UseGuards(CrmJwtGuard)
@RequireFeature(FEATURE.MARKET_REPORTS)
export class CrmMarketReportsController {
  constructor(
    private readonly stores: StoresService,
    private readonly categories: MarketCategoriesService,
    private readonly errors: ErrorReporter,
  ) {}

  @Get('options')
  async options(
    @Req() request: IRequestWithCrmUser,
    @Query('store') storeKey: unknown,
  ): Promise<ICrmMarketReportsOptions> {
    const { entry } = await this.resolveStore(request.crmUser.telegramUserId, storeKey, 'options');
    return marketReportsOptions(entry.placementType, new Date());
  }

  @Get('categories')
  async topCategories(
    @Req() request: IRequestWithCrmUser,
    @Query('store') storeKey: unknown,
  ): Promise<{ categories: ITopCategory[]; emptyText: string | null }> {
    const telegramUserId = request.crmUser.telegramUserId;
    const { store } = await this.resolveStore(telegramUserId, storeKey, 'categories');

    let categories: ITopCategory[];
    try {
      categories = await this.categories.topCategories(store);
    } catch (error) {
      void this.errors.report({
        error,
        source: 'crm',
        context: 'crm-market-reports:categories',
        telegramUserId,
        action: 'категории для отчёта «Конкурентная позиция»',
      });
      throw new BadGatewayException({
        statusCode: 502,
        code: MARKET_ERROR,
        message: withoutIcon(mktNoCategoriesText()),
      });
    }
    // Пустой каталог — тот же ответ, что у бота: без категории отчёт не собрать.
    return {
      categories,
      emptyText: categories.length ? null : withoutIcon(mktNoCategoriesText()),
    };
  }

  private async resolveStore(
    telegramUserId: string,
    storeKey: unknown,
    action: string,
  ): Promise<{ store: YandexMarketDocument; entry: IStoreEntry }> {
    if (typeof storeKey !== 'string' || !storeKey) {
      throw new BadRequestException('Не выбран магазин');
    }
    const resolved = await this.stores.resolve(telegramUserId, storeKey, {
      telegramUserId,
      source: 'crm',
      context: `crm-market-reports:${action}`,
    });
    if (!resolved) {
      throw new NotFoundException({
        statusCode: 404,
        code: STORE_NOT_FOUND,
        message: STORE_NOT_FOUND_TEXT,
      });
    }
    return resolved;
  }
}
