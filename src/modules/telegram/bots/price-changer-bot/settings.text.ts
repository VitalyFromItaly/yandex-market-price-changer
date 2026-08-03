import type { YandexMarketDocument } from '../../../../database/schemas/yandex-market.schema';
import type { TRateField } from '../../../yandex/reports/profit';

import {
  RATE_FIELDS,
  rateCallback,
  rateInputLabel,
  rateShortLabel,
  ratesOf,
} from '../../../yandex/reports/profit';
import { isStockWritable, placementOfCampaign } from '../../../yandex/stocks/placement';
import { b, code, esc } from '../../formatting/telegram-format';

import { MENU } from './menu.constants';
import { storeTitle } from './store-title';

/**
 * Экран настроек — ОДИН текст на кнопку «⚙️ Настройки API» и на `/settings`.
 *
 * Отдельный файл по образцу help.text.ts и ровно по той же причине: входов в
 * экран было два, и вели они в разные места. Кнопка показывала состояние
 * магазина, а `/settings` — меню из двух inline-кнопок, одна из которых
 * («🔄 Автообновление») не имела обработчика вовсе и отвечала «Неизвестная
 * команда: settings_auto_update».
 *
 * Идентификаторы здесь не печатаются И НЕ УПОМИНАЮТСЯ — ни значением, ни
 * названием. Продавцу campaign_id и business_id ни о чём не говорят, перепутать
 * их легко (документация Яндекса отдельно предупреждает не путать campaignId с
 * идентификатором магазина), а вводить их он больше не должен: бот определяет
 * магазин по токену. Убрать числа, но оставить «Campaign ID и Business ID бот
 * определит сам» — полумера: человек всё равно узнаёт из этой строки о полях,
 * которые его не касаются, и идёт их искать.
 */
/** Подключён ли магазин. Одно определение на текст и на клавиатуру. */
function isConfigured(store: YandexMarketDocument | null): boolean {
  return !!(store?.campaign_id && store?.business_id && store?.token);
}

/** Подсказка текстового ввода с ТЕКУЩИМ значением: «комиссия: 25». */
function hint(field: TRateField, value: number): string {
  return code(`${rateInputLabel(field)}: ${value}`);
}

