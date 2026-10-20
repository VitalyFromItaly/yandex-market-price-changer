import { ApiError, NETWORK_ERROR_STATUS } from '@/shared/http';

export type TurnStatus = 'running' | 'done' | 'failed';

/** Опрос хода: ответ модели — секунды и десятки секунд, долгий backoff только задерживал бы его. */
export const TURN_FIRST_POLL_MS = 1_000;
export const TURN_MAX_POLL_MS = 5_000;
/** Сетевых сбоев опроса подряд, после которых ход считается потерянным. */
export const TURN_MAX_NETWORK_FAILURES = 3;

export const TURN_LOST_TEXT = 'Ответ потерялся — сервер перезапустился. Спросите ещё раз.';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Один ход ИИ в памяти сервера: старт и опрос до готового ответа. Одна механика
 * на чат, разбор периода (TASK-150) и черновик ответа на отзыв (TASK-167) —
 * различаются только адреса, поэтому живёт в shared, а не в ai-analyst. 409 значит,
 * что ход уже идёт (вторая вкладка, повторный клик) — тогда опрашивается он.
 * 404 при опросе — сервер перезапустился и ход потерян. Отменённый ход (reset)
 * ответа не отдаёт: счётчик запусков выбрасывает поздние ответы.
 */
export function useTurn<TTurn extends { status: TurnStatus }>(
  poll: (turnId: string) => Promise<TTurn>,
) {
  let generation = 0;
  /** id последнего запущенного хода — по нему ставится 👍/👎 (TASK-170). */
  let lastTurnId: string | null = null;

  async function startOrJoin(start: () => Promise<string>): Promise<string> {
    try {
      return await start();
    } catch (e) {
      const running = e instanceof ApiError && e.status === 409 ? e.details?.turnId : undefined;
      if (typeof running === 'string') return running;
      throw e;
    }
  }

  /** Ответ хода; null — ход отменён. Ошибка — с текстом для продавца. */
  async function run(start: () => Promise<string>): Promise<TTurn | null> {
    const current = ++generation;
    const turnId = await startOrJoin(start);
    lastTurnId = turnId;
    let delay = TURN_FIRST_POLL_MS;
    let failures = 0;
    for (;;) {
      await sleep(delay);
      if (current !== generation) return null;
      try {
        const turn = await poll(turnId);
        if (current !== generation) return null;
        if (turn.status !== 'running') return turn;
        failures = 0;
      } catch (e) {
        if (e instanceof ApiError && e.status === 404) throw new Error(TURN_LOST_TEXT);
        const network = e instanceof ApiError && e.status === NETWORK_ERROR_STATUS;
        if (!network || ++failures >= TURN_MAX_NETWORK_FAILURES) throw e;
      }
      delay = Math.min(Math.round(delay * 1.5), TURN_MAX_POLL_MS);
    }
  }

  return {
    run,
    lastTurnId: (): string | null => lastTurnId,
    cancel(): void {
      generation += 1;
    },
  };
}
