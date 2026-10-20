import type { TFinanceMarketplace } from '../../database/postgres/finance.schema';
import type { TAnomalyKind } from '../finance/finance-anomalies';

import { MARKETPLACE_LABEL } from '../../shared/marketplace';
import { ANOMALY_KIND_LABEL, rubText } from '../finance/finance-anomalies';
import { esc } from '../telegram/formatting/telegram-format';

/**
 * Тексты уведомлений (TASK-152) — единственный источник: заголовок и тело
 * уведомления строятся здесь, сохраняются в документе и одинаково показываются
 * в центре уведомлений CRM и в сводке Telegram. Тела — простой текст; HTML
 * появляется только в `telegramDigest`, через `esc`.
 */

/** Сколько строк списка показывать в одном уведомлении. */
const LIST_LIMIT = 5;

export interface INotificationTextParts {
  title: string;
  body: string;
}

const percent = (share: number) => `${(share * 100).toFixed(1).replace('.', ',')} %`;
const points = (value: number) => `${value.toFixed(1).replace('.', ',')} п.п.`;
const units = (count: number) => `${count} шт.`;
const days = (value: number) => `${Math.floor(value)} дн.`;
const mp = (marketplace: TFinanceMarketplace) => MARKETPLACE_LABEL[marketplace];

function list(labels: readonly string[]): string {
  const shown = labels.slice(0, LIST_LIMIT).map((label) => `• ${label}`);
  if (labels.length > LIST_LIMIT) shown.push(`…и ещё ${labels.length - LIST_LIMIT}`);
  return shown.join('\n');
}

