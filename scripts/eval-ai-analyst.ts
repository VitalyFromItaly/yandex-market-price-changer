import 'dotenv/config';

import type { IAnalystAnswer } from '../src/modules/ai-analyst/ai-analyst.service';
import type { IEvalCase, IEvalRow } from '../src/modules/ai-analyst/analyst-eval.domain';
import type { TFeatureKey } from '../src/modules/telegram/bots/shared/features.domain';
import type { INestApplicationContext } from '@nestjs/common';

import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import { AppConfigModule } from '../src/config/app-config.module';
import { AppConfigService } from '../src/config/app-config.service';
import { AI_EVAL_PURPOSE, AiUsageService } from '../src/database/services/ai-usage.service';
import { AiModule } from '../src/modules/ai/ai.module';
import { AiService } from '../src/modules/ai/ai.service';
import { AiAnalystModule } from '../src/modules/ai-analyst/ai-analyst.module';
import { AiAnalystService } from '../src/modules/ai-analyst/ai-analyst.service';
import { formatReport, judgeCase } from '../src/modules/ai-analyst/analyst-eval.domain';
import { AI_GATED_FEATURES, AI_TOOL_FEATURE } from '../src/modules/ai-tools/ai-tools.domain';
import { ErrorsModule } from '../src/modules/errors/errors.module';

import {
  ANALYST_NOW,
  ANALYST_SELLER,
  seedAnalystTools,
} from '../__tests__/helpers/analyst-fixture';
import { createTestFinanceDb } from '../__tests__/helpers/test-postgres';

import { EVAL_CASES } from './eval-ai-analyst.cases';

/**
 * Контрольный набор вопросов к ИИ-аналитику (TASK-169): каждый вопрос из
 * `eval-ai-analyst.cases.ts` — один ход `AiAnalystService.ask`, вердикт —
 * `judgeCase` (вызваны ли нужные инструменты с нужными аргументами, нет ли
 * уточняющего вопроса, нет ли неподтверждённых чисел).
 *
 * ПЛАТНЫЙ: каждый вопрос — 1–5 запросов к Polza. Без `--run` только план и
 * оценка стоимости по прошлым строкам AiUsage — Polza не вызывается. Запускать
 * вручную перед сменой POLZA_AI_MODEL или промпта (`ai-analyst.domain.ts`).
 *
 * Строки AiUsage пишутся с purpose `eval` — видны на странице «ИИ», но в дневной
 * лимит продавца не входят (`AiUsageService.spentRubSince`). Текст вопросов и
 * ответов нигде не хранится — только печатается.
 *
 * Nest без AppModule — довод diagnose-*: AppModule поднял бы BotRegistry, а он
 * перевешивает вебхук боевого бота.
 *
 * Запуск:
 *   npx ts-node scripts/eval-ai-analyst.ts --user=<telegramUserId> [--run]
 *   npx ts-node scripts/eval-ai-analyst.ts --seed [--run]
 *   … [--only=1,5,12] [--grep=casio] [--verbose]
 *
 * --user — живой журнал продавца, «сегодня» — сейчас, все экраны ИИ открыты.
 * --seed — засеянный PGlite (`__tests__/helpers/analyst-fixture.ts`: сентябрь
 *   2026, артикул A1), «сегодня» — 15.10.2026; вопросы к инструментам экранов
 *   (прогноз, ДДС, налог, цена, расходы) пропускаются — их сервисов там нет.
 *   Mongo нужна и здесь: AiUsage.
 * --verbose — печатать ответ модели и вызовы инструментов.
 * Код выхода 1 — есть провалы.
 */

/** Средний ход аналитика — инструмент и ответ, два запроса; для оценки. */
const ROUNDS_PER_QUESTION = 2;
/** Строки AiUsage пишутся без ожидания (`void record`) — дать им долететь до сверки. */
const RECORD_SETTLE_MS = 2000;

@Module({ imports: [AppConfigModule, ErrorsModule, AiAnalystModule] })
class EvalLiveModule {}

