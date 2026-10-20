import type { ICrmPriceCalcTariff } from './crm-price-calc.domain';
import type { ICrmJobContext, ICrmJobOutput } from '../jobs/crm-jobs.domain';
import type { OnModuleInit } from '@nestjs/common';

import { Injectable } from '@nestjs/common';

import { PriceCalcRatesService } from '../../finance/price-calc-rates.service';
import { FEATURE } from '../../telegram/bots/shared/features.domain';
import {
  TariffQuoteService,
  TariffQuoteUnavailableError,
} from '../../yandex/reports/tariff-quote.service';
import { CrmJobError } from '../jobs/crm-jobs.domain';
import { CrmJobsRegistry } from '../jobs/crm-jobs.registry';

import {
  PRICE_CALC_RATES_KIND,
  PRICE_CALC_TARIFF_KIND,
  PRICE_CALC_TARIFF_PARAMS_TEXT,
  parseTariffParams,
} from './crm-price-calc.domain';

/**
 * Kind-ы «Калькулятора цен» (TASK-139).
 *
 * `price-calc:rates` — уровня аккаунта, требует и `price_calculator`, и
 * `finance`: факт берётся из журнала. Сборка — `PriceCalcRatesService`
 * финмодуля (TASK-165), её же берёт ИИ; kind — только доставка.
 *
 * `price-calc:tariff` — уровня магазина (решение `price_calc_tariff_check`):
 * тариф Маркета зависит от кампании, магазин задаёт браузер ключом. Только
 * чтение каталога и `tariffs/calculate`, Partner API не пишется. Требует одну
 * `price_calculator`: журнал ему не нужен.
 */
@Injectable()
export class CrmPriceCalcKinds implements OnModuleInit {
  constructor(
    private readonly registry: CrmJobsRegistry,
    private readonly ratesService: PriceCalcRatesService,
    private readonly tariffs: TariffQuoteService,
  ) {}

  onModuleInit(): void {
    this.registry.register(PRICE_CALC_RATES_KIND, {
      features: [FEATURE.PRICE_CALCULATOR, FEATURE.FINANCE],
      scope: 'account',
      run: (context) => this.rates(context),
    });
    this.registry.register(PRICE_CALC_TARIFF_KIND, {
      features: [FEATURE.PRICE_CALCULATOR],
      run: (context) => this.tariff(context),
    });
  }

  async rates(context: ICrmJobContext, now: Date = new Date()): Promise<ICrmJobOutput> {
    return { data: await this.ratesService.build(context.telegramUserId, context.store, now) };
  }

  async tariff(context: ICrmJobContext): Promise<ICrmJobOutput> {
    const params = parseTariffParams(context.params);
    if (!params) throw new CrmJobError(PRICE_CALC_TARIFF_PARAMS_TEXT);
    try {
      const quote = await this.tariffs.quote(context.store, params.sku, params.priceKopecks);
      const data: ICrmPriceCalcTariff = { sku: params.sku, ...quote };
      return { data };
    } catch (error) {
      if (error instanceof TariffQuoteUnavailableError) throw new CrmJobError(error.message);
      throw error;
    }
  }
}
