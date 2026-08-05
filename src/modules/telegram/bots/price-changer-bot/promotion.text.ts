import type { YandexMarketDocument } from '../../../../database/schemas/yandex-market.schema';
import type { TBrandKey } from '../../../yandex/reports/brands';

import { brandTitle } from '../../../yandex/reports/brands';
import {
  PROMO_CB_MENU,
  promoCallback,
  promoConfigsOf,
  promoLimitLabel,
  promoShortValue,
  promoValueLabel,
} from '../../../yandex/reports/promo';
import { b } from '../../formatting/telegram-format';

import { type IBrandUsage } from './brand-discounts.text';

/**
 * Экран «Продвижение» — ОДИН текст и одна клавиатура на все показы.
 *
 * Тот же паттерн, что brand-discounts.text.ts, и по той же причине: экран
 * рендерится из нескольких мест (кнопка на экране настроек, возврат после
 * сохранения, после отмены, после отключения), и копии разъехались бы.
 *
 * Бренды — только присутствующие в прайсе продавца (`brandUsageOf` — общий с
 * экраном скидок). «Остальных» здесь НЕТ намеренно: продвижение настраивается
 * по брендам, у позиций вне реестра его просто не бывает — в отличие от
 * скидки, у которой есть общий дефолт.
 */
export function promotionText(
  store: YandexMarketDocument | null,
  usage: readonly IBrandUsage[],
): string {
  const lines = [`📣 ${b('Продвижение')}`, ''];

  if (!usage.length) {
    // Бренды берутся из закупочных цен, а те — из прайса: без файла показывать
    // нечего, и честнее сказать это, чем нарисовать пустой список.
    lines.push(
      'Закупочных цен пока нет — пришлите прайс, и бот определит,',
      'какие бренды есть в ваших товарах.',
    );
    return lines.join('\n');
  }

  lines.push(
    'Комиссия Маркета за продвижение — вычитается из прибыли.',
    '«—» значит не настроено: считается 0%. Бренды — из вашего прайса.',
    '',
  );

  const configs = promoConfigsOf(store?.promoCommissions);
  for (const { key, count } of usage) {
    lines.push(`• ${brandTitle(key)}: ${b(promoValueLabel(configs[key]))} — ${count} поз.`);
  }

  lines.push('', 'Нажмите кнопку с брендом, чтобы настроить.');

  return lines.join('\n');
}

/**
 * Кнопки экрана: по две на ряд, значение НА кнопке — короткой формой
 * (`2/1%`), полная напечатана в тексте выше. Всё как у экрана скидок.
 */
export function promotionKeyboardRows(
  store: YandexMarketDocument | null,
  usage: readonly IBrandUsage[],
): { text: string; callback_data: string }[][] {
  const rows: { text: string; callback_data: string }[][] = [];
  const configs = promoConfigsOf(store?.promoCommissions);

  for (let i = 0; i < usage.length; i += 2) {
    rows.push(
      usage.slice(i, i + 2).map(({ key }) => ({
        text: `${brandTitle(key)} ${promoShortValue(configs[key])}`,
        callback_data: promoCallback('pick', key),
      })),
    );
  }

  rows.push([{ text: '⚙️ К настройкам', callback_data: 'check_settings' }]);

  return rows;
}

/**
 * Экран развилки после выбора бренда: как считать комиссию — одним процентом
 * или ступенями от цены товара.
 */
export function promotionModeText(store: YandexMarketDocument | null, brand: TBrandKey): string {
  const configs = promoConfigsOf(store?.promoCommissions);
  const current = configs[brand];

  const lines = [
    `📣 ${b(`Продвижение «${brandTitle(brand)}»`)}`,
    '',
    current
      ? `Сейчас: ${b(promoValueLabel(current))}.`
      : 'Сейчас не настроено — комиссия считается как 0%.',
    '',
    'Как считать комиссию?',
    '• Общий процент — один на все товары бренда.',
    '• Зависит от цены — до порога один процент, дороже — другой.',
  ];

  // Пункт про нижний порог — только вместе с кнопкой: пока бренд не настроен,
  // порогу не к чему применяться, и кнопки на экране нет.
  if (current) {
    lines.push('• Нижний порог — цена, с которой продвижение начисляется; дешевле — 0%.');
  }

  return lines.join('\n');
}

export function promotionModeKeyboardRows(
  store: YandexMarketDocument | null,
  brand: TBrandKey,
): { text: string; callback_data: string }[][] {
  const configs = promoConfigsOf(store?.promoCommissions);

  const rows: { text: string; callback_data: string }[][] = [
    [{ text: '💯 Общий процент', callback_data: promoCallback('flat', brand) }],
    [{ text: '🪜 Зависит от цены', callback_data: promoCallback('tier', brand) }],
  ];

  // «Нижний порог» и «Отключить» — только когда есть что настраивать/отключать:
  // продвижение opt-in, порогу без процента негде жить, а задать плоский 0% —
  // не то же самое, что убрать настройку (экран покажет «0%» вместо «—»).
  const current = configs[brand];
  if (current) {
    rows.push([
      {
        text:
          current.from !== undefined
            ? `📏 Нижний порог: ${promoLimitLabel(current.from)}`
            : '📏 Нижний порог',
        callback_data: promoCallback('floor', brand),
      },
    ]);
    rows.push([{ text: '🚫 Отключить', callback_data: promoCallback('off', brand) }]);
  }

  rows.push([{ text: '⬅️ Назад', callback_data: PROMO_CB_MENU }]);

  return rows;
}