@Module({ imports: [AppConfigModule, ErrorsModule, AiModule] })
class EvalSeedModule {}

function flag(name: string): string | true | undefined {
  const prefix = `--${name}`;
  for (const arg of process.argv.slice(2)) {
    if (arg === prefix) return true;
    if (arg.startsWith(`${prefix}=`)) return arg.slice(prefix.length + 1);
  }
  return undefined;
}

interface IPicked {
  index: number;
  test: IEvalCase;
}

function pickCases(seed: boolean): { picked: IPicked[]; skipped: IPicked[] } {
  const only = flag('only');
  const grep = flag('grep');
  const numbers = typeof only === 'string' ? new Set(only.split(',').map(Number)) : null;
  const all = EVAL_CASES.map((test, i) => ({ index: i + 1, test })).filter(
    ({ index, test }) =>
      (!numbers || numbers.has(index)) &&
      (typeof grep !== 'string' || test.q.toLowerCase().includes(grep.toLowerCase())),
  );
  if (!seed) return { picked: all, skipped: [] };
  const gated = (test: IEvalCase) => test.tools.some((tool) => tool in AI_TOOL_FEATURE);
  return {
    picked: all.filter(({ test }) => !gated(test)),
    skipped: all.filter(({ test }) => gated(test)),
  };
}

function expectation(test: IEvalCase): string {
  const args = Object.entries(test.args ?? {}).map(
    ([tool, values]) =>
      `${tool}(${Object.entries(values)
        .map(([key, value]) => `${key}=${String(value)}`)
        .join(', ')})`,
  );
  return [...test.tools.filter((tool) => !test.args?.[tool]), ...args].join(' + ');
}

/** Оценка: средний costRub строки AiUsage аналитика × раунды × вопросы. */
async function estimateRub(usage: AiUsageService, questions: number): Promise<number | null> {
  const rows = [
    ...(await usage.list({ purpose: 'analyst', status: 'ok', limit: 100 })),
    ...(await usage.list({ purpose: AI_EVAL_PURPOSE, status: 'ok', limit: 100 })),
  ];
  if (!rows.length) return null;
  const average = rows.reduce((sum, row) => sum + row.costRub, 0) / rows.length;
  return average * ROUNDS_PER_QUESTION * questions;
}

/** Сколько AiUsage насчитал прогону — постранично, страница не больше 100. */
async function recordedRub(usage: AiUsageService, user: string, since: Date): Promise<number> {
  let total = 0;
  for (let skip = 0; ; skip += 100) {
    const page = await usage.list({
      telegramUserId: user,
      purpose: AI_EVAL_PURPOSE,
      since,
      limit: 100,
      skip,
    });
    total += page.reduce((sum, row) => sum + row.costRub, 0);
    if (page.length < 100) return total;
  }
}

interface IRunner {
  context: INestApplicationContext;
  analyst: AiAnalystService;
  user: string;
  now: () => Date;
  features: readonly TFeatureKey[];
  close: () => Promise<void>;
}

async function liveRunner(user: string): Promise<IRunner> {
  const context = await NestFactory.createApplicationContext(EvalLiveModule, {
    logger: ['error', 'warn'],
  });
  return {
    context,
    analyst: context.get(AiAnalystService),
    user,
    now: () => new Date(),
    features: AI_GATED_FEATURES,
    close: () => context.close(),
  };
}

async function seedRunner(): Promise<IRunner> {
  const db = await createTestFinanceDb();
  const tools = await seedAnalystTools(db.db);
  const context = await NestFactory.createApplicationContext(EvalSeedModule, {
    logger: ['error', 'warn'],
  });
  return {
    context,
    // Без turnId строк AiTurn нет — счётчики хода контрольному набору не нужны.
    analyst: new AiAnalystService(context.get(AiService), tools, null as never),
    user: ANALYST_SELLER,
    now: () => ANALYST_NOW,
    features: [],
    close: async () => {
      await context.close();
      await db.close();
    },
  };
}

