import { describe, expect, it, vi } from 'vitest';

import {
  PolzaApiError,
  PolzaAuthError,
  PolzaInsufficientFundsError,
  PolzaNetworkError,
  PolzaServerError,
} from '../../src/modules/ai/polza.errors';
import { HealthMonitorService } from '../../src/modules/health/health-monitor.service';
import { POLZA_ACCOUNT_HINT, POLZA_NETWORK_HINT } from '../../src/modules/health/health.domain';

/**
 * Шестая самопроверка — баланс Polza. Кончившиеся деньги или отозванный ключ
 * иначе первым обнаружил бы продавец.
 */
interface IPolzaCheck {
  checkPolza(): Promise<{
    key: string;
    state: string;
    detail: string;
    latencyMs?: number;
    hint?: string;
  }>;
}

function setup(balance: () => Promise<unknown>, enabled = true) {
  const ai = { balance: vi.fn(balance) };
  const service = new HealthMonitorService(
    { readyState: 1 } as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    { polzaAiEnabled: enabled, polzaAiBalanceWarnRub: 200 } as never,
    {} as never,
    ai as never,
  );
  const sleep = vi.fn(async () => undefined);
  Object.assign(service, { sleep });
  return { service, ai, sleep, check: () => (service as unknown as IPolzaCheck).checkPolza() };
}

/** Остальные проверки collect() глушатся: здесь важен только состав списка. */
function stubOtherChecks(service: HealthMonitorService): void {
  const ok = (key: string) => async () => ({ key, state: 'ok', detail: '' });
  Object.assign(service, {
    checkDisk: ok('disk'),
    checkRedis: ok('redis'),
    checkTelegram: ok('telegram'),
    checkYandex: ok('yandex'),
  });
}

describe('HealthMonitorService: баланс Polza', () => {
  it('выше порога — ok, с задержкой', async () => {
    const { check } = setup(async () => ({ available: 1500 }));
    const result = await check();
    expect(result).toMatchObject({ key: 'polza', state: 'ok' });
    expect(result.detail).toContain('доступно');
    expect(typeof result.latencyMs).toBe('number');
  });

  it('ниже порога — warn, порог в тексте', async () => {
    const { check } = setup(async () => ({ available: 150 }));
    const result = await check();
    expect(result.state).toBe('warn');
    expect(result.detail).toContain('порог 200 ₽');
  });

  it('401 — авария «ключ отозван», без повтора', async () => {
    const { check, ai, sleep } = setup(async () => {
      throw new PolzaAuthError('Unauthorized', 401, 'UNAUTHORIZED');
    });
    const result = await check();
    expect(result.state).toBe('down');
    expect(result.detail).toContain('ключ отозван');
    expect(ai.balance).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('402 — авария «нет средств», без повтора', async () => {
    const { check, ai } = setup(async () => {
      throw new PolzaInsufficientFundsError('no money', 402, 'INSUFFICIENT_BALANCE');
    });
    expect((await check()).detail).toContain('нет средств');
    expect(ai.balance).toHaveBeenCalledTimes(1);
  });

  it('разовый сетевой сбой — ok со второй попытки, провал виден', async () => {
    const { check, ai, sleep } = setup(async () => ({ available: 1500 }));
    ai.balance.mockRejectedValueOnce(new PolzaNetworkError('socket hang up'));
    const result = await check();
    expect(result.state).toBe('ok');
    expect(result.detail).toContain('со второй попытки');
    expect(result.detail).toContain('socket hang up');
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it('нет ответа дважды — авария по таймауту, проход не виснет', async () => {
    vi.useFakeTimers();
    try {
      const { check, ai } = setup(() => new Promise(() => undefined));
      const pending = check();
      await vi.advanceTimersByTimeAsync(20_000);
      const result = await pending;
      expect(result.state).toBe('down');
      expect(result.detail).toContain('нет ответа');
      expect(result.detail).toContain('2 попытки из 2');
      expect(ai.balance).toHaveBeenCalledTimes(2);
      // Совет — про сеть, не «пополнить баланс»: 14-10-2026 было именно так.
      expect(result.hint).toBe(POLZA_NETWORK_HINT);
      // Брошенный запрос отменён, а не висит до таймаута клиента.
      for (const [options] of ai.balance.mock.calls as unknown as Array<
        [{ signal: AbortSignal }]
      >) {
        expect(options.signal.aborted).toBe(true);
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it('проба — без повторов клиента: причину видит монитор', async () => {
    const { check, ai } = setup(async () => ({ available: 1500 }));
    await check();
    expect(ai.balance).toHaveBeenCalledWith(expect.objectContaining({ retry: false }));
  });

  it('503 дважды — авария с кодом в тексте и сетевым советом', async () => {
    const { check, ai } = setup(async () => {
      throw new PolzaServerError('Service Unavailable', 503, 'SERVICE_UNAVAILABLE');
    });
    const result = await check();
    expect(result.state).toBe('down');
    expect(result.detail).toContain('HTTP 503 SERVICE_UNAVAILABLE');
    expect(result.hint).toBe(POLZA_NETWORK_HINT);
    expect(ai.balance).toHaveBeenCalledTimes(2);
  });

  it('500 — ответ по существу: без повтора и без совета про сеть', async () => {
    const { check, ai } = setup(async () => {
      throw new PolzaApiError('Internal', 500);
    });
    const result = await check();
    expect(result.detail).toContain('HTTP 500');
    expect(result.hint).toBeUndefined();
    expect(ai.balance).toHaveBeenCalledTimes(1);
  });

  it('401 и низкий баланс — совет про кабинет', async () => {
    const auth = setup(async () => {
      throw new PolzaAuthError('Unauthorized', 401);
    });
    expect((await auth.check()).hint).toBe(POLZA_ACCOUNT_HINT);
    const low = setup(async () => ({ available: 150 }));
    expect((await low.check()).hint).toBe(POLZA_ACCOUNT_HINT);
    const ok = setup(async () => ({ available: 1500 }));
    expect((await ok.check()).hint).toBeUndefined();
  });

  it('без токена проверки нет: ни строки в сводке, ни запроса', async () => {
    const { service, ai } = setup(async () => ({ available: 1500 }), false);
    stubOtherChecks(service);
    const keys = (await service.collect()).map((result) => result.key);
    expect(keys).not.toContain('polza');
    expect(ai.balance).not.toHaveBeenCalled();
  });

  it('с токеном — шестая строка сводки', async () => {
    const { service } = setup(async () => ({ available: 1500 }));
    stubOtherChecks(service);
    const keys = (await service.collect()).map((result) => result.key);
    expect(keys).toEqual(['disk', 'mongo', 'redis', 'telegram', 'yandex', 'polza']);
  });
});
