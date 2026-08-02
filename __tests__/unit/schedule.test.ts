import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import {
  DEFAULT_SCHEDULE_TIME,
  parseScheduleTime,
  toCron,
} from '../../src/modules/yandex/reports/schedule-time';
import { ReportScheduleService } from '../../src/database/services/report-schedule.service';
import { ReportSchedule } from '../../src/database/schemas/report-schedule.schema';

describe('Разбор времени рассылки', () => {
  it.each([
    ['09:00', '09:00'],
    ['9:00', '09:00'],
    ['9', '09:00'],
    ['21:30', '21:30'],
    ['21.30', '21:30'],
    ['21-30', '21:30'],
    ['  7 05  ', '07:05'],
    ['00:00', '00:00'],
    ['23:59', '23:59'],
  ])('«%s» нормализуется в «%s»', (input, expected) => {
    // Пользователи пишут время как придётся. Отказывать на каждом отклонении —
    // верный способ, чтобы рассылку не включил никто.
    const result = parseScheduleTime(input);
    expect(result.ok).toBe(true);
    expect(result.time.value).toBe(expected);
  });

  it.each(['24:00', '25:00', '99'])('часы вне суток отвергаются: %s', (input) => {
    const result = parseScheduleTime(input);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('Часы');
  });

  it.each(['09:60', '10:99'])('минуты вне часа отвергаются: %s', (input) => {
    const result = parseScheduleTime(input);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('Минуты');
  });

  it.each(['', '   ', 'утром', '9:00 утра', 'abc', '9:0:0', '-1'])(
    'мусор отвергается с понятным текстом: %o',
    (input) => {
      const result = parseScheduleTime(input);
      expect(result.ok).toBe(false);
      expect(result.error.length).toBeGreaterThan(10);
      expect(result.error).not.toContain('undefined');
    },
  );

  it('в тексте ошибки видно, что именно прислал пользователь', () => {
    expect(parseScheduleTime('утром').error).toContain('утром');
  });
});

describe('Перевод в cron', () => {
  it('порядок полей — минуты, затем часы', () => {
    // Перепутанные местами поля дали бы рассылку в 0 минут 21-го часа вместо
    // 21:30 — правдоподобно и незаметно.
    expect(toCron('21:30')).toBe('30 21 * * *');
    expect(toCron('09:05')).toBe('5 9 * * *');
    expect(toCron('00:00')).toBe('0 0 * * *');
  });

  it('некорректное время до cron не доходит', () => {
    expect(() => toCron('99:99')).toThrow(/Некорректное время/);
  });
});

describe('ReportScheduleService', () => {
  let findOneAndUpdate: ReturnType<typeof vi.fn>;
  let find: ReturnType<typeof vi.fn>;
  let deleteMany: ReturnType<typeof vi.fn>;
  let service: ReportScheduleService;

  const KEY = { telegramUserId: '222', botId: '999', reportKey: 'redeemed' };
  const exec = <T>(v: T) => ({ exec: async () => v });

  beforeEach(async () => {
    findOneAndUpdate = vi.fn(() => exec({ ...KEY, enabled: false, time: '09:00' }));
    find = vi.fn(() => exec([]));
    deleteMany = vi.fn(() => exec({ deletedCount: 3 }));

    const moduleRef = await Test.createTestingModule({
      providers: [
        ReportScheduleService,
        {
          provide: getModelToken(ReportSchedule.name),
          useValue: { findOneAndUpdate, find, deleteMany, findOne: () => exec(null) },
        },
      ],
    }).compile();

    service = moduleRef.get(ReportScheduleService);
  });

  it('некорректное время НЕ сохраняется', async () => {
    const result = await service.setTime(KEY, '99:99');

    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
    expect(findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('корректное время сохраняется нормализованным', async () => {
    await service.setTime(KEY, '9');

    expect(findOneAndUpdate.mock.calls[0][1].$set).toEqual({ time: '09:00' });
  });

  it('задание времени НЕ включает рассылку само по себе', async () => {
    // Бот не должен начинать писать сам, пока его об этом явно не попросили.
    await service.setTime(KEY, '09:00');

    expect(findOneAndUpdate.mock.calls[0][1].$setOnInsert).toEqual({ enabled: false });
  });

  it('включение задаёт время по умолчанию, если его не задавали', async () => {
    await service.setEnabled(KEY, true);

    expect(findOneAndUpdate.mock.calls[0][1].$set).toEqual({ enabled: true });
    expect(findOneAndUpdate.mock.calls[0][1].$setOnInsert).toEqual({
      time: DEFAULT_SCHEDULE_TIME,
    });
  });

  it('выключение не стирает заданное время', async () => {
    await service.setEnabled(KEY, false);

    expect(findOneAndUpdate.mock.calls[0][1].$set).toEqual({ enabled: false });
    expect(findOneAndUpdate.mock.calls[0][1].$set).not.toHaveProperty('time');
  });

  it('все запросы скоупятся по пользователю', async () => {
    // Мультитенантность: чужое расписание не должно быть видно даже случайно.
    await service.setTime(KEY, '10:00');
    await service.setEnabled(KEY, true);

    for (const call of findOneAndUpdate.mock.calls) {
      expect(call[0]).toMatchObject({ telegramUserId: '222', botId: '999' });
    }

    await service.listForUser('222', '999');
    expect(find.mock.calls[0][0]).toMatchObject({ telegramUserId: '222' });
  });

  it('сверка при старте берёт только включённые', async () => {
    await service.listEnabled();
    expect(find.mock.calls[0][0]).toEqual({ enabled: true });
  });

  it('deleteForUser сносит расписания по паре (пользователь × бот)', async () => {
    // Ключ — пара с botId, как у записи доступа: у одного telegramUserId в
    // разных ботах свои расписания, чужие трогать нельзя.
    const removed = await service.deleteForUser('222', '999');

    expect(deleteMany).toHaveBeenCalledWith({ telegramUserId: '222', botId: '999' });
    expect(removed).toBe(3);
  });
});
