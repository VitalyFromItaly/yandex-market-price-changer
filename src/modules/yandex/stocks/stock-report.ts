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

  lines.push(
    result.dryRun
      ? `🔍 ${b('Пробная сверка')} — в Яндекс ничего не записано`
      : `✅ ${b('Остатки обновлены')}`,
  );
  lines.push('');

  lines.push(`📄 Строк в прайсе: ${b(result.totalRows)}`);
  lines.push(`📚 Артикулов в каталоге: ${b(result.catalogSize)}`);
  lines.push(`🎯 Нашлось совпадений: ${b(result.matched)}`);

  if (!result.dryRun) {
    lines.push(`📤 Записано: ${b(result.updated)}`);
  }

  // Закупочные цены сохраняются и при сверке — про это надо сказать прямо,
  // иначе строка «в Яндекс ничего не записано» читается как «не сохранено
  // вообще ничего», и продавец не поймёт, откуда взялась прибыль.
  if (result.purchasePricesSaved) {
    lines.push(`💵 Закупочных цен сохранено: ${b(result.purchasePricesSaved)}`);
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
      '💡 Чаще всего это новинки, которых ещё нет в каталоге Маркета. ' +
        'Заведите карточки — и они начнут обновляться.',
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

  if (result.dryRun) {
    lines.push('');
    lines.push('Чтобы применить — пришлите файл ещё раз без пометки «проверка».');
  }

  return lines.join('\n');
}
