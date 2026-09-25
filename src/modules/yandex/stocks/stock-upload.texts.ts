import type { TUploadFileError, TUploadProgress, TUploadWarning } from './stock-upload-policy';

import { PLACEMENT_UNKNOWN, fbyStocksReadonlyText } from './placement';
import { UPLOAD_LIMITS } from './stock-upload-policy';

/**
 * Тексты приёма прайса — одна копия на бот и CRM.
 *
 * Перенесены из stock-upload.handler слово в слово: бот продолжает говорить
 * то же, CRM — то же самое. Канал различается только там, где текст указывает
 * на кнопку бота или несёт HTML-разметку (`plain: true` — прецедент
 * `fbyOnlyScreenText`).
 */

export type TUploadChannel = 'bot' | 'crm';

/**
 * Отказ, когда админ закрыл продавцу ОБЕ половины загрузки. Файл в этом случае
 * даже не скачивается. Стиль — как у блока FeatureGateHandler: гейт документ
 * больше не закрывает (исход бывает частичным, см. requiredFeatures), поэтому
 * полный отказ произносит хендлер.
 */
export const UPLOAD_DISABLED_TEXT = [
  '🔒 Загрузка прайса сейчас недоступна.',
  '',
  'Её открывает администратор бота. Напишите ему, если она вам нужна.',
].join('\n');

/** Половина «остатки» выключена админом — файл разберём ради закупочных цен. */
export const STOCK_UPDATE_DISABLED_TEXT = [
  '📦 Запись остатков для вас отключена администратором — в Яндекс ничего не уйдёт.',
  '',
  'Файл всё равно разберу: закупочные цены сохранятся, и «💰 Прибыль» посчитается.',
].join('\n');

/** Половина «закупочные цены» выключена админом — пишем только остатки. */
export const PURCHASE_PRICES_DISABLED_TEXT = [
  '💾 Сохранение закупочных цен для вас отключено администратором.',
  '',
  'Остатки из файла обновлю как обычно, но «💰 Прибыль» этот прайс не пополнит.',
].join('\n');

/** Отказ по расширению или размеру. */
export function uploadFileErrorText(error: TUploadFileError, fileName: string): string {
  if (error === 'extension') {
    return `⚠️ Нужен файл Excel (${UPLOAD_LIMITS.extensions.join(' или ')}). Получен «${fileName}».`;
  }
  const mb = (UPLOAD_LIMITS.maxBytes / 1024 / 1024).toFixed(0);
  return `⚠️ Файл больше ${mb} МБ. Пришлите файл меньшего размера.`;
}

/** Предупреждение до постановки. У бота — HTML (FBY), у CRM — без разметки. */
export function uploadWarningText(warning: TUploadWarning, channel: TUploadChannel): string {
  switch (warning) {
    case 'stock-feature-off':
      return STOCK_UPDATE_DISABLED_TEXT;
    case 'fby':
      return fbyStocksReadonlyText({ plain: channel === 'crm' });
    case 'placement-unknown':
      return PLACEMENT_UNKNOWN;
    case 'prices-off':
      return PURCHASE_PRICES_DISABLED_TEXT;
  }
}

/** Что обещаем сделать с файлом — ровно то, что сделаем. */
export function uploadProgressText(progress: TUploadProgress): string {
  switch (progress) {
    case 'prices-only':
      return '🔍 Разбираю файл — сохраню закупочные цены, остатки не трогаю…';
    case 'check':
      return '🔍 Проверяю файл, в Яндекс ничего записывать не буду…';
    case 'stocks-no-prices':
      return '⏳ Загружаю остатки, закупочные цены не сохраняю…';
    case 'stocks':
      return '⏳ Загружаю остатки, это займёт минуту…';
  }
}

/**
 * Строка о позиции в очереди. Пустая очередь — пустая строка: в типовом
 * случае перед файлом никого, и упоминание очереди только пугало бы.
 */
export function queueNote(ahead: number): string {
  if (ahead <= 0) return '';
  return `\n\n📥 Перед вами в очереди: ${ahead} ${fileWord(ahead)} — обработаю по порядку.`;
}

/** «1 файл», «2 файла», «5 файлов» — включая 11–14. */
function fileWord(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 14) return 'файлов';
  const ones = n % 10;
  if (ones === 1) return 'файл';
  if (ones >= 2 && ones <= 4) return 'файла';
  return 'файлов';
}
