import 'dotenv/config';

import {
  type IChatCompletionRequest,
  type IChatCompletionResult,
  type IPolzaModel,
  type IPolzaTool,
  PolzaClient,
} from '../src/modules/ai/polza.client';

/**
 * Сухая проверка Polza.ai: чем платить, сколько стоит, доходит ли запрос.
 *
 * Зачем. До того как открыть фичу `ai` хоть одному продавцу, нужно выбрать
 * POLZA_AI_MODEL по реальным ценам (в списке Polza ~400 моделей всех видов,
 * цены — в рублях за миллион токенов) и убедиться, что Polza отвечает с того
 * хоста, где живёт бот.
 *
 * Без Nest: AppModule поднял бы BotRegistry, а тот переставляет вебхук боевого
 * бота (довод diagnose-*). И мимо AiService: скрипт — не продавец, у него нет
 * фичи и дневного лимита, и он НЕ пишет строку AiUsage — в Mongo не ходит вовсе.
 * Переменные читаются из .env напрямую: Joi-проверку они проходят на старте
 * приложения, а скрипт ничего не пишет.
 *
 * Запуск (по умолчанию — только бесплатные GET):
 *   npx ts-node scripts/diagnose-polza.ts                  — баланс и текущая модель с ценой
 *   npx ts-node scripts/diagnose-polza.ts --models[=flash] — chat-модели с ценами, фильтр по id/имени
 *   npx ts-node scripts/diagnose-polza.ts --chat           — ПЛАТНО: один короткий запрос (доли копейки)
 *   npx ts-node scripts/diagnose-polza.ts --json           — ПЛАТНО: проба response_format json_schema
 *   npx ts-node scripts/diagnose-polza.ts --tools          — ПЛАТНО: проба tool-calling (два запроса)
 *   … --model=<id>                                         — другая модель для --chat/--json/--tools
 *
 * Платное включается только флагом: случайный запуск не должен тратить деньги
 * владельца. max_tokens у обеих проб маленький — цена ограничена сверху.
 */

const DEFAULT_BASE_URL = 'https://polza.ai/api';

/** Ширина разделителей — как в diagnose-orders.ts. */
const RULE = '─'.repeat(72);

const CHAT_MAX_TOKENS = 16;
const JSON_MAX_TOKENS = 64;
const TOOLS_MAX_TOKENS = 64;

/**
 * Игрушечная функция пробы --tools (TASK-147): схема той же формы, что у
 * инструментов ИИ — объект, required, без лишних полей. Данных продавца в пробе
 * нет: проверяется протокол, а не финансы.
 */
const PROBE_TOOL: IPolzaTool = {
  type: 'function',
  function: {
    name: 'get_city_population',
    description: 'Население города в миллионах человек',
    parameters: {
      type: 'object',
      properties: { city: { type: 'string', description: 'Название города' } },
      required: ['city'],
      additionalProperties: false,
    },
  },
};
const PROBE_TOOL_ANSWER = { ok: true, data: { city: 'Москва', population_mln: 13.1 } };

/** Схема пробы: маленькая, но с обоими типами и required — проверяется ровно то, что нужно отчётам. */
const PROBE_SCHEMA = {
  type: 'object',
  properties: {
    city: { type: 'string' },
    population_mln: { type: 'number' },
  },
  required: ['city', 'population_mln'],
  additionalProperties: false,
} as const;

function flag(name: string): string | true | undefined {
  const prefix = `--${name}`;
  for (const arg of process.argv.slice(2)) {
    if (arg === prefix) return true;
    if (arg.startsWith(`${prefix}=`)) return arg.slice(prefix.length + 1);
  }
  return undefined;
}

const rub = (value: number): string =>
  `${value.toLocaleString('ru-RU', { maximumFractionDigits: 8 })} ₽`;

const priceText = (model: IPolzaModel): string =>
  model.pricing
    ? `вход ${rub(model.pricing.promptPerMillionRub)} / выход ${rub(model.pricing.completionPerMillionRub)} за 1M`
    : 'цена неизвестна';

async function timed<T>(run: () => Promise<T>): Promise<{ value: T; ms: number }> {
  const started = Date.now();
  const value = await run();
  return { value, ms: Date.now() - started };
}

