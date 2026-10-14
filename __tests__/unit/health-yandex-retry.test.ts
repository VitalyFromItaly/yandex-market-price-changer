import { afterEach, describe, expect, it, vi } from 'vitest';

import { HealthMonitorService } from '../../src/modules/health/health-monitor.service';

/**
 * Самопроверка Яндекса: одна неудача соединения — не авария. 13-10-2026 алерт
 * пришёл из-за единственного ETIMEDOUT, а следующий запрос прошёл.
 */
interface IYandexCheck {
  checkYandex(): Promise<{ state: string; detail: string }>;
}

function setup() {
  const service = new HealthMonitorService(
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    { yandexMarketBaseUrl: 'https://api.example' } as never,
    {} as never,
    {} as never,
  );
  const sleep = vi.fn(async () => undefined);
  Object.assign(service, { sleep });
  return { check: () => (service as unknown as IYandexCheck).checkYandex(), sleep };
}

const timeout = Object.assign(new TypeError('fetch failed'), {
  cause: { code: 'ETIMEDOUT', address: '93.158.134.216', port: 443 },
});

describe('HealthMonitorService: проверка Яндекса', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('первая попытка упала, вторая прошла — ok, но провал виден', async () => {
    const fetch = vi.fn().mockRejectedValueOnce(timeout).mockResolvedValueOnce({ status: 401 });
    vi.stubGlobal('fetch', fetch);
    const { check, sleep } = setup();

    const result = await check();

    expect(result.state).toBe('ok');
    expect(result.detail).toContain('со второй попытки');
    expect(result.detail).toContain('ETIMEDOUT');
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it('обе попытки упали — авария с причиной, а не «fetch failed»', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(timeout));
    const { check } = setup();

    const result = await check();

    expect(result.state).toBe('down');
    expect(result.detail).toContain('соединение не установилось');
    expect(result.detail).toContain('93.158.134.216:443');
    expect(result.detail).toContain('2 попытки из 2');
    expect(result.detail).not.toContain('fetch failed');
  });

  it('HTTP-ответ с первого раза — без повтора', async () => {
    const fetch = vi.fn().mockResolvedValue({ status: 401 });
    vi.stubGlobal('fetch', fetch);
    const { check, sleep } = setup();

    expect((await check()).state).toBe('ok');
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });
});
