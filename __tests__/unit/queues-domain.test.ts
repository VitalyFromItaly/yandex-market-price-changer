import { describe, it, expect } from 'vitest';

import {
  QUEUE_LIST,
  JOB_STATES,
  isQueueName,
  isJobState,
  safeJobData,
  parseReportJobId,
  cronToTime,
  reportTitleOf,
} from '../../src/modules/queues/queues.domain';
import { QUEUE_NAMES } from '../../src/modules/telegram';
import { ReportSchedulerService } from '../../src/modules/telegram/queue/services/report-scheduler.service';
import { REPORT } from '../../src/modules/yandex/reports/report-status-map';
import { toCron } from '../../src/modules/yandex/reports/schedule-time';

describe('Белый список payload (safeJobData)', () => {
  // Реальная форма задачи очереди file-processing/yandex-api: см. процессоры.
  const PAYLOAD = {
    userId: '222',
    chatId: 333,
    botToken: '7000000001:AAF-секретный-токен-бота',
    sessionId: 'c0ffee',
    fileInfo: { fileName: 'stock.xlsx', filePath: '/app/static/temp/stock.xlsx', fileSize: 100500 },
    parsingResult: { rows: new Array(5000).fill({ sku: 'x', price: 1 }) },
  };

  it('botToken не имеет пути в ответ', () => {
    const raw = JSON.stringify(safeJobData(PAYLOAD));
    expect(raw).not.toContain('botToken');
    expect(raw).not.toContain('7000000001');
  });

  it('многотысячные блобы результатов отсекаются', () => {
    const safe = safeJobData(PAYLOAD);
    expect(safe).not.toHaveProperty('parsingResult');
    // Из fileInfo остаётся только имя файла — без путей на диске.
    expect(safe.fileName).toBe('stock.xlsx');
    expect(JSON.stringify(safe)).not.toContain('/app/static');
  });

  it('неизвестное поле по умолчанию НЕ показывается — свойство белого списка', () => {
    // Маскирующий regex, пропустивший новый секрет, промолчал бы. Белый список
    // ошибается в безопасную сторону: новое поле просто не видно.
    const safe = safeJobData({ userId: '1', freshSecretField: 'секрет' });
    expect(safe).toEqual({ userId: '1' });
  });

  it('payload рассылки проходит целиком — в нём только ключ', () => {
    expect(safeJobData({ telegramUserId: '222', botId: '999', reportKey: 'profit' })).toEqual({
      telegramUserId: '222',
      botId: '999',
      reportKey: 'profit',
    });
  });

  it('не-объект не роняет проекцию', () => {
    expect(safeJobData(null)).toEqual({});
    expect(safeJobData('строка')).toEqual({});
    expect(safeJobData(undefined)).toEqual({});
  });
});

describe('Разбор идентификатора рассылки', () => {
  it('round-trip с ReportSchedulerService.jobId — форматы не расходятся', () => {
    // Дрейф-гвард: страница очередей разбирает то, что планировщик собрал.
    const key = { botId: '999', telegramUserId: '222', reportKey: REPORT.PROFIT };
    expect(parseReportJobId(ReportSchedulerService.jobId(key))).toEqual(key);
  });

  it('чужие идентификаторы пропускаются, а не ломают выдачу', () => {
    expect(parseReportJobId('repeat:abc123:1754000000000')).toBeNull();
    expect(parseReportJobId('report:999:222')).toBeNull();
    expect(parseReportJobId('report:999:222:profit:extra')).toBeNull();
    expect(parseReportJobId(undefined)).toBeNull();
  });
});

describe('Время из cron', () => {
  it('round-trip с toCron', () => {
    expect(cronToTime(toCron('9:30'))).toBe('09:30');
    expect(cronToTime(toCron('21:05'))).toBe('21:05');
    expect(cronToTime(toCron('0:00'))).toBe('00:00');
  });

  it('мусор и нестандартные выражения дают null, а не выдумку', () => {
    expect(cronToTime('*/5 * * * *')).toBeNull();
    expect(cronToTime('90 9 * * *')).toBeNull();
    expect(cronToTime('0 9 * * 1')).toBeNull();
    expect(cronToTime(undefined)).toBeNull();
  });
});

describe('Справочники', () => {
  it('список очередей — это QUEUE_NAMES, без второй копии', () => {
    expect([...QUEUE_LIST].sort()).toEqual(Object.values(QUEUE_NAMES).sort());
  });

  it('имя очереди и состояние проверяются по белому списку', () => {
    expect(isQueueName(QUEUE_NAMES.REPORTS)).toBe(true);
    expect(isQueueName('__proto__')).toBe(false);
    expect(isJobState('failed')).toBe(true);
    // paused у getJobs в Bull v4 ведёт себя иначе, наружу не отдаём.
    expect(isJobState('paused')).toBe(false);
    for (const state of JOB_STATES) expect(isJobState(state)).toBe(true);
  });

  it('название отчёта берётся из REPORT_DEFINITIONS, неизвестный ключ виден как есть', () => {
    expect(reportTitleOf(REPORT.PROFIT)).toBe('Прибыль');
    expect(reportTitleOf('deleted_report')).toBe('deleted_report');
  });
});
