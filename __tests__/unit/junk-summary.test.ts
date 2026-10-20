import { describe, it, expect } from 'vitest';

import { summarizeJunk, UNKNOWN_IP } from '../../src/modules/logs/junk.domain';

/**
 * Сводка «Мусора» по IP: по ней решают, блокировать ли источник на краю
 * (nginx deny / CrowdSec). Важно: счёт по адресу, топ запросов, UA последнего
 * запроса и старые записи без ip — отдельной группой, а не потерей.
 */
describe('summarizeJunk', () => {
  const at = (minute: number) => new Date(Date.UTC(2026, 9, 18, 12, minute));

  const rows = [
    { createdAt: at(1), ip: '1.1.1.1', requestUrl: 'POST /', userAgent: 'old' },
    { createdAt: at(3), ip: '1.1.1.1', requestUrl: 'POST /', userAgent: 'new' },
    { createdAt: at(2), ip: '1.1.1.1', requestUrl: 'GET /.env' },
    { createdAt: at(5), ip: '2.2.2.2', requestUrl: 'GET /.git/config' },
    { createdAt: at(0), requestUrl: 'GET /favicon.ico' },
  ];

  it('группирует по IP и сортирует по числу запросов', () => {
    const [top, second, third] = summarizeJunk(rows, 10);

    expect(top).toMatchObject({ ip: '1.1.1.1', count: 3, firstAt: at(1), lastAt: at(3) });
    expect(top.topRequests).toEqual([
      { request: 'POST /', count: 2 },
      { request: 'GET /.env', count: 1 },
    ]);
    // Свежий из равных по счёту — выше.
    expect(second.ip).toBe('2.2.2.2');
    expect(third.ip).toBe(UNKNOWN_IP);
  });

  it('UA — от последнего по времени запроса, а не от последней строки', () => {
    expect(summarizeJunk(rows, 10)[0].userAgent).toBe('new');
  });

  it('limit режет число источников', () => {
    expect(summarizeJunk(rows, 1)).toHaveLength(1);
  });
});
