/**
 * «ИИ-аналитик» (TASK-148): системный промпт, проверка истории из браузера,
 * сверка чисел ответа с результатами инструментов и ссылки на источники.
 * Чистые функции — без Nest, базы и Polza.
 *
 * ИИ не считает (решение `ai_explains_not_computes`), поэтому каждое число
 * ответа обязано найтись в данных, которые инструменты отдали ЭТОМУ ответу.
 * Не нашлось — ответ помечается: модель посчитала сама или выдумала.
 */

import type { IAiSourceRefs, IAiToolInvocation, IAiToolResult } from '../ai/ai-tools.types';
import type { IPolzaMessage } from '../ai/polza.client';
import type { TGatedAiTool } from '../ai-tools/ai-tools.domain';

import { AI_TOOL } from '../ai-tools/ai-tools.domain';
import { financeToday } from '../finance/finance-period';

/** Сколько реплик истории уходит модели: дальше — дорого и мимо вопроса. */
export const MAX_HISTORY_MESSAGES = 20;
/** Потолок одной реплики. Ответы модели бывают длинными, вопросы — нет. */
export const MAX_MESSAGE_CHARS = 4000;
/** Потолок истории целиком — сверх него отрезаются старые реплики, не вопрос. */
export const MAX_HISTORY_CHARS = 20_000;

export type TAnalystRole = 'user' | 'assistant';

export interface IAnalystMessage {
  role: TAnalystRole;
  content: string;
}

/** Подсказки к инструментам экранов — в промпт только для видимых модели. */
const GATED_TOOL_HINTS: Readonly<Record<TGatedAiTool, string>> = {
  [AI_TOOL.FORECAST]:
    'getForecast даёт ПРОГНОЗ, а не факт: называй такие числа прогнозом, коротко назови ' +
    'метод из method.text и не смешивай прогноз с фактом месяца.',
  [AI_TOOL.CASHFLOW]:
    '«Когда придут деньги / сколько Маркет должен» — getCashflow текущего месяца, поле receivable ' +
    '(на дату asOf, по статьям). «Почему выплата меньше» — payouts: mismatch = true значит, что ' +
    'сумма поручения не сошлась со строками журнала; удержания — в payoutArticles.',
  [AI_TOOL.TAX_YEAR]:
    'Налоги — getTaxYear. Периоды нарастающим итогом: «налог за 3 квартал» — поле advance ' +
    'периода m9 («9 месяцев»), сам не вычитай. forecast с kind: прогноз — называй прогнозом. ' +
    'Предупреждения о лимите УСН и пороге НДС — из warnings.',
  [AI_TOOL.PRICE]:
    '«По какой цене продавать, чтобы зарабатывать N ₽ / N %» — getPriceFor (артикул — через ' +
    'searchProducts). Это расчёт по ставкам, а не тариф Маркета: так и скажи и назови ' +
    'источники ставок из rates.',
  [AI_TOOL.EXPENSES]:
    'Расходы бизнеса («сколько ушло на аренду») — getExpenses за период, категория из byCategory.',
  [AI_TOOL.STOCKS]:
    '«Что заканчивается / сколько осталось на складе» — getStocks (живой запрос к Маркету), бренд — ' +
    'аргументом brand («что из Casio заканчивается» — brand: casio, onlyLow: true), а не ' +
    'getBrandEconomics. Число — доступный остаток сейчас, модель склада — из model (FBS или FBY). ' +
    'Ответил ошибкой — перескажи её и предложи повторить позже, остатки не придумывай.',
  [AI_TOOL.RETURNS]:
    '«Сколько едет обратно / возвратов» — getReturns: едет к продавцу — returns.inFlight, уже ' +
    'выдано — returns.settled; без периода в вопросе — period: all (все активные возвраты). ' +
    'Суммы в нём — рубли числом, не поле rub.',
};

