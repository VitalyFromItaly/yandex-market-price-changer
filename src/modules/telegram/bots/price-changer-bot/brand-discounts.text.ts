import type { YandexMarketDocument } from '../../../../database/schemas/yandex-market.schema';
import type { TBrandKey } from '../../../yandex/reports/brands';

import {
  BRAND_KEYS,
  brandCallback,
  brandInputLabel,
  brandOf,
  brandTitle,
  type IBrandSource,
} from '../../../yandex/reports/brands';
import { brandDiscountOf, discountsOf, rateCallback } from '../../../yandex/reports/profit';
import { b, code } from '../../formatting/telegram-format';

/**
 * Экран «Скидки по брендам» — ОДИН текст и одна клавиатура на все показы.
 *
 * Отдельный файл по образцу settings.text.ts и по той же причине: экран
 * рендерится минимум трижды (кнопка на экране настроек, возврат после
 * сохранения скидки, возврат после отмены), и три копии разъехались бы так же,
 * как когда-то расходились копии экрана настроек.
 *
 * Бренды показываются ТОЛЬКО присутствующие в прайсе продавца: реестр в
 * brands.ts общий, но кнопка «SEIKO» у продавца без SEIKO — это настройка,
 * которая ни на что не влияет, то есть приглашение к недоумению.
 */
export interface IBrandUsage {
  key: TBrandKey;
  count: number;
}

/**
 * Свернуть строки закупа в список брендов с числом позиций.
 *
 * Порядок — порядок BRAND_KEYS, а не частотный: кнопки не должны прыгать между
 * открытиями экрана из-за того, что изменился состав прайса.
 */
export function brandUsageOf(rows: readonly IBrandSource[]): {
  usage: IBrandUsage[];
  otherCount: number;
} {
  const counts = new Map<TBrandKey, number>();
  let otherCount = 0;

  for (const row of rows) {
    const key = brandOf(row);
    if (key) counts.set(key, (counts.get(key) ?? 0) + 1);
    else otherCount += 1;
  }

  const usage = BRAND_KEYS.filter((key) => counts.has(key)).map((key) => ({
    key,
    count: counts.get(key) ?? 0,
  }));

  return { usage, otherCount };
}

export function brandDiscountsText(
  store: YandexMarketDocument | null,
  usage: readonly IBrandUsage[],
  otherCount: number,
): string {
  const lines = [`🏷 ${b('Скидки по брендам')}`, ''];

  if (!usage.length && !otherCount) {
    // Бренды берутся из закупочных цен, а те — из прайса: без файла показывать
    // нечего, и честнее сказать это, чем нарисовать пустой список.
    lines.push(
      'Закупочных цен пока нет — пришлите прайс, и бот определит,',
      'какие бренды есть в ваших товарах.',
    );
    return lines.join('\n');
  }

  lines.push('Закуп = цена прайса минус скидка бренда. Бренды — из вашего прайса.', '');

  // Печатается ДЕЙСТВУЮЩИЙ процент (с учётом дефолта), а не только явно
  // заданный: продавец сверяет отчёт с этим экраном, и «не задано» ему ни о
  // чём не говорит — важен процент, по которому считается закуп.
  const config = discountsOf(store ?? {});
  for (const { key, count } of usage) {
    lines.push(`• ${brandTitle(key)}: ${b(`${brandDiscountOf(config, key)}%`)} — ${count} поз.`);
  }
  if (otherCount > 0) {
    lines.push(`• Остальные: ${b(`${config.defaultPercent}%`)} — ${otherCount} поз.`);
  }

  const example = usage[0]?.key ?? 'vostok';
  lines.push(
    '',
    'Нажмите кнопку с брендом или пришлите сообщением:',
    code(`${brandInputLabel(example)}: ${brandDiscountOf(config, example)}`),
  );

  return lines.join('\n');
}

/**
 * Кнопки экрана: по две на ряд, как у ставок в settings.text.ts, значение
 * печатается НА кнопке. «Остальные» ведёт в уже существующий вопрос про общую
 * скидку (`rate:discountPercent`) — один редактор дефолта, а не второй.
 */
export function brandDiscountsKeyboardRows(
  store: YandexMarketDocument | null,
  usage: readonly IBrandUsage[],
  otherCount: number,
): { text: string; callback_data: string }[][] {
  const rows: { text: string; callback_data: string }[][] = [];
  const config = discountsOf(store ?? {});

  for (let i = 0; i < usage.length; i += 2) {
    rows.push(
      usage.slice(i, i + 2).map(({ key }) => ({
        text: `${brandTitle(key)} ${brandDiscountOf(config, key)}%`,
        callback_data: brandCallback(key),
      })),
    );
  }

  if (otherCount > 0) {
    rows.push([
      {
        text: `📦 Остальные ${config.defaultPercent}%`,
        callback_data: rateCallback('discountPercent'),
      },
    ]);
  }

  rows.push([{ text: '⚙️ К настройкам', callback_data: 'check_settings' }]);

  return rows;
}
