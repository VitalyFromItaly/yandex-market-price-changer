import type { IChatCompletionResult, IPolzaTool } from './polza.client';

/**
 * Контракт инструментов ИИ (TASK-147). Здесь, а не рядом с инструментами:
 * AiModule финансы не импортирует, а цикл вызовов живёт в AiService — единственной
 * двери к Polza. Реализация — `AiToolsService.toolbox` в `src/modules/ai-tools/`.
 */

/** Откуда число: на что сослаться в ответе продавцу. */
export interface IAiSourceRefs {
  /** Чем посчитано: `finance:pnl`, `finance:sku`, `finance:anomalies`, `finance:operations`. */
  source: string;
  /** Период расчёта, ГГГГ-ММ-ДД включительно. */
  period?: { from: string; to: string };
  /** id операций журнала — первые `MAX_REF_IDS`, полный счёт — `operationCount`. */
  operationIds: string[];
  operationCount: number;
  /** id версий отчёта Маркета (оригиналы), если известны. */
  documentIds?: string[];
  /** Подпись ссылки, если подписи источника мало («Статья «Логистика»», TASK-150). */
  label?: string;
}

export type IAiToolResult =
  | { ok: true; data: unknown; sourceRefs: IAiSourceRefs }
  /** Данных нет — модель обязана сказать это, а не догадываться. */
  | { ok: false; insufficientData: true; reason: string }
  /** Вызов не принят: неизвестный инструмент, кривые аргументы, сбой. */
  | { ok: false; insufficientData?: undefined; error: string };

/**
 * Набор инструментов одного продавца. Продавец зашит при создании и в
 * аргументах инструментов его нет — модель не может попросить чужие данные.
 */
export interface IAiToolbox {
  readonly telegramUserId: string;
  readonly definitions: IPolzaTool[];
  /** Никогда не бросает: любой исход — результат для модели. */
  call(name: string, rawArguments: string): Promise<IAiToolResult>;
}

export interface IAiToolInvocation {
  name: string;
  /** Аргументы как прислала модель. */
  arguments: string;
  result: IAiToolResult;
}

export interface IAiToolsCompletion extends IChatCompletionResult {
  /** Все вызовы всех раундов по порядку — по ним проверяются числа ответа (TASK-148). */
  toolResults: IAiToolInvocation[];
  /** Сколько запросов к Polza ушло — столько же строк AiUsage. */
  rounds: number;
  /** Стоимость всех раундов, ₽ (`usage` — только последнего). */
  costRub: number;
}
