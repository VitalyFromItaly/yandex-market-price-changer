import type { ICardsWorkbook } from './cards-workbook';
import type { ICardsSummary, IOfferCard } from './cards.domain';
import type { YandexMarketDocument } from '../../../database/schemas/yandex-market.schema';

import { Injectable } from '@nestjs/common';

import { YandexClientFactory } from '../yandex-client.factory';

import { cardsFileName } from './cards-message';
import { buildCardsWorkbook } from './cards-workbook';
import { summarizeCards } from './cards.domain';

/** Срез карточек: сами карточки, сводка, момент съёмки и книга (null — карточек нет). */
export interface ICardsReport {
  cards: IOfferCard[];
  summary: ICardsSummary;
  takenAt: Date;
  workbook: (ICardsWorkbook & { filename: string }) | null;
}

/**
 * «Карточки» — ядро на оба канала: загрузка, сводка и книга. Бот печатает
 * сводку текстом, CRM — таблицей; числа у обоих из одного `summarizeCards`.
 */
@Injectable()
export class CardsService {
  constructor(private readonly clients: YandexClientFactory) {}

  async build(store: YandexMarketDocument, now: Date = new Date()): Promise<ICardsReport> {
    const cards = await this.clients.forStore(store).loadOfferCards();
    const workbook = cards.length
      ? { ...buildCardsWorkbook(cards), filename: cardsFileName(now) }
      : null;
    return { cards, summary: summarizeCards(cards), takenAt: now, workbook };
  }
}
