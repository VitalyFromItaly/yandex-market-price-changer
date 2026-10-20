/**
 * Нераспознанные статьи ЯМ: сводка и алерт администраторам.
 *
 * Классификатор (`ym-articles.ts`) — лист и сообщить никуда не может; сообщает
 * тот, кто загрузил журнал (импорт, TASK-111). Операция с `unknown` при этом
 * НЕ отбрасывается: она лежит в журнале своей статьёй, а алерт говорит, что
 * правилам пора дописать строку.
 */

import type { IFinanceOperationRow } from './ym-journal';
import type { ErrorReporter } from '../errors/error-reporter.service';

import { kopecksToRub } from './kopecks';
import { classifyYmRow } from './ym-articles';

/**
 * Отдельный класс, а не голый Error: имя становится `errorType` записи и
 * половиной ключа троттлинга алертов.
 */
export class YmUnknownArticleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'YmUnknownArticleError';
  }
}

/**
 * Место — константа без id продавца и периода: троттлинг алертов держит ключ
 * `${errorType}:${context}`, и id в нём сделал бы каждый импорт «новой» ошибкой.
 */
export const YM_UNKNOWN_ARTICLE_CONTEXT = 'finance:ym-articles';

export interface IUnknownArticleGroup {
  signature: string;
  count: number;
  amountKopecks: number;
}

/** Нераспознанные операции по типам — строки «не распознано» отчёта и алерта. */
export function unknownArticleGroups(ops: readonly IFinanceOperationRow[]): IUnknownArticleGroup[] {
  const groups = new Map<string, IUnknownArticleGroup>();
  for (const op of ops) {
    if (op.article !== 'unknown') continue;
    const { signature } = classifyYmRow(op.raw);
    const group = groups.get(signature) ?? { signature, count: 0, amountKopecks: 0 };
    group.count += 1;
    group.amountKopecks += op.amountKopecks;
    groups.set(signature, group);
  }
  return [...groups.values()].sort((a, b) => b.count - a.count);
}

/**
 * Один отчёт на загрузку, сколько бы типов ни было незнакомо. В тексте — только
 * типы, число строк и сумма: заказы и артикулы есть в самих операциях.
 */
export async function reportUnknownArticles(
  errors: Pick<ErrorReporter, 'report'>,
  ops: readonly IFinanceOperationRow[],
  telegramUserId: string,
): Promise<void> {
  const groups = unknownArticleGroups(ops);
  if (!groups.length) return;

  const lines = groups.map(
    (g) => `${g.signature}: ${g.count} стр., ${kopecksToRub(g.amountKopecks)} ₽`,
  );
  await errors.report({
    error: new YmUnknownArticleError(
      `Журнал ЯМ: операции без статьи — допишите правило в ym-articles.ts\n${lines.join('\n')}`,
    ),
    source: 'queue',
    context: YM_UNKNOWN_ARTICLE_CONTEXT,
    telegramUserId,
  });
}