export function settingsText(store: YandexMarketDocument | null): string {
  const configured = isConfigured(store);

  const lines = [`⚙️ ${b('Настройки API')}`, ''];

  if (configured) {
    // Название вместе с моделью размещения: одноимённые FBS и FBY иначе
    // неразличимы, а от модели зависит, примет ли бот прайс.
    lines.push(`🏪 Магазин: ${esc(storeTitle(store)) || '✅ подключён'}`, '');

    /**
     * На FBY загрузка остатков не работает, и спрашивают об этом именно здесь —
     * на экране, где магазин назван. Сказать причину рядом с названием дешевле,
     * чем ждать, пока продавец пришлёт прайс и получит отказ.
     *
     * Условие «модель ИЗВЕСТНА и не пишущая», а не просто `!isStockWritable`:
     * та на `undefined` отвечает «нельзя» — и правильно делает, когда решается
     * вопрос о записи, — но здесь это означало бы показать «только чтение»
     * продавцу на FBS, у которого просто ещё не заполнен кэш магазинов.
     */
    const placement = placementOfCampaign(store?.stores, store?.campaign_id);
    if (placement && !isStockWritable(placement)) {
      lines.push('📦 Остатки: только чтение — на FBY ими распоряжается Маркет.', '');
    }
    // Строку состояния не пересказываем прозой. Было «🏪 Магазин: … » и следом
    // «Магазин подключён.» — одно и то же дважды подряд.
    lines.push(
      'Чтобы подключить другой магазин или обновить токен, пришлите:',
      code('token: ваш_токен'),
    );

    /**
     * Ставки расчёта прибыли — только здесь, в ветке подключённого магазина.
     *
     * Печатать их до подключения незачем: прибыль всё равно не посчитается, а
     * экран без магазина обязан сказать ровно одну вещь — пришлите токен.
     *
     * Подсказки текстового ввода собираются с ТЕКУЩИМИ значениями.
     *
     * Раньше это были литералы «комиссия: 23» и «налог: 7», и у продавца с
     * комиссией 25 экран противоречил сам себе: сверху 25 %, снизу предложение
     * прислать 23. Заодно кнопки ниже делают текстовый ввод необязательным —
     * подсказки остаются как быстрый путь для тех, кто его знает.
     */
    const rates = ratesOf(store);
    lines.push(
      '',
      b('Расчёт прибыли'),
      `📉 Комиссия Маркета: ${b(`${rates.commissionPercent}%`)}`,
      `🧾 Налог с продаж: ${b(`${rates.taxPercent}%`)}`,
      '',
      'Оба процента вычитаются из суммы продажи.',
      'Нажмите кнопку ниже или пришлите сообщением:',
      hint('commissionPercent', rates.commissionPercent),
      hint('taxPercent', rates.taxPercent),
      '',
      b('Закуп'),
      'Берётся из прайса — того же файла, которым вы обновляете остатки.',
      `📦 Скидка от прайса: ${b(`${rates.discountPercent}%`)}`,
      `⌚ Скидка на «Восток»: ${b(`${rates.vostokDiscountPercent}%`)}`,
      '',
      'В прайсе цена поставщика, закуп — она минус скидка. Чтобы изменить:',
      hint('discountPercent', rates.discountPercent),
      hint('vostokDiscountPercent', rates.vostokDiscountPercent),
    );
  } else {
    lines.push('🏪 Магазин: ❌ не подключён', '');
    // Campaign ID и Business ID здесь НЕ упоминаются. Продавец их не вводит и
    // нигде не видит; назвать их — значит отправить искать то, чего от него не
    // требуется. Прежний текст обещал «бот определит их сам», то есть успокаивал
    // насчёт полей, о существовании которых человек узнавал из этой же строки.
    lines.push('Пришлите API-токен Яндекс.Маркета одним сообщением —', 'магазин определится сам.');
  }

  return lines.join('\n');
}

/**
 * Кнопки экрана настроек — по одной на каждую ставку.
 *
 * Живут ЗДЕСЬ же, где текст экрана, и по той же причине, по которой сам текст
 * съехался в один файл: экран открывается из трёх мест (кнопка «⚙️ Настройки
 * API», `/settings`, inline «👀 Проверить настройки»), и три копии клавиатуры
 * разошлись бы так же, как расходились три копии текста.
 *
 * Значение печатается НА кнопке: состояние читается прямо с неё, без отдельного
 * списка, — тем же приёмом, что в разделе рассылки. Названия ставок короткие
 * (`rateShortLabel`), потому что в ряду из двух кнопок Telegram обрезает длинные.
 *
 * Пока магазина нет, ставок на экране нет тоже — и кнопок к ним быть не должно:
 * этот экран обязан говорить ровно одну вещь, пришлите токен.
 */
export function settingsKeyboardRows(
  store: YandexMarketDocument | null,
): { text: string; callback_data: string }[][] {
  const rows: { text: string; callback_data: string }[][] = [];

  if (isConfigured(store)) {
    const rates = ratesOf(store);

    // По две кнопки в ряду, в порядке RATE_FIELDS — том же, в каком ставки
    // перечислены в тексте выше.
    for (let i = 0; i < RATE_FIELDS.length; i += 2) {
      rows.push(
        RATE_FIELDS.slice(i, i + 2).map((field) => ({
          text: `${rateShortLabel(field)} ${rates[field]}%`,
          callback_data: rateCallback(field),
        })),
      );
    }
  }

  rows.push([{ text: MENU.MAIN, callback_data: 'main_menu' }]);

  return rows;
}
