import type { IPurchaseRow } from '../../modules/yandex/reports/profit';

import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';

import { PurchasePrice, PurchasePriceDocument } from '../schemas/purchase-price.schema';

/** Одна строка прайса, готовая к записи: артикул уже разрешён по каталогу. */
export interface IPurchasePriceRow {
  sku: string;
  price: number;
  name?: string;
  category?: string;
}

/** Сколько операций отправлять в одном bulkWrite. */
const UPSERT_CHUNK_SIZE = 1000;

/**
 * Закупочные цены продавца.
 *
 * Все запросы скоупятся по telegramUserId: сервис мультитенантный, и закуп
 * одного продавца не должен быть виден другому даже случайно.
 */
@Injectable()
export class PurchasePriceService {
  private readonly logger = new Logger(PurchasePriceService.name);

  constructor(
    @InjectModel(PurchasePrice.name)
    private readonly model: Model<PurchasePriceDocument>,
  ) {}

  /**
   * Записать цены из прайса.
   *
   * ОДИН bulkWrite на всю загрузку, а не четыре тысячи запросов подряд: прайс —
   * это ~4300 строк, и последовательные upsert'ы держали бы обработчик минуты.
   *
   * Upsert настоящий (`upsert: true`), а не find-then-create: два быстрых файла
   * подряд не должны порождать дубли, которые потом отсекает только unique-индекс
   * с ошибкой 11000. Образец — UserAccessService; `YandexMarketService.upsertBy…`
   * копировать нельзя, он гоночный.
   *
   * Отсутствующие в файле позиции НЕ удаляются. Прайс может прийти частичным —
   * по одному бренду, — и удаление обнулило бы закуп по всему остальному
   * каталогу. Возраст данных виден через `lastUpdatedAt`.
   */
  async upsertMany(telegramUserId: string, rows: readonly IPurchasePriceRow[]): Promise<number> {
    if (!rows.length) return 0;

    const operations = rows.map((row) => ({
      updateOne: {
        filter: { telegramUserId, sku: row.sku },
        update: {
          $set: {
            price: row.price,
            name: row.name,
            category: row.category,
          },
        },
        upsert: true,
      },
    }));

    // Пачками, а не одним bulkWrite: файл склада вырос вчетверо (19 143 строки),
    // и запас по лимитам одной операции незачем расходовать целиком. Заодно в
    // логе виден прогресс, а не одна строка через полминуты.
    for (let i = 0; i < operations.length; i += UPSERT_CHUNK_SIZE) {
      await this.model.bulkWrite(operations.slice(i, i + UPSERT_CHUNK_SIZE));
    }

    this.logger.log(`Закупочные цены для ${telegramUserId}: записано ${rows.length}`);

    return rows.length;
  }

  /**
   * Строки прайса по списку артикулов — картой sku → {цена, название, категория}.
   *
   * Возвращается ЦЕНА ПРАЙСА, а не закуп: скидка (своя у «Востока», своя у
   * остального) применяется при расчёте, `applyDiscounts` в profit.ts. Поэтому
   * наружу идут ещё название и категория — по ним определяется группа скидки.
   * Смена процента не требует перезагрузки файла именно из-за этого.
   *
   * Один запрос с `$in`, а не запрос на позицию: в отчёте за месяц артикулов
   * бывают сотни, и цикл из findOne превратил бы сборку отчёта в минуты.
   */
  async findBySkus(
    telegramUserId: string,
    skus: readonly string[],
  ): Promise<Map<string, IPurchaseRow>> {
    const rows = new Map<string, IPurchaseRow>();
    if (!skus.length) return rows;

    // Дубли в списке ни на что не влияют, но раздувают запрос — заказов с одним
    // и тем же товаром в выборке много.
    const unique = [...new Set(skus)];

    const documents = await this.model.find({ telegramUserId, sku: { $in: unique } }).exec();

    for (const doc of documents) {
      rows.set(doc.sku, { price: doc.price, name: doc.name, category: doc.category });
    }

    return rows;
  }

  /**
   * Название и категория каждой строки закупа — для экрана «Скидки по брендам».
   *
   * НЕ `distinct('category')`: бренд определяется и по названию тоже — строки
   * «(без категории)» с «CASIO …» в имени distinct по категории потерял бы.
   * Проекция из двух полей + lean: даже на выросшем файле (19 143 строки) это
   * мегабайт-другой на один тап по кнопке настроек, а не полный документ на
   * строку.
   */
  async listNamesAndCategories(
    telegramUserId: string,
  ): Promise<{ name?: string; category?: string }[]> {
    const documents = await this.model
      .find({ telegramUserId })
      .select('name category')
      .lean()
      .exec();

    return documents.map((doc) => ({ name: doc.name, category: doc.category }));
  }

  /**
   * Когда последний раз загружали прайс.
   *
   * Печатается в отчёте о прибыли: закуп месячной давности даёт правдоподобную,
   * но неверную прибыль, и продавец должен видеть, на какие данные смотрит.
   */
  async lastUpdatedAt(telegramUserId: string): Promise<Date | null> {
    // Сортировка и лимит на стороне базы: позиций у продавца четыре тысячи, и
    // вытаскивать их все ради одной даты незачем.
    const latest = await this.model.findOne({ telegramUserId }).sort({ updatedAt: -1 }).exec();

    return latest?.updatedAt ?? null;
  }

  /** Сколько позиций с закупом известно продавцу — для экрана настроек. */
  async countForUser(telegramUserId: string): Promise<number> {
    return await this.model.countDocuments({ telegramUserId }).exec();
  }

  /**
   * Удалить все закупочные цены продавца — при удалении пользователя из панели.
   * Ключ здесь только `telegramUserId` (цены пишутся без botId). Возвращает
   * число удалённых строк; ноль — нормальный ответ, прайс мог и не грузиться.
   */
  async deleteForUser(telegramUserId: string): Promise<number> {
    const result = await this.model.deleteMany({ telegramUserId }).exec();
    return result.deletedCount ?? 0;
  }
}
