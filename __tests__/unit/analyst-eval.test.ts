import type { IAiToolInvocation } from '../../src/modules/ai/ai-tools.types';
import type { IEvalCase } from '../../src/modules/ai-analyst/analyst-eval.domain';

import { describe, expect, it } from 'vitest';

import { verifyAnswer } from '../../src/modules/ai-analyst/ai-analyst.domain';
import {
  asksBack,
  formatReport,
  judgeCase,
} from '../../src/modules/ai-analyst/analyst-eval.domain';
import { AI_TOOL, allowedArgs } from '../../src/modules/ai-tools/ai-tools.domain';
import { BRAND_KEYS } from '../../src/modules/yandex/reports/brands';
import { EVAL_CASES } from '../../scripts/eval-ai-analyst.cases';

/** Контрольный набор вопросов к ИИ-аналитику (TASK-169): оценщик и сам набор. */

const OK = {
  ok: true as const,
  data: { net: 1000 },
  sourceRefs: { source: 'finance:pnl', operationIds: [], operationCount: 0 },
};
const call = (name: string, args: unknown = {}): IAiToolInvocation => ({
  name,
  arguments: typeof args === 'string' ? args : JSON.stringify(args),
  result: OK,
});
const CASIO: IEvalCase = {
  q: 'Сколько я заработал на Casio?',
  tools: [AI_TOOL.BRAND],
  args: { [AI_TOOL.BRAND]: { brand: 'casio' } },
};
const VERIFIED = { verified: true, unconfirmed: [] };

describe('asksBack — уточняющий вопрос вместо ответа', () => {
  it.each([
    'Уточните, пожалуйста, артикул товара.',
    'Какой артикул вас интересует?',
    'За какой период посмотреть?',
    'Вы имеете в виду Яндекс Маркет или Ozon',
    'Подскажите модель часов.',
    'По Casio нет отдельного отчёта. Какой именно товар?',
  ])('«%s» — переспросил', (answer) => {
    expect(asksBack(answer)).toBe(true);
  });

  it.each([
    'На Casio в сентябре чистая 12 000 ₽.',
    'Чистая 12 000 ₽ за сентябрь (взял Яндекс Маркет). Хотите разбить по товарам?',
    'Выручка 12 000 ₽.\nМогу показать топ товаров?',
    'Данных за октябрь недостаточно: журнал не загружен.',
  ])('«%s» — ответ', (answer) => {
    expect(asksBack(answer)).toBe(false);
  });
});

describe('judgeCase', () => {
  it('нужный инструмент с нужным аргументом, ответ без уточнений — зачёт', () => {
    const verdict = judgeCase(CASIO, {
      answer: 'На Casio чистая 1000 ₽.',
      toolResults: [call(AI_TOOL.PNL), call(AI_TOOL.BRAND, { brand: 'casio', from: 'a', to: 'b' })],
      verification: VERIFIED,
    });
    expect(verdict).toEqual({ passed: true, reasons: [] });
  });

  it('регрессия Casio 18-10-2026: модель ищет артикул и переспрашивает — две причины', () => {
    const verdict = judgeCase(CASIO, {
      answer: 'Какой артикул Casio вас интересует?',
      toolResults: [call(AI_TOOL.SEARCH, { query: 'Casio' })],
      verification: VERIFIED,
    });
    expect(verdict.passed).toBe(false);
    expect(verdict.reasons).toEqual([
      'ожидали getBrandEconomics — вызвано [searchProducts]',
      'уточняющий вопрос',
    ]);
  });

  it('ничего не вызвано — так и сказано', () => {
    const verdict = judgeCase(CASIO, {
      answer: 'Не знаю.',
      toolResults: [],
      verification: VERIFIED,
    });
    expect(verdict.reasons).toEqual(['ожидали getBrandEconomics — вызвано ничего']);
  });

  it('не тот аргумент — что ждали и с чем вызван', () => {
    const verdict = judgeCase(CASIO, {
      answer: 'На Orient чистая 1000 ₽.',
      toolResults: [call(AI_TOOL.BRAND, { brand: 'orient', from: '2026-09-01', to: '2026-09-30' })],
      verification: VERIFIED,
    });
    expect(verdict.reasons).toEqual([
      'getBrandEconomics: ожидали brand=casio — вызван (brand=orient, from=2026-09-01, to=2026-09-30)',
    ]);
  });

  it('аргументы не JSON — провал, а не исключение', () => {
    const verdict = judgeCase(CASIO, {
      answer: 'Ок.',
      toolResults: [call(AI_TOOL.BRAND, '{brand: casio')],
      verification: VERIFIED,
    });
    expect(verdict.reasons).toEqual(['getBrandEconomics: ожидали brand=casio — вызван (не JSON)']);
  });

  it('неподтверждённые числа — из verifyAnswer, как есть', () => {
    const toolResults = [call(AI_TOOL.BRAND, { brand: 'casio' })];
    const answer = 'На Casio чистая 6 500 ₽.';
    const verdict = judgeCase(CASIO, {
      answer,
      toolResults,
      verification: verifyAnswer(answer, CASIO.q, toolResults),
    });
    expect(verdict.reasons).toEqual(['неподтверждённые числа [6 500]']);
  });

  it('булевы и числовые ожидания сравниваются строкой', () => {
    const verdict = judgeCase(
      { q: 'убыточные', tools: [AI_TOOL.TOP], args: { [AI_TOOL.TOP]: { lossOnly: true } } },
      {
        answer: 'Убыточных нет.',
        toolResults: [call(AI_TOOL.TOP, { lossOnly: true })],
        verification: VERIFIED,
      },
    );
    expect(verdict.passed).toBe(true);
  });

  it('allowClarify — уточнение не провал', () => {
    const verdict = judgeCase(
      { q: 'а там?', tools: [], allowClarify: true },
      { answer: 'Что вы имеете в виду?', toolResults: [], verification: VERIFIED },
    );
    expect(verdict.passed).toBe(true);
  });
});