function printCompletion(result: IChatCompletionResult, ms: number): void {
  const u = result.usage;
  console.log(`Ответ:      ${JSON.stringify(result.content)}`);
  console.log(`Стоимость:  ${rub(u.costRub)}`);
  console.log(
    `Токены:     вход ${u.promptTokens}, выход ${u.completionTokens}` +
      (u.reasoningTokens ? `, рассуждение ${u.reasoningTokens}` : '') +
      (u.cachedTokens ? `, из кэша ${u.cachedTokens}` : ''),
  );
  console.log(`Латентность: ${ms} мс`);
  console.log(`Модель:     ${result.model || '—'}; провайдер: ${result.provider || '—'}`);
  console.log(`trace_id:   ${result.traceId || '—'}`);
}

/** Без ajv: схема пробы из двух полей, а лишняя зависимость ради скрипта не нужна. */
function schemaVerdict(content: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return '❌ не JSON';
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return '❌ не объект';
  const obj = parsed as Record<string, unknown>;
  const problems: string[] = [];
  if (typeof obj.city !== 'string') problems.push('city не строка');
  if (typeof obj.population_mln !== 'number') problems.push('population_mln не число');
  const extra = Object.keys(obj).filter((k) => !(k in PROBE_SCHEMA.properties));
  if (extra.length) problems.push(`лишние поля: ${extra.join(', ')}`);
  return problems.length ? `❌ не по схеме: ${problems.join('; ')}` : '✅ валиден по схеме';
}

function printModels(
  models: IPolzaModel[],
  filter: string | true,
  current: string | undefined,
): void {
  const needle = filter === true ? '' : filter.toLowerCase();
  const rows = models
    .filter((m) => m.type === 'chat')
    .filter((m) => !needle || `${m.id} ${m.name ?? ''}`.toLowerCase().includes(needle))
    // Без цены — в конец: «неизвестно» не дешевле остальных.
    .sort(
      (a, b) =>
        (a.pricing?.completionPerMillionRub ?? Infinity) -
          (b.pricing?.completionPerMillionRub ?? Infinity) || a.id.localeCompare(b.id),
    );

  console.log(RULE);
  console.log(
    `Chat-моделей${needle ? ` по «${needle}»` : ''}: ${rows.length}. ₽ за 1M токенов, по цене выхода. ` +
      'JSON — держит json_schema, TOOLS — вызов функций.',
  );
  console.log(RULE);
  console.log('       вход     выход контекст            модель');
  for (const m of rows) {
    const mark = m.id === current ? '▶' : ' ';
    const price = m.pricing
      ? `${m.pricing.promptPerMillionRub.toFixed(2).padStart(9)} ${m.pricing.completionPerMillionRub.toFixed(2).padStart(9)}`
      : '        —         —';
    const ctx = m.contextLength ? `${Math.round(m.contextLength / 1000)}k`.padStart(6) : '     —';
    console.log(
      `${mark} ${price} ${ctx} ${m.structuredOutputs ? 'JSON' : '    '} ${m.tools ? 'TOOLS' : '     '}  ${m.id}`,
    );
  }
}

async function probe(
  client: PolzaClient,
  title: string,
  request: IChatCompletionRequest,
): Promise<IChatCompletionResult> {
  console.log(RULE);
  console.log(`${title} (модель ${request.model})`);
  console.log(RULE);
  const { value, ms } = await timed(() => client.chatCompletion(request));
  printCompletion(value, ms);
  return value;
}