function printVerbose(answer: IAnalystAnswer): void {
  for (const call of answer.toolResults) {
    const { result } = call;
    let outcome = 'ok';
    if ('reason' in result) outcome = `нет данных: ${result.reason}`;
    else if ('error' in result) outcome = result.error;
    console.log(`     · ${call.name}(${call.arguments}) → ${outcome}`);
  }
  console.log(`     » ${answer.answer.replace(/\n+/g, ' ')}`);
}

async function main(): Promise<void> {
  const seed = flag('seed') === true;
  const user = flag('user');
  const run = flag('run') === true;
  const verbose = flag('verbose') === true;
  if (!seed && typeof user !== 'string') {
    throw new Error('Нужен --user=<telegramUserId> или --seed');
  }

  const { picked, skipped } = pickCases(seed);
  const runner = seed ? await seedRunner() : await liveRunner(user as string);
  try {
    const config = runner.context.get(AppConfigService);
    const usage = runner.context.get(AiUsageService);
    console.log('─'.repeat(72));
    console.log(
      `  ПРОДАВЕЦ: ${seed ? `${runner.user} (засев)` : runner.user}   ` +
        `МОДЕЛЬ: ${config.polzaAiModelFor(AI_EVAL_PURPOSE) ?? '(не задана)'}   ВОПРОСОВ: ${picked.length}`,
    );
    console.log('─'.repeat(72));
    for (const { index, test } of picked) {
      console.log(`${String(index).padStart(2)}  ${test.q}\n      ждём: ${expectation(test)}`);
    }
    for (const { index, test } of skipped) {
      console.log(`${String(index).padStart(2)}  — пропуск (инструмент экрана): ${test.q}`);
    }
    console.log('─'.repeat(72));

    const estimate = await estimateRub(usage, picked.length);
    console.log(
      estimate === null
        ? '  Оценки стоимости нет: в AiUsage ещё нет ответов аналитика.'
        : `  Оценка: ≈ ${estimate.toFixed(2)} ₽ (средний запрос аналитика × ${ROUNDS_PER_QUESTION} × ${picked.length})`,
    );
    if (!run) {
      console.log('  Это план. Прогон платный — добавьте --run.');
      return;
    }
    if (!config.polzaAiEnabled) throw new Error('POLZA_AI_TOKEN не задан — прогонять нечем');

    const started = new Date();
    const rows: IEvalRow[] = [];
    for (const { index, test } of picked) {
      let row: IEvalRow;
      try {
        const answer = await runner.analyst.ask(
          {
            telegramUserId: runner.user,
            aiAllowed: true,
            features: runner.features,
            purpose: AI_EVAL_PURPOSE,
            messages: [{ role: 'user', content: test.q }],
          },
          runner.now(),
        );
        row = {
          index,
          q: test.q,
          verdict: judgeCase(test, answer),
          rounds: answer.rounds,
          costRub: answer.costRub,
        };
        if (verbose || !row.verdict.passed) printVerbose(answer);
      } catch (error) {
        row = {
          index,
          q: test.q,
          verdict: { passed: false, reasons: [`ошибка: ${(error as Error).message}`] },
          rounds: 0,
          costRub: 0,
        };
      }
      rows.push(row);
      console.log(`${String(index).padStart(2)} ${row.verdict.passed ? '✓' : '✗'} ${test.q}`);
    }

    console.log('─'.repeat(72));
    console.log(formatReport(rows));
    await new Promise((resolve) => setTimeout(resolve, RECORD_SETTLE_MS));
    const recorded = await recordedRub(usage, runner.user, started);
    console.log(
      `  AiUsage (purpose ${AI_EVAL_PURPOSE}) с начала прогона: ${recorded.toFixed(2)} ₽`,
    );
    console.log('─'.repeat(72));
    if (rows.some((row) => !row.verdict.passed)) process.exitCode = 1;
  } finally {
    await runner.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