describe('formatReport', () => {
  it('строка на вопрос, причины под ней, итог и стоимость', () => {
    const text = formatReport([
      { index: 1, q: 'Casio', verdict: { passed: true, reasons: [] }, rounds: 2, costRub: 0.04 },
      {
        index: 2,
        q: 'Налог',
        verdict: { passed: false, reasons: ['уточняющий вопрос'] },
        rounds: 1,
        costRub: 0.02,
      },
    ]);
    expect(text).toContain(' 1 ✓ Casio  (раундов 2, 0.04 ₽)');
    expect(text).toContain(' 2 ✗ Налог');
    expect(text).toContain('     — уточняющий вопрос');
    expect(text).toContain('Прошло 1 из 2, стоимость 0.06 ₽');
  });
});

describe('набор EVAL_CASES — данные, а не код', () => {
  const tools = new Set<string>(Object.values(AI_TOOL));

  it('30–50 вопросов, без повторов', () => {
    expect(EVAL_CASES.length).toBeGreaterThanOrEqual(30);
    expect(EVAL_CASES.length).toBeLessThanOrEqual(50);
    expect(new Set(EVAL_CASES.map((c) => c.q)).size).toBe(EVAL_CASES.length);
  });

  it('каждый ждёт существующие инструменты с существующими аргументами', () => {
    for (const test of EVAL_CASES) {
      expect(test.tools.length, test.q).toBeGreaterThan(0);
      for (const tool of test.tools) expect(tools.has(tool), `${test.q}: ${tool}`).toBe(true);
      for (const [tool, args] of Object.entries(test.args ?? {})) {
        expect(test.tools, `${test.q}: args без инструмента ${tool}`).toContain(tool);
        for (const key of Object.keys(args)) {
          expect(allowedArgs(tool as never), `${test.q}: ${tool}.${key}`).toContain(key);
        }
      }
    }
  });

  it('бренды — ключи brands.ts', () => {
    const brands = EVAL_CASES.flatMap((c) => {
      const brand = c.args?.[AI_TOOL.BRAND]?.brand;
      return brand === undefined ? [] : [String(brand)];
    });
    expect(brands.length).toBeGreaterThan(0);
    for (const brand of brands) expect(BRAND_KEYS as readonly string[]).toContain(brand);
  });

  it('регрессия Casio 18-10-2026 в наборе', () => {
    expect(EVAL_CASES).toContainEqual(CASIO);
  });

  it('все инструменты покрыты, кроме getOperations (его зовут по id из других)', () => {
    const covered = new Set(EVAL_CASES.flatMap((c) => c.tools));
    const missing = [...tools].filter((tool) => !covered.has(tool as never));
    expect(missing).toEqual([AI_TOOL.OPERATIONS]);
  });
});
