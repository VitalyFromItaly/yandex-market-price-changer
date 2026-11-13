import type { WbPromotionUploadResponse } from '../accounting.domain';
import type { FinanceUploadSummary } from '@/modules/finance/finance.domain';

import { monthLabel } from '@/shared/period';

/** Итог загрузки «Продвижения» словами: сколько списаний, сколько новых, что уже было. */
export function toWbPromotionUploadSummary(
  response: WbPromotionUploadResponse,
): FinanceUploadSummary {
  const month = monthLabel(response.month).toLowerCase();
  if (response.status === 'unchanged') {
    return {
      title: `Этот файл уже загружен за ${month}`,
      lines: [`Списаний в нём: ${response.rows}. Ничего не изменилось.`],
    };
  }
  return {
    title: `Реклама WB за ${month} загружена`,
    lines: [
      `Списаний в файле: ${response.rows}.`,
      `Новых: ${response.inserted}, уже были: ${response.matched}.`,
    ],
  };
}
