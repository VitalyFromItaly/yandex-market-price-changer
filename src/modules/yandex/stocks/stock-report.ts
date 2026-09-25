import type { ISkippedRow, IStockSyncResult } from './stock-sync.service';
import type { TUploadChannel } from './stock-upload.texts';

import { b, code, esc } from '../../telegram/formatting/telegram-format';
import { YandexApiError } from '../yandex-api.errors';

/**
 * Отчёт о загрузке остатков.
 *
 * Отдельный модуль, потому что формат отчёта — самостоятельная штука: его
 * читает человек, принимающий решение «всё ли прошло нормально». Молчаливая
 * строка «готово» здесь недопустима: пропуски должны быть видны числом, иначе
 * незамеченными уедут сотни позиций.
 */

/** Сколько пропущенных позиций перечислять поимённо. */
const SKIPPED_PREVIEW = 10;

export function formatStockReport(result: IStockSyncResult): string {
  const lines: string[] = [];

  /**
   * Заголовок отвечает на «что произошло с моим файлом», и поводов НЕ записать
   * ЧЕТЫРЕ. Итог у всех общий — «в Яндекс ничего не ушло», — а действие от
   * продавца требуется разное: прислать файл без пометки, сменить магазин,
   * написать администратору (фича выключена) либо вообще никакое (запись
   * выключена настройкой среды). Один заголовок на всех означал бы
   * «записано 0» без объяснения.
   *
   * Запрет проверяется РАНЬШЕ просьбы: если продавец попросил сверку на
   * FBY-магазине, важнее сказать, что записать туда нельзя в принципе.
   */
  lines.push(headline(result));
  lines.push('');

  const explanation = skipExplanation(result);
  if (explanation) {
    lines.push(explanation, 'Файл разобран, ниже — что в нём нашлось.', '');
  }

  lines.push(`📄 Строк в прайсе: ${b(result.totalRows)}`);
  lines.push(`📚 Артикулов в каталоге: ${b(result.catalogSize)}`);
  lines.push(`🎯 Нашлось совпадений: ${b(result.matched)}`);

  // Обнуление называем числом и словами. Это единственная строка отчёта про
  // товар, который СНИМАЕТСЯ с продажи, и молчать о ней нельзя: в файле склада
  // пустое количество означает «нет в наличии», и таких позиций большинство.
  if (result.zeroed) {
    lines.push(`🚫 Нет в наличии: ${b(result.zeroed)} → остаток 0`);
  }

  // «Записано: 0» при запрете — строка, которая только путает: она выглядит как
  // неудача записи, тогда как записи не было и не должно было быть.
  if (!result.dryRun && !result.writeSkipReason) {
    lines.push(`📤 Записано: ${b(result.updated)}`);
  }

  // Закупочные цены сохраняются и при сверке — про это надо сказать прямо,
  // иначе строка «в Яндекс ничего не записано» читается как «не сохранено
  // вообще ничего», и продавец не поймёт, откуда взялась прибыль.
  if (result.purchasePricesSaved) {
    lines.push(`💵 Закупочных цен сохранено: ${b(result.purchasePricesSaved)}`);
  }

  // Выключенный закуп называем явно: ноль сохранённых цен бывает и у файла без
  // цен, а продавец должен понять, почему «Прибыль» не пополнилась.
  if (result.purchasePricesSkipped) {
    lines.push('💾 Закупочные цены не сохранялись — сохранение выключено администратором.');
  }

  // Пропуски — главное, ради чего отчёт читают. Прячем их в конец только если
  // их нет вовсе.
  if (result.skipped.length) {
    lines.push(`⏭ Пропущено: ${b(result.skipped.length)}`);
  }

  if (result.errors.length) {
    const lost = result.errors.reduce((sum, e) => sum + e.skus.length, 0);
    lines.push(`❌ Не записано из-за ошибок: ${b(lost)}`);
  }

  // Разбивка по способу сопоставления. Нужна не из любопытства: если вдруг
  // почти всё стало находиться «как в прайсе», значит каталог перезаведён и
  // правило пора пересматривать.
  const ways = Object.entries(result.matchedBy).filter(([, n]) => n > 0);
  if (ways.length > 1) {
    lines.push('');
    lines.push(b('Как сопоставилось:'));
    for (const [way, count] of ways) {
      lines.push(`• ${esc(way)}: ${count}`);
    }
  }

  if (result.skipped.length) {
    lines.push('');
    lines.push(b('Пропущенные позиции:'));

    for (const row of result.skipped.slice(0, SKIPPED_PREVIEW)) {
      lines.push(`• ${code(row.name)} — ${esc(row.reason)}`);
    }

    if (result.skipped.length > SKIPPED_PREVIEW) {
      lines.push(`…и ещё ${result.skipped.length - SKIPPED_PREVIEW}`);
    }

    lines.push('');
    lines.push(
      '💡 Это позиции поставщика, которых нет в вашем каталоге на Маркете: ' +
        'в файле приходит весь его ассортимент, а он шире вашего. ' +
        'Заведите карточки на нужные — и они начнут обновляться.',
    );
  }

  if (result.errors.length) {
    lines.push('');
    lines.push(b('Ошибки Яндекса:'));
    for (const err of result.errors.slice(0, 3)) {
      lines.push(`• партия ${err.batch} (${err.skus.length} шт.): ${esc(err.message)}`);
    }
    lines.push('');
    lines.push('⚠️ Эти позиции остались со старым остатком. Загрузите файл ещё раз.');
  }

  // Совет даём ровно один и по фактическому поводу: «пришлите ещё раз без
  // пометки» на FBY-магазине отправило бы продавца делать то, что снова не
  // сработает.
  const advice = skipAdvice(result);
  if (advice) lines.push('', advice);

  return lines.join('\n');
}