export const NOTIFICATION_TEXT = {
  salesDrop(input: {
    marketplace: TFinanceMarketplace;
    currentKopecks: number;
    previousKopecks: number;
    drop: number;
  }): INotificationTextParts {
    return {
      title: `${mp(input.marketplace)}: продажи упали на ${percent(input.drop)}`,
      body:
        `Выручка за последние 7 дней — ${rubText(input.currentKopecks)}, ` +
        `за предыдущие 7 — ${rubText(input.previousKopecks)}.`,
    };
  },

  expensesGrowth(input: {
    marketplace: TFinanceMarketplace;
    currentShare: number;
    previousShare: number;
  }): INotificationTextParts {
    return {
      title: `${mp(input.marketplace)}: расходы площадки выросли`,
      body:
        `Услуги и удержания площадки — ${percent(input.currentShare)} выручки за 7 дней ` +
        `против ${percent(input.previousShare)} неделей раньше ` +
        `(+${points((input.currentShare - input.previousShare) * 100)}).`,
    };
  },

  productLoss(input: {
    marketplace: TFinanceMarketplace;
    sku: string;
    name: string | null;
    netKopecks: number;
    units: number;
  }): INotificationTextParts {
    const label = input.name ? `${input.name} (${input.sku})` : input.sku;
    return {
      title: `${mp(input.marketplace)}: товар в убытке — ${label}`,
      body:
        `За 28 дней продано ${units(input.units)}, чистая прибыль ${rubText(input.netKopecks)}. ` +
        'Проверьте цену, себестоимость и расходы площадки.',
    };
  },

  anomaly(input: {
    kind: TAnomalyKind;
    detail: string;
    amountKopecks: number | null;
  }): INotificationTextParts {
    const amount = input.amountKopecks === null ? '' : ` (${rubText(input.amountKopecks)})`;
    return {
      title: `Яндекс Маркет: ${ANOMALY_KIND_LABEL[input.kind].toLowerCase()}${amount}`,
      body: `${input.detail}\nПодробности и отметка «просмотрено» — в «Финансах», вкладка аномалий.`,
    };
  },

  returnsGrowth(input: {
    marketplace: TFinanceMarketplace;
    currentRate: number;
    previousRate: number;
    currentLossesKopecks: number;
  }): INotificationTextParts {
    return {
      title: `${mp(input.marketplace)}: возвраты выросли`,
      body:
        `Доля возвратов за 28 дней — ${percent(input.currentRate)} против ` +
        `${percent(input.previousRate)} за прошлые 28 дней; потери — ${rubText(input.currentLossesKopecks)}.`,
    };
  },

  tax(input: { text: string }): INotificationTextParts {
    return { title: 'Налоговый лимит', body: input.text };
  },

  stock(input: {
    rule: 'out_of_stock' | 'low_stock' | 'stock_running_out';
    label: string;
    available: number;
    unitsPerDay: number | null;
    daysLeft: number | null;
  }): INotificationTextParts {
    const speed =
      input.unitsPerDay === null
        ? ''
        : ` Продаётся ~${input.unitsPerDay.toFixed(1).replace('.', ',')} шт. в день.`;
    if (input.rule === 'out_of_stock') {
      return { title: `Закончился: ${input.label}`, body: `Доступного остатка нет.${speed}` };
    }
    const left = input.daysLeft === null ? '' : ` Хватит примерно на ${days(input.daysLeft)}`;
    if (input.rule === 'low_stock') {
      return {
        title: `Мало остатка: ${input.label}`,
        body: `Доступно ${units(input.available)}.${speed}${left ? `${left}.` : ''}`,
      };
    }
    return {
      title: `Заканчивается: ${input.label}`,
      body: `Доступно ${units(input.available)}.${speed}${left ? `${left}.` : ''}`,
    };
  },

  purchaseNeeded(input: {
    coverDays: number;
    totalUnits: number;
    totalKopecks: number;
    withoutCostSkus: number;
    rows: readonly { label: string; needUnits: number }[];
  }): INotificationTextParts {
    const money = input.totalKopecks > 0 ? ` на ${rubText(input.totalKopecks)}` : '';
    const noCost = input.withoutCostSkus
      ? `\nБез закупочной цены в прайсе: ${input.withoutCostSkus} — сумма без них.`
      : '';
    return {
      title: `Нужна закупка: ${input.rows.length} тов., ${units(input.totalUnits)}`,
      body:
        `Чтобы хватило на ${input.coverDays} дней продаж, докупить ${units(input.totalUnits)}${money}:\n` +
        list(input.rows.map((row) => `${row.label} — ${units(row.needUnits)}`)) +
        noCost,
    };
  },

  staleStock(input: {
    basisDays: number;
    count: number;
    units: number;
    valueKopecks: number | null;
    labels: readonly string[];
  }): INotificationTextParts {
    const value =
      input.valueKopecks === null ? '' : `, по себестоимости ${rubText(input.valueKopecks)}`;
    return {
      title: `Не продаются ${input.basisDays} дней: ${input.count} тов.`,
      body: `На остатке ${units(input.units)}${value}:\n${list(input.labels)}`,
    };
  },

  stockValueHigh(input: {
    totalKopecks: number;
    limitKopecks: number;
    withoutCost: number;
  }): INotificationTextParts {
    const noCost = input.withoutCost
      ? `\nБез себестоимости: ${input.withoutCost} тов. — в сумму не вошли.`
      : '';
    return {
      title: `В остатках ${rubText(input.totalKopecks)}`,
      body:
        `Свой склад и склады площадок по себестоимости — ${rubText(input.totalKopecks)}, ` +
        `порог — ${rubText(input.limitKopecks)}.${noCost}`,
    };
  },
};

/** Сколько уведомлений помещается в одну сводку Telegram; остальное — в CRM. */
export const TELEGRAM_DIGEST_LIMIT = 15;

/** Сводка новых уведомлений для Telegram (HTML). Тексты — те же, что в CRM. */
export function telegramDigest(items: readonly INotificationTextParts[]): string {
  const shown = items.slice(0, TELEGRAM_DIGEST_LIMIT);
  const blocks = shown.map((item) => `<b>${esc(item.title)}</b>\n${esc(item.body)}`);
  const rest = items.length - shown.length;
  const tail = rest > 0 ? `\n\n…и ещё ${rest} — в CRM, раздел «Уведомления».` : '';
  return `🔔 <b>Уведомления</b>\n\n${blocks.join('\n\n')}${tail}`;
}
