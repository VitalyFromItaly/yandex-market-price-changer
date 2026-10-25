/**
 * Выплаты Ozon → `paidAt` строк журнала (TASK-184, решение владельца
 * `ozon_accrual_migration_and_payouts`). Чистые функции — без Nest и базы.
 *
 * Выплаты по операции Ozon не отдаёт: есть только сальдо и выплаты по дням
 * (`/v1/finance/balance`). Поэтому раскладка FIFO: выплаты гасят сначала долг
 * Ozon на начало месяца (`opening_balance` — это начисления прошлых месяцев),
 * затем строки месяца по дате начисления. Строка выплачена в день той выплаты,
 * на которой накопленные выплаты покрыли её вместе со всеми строками до неё.
 *
 * Месяц самодостаточен: строки следующего месяца по FIFO встают после всех
 * строк этого, поэтому покрыть их раньше выплаты этого месяца не могут.
 */

import type { TFinanceArticle } from './finance-articles';

import { FINANCE_ARTICLE_META } from './finance-articles';
import { financeToday } from './finance-period';

/** Живая строка журнала Ozon — кандидат на выплату. */
export interface IOzonPayoutLine {
  id: string;
  article: TFinanceArticle;
  amountKopecks: number;
  accruedAt: Date;
}

/** Выплата Ozon за день. */
export interface IOzonDayPayout {
  /** ГГГГ-ММ-ДД по Москве. */
  day: string;
  kopecks: number;
}

export interface IOzonPaidDays {
  /** id строки → день выплаты (ГГГГ-ММ-ДД). Строк вне карты выплата не покрыла. */
  paid: Map<string, string>;
  /** Денежных строк, которые выплаты пока не покрыли. */
  uncovered: number;
}

/**
 * Дни выплат строк месяца. `lines` — живые строки месяца в любом порядке,
 * `openingKopecks` — сальдо Ozon на первый день месяца, `payouts` — выплаты
 * от первого дня месяца по порядку дней.
 *
 * Строки группы `reference` (бонусный баланс) — не деньги: выплатой не
 * гасятся и в карту не попадают. Порог строки — максимум накопленной суммы до
 * неё включительно: удержание (минус) выплачивается вместе со строками перед
 * ним, а не «раньше всех». Выплата не покрывает строку, начисленную позже дня
 * выплаты, — деньги за неё ещё не начислены.
 */
export function ozonPaidDays(
  lines: readonly IOzonPayoutLine[],
  openingKopecks: number,
  payouts: readonly IOzonDayPayout[],
): IOzonPaidDays {
  const money = lines
    .filter((line) => FINANCE_ARTICLE_META[line.article].group !== 'reference')
    .sort((a, b) => a.accruedAt.getTime() - b.accruedAt.getTime() || a.id.localeCompare(b.id));

  const paid = new Map<string, string>();
  let next = 0;
  let paidKopecks = -openingKopecks;
  let sum = 0;
  let threshold = Number.NEGATIVE_INFINITY;
  // Порог текущей строки считается один раз — при переходе к ней.
  const advance = () => {
    sum += money[next].amountKopecks;
    threshold = Math.max(threshold, sum);
  };
  if (money.length) advance();

  for (const payout of payouts) {
    if (payout.kopecks <= 0) continue;
    paidKopecks += payout.kopecks;
    while (
      next < money.length &&
      financeToday(money[next].accruedAt) <= payout.day &&
      paidKopecks >= threshold
    ) {
      paid.set(money[next].id, payout.day);
      next += 1;
      if (next < money.length) advance();
    }
  }
  return { paid, uncovered: money.length - next };
}