/**
 * Заголовок: что произошло с файлом. Части раздельно, чтобы бот выделил
 * ключевую фразу `<b>`, а CRM взял тот же текст без разметки — одна копия.
 */
interface IHeadlineParts {
  icon: string;
  title: string;
  rest: string;
}

function headlineParts(result: IStockSyncResult): IHeadlineParts {
  if (result.writeSkipReason === 'write-disabled') {
    return {
      icon: '🧪',
      title: 'Запись остатков выключена',
      rest: ' — в Яндекс ничего не отправлено',
    };
  }
  if (result.writeSkipReason === 'feature-disabled') {
    return {
      icon: '🔒',
      title: 'Остатки не записаны',
      rest: ' — запись отключена администратором',
    };
  }
  if (result.writeSkipReason === 'placement') {
    return {
      icon: '🏬',
      title: 'Остатки не записаны',
      rest: ` — магазин на модели ${placement(result)}`,
    };
  }
  if (result.dryRun) {
    return { icon: '🔍', title: 'Пробная сверка', rest: ' — в Яндекс ничего не записано' };
  }
  return { icon: '✅', title: 'Остатки обновлены', rest: '' };
}

function headline(result: IStockSyncResult): string {
  const { icon, title, rest } = headlineParts(result);
  return `${icon} ${b(title)}${esc(rest)}`;
}

/** Заголовок без разметки — для CRM. */
export function stockHeadlineText(result: IStockSyncResult): string {
  const { icon, title, rest } = headlineParts(result);
  return `${icon} ${title}${rest}`;
}

/** Почему не записали. Пусто — записали или продавец сам просил сверку. */
export function skipExplanation(result: IStockSyncResult): string | null {
  if (result.writeSkipReason === 'write-disabled') {
    return 'В этой среде запись остатков отключена настройкой (STOCK_WRITE_ENABLED=false).';
  }
  if (result.writeSkipReason === 'feature-disabled') {
    return 'Администратор бота отключил вам запись остатков из прайса.';
  }
  if (result.writeSkipReason !== 'placement') return null;

  return result.placementType
    ? 'Товаром на складе Маркета распоряжается сам Маркет — прайсом его остатки не меняются.'
    : 'Не удалось определить модель магазина, поэтому записывать остатки не стали.';
}

