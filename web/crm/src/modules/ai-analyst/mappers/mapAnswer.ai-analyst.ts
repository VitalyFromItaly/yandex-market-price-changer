import type {
  AnalystAnswerResponse,
  AnalystSourceResponse,
  AnswerModel,
  ChatMessage,
  HistoryMessage,
  SourceLink,
} from '../ai-analyst.domain';

import { HISTORY_SENT } from '../ai-analyst.domain';

import { rangeLabel } from '@/shared/period';

export function toSourceLink(source: AnalystSourceResponse, index: number): SourceLink {
  return {
    key: `${source.source}:${index}`,
    label: source.label,
    periodLabel: source.period ? rangeLabel(source.period) : null,
    financeQuery: source.period ? { from: source.period.from, to: source.period.to } : null,
    operations: source.operationIds.length
      ? {
          title: source.label,
          amount: null,
          operationIds: source.operationIds,
          operationCount: source.operationCount,
        }
      : null,
    documentIds: source.documentIds,
  };
}

/** Ответ сервера → модель пузыря: текст, плашка непроверенных чисел, ссылки, пробелы. */
export function toAnswerModel(response: AnalystAnswerResponse): AnswerModel {
  const { unconfirmed, verified } = response.verification;
  return {
    text: response.answer,
    unverified:
      verified || !unconfirmed.length
        ? null
        : `Не подтверждены данными журнала: ${unconfirmed.join(', ')}`,
    sources: response.sources.map(toSourceLink),
    gaps: response.gaps,
  };
}

/** Лента → история для сервера: последние реплики, только роль и текст. */
export function toHistory(messages: readonly ChatMessage[]): HistoryMessage[] {
  return messages.slice(-HISTORY_SENT).map((m) => ({ role: m.role, content: m.content }));
}
