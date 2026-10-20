import type { ErrorReporter } from '../errors/error-reporter.service';

import { randomUUID } from 'node:crypto';

import { AiError } from '../ai/ai.errors';
import { PolzaApiError } from '../ai/polza.errors';

/** Коды ответов ходов: 409 — у продавца ход уже идёт, 404 — хода нет (или чужой). */
export const TURN_RUNNING = 'TURN_RUNNING';
export const TURN_NOT_FOUND = 'TURN_NOT_FOUND';
export const INVALID_RATING = 'INVALID_RATING';

/** Тело `POST turns/:id/rating` — `{ rating: 'up' | 'down' }`; иное — null (400). */
export function parseTurnRating(body: unknown): 'up' | 'down' | null {
  const rating = (body as { rating?: unknown } | null)?.rating;
  return rating === 'up' || rating === 'down' ? rating : null;
}

/** Сколько готовый ход ждёт, пока вкладка его заберёт. */
export const TURN_TTL_MS = 10 * 60_000;
export const TURN_FAILED_TEXT = 'Не удалось получить ответ — попробуйте ещё раз.';

export type TTurnStatus = 'running' | 'done' | 'failed';

export interface ITurnView<TAnswer = unknown> {
  status: TTurnStatus;
  answer?: TAnswer;
  message?: string;
}

interface ITurn<TAnswer> extends ITurnView<TAnswer> {
  telegramUserId: string;
  finishedAt?: number;
}

/** У продавца уже идёт ход — второй не запускается (одна оплаченная цепочка за раз). */
export class TurnRunningError extends Error {
  constructor(public readonly turnId: string) {
    super('ход уже идёт');
  }
}

/**
 * Ходы ИИ в памяти процесса (решение `ai_analyst_in_memory_turns`).
 *
 * Не crm-jobs: там params и результат лежат в Mongo сутки и копируются в Redis,
 * а переписка продавца на сервере не хранится (правило TASK-104). И не
 * синхронный POST: ход — до пяти запросов к модели, прокси оборвал бы его.
 * Ход запускается фоном, вкладка опрашивает `view`. Рестарт процесса ход
 * теряет — вкладка предложит спросить снова; прод — один инстанс.
 *
 * Одна механика на чат, разбор периода (TASK-150) и черновик ответа на отзыв
 * (TASK-167): у каждого свой экземпляр, поэтому идущий вопрос чата не мешает
 * разбору и наоборот. Лежит в корне crm/, а не в ai-analyst/: её читают разделы.
 */
export abstract class InMemoryTurns<TInput extends { telegramUserId: string }, TAnswer> {
  private readonly turns = new Map<string, ITurn<TAnswer>>();

  protected constructor(
    private readonly errors: ErrorReporter,
    /** Место в журнале ошибок: `crm:ai-analyst`, `crm:ai-period-review`, `crm:feedback-draft`. */
    private readonly context: string,
  ) {}

  /** `turnId` — тот же id, что увидит фронт: по нему пишутся счётчики хода и оценка (TASK-170). */
  protected abstract run(input: TInput, turnId: string): Promise<TAnswer>;

  public start(input: TInput, now: () => number = Date.now): string {
    this.sweep(now());
    const running = [...this.turns].find(
      ([, turn]) => turn.telegramUserId === input.telegramUserId && turn.status === 'running',
    );
    if (running) throw new TurnRunningError(running[0]);

    const id = randomUUID();
    const turn: ITurn<TAnswer> = { telegramUserId: input.telegramUserId, status: 'running' };
    this.turns.set(id, turn);
    void this.run(input, id)
      .then((answer) => Object.assign(turn, { status: 'done', answer }))
      .catch((error: unknown) =>
        Object.assign(turn, {
          status: 'failed',
          message: this.failureText(error, input.telegramUserId),
        }),
      )
      .finally(() => (turn.finishedAt = now()));
    return id;
  }

  /** Чужой и несуществующий ход неразличимы — null в обоих случаях. */
  public view(
    telegramUserId: string,
    id: string,
    now: () => number = Date.now,
  ): ITurnView<TAnswer> | null {
    this.sweep(now());
    const turn = this.turns.get(id);
    if (!turn || turn.telegramUserId !== telegramUserId) return null;
    return { status: turn.status, answer: turn.answer, message: turn.message };
  }

  /**
   * Отказ AiService (фича, лимит, ИИ выключен) — не сбой: продавцу его текст,
   * админам ничего. Сбой Polza AiService уже отрепортил — только текст.
   * Остальное — наша поломка: в журнал с алертом и общий текст.
   */
  private failureText(error: unknown, telegramUserId: string): string {
    if (error instanceof AiError) return error.userMessage;
    if (error instanceof PolzaApiError) return error.userMessage;
    void this.errors.report({ error, source: 'crm', context: this.context, telegramUserId });
    return TURN_FAILED_TEXT;
  }

  private sweep(now: number): void {
    for (const [id, turn] of this.turns)
      if (turn.finishedAt !== undefined && now - turn.finishedAt > TURN_TTL_MS)
        this.turns.delete(id);
  }
}
