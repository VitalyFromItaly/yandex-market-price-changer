import type { AnalystAnswerResponse, ChatMessage } from '../ai-analyst.domain';

import { describe, expect, it } from 'vitest';

import { HISTORY_SENT } from '../ai-analyst.domain';

import { toAnswerModel, toHistory } from './mapAnswer.ai-analyst';

const response = (patch: Partial<AnalystAnswerResponse> = {}): AnalystAnswerResponse => ({
  answer: 'Чистая прибыль 1 234,50 ₽',
  verification: { verified: true, unconfirmed: [] },
  sources: [],
  gaps: [],
  rounds: 2,
  ...patch,
});

describe('ответ ИИ-аналитика → пузырь', () => {
  it('все числа подтверждены — плашки нет', () => {
    expect(toAnswerModel(response()).unverified).toBeNull();
  });

  it('неподтверждённые числа перечисляются', () => {
    const model = toAnswerModel(
      response({ verification: { verified: false, unconfirmed: ['999', '12 %'] } }),
    );
    expect(model.unverified).toBe('Не подтверждены данными журнала: 999, 12 %');
  });

  it('ссылка: операции без суммы, с полным счётом, «Финансы» с периодом', () => {
    const model = toAnswerModel(
      response({
        sources: [
          {
            source: 'finance:pnl',
            label: 'P&L из журнала',
            period: { from: '2026-09-01', to: '2026-09-30' },
            operationIds: ['a', 'b'],
            operationCount: 120,
            documentIds: ['doc1'],
          },
        ],
      }),
    );
    const link = model.sources[0];
    expect(link?.operations).toEqual({
      title: 'P&L из журнала',
      amount: null,
      operationIds: ['a', 'b'],
      operationCount: 120,
    });
    expect(link?.financeQuery).toEqual({ from: '2026-09-01', to: '2026-09-30' });
    expect(link?.periodLabel).toContain('—');
    expect(link?.documentIds).toEqual(['doc1']);
  });

  it('ссылка без операций и периода — ни раскрытия, ни «Финансов»', () => {
    const model = toAnswerModel(
      response({
        sources: [
          {
            source: 'finance:operations',
            label: 'Операции журнала',
            period: null,
            operationIds: [],
            operationCount: 0,
            documentIds: ['doc1'],
          },
        ],
      }),
    );
    expect(model.sources[0]?.operations).toBeNull();
    expect(model.sources[0]?.financeQuery).toBeNull();
  });

  it('история: последние реплики, только роль и текст', () => {
    const messages: ChatMessage[] = Array.from({ length: HISTORY_SENT + 5 }, (_, i) => ({
      id: i,
      role: i % 2 ? 'assistant' : 'user',
      content: `m${i}`,
    }));
    const history = toHistory(messages);
    expect(history).toHaveLength(HISTORY_SENT);
    expect(history[history.length - 1]).toEqual({ role: 'user', content: `m${HISTORY_SENT + 4}` });
    expect(Object.keys(history[0] ?? {})).toEqual(['role', 'content']);
  });
});