/**
 * Что продавцу делать дальше. При выключенной записи — ничего.
 *
 * Канал различает только указание, КУДА нажать: в боте магазин переключают
 * кнопкой, в CRM — открывают другой из списка «Магазины» (активный магазин бота
 * веб не трогает), а «проверка» в CRM — галочка, а не подпись к файлу.
 */
export function skipAdvice(
  result: IStockSyncResult,
  channel: TUploadChannel = 'bot',
): string | null {
  // Выключенная запись — решение развёртывания, а не продавца: советовать ему
  // нечего, и фраза про смену магазина увела бы не туда.
  if (result.writeSkipReason === 'write-disabled') return null;

  // Выключенная фича — решение администратора о продавце: единственное
  // осмысленное действие — обсудить с ним, а не менять магазин или файл.
  if (result.writeSkipReason === 'feature-disabled') {
    return 'Если запись остатков вам нужна — напишите администратору бота.';
  }

  if (result.writeSkipReason === 'placement') {
    if (!result.placementType) return 'Попробуйте ещё раз через пару минут.';
    return channel === 'crm'
      ? 'Чтобы обновить остатки, откройте магазин FBS из списка «Магазины».'
      : 'Чтобы обновить остатки, переключитесь на магазин FBS — «🏪 Сменить магазин».';
  }

  if (result.dryRun) {
    return channel === 'crm'
      ? 'Чтобы применить — загрузите файл ещё раз без отметки «Только проверка».'
      : 'Чтобы применить — пришлите файл ещё раз без пометки «проверка».';
  }

  return null;
}

/** Как назвать модель в заголовке, когда определить её не удалось. */
function placement(result: IStockSyncResult): string {
  return result.placementType ?? 'неизвестной модели';
}

/**
 * Текст об ошибке обработки файла — для пользователя.
 *
 * Один на оба пути: постановку в очередь (stock-upload.handler) и саму
 * обработку (stock-sync.processor). Две копии разъехались бы ровно так же,
 * как когда-то экраны помощи.
 */
export function uploadErrorText(error: unknown): string {
  const text =
    error instanceof YandexApiError
      ? error.userMessage
      : 'Не удалось обработать файл. Проверьте, что это прайс в обычном формате, и попробуйте ещё раз.';
  return `❌ ${text}`;
}

/**
 * Итог загрузки для CRM — данные, а не HTML. Тексты — те же функции, что у
 * отчёта бота (канал `crm`), поэтому два экрана не расходятся в словах; числа —
 * поля самого результата, без пересчёта. Пропуски отдаются ЦЕЛИКОМ: бот
 * печатает десять, а таблице веба лимит сообщения не мешает.
 */
export interface ICrmStockView {
  headline: string;
  explanation: string | null;
  advice: string | null;
  dryRun: boolean;
  writeSkipReason: string | null;
  placementType: string | null;
  totalRows: number;
  catalogSize: number;
  matched: number;
  zeroed: number;
  /** `null` — записи не было и не должно было быть (сверка или запрет). */
  updated: number | null;
  purchasePricesSaved: number;
  purchasePricesSkipped: boolean;
  matchedBy: Record<string, number>;
  skipped: ISkippedRow[];
  errors: Array<{ batch: number; skus: string[]; message: string }>;
}

export function toCrmStockView(result: IStockSyncResult): ICrmStockView {
  return {
    headline: stockHeadlineText(result),
    explanation: skipExplanation(result),
    advice: skipAdvice(result, 'crm'),
    dryRun: result.dryRun,
    writeSkipReason: result.writeSkipReason ?? null,
    placementType: result.placementType ?? null,
    totalRows: result.totalRows,
    catalogSize: result.catalogSize,
    matched: result.matched,
    zeroed: result.zeroed,
    updated: !result.dryRun && !result.writeSkipReason ? result.updated : null,
    purchasePricesSaved: result.purchasePricesSaved,
    purchasePricesSkipped: result.purchasePricesSkipped ?? false,
    matchedBy: result.matchedBy,
    skipped: result.skipped,
    errors: result.errors,
  };
}
