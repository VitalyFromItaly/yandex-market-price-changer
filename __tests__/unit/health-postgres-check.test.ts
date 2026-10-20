import { describe, expect, it, vi } from 'vitest';

import { HealthMonitorService } from '../../src/modules/health/health-monitor.service';

/**
 * Postgres финансов в самопроверке (TASK-156): пинг SELECT 1, гонка с таймаутом.
 * Пул ленивый, флага «соединено» у него нет — поэтому именно запрос.
 */
interface IPostgresCheck {
  checkPostgres(): Promise<{ key: string; state: string; detail: string; latencyMs?: number }>;
}

function setup(query: () => Promise<unknown>) {
  const pool = { query: vi.fn(query) };
  const service = new HealthMonitorService(
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    pool as never,
  );
  return { pool, check: () => (service as unknown as IPostgresCheck).checkPostgres() };
}

describe('HealthMonitorService: Postgres', () => {
  it('отвечает — ok с задержкой', async () => {
    const { check, pool } = setup(async () => ({ rows: [{ '?column?': 1 }] }));
    const result = await check();
    expect(result).toMatchObject({ key: 'postgres', state: 'ok' });
    expect(typeof result.latencyMs).toBe('number');
    expect(pool.query).toHaveBeenCalledWith('SELECT 1');
  });

  it('отказ соединения — down с причиной', async () => {
    const { check } = setup(async () => {
      throw new Error('connect ECONNREFUSED 127.0.0.1:5433');
    });
    const result = await check();
    expect(result).toMatchObject({ key: 'postgres', state: 'down' });
    expect(result.detail).toContain('ECONNREFUSED');
  });
});
