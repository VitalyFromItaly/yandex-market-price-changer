import type { TStockPushBlock } from '../finance/stock-push';

/**
 * Алерты прохода по расписанию (TASK-176) — чистые правила, без Nest.
 *
 * Алертятся блокировки, которые означают «продажа не дошла до площадки»:
 * сбой чтения, неизвестные заказы, порог обнулений, нет/несколько складов.
 * `placement` (FBY/FBO/FBW) и `no-write-method` — устройство магазина, а не
 * сбой: туда не пишется никогда, и алерт на каждом проходе был бы шумом.
 */
export const STOCK_PUSH_ALERT_BLOCKS: Readonly<Record<TStockPushBlock, boolean>> = {
  placement: false,
  'read-error': true,
  'orders-unknown': true,
  'own-orders-unknown': true,
  zeroing: true,
  'no-warehouse': true,
  'several-warehouses': true,
  'no-write-method': false,
};

export interface IBlockState {
  /** Ключ цели плана (кампания ЯМ или `<площадка>:<склад>`). */
  key: string;
  blockedBy: TStockPushBlock | null;
}

/**
 * Какие цели алертить сейчас (решение `stock_push_schedule_alert_on_change`):
 * только при смене состояния — блок появился или сменил причину. Держится
 * тот же — молчим; снят — забываем, следующий блок снова алертит. `memory` —
 * последние блоки продавца по ключу цели, функция её обновляет.
 */
export function blockAlerts<T extends IBlockState>(
  memory: Map<string, TStockPushBlock>,
  targets: readonly T[],
): T[] {
  const alerts: T[] = [];
  const seen = new Set<string>();
  for (const target of targets) {
    seen.add(target.key);
    const block = target.blockedBy;
    if (!block || !STOCK_PUSH_ALERT_BLOCKS[block]) {
      memory.delete(target.key);
      continue;
    }
    if (memory.get(target.key) !== block) alerts.push(target);
    memory.set(target.key, block);
  }
  // Цель пропала из плана (магазин отключили) — её блок больше не держится.
  for (const key of [...memory.keys()]) if (!seen.has(key)) memory.delete(key);
  return alerts;
}
