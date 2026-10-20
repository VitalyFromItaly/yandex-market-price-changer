/**
 * Корректировки журнала: что Маркет поменял в новой версии отчёта периода.
 * Чистые функции — без Nest и базы.
 *
 * Своего id у строки журнала нет, ключ операции строится из суммы, поэтому
 * пересчитанная строка приходит ДРУГИМ ключом: старая пропадает из версии,
 * новая появляется. Сопоставить их «было → стало» можно только по тому, что
 * у строки осталось прежним, — по её смыслу без суммы.
 */

export const FINANCE_CORRECTION_KINDS = ['changed', 'removed'] as const;
export type TFinanceCorrectionKind = (typeof FINANCE_CORRECTION_KINDS)[number];

/** Сторона корректировки — операция без сырой строки. */
export interface IFinanceCorrectionSide {
  operationKey: string;
  amountKopecks: number;
  accruedAt: Date;
  article: string;
  transactionType: string;
  transactionSource?: string;
  serviceName?: string;
  orderId?: string;
  sku?: string;
  actId?: string;
}

/**
 * Операция → сторона корректировки перечислением полей. Не спредом и не
 * проекцией запроса: сырая строка и поля выплаты в корректировку не едут, и
 * это не должно зависеть от того, что вернула база.
 */
export function correctionSideOf(op: IFinanceCorrectionSide): IFinanceCorrectionSide {
  return {
    operationKey: op.operationKey,
    amountKopecks: op.amountKopecks,
    accruedAt: op.accruedAt,
    article: op.article,
    transactionType: op.transactionType,
    transactionSource: op.transactionSource,
    serviceName: op.serviceName,
    orderId: op.orderId,
    sku: op.sku,
    actId: op.actId,
  };
}

export interface IFinanceCorrectionPair {
  kind: TFinanceCorrectionKind;
  before: IFinanceCorrectionSide;
  /** null — строку убрали, замены нет. */
  after: IFinanceCorrectionSide | null;
}

/**
 * Смысл строки без суммы: что за операция, по какому заказу и товару, когда.
 * `count` не входит — пересчёт штук меняет и сумму, это та же строка. Дата
 * входит: без неё две начисления одного заказа в разные дни склеились бы.
 */
export function correctionIdentity(side: IFinanceCorrectionSide): string {
  return JSON.stringify([
    side.orderId ?? null,
    side.sku ?? null,
    side.serviceName ?? null,
    side.transactionType,
    side.transactionSource ?? null,
    side.actId ?? null,
    new Date(side.accruedAt).toISOString(),
  ]);
}

/**
 * Пары «было → стало». Снятая строка, у которой в новой версии есть новая
 * строка того же смысла, — `changed`; без пары — `removed`. Новые строки без
 * пары корректировкой НЕ считаются: в открытом периоде каждый день приходят
 * новые операции, и журнал корректировок утонул бы в них.
 *
 * Одинаковых по смыслу строк бывает несколько (две штуки товара двумя
 * строками) — пары берутся по порядку, каждая новая строка используется один
 * раз.
 */
export function pairCorrections(
  removed: readonly IFinanceCorrectionSide[],
  added: readonly IFinanceCorrectionSide[],
): IFinanceCorrectionPair[] {
  const pool = new Map<string, IFinanceCorrectionSide[]>();
  for (const side of added) {
    const id = correctionIdentity(side);
    const bucket = pool.get(id) ?? [];
    bucket.push(side);
    pool.set(id, bucket);
  }

  return removed.map((before) => {
    const after = pool.get(correctionIdentity(before))?.shift() ?? null;
    return { kind: after ? 'changed' : 'removed', before, after };
  });
}
