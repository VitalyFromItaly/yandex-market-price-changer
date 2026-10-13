import { describe, expect, it, vi } from 'vitest';

import { FbyStockService, POLL_MAX_ATTEMPTS } from '../../src/modules/yandex/fby/fby-stock.service';

/**
 * Поллинг отчёта остатков FBY. 12-10-2026 отчёт дважды не уложился в прежние
 * 3 минуты, и алерт «не готов вовремя» не говорил, где он застрял. Пиним
 * потолок попыток и то, что последний статус попадает в текст ошибки.
 */

interface IPoller {
  pollReport(client: unknown, reportId: string): Promise<string>;
}

function setup(statuses: Array<{ status: string; fileUrl?: string }>) {
  const service = new FbyStockService({} as never, {} as never);
  const sleep = vi.fn(async () => undefined);
  Object.assign(service, { sleep });
  let call = 0;
  const client = {
    getReportInfo: vi.fn(async () => statuses[Math.min(call++, statuses.length - 1)]),
  };
  const poll = () => (service as unknown as IPoller).pollReport(client, 'r1');
  return { client, sleep, poll };
}

describe('FbyStockService: ожидание отчёта остатков', () => {
  it('застрявший отчёт: ровно POLL_MAX_ATTEMPTS опросов и последний статус в ошибке', async () => {
    const { client, poll } = setup([{ status: 'PENDING' }]);

    await expect(poll()).rejects.toThrow(/не готов за 10 мин \(последний статус: PENDING\)/);
    expect(client.getReportInfo).toHaveBeenCalledTimes(POLL_MAX_ATTEMPTS);
  });

  it('PENDING → PROCESSING → DONE: отдаёт ссылку на файл', async () => {
    const { client, poll } = setup([
      { status: 'PENDING' },
      { status: 'PROCESSING' },
      { status: 'DONE', fileUrl: 'https://files/r1.csv' },
    ]);

    await expect(poll()).resolves.toBe('https://files/r1.csv');
    expect(client.getReportInfo).toHaveBeenCalledTimes(3);
  });

  it('FAILED: прежняя ошибка «не сгенерировался», без ожидания до потолка', async () => {
    const { client, poll } = setup([{ status: 'FAILED' }]);

    await expect(poll()).rejects.toThrow('Отчёт об остатках FBY не сгенерировался');
    expect(client.getReportInfo).toHaveBeenCalledTimes(1);
  });

  it('новый текст ошибки не принимается за лимит генерации', async () => {
    const { poll } = setup([{ status: 'PENDING' }]);
    const message = await poll().catch((error: Error) => error.message);

    expect(/rate limit|METHOD_FAILURE|1 point per 1 minute/i.test(message)).toBe(false);
  });
});
