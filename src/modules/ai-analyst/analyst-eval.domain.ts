import type { IAnswerVerification } from './ai-analyst.domain';
import type { IAiToolInvocation } from '../ai/ai-tools.types';
import type { TAiToolName } from '../ai-tools/ai-tools.domain';

/**
 * Контрольный набор вопросов к ИИ-аналитику (TASK-169): чистая часть —
 * ожидание вопроса, вердикт по ответу, отчёт. Прогон — `scripts/eval-ai-analyst.ts`,
 * вопросы — `scripts/eval-ai-analyst.cases.ts`.
 */

export interface IEvalCase {
  /** Вопрос продавца как есть. */
  q: string;
  /** Каждый из них обязан быть вызван хотя бы раз (порядок и лишние вызовы не важны). */
  tools: TAiToolName[];
  /**
   * Ключевые аргументы: хотя бы один вызов инструмента обязан нести их все
   * (`{ getBrandEconomics: { brand: 'casio' } }`). Сравнение — строкой.
   */
  args?: Partial<Record<TAiToolName, Record<string, string | number | boolean>>>;
  /** Уточнение здесь законно (вопрос без смысла без него). По умолчанию — провал. */
  allowClarify?: boolean;
}

export interface IEvalAnswer {
  answer: string;
  toolResults: readonly IAiToolInvocation[];
  verification: IAnswerVerification;
}

export interface IEvalVerdict {
  passed: boolean;
  /** Почему провал — по строке на причину; при зачёте пусто. */
  reasons: string[];
}

/**
 * Модель переспросила вместо ответа. Эвристика: ответ кончается вопросом или
 * просит уточнить. Ложные срабатывания дешевле пропусков — провал читает человек.
 */
const CLARIFY_MARKERS = [
  /уточните/i,
  /уточнить/i,
  /подскажите/i,
  /вы имеете в виду/i,
  /какой (именно )?(артикул|период|товар|месяц|бренд|площадк)/i,
  /какую (именно )?(площадку|модель)/i,
  /за какой (период|месяц)/i,
];

/** «Хотите разбить по месяцам?» после ответа — предложение, а не уточнение. */
const OFFER = /^(хотите|могу|показать|разобрать|если (нужно|хотите)|нужно ли)/i;

export function asksBack(answer: string): boolean {
  const text = answer.trim();
  const last = text.split(/(?<=[.!?…])\s+|\n+/).pop() ?? '';
  if (/\?\s*$/.test(text) && !OFFER.test(last.trim())) return true;
  return CLARIFY_MARKERS.some((marker) => marker.test(text));
}

function parsedArgs(raw: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(raw || '{}');
    return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function argsMatch(raw: string, expected: Record<string, unknown>): boolean {
  const actual = parsedArgs(raw);
  if (!actual) return false;
  return Object.entries(expected).every(([key, value]) => String(actual[key]) === String(value));
}

function argsText(raw: string): string {
  const actual = parsedArgs(raw);
  if (!actual) return 'не JSON';
  return Object.entries(actual)
    .map(([key, value]) => `${key}=${typeof value === 'string' ? value : JSON.stringify(value)}`)
    .join(', ');
}

export function judgeCase(test: IEvalCase, result: IEvalAnswer): IEvalVerdict {
  const reasons: string[] = [];
  const called = result.toolResults.map((call) => call.name);
  const calledText = called.length ? `[${[...new Set(called)].join(', ')}]` : 'ничего';

  for (const tool of test.tools) {
    if (!called.includes(tool)) reasons.push(`ожидали ${tool} — вызвано ${calledText}`);
  }

  for (const [tool, expected] of Object.entries(test.args ?? {})) {
    const calls = result.toolResults.filter((call) => call.name === tool);
    // Инструмент не вызван — причина уже записана выше.
    if (!calls.length || calls.some((call) => argsMatch(call.arguments, expected))) continue;
    const wanted = Object.entries(expected)
      .map(([key, value]) => `${key}=${String(value)}`)
      .join(', ');
    const got = calls.map((call) => `(${argsText(call.arguments)})`).join(' ');
    reasons.push(`${tool}: ожидали ${wanted} — вызван ${got}`);
  }

  if (!test.allowClarify && asksBack(result.answer)) reasons.push('уточняющий вопрос');

  if (result.verification.unconfirmed.length) {
    reasons.push(`неподтверждённые числа [${result.verification.unconfirmed.join(', ')}]`);
  }

  return { passed: !reasons.length, reasons };
}

export interface IEvalRow {
  index: number;
  q: string;
  verdict: IEvalVerdict;
  rounds: number;
  costRub: number;
}

function rub(value: number): string {
  return `${value.toFixed(2)} ₽`;
}

/** Таблица прогона: строка на вопрос, причины провала под ней. */
export function formatReport(rows: readonly IEvalRow[]): string {
  const lines = rows.flatMap((row) => {
    const mark = row.verdict.passed ? '✓' : '✗';
    const head = `${String(row.index).padStart(2)} ${mark} ${row.q}  (раундов ${row.rounds}, ${rub(row.costRub)})`;
    return [head, ...row.verdict.reasons.map((reason) => `     — ${reason}`)];
  });
  const passed = rows.filter((row) => row.verdict.passed).length;
  const cost = rows.reduce((sum, row) => sum + row.costRub, 0);
  lines.push('', `Прошло ${passed} из ${rows.length}, стоимость ${rub(cost)}`);
  return lines.join('\n');
}