export function analystSystemPrompt(
  now: Date = new Date(),
  tools: ReadonlySet<string> = new Set(),
): string {
  return [
    'Ты — финансовый аналитик продавца маркетплейсов. Отвечай по-русски, коротко и по делу.',
    `Сегодня ${financeToday(now)} (Москва). Периоды передавай инструментам как ГГГГ-ММ-ДД.`,
    'Любое число бери ТОЛЬКО из ответов инструментов и пересказывай как есть: рубли — полем rub ' +
      '(можно округлить до целого рубля), проценты — как пришли. Сам не складывай, не вычитай, ' +
      'не дели и не пиши «тыс.»/«млн» — такое число не подтвердится.',
    'Если инструмент ответил insufficientData или у площадки нет данных — так и скажи: ' +
      '«данных недостаточно» и причина. Не догадывайся и не подставляй ноль.',
    'Финансовый журнал есть только по Яндекс Маркету; по Ozon и Wildberries данных пока нет. ' +
      'Если спрашивают «по всем площадкам», «везде» или площадку не называют — не переспрашивай: ' +
      'отвечай по Яндекс Маркету и одной фразой скажи, что по Ozon и Wildberries журнала пока нет.',
    'Если statusLabel говорит, что месяц не проверен, или costComplete/costKnown = false — ' +
      'оговори это: числа могут измениться, прибыль завышена из-за неполного закупа.',
    'Бренд в вопросе («Casio», «Восток», «все часы Seiko») — сразу getBrandEconomics с этим ' +
      'брендом, артикул не нужен. «Какой бренд/товар выгоднее» — getBrandEconomics без brand. ' +
      'ordersSumBySku — сумма заказов по товарам, называй его «заказов по товарам», а не заказов.',
    'Название или модель товара в вопросе («F-91W», «Амфибия 420») — сначала searchProducts, ' +
      'затем getSkuEconomics по найденному sku. Артикул у продавца не выпрашивай: нашлось ' +
      'несколько — возьми точное совпадение или перечисли найденные и посчитай по каждому.',
    '«Убыточные товары» — getTopSkus с lossOnly: true и by: net; «самые прибыльные / ходовые / ' +
      'с лучшей маржой» — getTopSkus с by: net / units / margin. excludedNoCost — товары без ' +
      'закупа вне рейтинга: если он есть, скажи, сколько таких.',
    'Не задавай уточняющих вопросов, если ответ можно получить инструментом с разумным ' +
      'допущением (площадка — Яндекс Маркет, «октябрь» — октябрь текущего года); допущение назови.',
    ...Object.entries(GATED_TOOL_HINTS)
      .filter(([tool]) => tools.has(tool))
      .map(([, hint]) => hint),
  ].join('\n');
}

// ── История из браузера ────────────────────────────────────────────────────

export const HISTORY_INVALID_TEXT =
  'История чата не принята: нужны реплики user/assistant, последняя — вопрос';
export const MESSAGE_TOO_LONG_TEXT = `Сообщение длиннее ${MAX_MESSAGE_CHARS} символов — сократите вопрос`;

/**
 * История приходит из вкладки — значит, что угодно. Только `user`/`assistant`
 * и строки: `system` и `tool` из браузера подменили бы промпт или результат
 * инструмента, по которому сверяются числа. Последняя реплика — вопрос.
 * Длинная история режется со старого конца, вопрос — никогда.
 */
export function normalizeHistory(input: unknown): IAnalystMessage[] | string {
  if (!Array.isArray(input) || !input.length) return HISTORY_INVALID_TEXT;
  const messages: IAnalystMessage[] = [];
  for (const raw of input) {
    if (!raw || typeof raw !== 'object') return HISTORY_INVALID_TEXT;
    const { role, content } = raw as Record<string, unknown>;
    if ((role !== 'user' && role !== 'assistant') || typeof content !== 'string')
      return HISTORY_INVALID_TEXT;
    if (content.length > MAX_MESSAGE_CHARS) return MESSAGE_TOO_LONG_TEXT;
    messages.push({ role, content });
  }
  const last = messages[messages.length - 1];
  if (last.role !== 'user' || !last.content.trim()) return HISTORY_INVALID_TEXT;

  const kept = messages.slice(-MAX_HISTORY_MESSAGES);
  let chars = kept.reduce((sum, m) => sum + m.content.length, 0);
  while (kept.length > 1 && chars > MAX_HISTORY_CHARS) chars -= kept.shift().content.length;
  return kept;
}

export function toPolzaMessages(
  history: IAnalystMessage[],
  now?: Date,
  tools: ReadonlySet<string> = new Set(),
): IPolzaMessage[] {
  return [
    { role: 'system', content: analystSystemPrompt(now, tools) },
    ...history.map((m) => ({ role: m.role, content: m.content })),
  ];
}

// ── Числа ответа ───────────────────────────────────────────────────────────

export interface IAnswerNumber {
  /** Как написано в ответе. */
  raw: string;
  /** Модуль: знак модель передаёт и словами («убыток 1 200»). */
  value: number;
  /** Единица последнего знака: «23,5» → 0.1. Допуск округления. */
  unit: number;
  percent: boolean;
}