async function main(): Promise<void> {
  const token = process.env.POLZA_AI_TOKEN || undefined;
  const envModel = process.env.POLZA_AI_MODEL || undefined;
  const baseUrl = (process.env.POLZA_AI_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, '');

  if (!token) {
    console.log('POLZA_AI_TOKEN не задан — ИИ выключен, проверять нечего.');
    return;
  }

  const modelFlag = flag('model');
  const model = typeof modelFlag === 'string' ? modelFlag : envModel;
  const client = new PolzaClient({ baseUrl, token, model });

  console.log(`База: ${baseUrl}; POLZA_AI_MODEL: ${envModel ?? '—'}`);

  const balance = await timed(() => client.getBalance());
  const b = balance.value;
  console.log(RULE);
  console.log(`Баланс (${balance.ms} мс): доступно ${rub(b.available)}, всего ${rub(b.amount)}`);
  if (b.reservedAmount !== null) console.log(`  в резерве ${rub(b.reservedAmount)}`);
  if (b.spentAmount !== null) console.log(`  потрачено ${rub(b.spentAmount)}`);

  const listed = await timed(() => client.listModels());
  const models = listed.value;
  console.log(`Моделей в списке: ${models.length} (${listed.ms} мс)`);
  for (const id of new Set([envModel, model].filter(Boolean))) {
    const found = models.find((m) => m.id === id);
    console.log(
      found
        ? `  ${id}: ${priceText(found)}` +
            (found.structuredOutputs ? ', json_schema держит' : ', json_schema НЕ заявлен') +
            (found.tools ? ', tools держит' : ', tools НЕ заявлен')
        : `  ${id}: ❌ нет в списке моделей`,
    );
  }

  const modelsFilter = flag('models');
  if (modelsFilter !== undefined) printModels(models, modelsFilter, model);

  if (!flag('chat') && !flag('json') && !flag('tools')) return;
  if (!model) {
    console.log('Модель не задана: нужна POLZA_AI_MODEL или --model=<id>.');
    process.exitCode = 1;
    return;
  }

  if (flag('chat')) {
    await probe(client, 'Пробный chat', {
      model,
      messages: [{ role: 'user', content: 'Ответь одним словом: столица России?' }],
      maxTokens: CHAT_MAX_TOKENS,
      temperature: 0,
    });
  }

  if (flag('json')) {
    const result = await probe(client, 'Проба response_format: json_schema', {
      model,
      messages: [
        { role: 'user', content: 'Столица России и её население в миллионах. Ответь по схеме.' },
      ],
      responseFormat: {
        type: 'json_schema',
        json_schema: { name: 'city_probe', strict: true, schema: PROBE_SCHEMA },
      },
      maxTokens: JSON_MAX_TOKENS,
      temperature: 0,
    });
    console.log(`Схема:      ${schemaVerdict(result.content)}`);
  }

  if (flag('tools')) await probeTools(client, model);
}

/** Вердикт по вызову: модель попросила нашу функцию с валидными аргументами. */
function toolCallVerdict(result: IChatCompletionResult): string {
  const [call] = result.toolCalls;
  if (!call) return `❌ вызова нет (finish_reason ${result.finishReason || '—'})`;
  if (call.name !== PROBE_TOOL.function.name) return `❌ чужая функция: ${call.name}`;
  try {
    const args = JSON.parse(call.arguments) as Record<string, unknown>;
    return typeof args.city === 'string'
      ? `✅ ${call.name}(${call.arguments})`
      : `❌ аргументы не по схеме: ${call.arguments}`;
  } catch {
    return `❌ аргументы не JSON: ${call.arguments}`;
  }
}

/**
 * Два раунда, как в AiService.completeWithTools: запрос с функцией → вызов →
 * ответ функции с id вызова → текст. Второй раунд проверяет, что роль `tool`
 * и `tool_call_id` Polza принимает, а не только отдаёт вызов.
 */
async function probeTools(client: PolzaClient, model: string): Promise<void> {
  const question = {
    role: 'user' as const,
    content: 'Сколько людей живёт в Москве? Узнай функцией.',
  };
  const first = await probe(client, 'Проба tool-calling, раунд 1', {
    model,
    messages: [question],
    tools: [PROBE_TOOL],
    toolChoice: 'auto',
    maxTokens: TOOLS_MAX_TOKENS,
    temperature: 0,
  });
  console.log(`Вызов:      ${toolCallVerdict(first)}`);
  const [call] = first.toolCalls;
  if (!call) return;

  const second = await probe(client, 'Проба tool-calling, раунд 2 (ответ функции)', {
    model,
    messages: [
      question,
      { role: 'assistant', content: first.content || null, toolCalls: first.toolCalls },
      { role: 'tool', toolCallId: call.id, content: JSON.stringify(PROBE_TOOL_ANSWER) },
    ],
    tools: [PROBE_TOOL],
    maxTokens: TOOLS_MAX_TOKENS,
    temperature: 0,
  });
  console.log(
    `Итог:       ${second.content.includes('13') ? '✅ ответ опирается на результат функции' : '⚠️ в ответе нет числа из функции'}`,
  );
}

main().catch((error: Error) => {
  // Только имя и текст: у PolzaApiError в них нет ключа.
  console.error(`${error.name}: ${error.message}`);
  process.exitCode = 1;
});
