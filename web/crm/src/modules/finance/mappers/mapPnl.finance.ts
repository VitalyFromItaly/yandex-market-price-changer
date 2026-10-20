import type {
  FinanceMonth,
  FinancePeriodStatus,
  MonthOption,
  MonthStatusModel,
  PnlLevelRow,
  PnlModel,
  PnlResponse,
  StatusTone,
} from '../finance.domain';

import { unconfirmedSummary } from '../../../../../../src/shared/profit-confirmation';

import { monthLabel } from '@/shared/period';
import {
  formatCount,
  formatDay,
  formatKopecks,
  formatMoscowDate,
  formatRub,
  plural,
} from '@/shared/utils';

/** Подпись месяца переехала в `@/shared/period` (второй потребитель — ИИ-разбор, TASK-150). */
export { monthLabel };

export function statusTone(status: FinancePeriodStatus | null): StatusTone {
  if (status === 'verified') return 'ok';
  if (status === 'discrepancy') return 'danger';
  if (status === 'preliminary') return 'warn';
  return 'default';
}

export function toMonthOption(month: FinanceMonth): MonthOption {
  return {
    value: month.month,
    label: monthLabel(month.month),
    statusLabel: month.statusLabel,
    tone: statusTone(month.status),
  };
}

/** Статус месяца для вкладки «Сверка»: что сделано и что нашлось. */
export function toMonthStatus(month: FinanceMonth): MonthStatusModel {
  const lines: string[] = [];
  if (month.status === null) {
    lines.push('Журнал за месяц ещё не загружался — загрузка идёт ночью.');
  } else {
    if (month.checkedAt !== null) {
      lines.push(`Последняя загрузка: ${formatMoscowDate(month.checkedAt) ?? month.checkedAt}.`);
    }
    if (month.reconcileNote !== null) lines.push(month.reconcileNote);
    const fixed = month.changedCount + month.removedCount;
    if (fixed > 0) {
      lines.push(
        `Маркет поправил ${formatCount(fixed)} ${plural(fixed, ['строку', 'строки', 'строк'])} ` +
          'отчёта после первой загрузки.',
      );
    }
    if (month.unknownCount > 0) {
      const n = month.unknownCount;
      lines.push(
        `${formatCount(n)} ${plural(n, ['операция', 'операции', 'операций'])} без статьи.`,
      );
    }
  }
  return {
    label: monthLabel(month.month),
    statusLabel: month.statusLabel,
    tone: statusTone(month.status),
    lines,
  };
}

const percent = (ratio: number | null): string | null =>
  ratio === null ? null : `${(ratio * 100).toFixed(1).replace('.', ',')} %`;

/** Расход печатается со знаком «−»: в ответе он положительный (себестоимость, налог). */
const cost = (kopecks: number): number => (kopecks === 0 ? 0 : -kopecks);

function level(key: string, label: string, kopecks: number, total = false): PnlLevelRow {
  return { key, label, amount: formatKopecks(kopecks), total, negative: kopecks < 0 };
}

function notesOf(data: PnlResponse): string[] {
  const notes: string[] = [];
  const unconfirmed = unconfirmedSummary(data.unconfirmed, formatKopecks);
  if (unconfirmed) {
    const skus = data.unconfirmed.skus.length;
    notes.push(
      `${unconfirmed} (${formatCount(skus)} ${plural(skus, ['артикул', 'артикула', 'артикулов'])}). ` +
        'Себестоимость занижена, чистая прибыль завышена — загрузите прайс с этими позициями.',
    );
  }
  if (data.taxIsDefault) {
    notes.push(
      'Налог посчитан по умолчанию — УСН «Доходы» 6 %. Подтвердите режим в разделе «Налоги».',
    );
  }
  if (data.tax.minimumApplied) notes.push('Применён минимальный налог — 1 % от доходов.');
  if (data.tax.undatedLines > 0) {
    const n = data.tax.undatedLines;
    notes.push(
      `${formatCount(n)} ${plural(n, ['строка', 'строки', 'строк'])} дохода без даты признания — ` +
        'в налог не попали.',
    );
  }
  if (data.flat === null && data.flatNote !== null) notes.push(data.flatNote);
  return notes;
}

/** P&L месяца → модель экрана. Уровни и разделы сложены сервером, фронт только печатает. */
export function toPnlModel(data: PnlResponse): PnlModel {
  const l = data.levels;
  const levels: PnlLevelRow[] = [
    level('revenue', 'Выручка', l.revenueKopecks, true),
    level('other', 'Прочие доходы', l.otherIncomeKopecks),
    level('cogs', 'Себестоимость проданного', cost(l.cogsKopecks)),
    level('gross', 'Валовая прибыль', l.grossKopecks, true),
    level('marketplace', 'Расходы площадки', l.marketplaceKopecks),
    ...(l.unrecognizedKopecks === 0
      ? []
      : [level('unrecognized', 'Не распознано', l.unrecognizedKopecks)]),
    level('after', 'После расходов площадки', l.afterMarketplaceKopecks, true),
    level('opex', 'Операционные расходы', cost(l.operatingExpensesKopecks)),
    level('operating', 'Операционная прибыль', l.operatingKopecks, true),
    level('tax', 'Налог', cost(l.taxKopecks)),
  ];

  return {
    month: data.month,
    rangeLabel: `${formatDay(data.from)} — ${formatDay(data.to)}`,
    statusLabel: data.statusLabel,
    tone: statusTone(data.status),
    preliminary: data.status !== 'verified',
    levels,
    net: formatKopecks(l.netKopecks),
    netNegative: l.netKopecks < 0,
    netMargin: percent(l.netMargin),
    sections: data.sections.map((section) => ({
      key: section.key,
      title: section.title,
      amount: formatKopecks(section.kopecks),
      reference: section.key === 'reference',
      articles: section.articles.map((article) => {
        const n = article.operationIds.length;
        return {
          article: article.article,
          title: article.title,
          amount: formatKopecks(article.kopecks),
          negative: article.kopecks < 0,
          countLabel: `${formatCount(n)} ${plural(n, ['операция', 'операции', 'операций'])}`,
          operationIds: article.operationIds,
        };
      }),
    })),
    notes: notesOf(data),
    flat:
      data.flat === null
        ? null
        : {
            label: data.flat.label,
            rows: [
              { key: 'revenue', label: 'Продажи', amount: formatRub(data.flat.revenue) },
              { key: 'commission', label: 'Комиссия', amount: formatRub(-data.flat.commission) },
              { key: 'tax', label: 'Налог', amount: formatRub(-data.flat.tax) },
              { key: 'promo', label: 'Продвижение', amount: formatRub(-data.flat.promo) },
              { key: 'purchase', label: 'Закуп', amount: formatRub(-data.flat.purchase) },
            ],
            net: formatRub(data.flat.net),
          },
  };
}