/** Даты, время и месяцы — не суммы: вырезаются до поиска чисел. */
const DATE_PATTERNS = [
  /\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?Z?)?/g,
  /\b\d{1,2}[./-]\d{1,2}[./-]\d{2,4}\b/g,
  /\b\d{1,2}[.-]\d{4}\b/g,
  /\b\d{4}-\d{2}\b/g,
  /\b\d{1,2}:\d{2}(?::\d{2})?\b/g,
  /^\s*\d+[.)]\s/gm,
];

/**
 * Число: разряды через пробел (обычный, NBSP, узкий), дробь через запятую или
 * точку, `%` рядом. Не берётся число внутри слова или артикула (`F-91W`,
 * `id42`): перед ним нет буквы, цифры, а также «буква/цифра + дефис».
 */
const NUMBER_RE =
  /(?<![\p{L}\d_.,])(?<![\p{L}\d][-‐–])(\d{1,3}(?:[ \u00a0\u202f]\d{3})+|\d+)(?:[.,](\d+))?(?![\p{L}\d])(\s?%)?/gu;

const isYear = (n: IAnswerNumber) =>
  !n.percent && n.unit === 1 && n.value >= 1990 && n.value <= 2100;
const isSmallCount = (n: IAnswerNumber) => !n.percent && n.unit === 1 && n.value <= 10;

export function extractNumbers(text: string): IAnswerNumber[] {
  let cleaned = text ?? '';
  for (const pattern of DATE_PATTERNS) cleaned = cleaned.replace(pattern, ' ');
  const found: IAnswerNumber[] = [];
  for (const match of cleaned.matchAll(NUMBER_RE)) {
    const [raw, whole, fraction, percent] = match;
    const digits = whole.replace(/[ \u00a0\u202f]/g, '');
    const value = Number(fraction ? `${digits}.${fraction}` : digits);
    if (!Number.isFinite(value)) continue;
    found.push({
      raw: raw.trim(),
      value,
      unit: fraction ? 10 ** -fraction.length : 1,
      percent: Boolean(percent),
    });
  }
  return found;
}

/**
 * Плоский взгляд на результат: без strictNullChecks union с необязательным
 * `insufficientData` не сужается по `ok`, а поля читаются у всех трёх форм.
 */
interface IToolResultView {
  ok: boolean;
  data?: unknown;
  sourceRefs?: IAiSourceRefs;
  insufficientData?: boolean;
  reason?: string;
  error?: string;
}
const view = (result: IAiToolResult): IToolResultView => result as IToolResultView;

/** Числовая строка данных: `"1234.50"`, id заказа `"58841189889"`. */
const NUMERIC_STRING = /^-?\d+(?:\.\d+)?$/;

/**
 * Все числа, которые инструменты отдали этому ответу: поля data (и рубли
 * строкой, и копейки), счётчики ссылок, числа из причин «данных нет».
 */
export function toolNumbers(toolResults: readonly IAiToolInvocation[]): number[] {
  const values: number[] = [];
  const walk = (node: unknown): void => {
    if (typeof node === 'number') {
      if (Number.isFinite(node)) values.push(Math.abs(node), Math.abs(node) / 100);
    } else if (typeof node === 'string') {
      if (NUMERIC_STRING.test(node)) values.push(Math.abs(Number(node)));
      else for (const n of extractNumbers(node)) values.push(n.value);
    } else if (Array.isArray(node)) node.forEach(walk);
    else if (node && typeof node === 'object') Object.values(node).forEach(walk);
  };
  for (const { result } of toolResults) {
    const r = view(result);
    if (r.ok) {
      walk(r.data);
      values.push(r.sourceRefs.operationCount);
    } else walk(r.insufficientData ? r.reason : r.error);
  }
  return values;
}

export interface IAnswerVerification {
  /** Каждое число ответа нашлось в результатах инструментов. */
  verified: boolean;
  /** Числа как в ответе, которых в данных нет. */
  unconfirmed: string[];
}

/**
 * Числа ответа, которые сверяются с данными: без годов, мелких счётов до 10 и
 * чисел, которые продавец сам написал в вопросе. Тот же список считает метрика
 * «чисел в ответе» (TASK-170) — доля неподтверждённых берётся от него.
 */
