import type { IAnswerVerification } from '../../../ai-analyst/ai-analyst.domain';
import type { IFinancePeriod } from '../../../finance/finance-period';

import { weekLabel } from '../../../ai-analyst/weekly-digest.domain';
import { esc, splitMessage } from '../../formatting/telegram-format';

export const DIGEST_FOOTER = 'Числа — из журнала операций («Финансы»), ИИ их только пересказывает.';

/**
 * Сообщение сводки (TASK-168), уже порезанное `splitMessage`. Ответ модели —
 * простым текстом через `esc()`: разметку модели Telegram не доверяем.
 * Неподтверждённые числа не прячутся, а помечаются строкой — как плашка
 * «ИИ-аналитика» (решение `ai_analyst_number_check`).
 */
export function weeklyDigestMessages(
  week: IFinancePeriod,
  answer: string,
  verification: IAnswerVerification,
  gaps: readonly string[],
): string[] {
  const lines = [`🤖 <b>ИИ-сводка за ${esc(weekLabel(week))}</b>`, '', esc(answer), ''];
  if (!verification.verified) {
    lines.push(`⚠️ Не подтверждены данными: ${esc(verification.unconfirmed.join(', '))}`);
  }
  for (const gap of gaps) lines.push(`ℹ️ ${esc(gap)}`);
  lines.push(`<i>${esc(DIGEST_FOOTER)}</i>`);
  return splitMessage(lines.join('\n'));
}
