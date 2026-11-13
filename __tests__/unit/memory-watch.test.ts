import { afterEach, describe, expect, it } from 'vitest';

import {
  MEMORY_ALERT_RSS_BYTES,
  MEMORY_REARM_RSS_BYTES,
  activeMemoryJobs,
  memoryAlertText,
  nextMemoryAlertState,
  resetMemoryJobsForTest,
  sampleActiveJobs,
  traceMemory,
} from '../../src/modules/health/memory-watch.domain';

const MB = 1024 * 1024;

describe('memory-watch', () => {
  afterEach(() => resetMemoryJobsForTest());

  it('алерт только при пересечении порога снизу, повтор — после спада ниже rearm', () => {
    let state = { armed: true, alert: false };
    state = nextMemoryAlertState(state.armed, MEMORY_ALERT_RSS_BYTES - 1);
    expect(state).toEqual({ armed: true, alert: false });
    state = nextMemoryAlertState(state.armed, MEMORY_ALERT_RSS_BYTES);
    expect(state).toEqual({ armed: false, alert: true });
    state = nextMemoryAlertState(state.armed, MEMORY_ALERT_RSS_BYTES + 500 * MB);
    expect(state.alert).toBe(false);
    // Между rearm и порогом — молчим и не взводимся (без дребезга).
    state = nextMemoryAlertState(state.armed, MEMORY_REARM_RSS_BYTES + MB);
    expect(state).toEqual({ armed: false, alert: false });
    state = nextMemoryAlertState(state.armed, MEMORY_REARM_RSS_BYTES - 1);
    expect(state).toEqual({ armed: true, alert: false });
  });

  it('traceMemory держит задачу в реестре на время работы, поднимает пик и пишет строку лога', async () => {
    const lines: string[] = [];
    let seenInside: string[] = [];
    const result = await traceMemory(
      'crm:accounting:dashboard 1',
      async () => {
        seenInside = activeMemoryJobs().map((job) => job.label);
        sampleActiveJobs(10_000 * MB);
        return 42;
      },
      { log: (line) => lines.push(line) },
    );
    expect(result).toBe(42);
    expect(seenInside).toEqual(['crm:accounting:dashboard 1']);
    expect(activeMemoryJobs()).toEqual([]);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('Память crm:accounting:dashboard 1');
    expect(lines[0]).toContain('пик 10000 МБ');
  });

  it('ошибка задачи пробрасывается, а задача всё равно снимается с реестра и логируется', async () => {
    const lines: string[] = [];
    await expect(
      traceMemory('finance-import 1 nightly', () => Promise.reject(new Error('boom')), {
        log: (line) => lines.push(line),
      }),
    ).rejects.toThrow('boom');
    expect(activeMemoryJobs()).toEqual([]);
    expect(lines).toHaveLength(1);
  });

  it('текст алерта называет идущие задачи с их приростом', () => {
    const memory = {
      rss: 2000 * MB,
      heapUsed: 1500 * MB,
      external: 300 * MB,
      arrayBuffers: 250 * MB,
    };
    const now = 1_000_000;
    const text = memoryAlertText(
      memory,
      [
        {
          label: 'crm:stocks:by-sku 1',
          startedAt: now - 120_000,
          startRss: 200 * MB,
          peakRss: 2000 * MB,
        },
      ],
      now,
    );
    expect(text).toContain('2000 МБ');
    expect(text).toContain('crm:stocks:by-sku 1 (2 мин, со старта +1800 МБ)');
    expect(memoryAlertText(memory, [], now)).toContain('Отслеживаемых задач нет');
  });
});
