import { describe, expect, it } from 'vitest';

import { qualityShares } from '../../src/modules/ai/ai-usage.domain';
import { checkedNumbers, verifyAnswer } from '../../src/modules/ai-analyst/ai-analyst.domain';
import { turnQualityOf } from '../../src/modules/ai-analyst/turn-quality.domain';

/** Счётчики качества хода ИИ (TASK-170): без текста, по заглушке инструментов. */
const PNL = {
  name: 'getPnl',
  arguments: '{}',
  result: {
    ok: true,
    data: { revenue: '12000.00' },
    sourceRefs: { source: 'finance:pnl', label: 'P&L', operationIds: [], operationCount: 2 },
  },
} as never;

describe('turnQualityOf', () => {
  it('числа — те же, что сверяет verifyAnswer; неподтверждённые — из проверки', () => {
    const answer = 'Выручка 12 000 ₽, прибыль 4 321 ₽ за 3 месяца 2026 года.';
    const question = 'Сколько я заработал?';
    const verification = verifyAnswer(answer, question, [PNL]);
    expect(checkedNumbers(answer, question).map((n) => n.value)).toEqual([12000, 4321]);
    expect(
      turnQualityOf({ answer, question, verification, toolResults: [PNL], rounds: 2 }),
    ).toEqual({
      numbers: 2,
      unconfirmed: 1,
      toolCalls: 1,
      rounds: 2,
      asksBackNoTools: false,
    });
  });

  it('разговор про Casio: переспросил без инструментов — уточняющий', () => {
    const answer = 'По Casio нет отдельного отчёта. Какой именно товар?';
    const quality = turnQualityOf({
      answer,
      question: 'Сколько я заработал на Casio?',
      verification: { verified: true, unconfirmed: [] },
      toolResults: [],
      rounds: 1,
    });
    expect(quality).toMatchObject({ asksBackNoTools: true, toolCalls: 0, numbers: 0 });
  });

  it('уточнение после вызова инструмента — уже не «без инструментов»; предложение — не уточнение', () => {
    const base = {
      question: 'Casio?',
      verification: { verified: true, unconfirmed: [] },
      rounds: 2,
    };
    expect(
      turnQualityOf({ ...base, answer: 'Какой именно товар?', toolResults: [PNL] }).asksBackNoTools,
    ).toBe(false);
    expect(
      turnQualityOf({
        ...base,
        answer: 'Выручка 12 000 ₽. Хотите разбить по месяцам?',
        toolResults: [],
      }).asksBackNoTools,
    ).toBe(false);
  });
});

describe('qualityShares', () => {
  it('неподтверждённые и уточняющие — от ходов, 👎 — от оценённых; делить не на что — null', () => {
    expect(
      qualityShares({ turns: 4, withUnconfirmed: 1, asksBackNoTools: 2, rated: 2, down: 1 }),
    ).toMatchObject({ unconfirmedShare: 0.25, asksBackShare: 0.5, downShare: 0.5 });
    expect(
      qualityShares({ turns: 0, withUnconfirmed: 0, asksBackNoTools: 0, rated: 0, down: 0 }),
    ).toMatchObject({ unconfirmedShare: null, asksBackShare: null, downShare: null });
  });
});
