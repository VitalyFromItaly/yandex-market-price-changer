import type {
  AccountingLotResponse,
  AccountingLotRow,
  AccountingLotsResponse,
  AccountingLotsView,
} from '../accounting.domain';

import { formatCount, formatDay, formatKopecks } from '@/shared/utils';

/** Партия → строка таблицы. Остаток и цены — с сервера, здесь только подписи. */
export function toAccountingLotRow(lot: AccountingLotResponse): AccountingLotRow {
  return {
    key: lot.lotId,
    productLabel: lot.name ?? lot.sku,
    skuLabel: lot.sku,
    unmatchedNote: lot.productMatched
      ? null
      : 'Артикул не сопоставлен с товаром — партия не списывается',
    supplierLabel: lot.supplier,
    receivedLabel: formatDay(lot.receivedDay),
    countLabel: `${formatCount(lot.count)} шт.`,
    remainingLabel: `${formatCount(lot.remaining)} шт.`,
    soldOut: lot.remaining === 0,
    unitCostLabel: formatKopecks(lot.unitCostKopecks),
    unitCostNote:
      lot.extraKopecks > 0 ? `Закуп ${formatKopecks(lot.unitPriceKopecks)} + доп. расходы` : null,
    remainingCostLabel: formatKopecks(lot.remainingCostKopecks),
  };
}

/** Ответ `GET lots` → вид экрана партий. */
export function mapAccountingLots(response: AccountingLotsResponse): AccountingLotsView {
  const { remaining, remainingCostKopecks } = response.totals;
  return {
    rows: response.lots.map(toAccountingLotRow),
    totalsLabel: `В остатке ${formatCount(remaining)} шт. на ${formatKopecks(remainingCostKopecks)}`,
  };
}