export function checkedNumbers(answer: string, question: string): IAnswerNumber[] {
  const asked = new Set(extractNumbers(question).map((n) => n.value));
  return extractNumbers(answer).filter(
    (n) => !isYear(n) && !isSmallCount(n) && !asked.has(n.value),
  );
}

/**
 * Сверка: число ответа подтверждено, если в данных есть значение в пределах
 * единицы последнего показанного знака («1 234 568 ₽» ← 1234567.89, «23,5 %» ←
 * 23.45). Не проверяются годы, мелкие счёты до 10 («за 3 месяца») и числа,
 * которые продавец сам написал в вопросе.
 */
export function verifyAnswer(
  answer: string,
  question: string,
  toolResults: readonly IAiToolInvocation[],
): IAnswerVerification {
  const known = toolNumbers(toolResults);
  const unconfirmed = checkedNumbers(answer, question)
    .filter((n) => !known.some((v) => Math.abs(v - n.value) <= n.unit + 1e-9))
    .map((n) => n.raw);
  const unique = [...new Set(unconfirmed)];
  return { verified: !unique.length, unconfirmed: unique };
}

// ── Источники и пробелы ────────────────────────────────────────────────────

export interface IAnalystSource {
  source: string;
  label: string;
  period: { from: string; to: string } | null;
  operationIds: string[];
  operationCount: number;
  documentIds: string[];
}

const SOURCE_LABEL: Record<string, string> = {
  'finance:pnl': 'P&L из журнала',
  'finance:sku': 'Экономика товара',
  'finance:brand': 'Экономика брендов',
  'finance:compare': 'Сравнение площадок',
  'finance:top-skus': 'Рейтинг товаров',
  'finance:anomalies': 'Аномалии журнала',
  'finance:operations': 'Операции журнала',
  'finance:payouts': 'Выплаты Маркета',
  'finance:forecast': 'Окно базы прогноза',
  'finance:cashflow': 'Выплаты по статьям',
  'finance:tax-year': 'Налоговый год',
  'finance:price-calc': 'Калькулятор цен',
  'finance:expenses': 'Расходы бизнеса',
};

function skuOf(invocation: IAiToolInvocation): string | null {
  if (invocation.name !== AI_TOOL.SKU) return null;
  try {
    const sku = (JSON.parse(invocation.arguments) as { sku?: unknown }).sku;
    return typeof sku === 'string' ? sku : null;
  } catch {
    return null;
  }
}

/**
 * Ссылки ответа — из `sourceRefs` успешных вызовов. Одна и та же выборка,
 * запрошенная дважды, — одна ссылка. Пустая (ни операций, ни документов)
 * никуда не ведёт и не показывается.
 */
export function sourcesOf(toolResults: readonly IAiToolInvocation[]): IAnalystSource[] {
  const seen = new Set<string>();
  const sources: IAnalystSource[] = [];
  for (const invocation of toolResults) {
    const r = view(invocation.result);
    if (!r.ok) continue;
    const refs = r.sourceRefs;
    const documentIds = refs.documentIds ?? [];
    if (!refs.operationCount && !documentIds.length) continue;
    const key = [refs.source, refs.period?.from, refs.period?.to, refs.operationIds.join(',')].join(
      '|',
    );
    if (seen.has(key)) continue;
    seen.add(key);
    const sku = skuOf(invocation);
    const base = SOURCE_LABEL[refs.source] ?? refs.source;
    sources.push({
      source: refs.source,
      label: refs.label ?? (sku ? `${base} «${sku}»` : base),
      period: refs.period ? { from: refs.period.from, to: refs.period.to } : null,
      operationIds: refs.operationIds,
      operationCount: refs.operationCount,
      documentIds,
    });
  }
  return sources;
}

/**
 * Чего не хватило: причины `insufficientData` — и вызова целиком, и площадки
 * внутри ответа (`compareMarketplaces` отдаёт Ozon/WB так). Экран печатает их
 * отдельно от текста: модель могла промолчать, а продавец должен знать.
 */
export function gapsOf(toolResults: readonly IAiToolInvocation[]): string[] {
  const gaps = new Set<string>();
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) node.forEach(walk);
    else if (node && typeof node === 'object') {
      const record = node as Record<string, unknown>;
      if (record.insufficientData === true && typeof record.reason === 'string')
        gaps.add(record.reason);
      Object.values(record).forEach(walk);
    }
  };
  for (const { result } of toolResults) {
    const r = view(result);
    if (r.ok) walk(r.data);
    else if (r.insufficientData) gaps.add(r.reason);
  }
  return [...gaps];
}
