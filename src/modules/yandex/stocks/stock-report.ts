import type { IStockSyncResult } from './stock-sync.service';

import { b, code, esc } from '../../telegram/formatting/telegram-format';

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

/** Заголовок: что произошло с файлом. */
function headline(result: IStockSyncResult): string {
  if (result.writeSkipReason === 'write-disabled') {
    return `🧪 ${b('Запись остатков выключена')} — в Яндекс ничего не отправлено`;
  }
  if (result.writeSkipReason === 'feature-disabled') {
    return `🔒 ${b('Остатки не записаны')} — запись отключена администратором`;
  }
  if (result.writeSkipReason === 'placement') {
    return `🏬 ${b('Остатки не записаны')} — магазин на модели ${esc(placement(result))}`;
  }
  if (result.dryRun) {
    return `🔍 ${b('Пробная сверка')} — в Яндекс ничего не записано`;
  }
  return `✅ ${b('Остатки обновлены')}`;
}

/** Почему не записали. Пусто — записали или продавец сам просил сверку. */
function skipExplanation(result: IStockSyncResult): string | null {
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

/** Что продавцу делать дальше. При выключенной записи — ничего. */
function skipAdvice(result: IStockSyncResult): string | null {
  // Выключенная запись — решение развёртывания, а не продавца: советовать ему
  // нечего, и фраза про смену магазина увела бы не туда.
  if (result.writeSkipReason === 'write-disabled') return null;

  // Выключенная фича — решение администратора о продавце: единственное
  // осмысленное действие — обсудить с ним, а не менять магазин или файл.
  if (result.writeSkipReason === 'feature-disabled') {
    return 'Если запись остатков вам нужна — напишите администратору бота.';
  }

  if (result.writeSkipReason === 'placement') {
    return result.placementType
      ? 'Чтобы обновить остатки, переключитесь на магазин FBS — «🏪 Сменить магазин».'
      : 'Попробуйте ещё раз через пару минут.';
  }

  if (result.dryRun) {
    return 'Чтобы применить — пришлите файл ещё раз без пометки «проверка».';
  }

  return null;
}

/** Как назвать модель в заголовке, когда определить её не удалось. */
function placement(result: IStockSyncResult): string {
  return result.placementType ?? 'неизвестной модели';
}
