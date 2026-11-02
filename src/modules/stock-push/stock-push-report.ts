import type { IStockPushApplyResult } from './stock-push.service';
import type { TWriteSkipReason } from '../yandex/stocks/stock-upload-policy';

import { MARKETPLACE_LABEL } from '../../shared/marketplace';
import { stockPushBlockTextOf } from '../finance/stock-push';
import { isFeatureEnabled } from '../telegram/bots/shared/features.domain';
import { b, esc } from '../telegram/formatting/telegram-format';

import { STOCK_PUSH_WRITE_FEATURE } from './stock-push.service';

/**
 * Итог прохода «Передачи остатков» после прайса из бота (решение
 * `stock_push_after_bot_price_list`) — второе сообщение после отчёта о файле.
 * Строка на каждую площадку с открытой записью: записано, менять нечего или
 * почему не записано. Площадка без строки читалась бы как «обновилась».
 * Кабинет называется только именем: id кампании продавцу не показывается.
 */

/** Почему функция записи площадки ничего не отправила — словами продавца. */
const WRITE_SKIP_TEXT: Readonly<Record<TWriteSkipReason, string>> = {
  'write-disabled': 'запись остатков выключена на сервере — ничего не отправлено',
  placement: 'склад площадки не даёт писать остатки',
  'feature-disabled': 'запись закрыта администратором',
};

export function formatPushPassReport(
  result: IStockPushApplyResult,
  features: Readonly<Record<string, boolean>>,
): string {
  const lines = [b('🔁 Передача остатков на площадки'), ''];
  const writes = new Map(result.writes.map((write) => [write.key, write]));
  const targets = result.plan.targets.filter((target) =>
    isFeatureEnabled(features, STOCK_PUSH_WRITE_FEATURE[target.marketplace]),
  );

  for (const target of targets) {
    const label = `${MARKETPLACE_LABEL[target.marketplace]} «${esc(target.name)}»`;
    const blocked = stockPushBlockTextOf(target);
    if (blocked) {
      lines.push(`⛔ ${label}: не записано — ${esc(blocked)}`);
      continue;
    }
    if (target.linked === 0) {
      lines.push(`⚠️ ${label}: ни один товар прайса не нашёлся на площадке`);
      continue;
    }
    const write = writes.get(target.key);
    if (!write) {
      lines.push(`✅ ${label}: менять нечего`);
      continue;
    }
    if (write.skipReason) {
      lines.push(`⚠️ ${label}: ${WRITE_SKIP_TEXT[write.skipReason]}`);
      continue;
    }
    const icon = write.errors.length ? '⚠️' : '✅';
    const zeroed = target.zeroed ? `, из них в ноль ${b(target.zeroed)}` : '';
    lines.push(`${icon} ${label}: записано ${b(write.written)} из ${b(write.requested)}${zeroed}`);
    if (write.errors.length)
      lines.push(`   площадка отвергла часть записи: ${esc(write.errors[0].message)}`);
    if (write.skipped.length) lines.push(`   площадка не примет: ${b(write.skipped.length)}`);
  }

  if (!targets.length) lines.push('Писать некуда: ни одна площадка не открыта для записи.');
  return lines.join('\n');
}
