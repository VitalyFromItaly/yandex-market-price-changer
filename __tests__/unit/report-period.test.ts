import { describe, it, expect } from 'vitest';
import {
  DEFAULT_PERIOD,
  PERIOD,
  SCHEDULE_PERIODS,
  assertPeriodSupported,
  creationDateParams,
  nextSchedulePeriod,
  parseDayInput,
  periodBounds,
  periodTitle,
  schedulePeriod,
  shipmentDateParams,
  updatedAtParams,
} from '../../src/modules/yandex/reports/report-period';
import { YandexDateRangeError } from '../../src/modules/yandex/yandex-date-window';

/**
 * Периоды — чистая календарная арифметика. Ошибка «на один день» здесь не
 * падает и не компилируется в ошибку: отчёт просто показывает не тот диапазон,
 * а расхождение с кабинетом продавец найдёт сам и в худший момент.
 *
 * Даты в тестах фиксированные — Date.now() сделал бы результат зависящим от
 * дня прогона, и тест «с 1 числа» краснел бы каждое первое число.
 */
describe('Границы периода', () => {
  // Четверг, 30 июля 2026, 12:00 МСК.
  const NOW = new Date('2026-07-30T12:00:00+03:00');

  it('сегодня — один день, начало равно концу', () => {
    const bounds = periodBounds({ key: PERIOD.TODAY }, NOW);
    expect(bounds.from).toMatchObject({ year: 2026, month: 7, day: 30 });
    expect(bounds.to).toMatchObject({ year: 2026, month: 7, day: 30 });
  });

  it('неделя начинается с ПОНЕДЕЛЬНИКА, а не с воскресенья', () => {
    // 30 июля 2026 — четверг, понедельник этой недели — 27-е.
    const bounds = periodBounds({ key: PERIOD.WEEK }, NOW);
    expect(bounds.from).toMatchObject({ year: 2026, month: 7, day: 27 });
    expect(bounds.to).toMatchObject({ year: 2026, month: 7, day: 30 });
  });

  it('в понедельник неделя начинается сегодня, а не неделю назад', () => {
    const monday = new Date('2026-07-27T09:00:00+03:00');
    expect(periodBounds({ key: PERIOD.WEEK }, monday).from).toMatchObject({
      year: 2026,
      month: 7,
      day: 27,
    });
  });

  it('в воскресенье неделя всё ещё начинается с прошедшего понедельника', () => {
    // Воскресенье 2 августа принадлежит неделе, начавшейся 27 июля.
    const sunday = new Date('2026-08-02T09:00:00+03:00');
    expect(periodBounds({ key: PERIOD.WEEK }, sunday).from).toMatchObject({
      year: 2026,
      month: 7,
      day: 27,
    });
  });

  it('месяц начинается с первого числа', () => {
    const bounds = periodBounds({ key: PERIOD.MONTH }, NOW);
    expect(bounds.from).toMatchObject({ year: 2026, month: 7, day: 1 });
  });

  it('неделя корректно переходит через границу месяца', () => {
    // Среда 1 июля 2026; понедельник той недели — 29 ИЮНЯ.
    const firstOfMonth = new Date('2026-07-01T09:00:00+03:00');
    expect(periodBounds({ key: PERIOD.WEEK }, firstOfMonth).from).toMatchObject({
      year: 2026,
      month: 6,
      day: 29,
    });
  });

  it('поздним вечером по Москве период всё ещё сегодняшний', () => {
    // 23:30 МСК — в UTC это уже следующие сутки. Считать по времени сервера
    // нельзя: продавец получил бы отчёт за завтра, то есть пустой.
    const lateEvening = new Date('2026-07-30T23:30:00+03:00');
    expect(periodBounds({ key: PERIOD.TODAY }, lateEvening).from).toMatchObject({
      year: 2026,
      month: 7,
      day: 30,
    });
  });
});

describe('Параметры Partner API', () => {
  const NOW = new Date('2026-07-30T12:00:00+03:00');

  it('supplierShipmentDate — DD-MM-YYYY', () => {
    expect(shipmentDateParams({ key: PERIOD.WEEK }, NOW)).toEqual({
      from: '27-07-2026',
      to: '30-07-2026',
    });
  });

  it('creationDate — верхняя граница на день вперёд: у Яндекса она исключающая', () => {
    // «Заказы, созданные ДО 00:00 указанного дня». Без сдвига период «с 1 числа
    // по сегодня» молча терял бы СЕГОДНЯШНИЕ заказы — те самые, ради которых
    // продавец открывает отчёт.
    expect(creationDateParams({ key: PERIOD.MONTH }, NOW)).toEqual({
      from: '01-07-2026',
      to: '31-07-2026',
    });
  });

  it('creationDate за сегодня — это ровно сегодняшние сутки', () => {
    expect(creationDateParams({ key: PERIOD.TODAY }, NOW)).toEqual({
      from: '30-07-2026',
      to: '31-07-2026',
    });
  });

  it('creationDate на границе месяца переносит и месяц, и год', () => {
    // Сдвиг календарной датой, а не миллисекундами: 31-12 + 1 день должно
    // давать 01-01 следующего года, а не «32-12».
    const lastDay = new Date('2026-12-31T12:00:00+03:00');
    expect(creationDateParams({ key: PERIOD.TODAY }, lastDay)).toEqual({
      from: '31-12-2026',
      to: '01-01-2027',
    });
  });

  it('updatedAt — ISO СО СМЕЩЕНИЕМ, иначе Яндекс сдвинет отчёт на три часа', () => {
    const range = updatedAtParams({ key: PERIOD.TODAY }, NOW);
    expect(range.from).toBe('2026-07-30T00:00:00+03:00');
    expect(range.to).toBe('2026-07-30T23:59:59+03:00');
  });

  it('диапазон покрывает сутки целиком: с 00:00:00 по 23:59:59', () => {
    const range = updatedAtParams({ key: PERIOD.MONTH }, NOW);
    expect(range.from).toBe('2026-07-01T00:00:00+03:00');
    expect(range.to).toBe('2026-07-30T23:59:59+03:00');
  });
});

describe('Окно истории Яндекса', () => {
  const NOW = new Date('2026-07-30T12:00:00+03:00');

  it('сегодня, неделя и месяц проходят', () => {
    for (const key of [PERIOD.TODAY, PERIOD.WEEK, PERIOD.MONTH]) {
      expect(() => assertPeriodSupported({ key }, NOW)).not.toThrow();
    }
  });

  it('«с 1 числа» 31-го числа — ровно 30 дней, проходит', () => {
    // Граничный случай: длиннее месяца период стать не может, но 31-го числа
    // он упирается в лимит вплотную.
    const lastDay = new Date('2026-07-31T12:00:00+03:00');
    expect(() => assertPeriodSupported({ key: PERIOD.MONTH }, lastDay)).not.toThrow();
  });

  it('день старше 30 дней отклоняется ДО запроса', () => {
    // Отклоняем сами, не тратя квоту: Яндекс всё равно вернул бы пустоту, и
    // это выглядело бы как «в тот день заказов не было».
    const old = { key: PERIOD.DAY, day: { year: 2026, month: 1, day: 5 } };
    expect(() => assertPeriodSupported(old, NOW)).toThrow(YandexDateRangeError);
  });

  it('в тексте отказа названа причина, а не код ошибки', () => {
    const old = { key: PERIOD.DAY, day: { year: 2026, month: 1, day: 5 } };
    try {
      assertPeriodSupported(old, NOW);
      expect.unreachable();
    } catch (error) {
      expect((error as YandexDateRangeError).userMessage).toContain('30 дней');
    }
  });
});

describe('Разбор даты от пользователя', () => {
  it('принимает и дефис, и точку', () => {
    const expected = { year: 2026, month: 7, day: 28 };
    expect(parseDayInput('28-07-2026')).toEqual(expected);
    expect(parseDayInput('28.07.2026')).toEqual(expected);
    expect(parseDayInput(' 28.07.2026 ')).toEqual(expected);
  });

  it('принимает однозначные день и месяц', () => {
    expect(parseDayInput('5.7.2026')).toEqual({ year: 2026, month: 7, day: 5 });
  });

  it('несуществующую дату отвергает, а не переносит на другой день', () => {
    // Date молча превратил бы 31 февраля в 3 марта, и отчёт пришёл бы не за
    // тот день, о котором просили.
    expect(parseDayInput('31-02-2026')).toBeNull();
    expect(parseDayInput('32-01-2026')).toBeNull();
    expect(parseDayInput('01-13-2026')).toBeNull();
  });

  it('мусор не разбирается', () => {
    for (const text of ['вчера', '2026-07-28', '28/07', '', 'ACMA:token']) {
      expect(parseDayInput(text)).toBeNull();
    }
  });
});

describe('Заголовок отчёта', () => {
  const NOW = new Date('2026-07-30T12:00:00+03:00');

  it('для диапазона печатает ОБЕ границы', () => {
    // Без дат продавцу пришлось бы считать в уме, с какого числа шёл подсчёт,
    // а именно эти числа он потом сверяет с кабинетом.
    expect(periodTitle({ key: PERIOD.WEEK }, NOW)).toBe('с начала недели, 27-07-2026 — 30-07-2026');
  });

  it('для одного дня печатает сам день', () => {
    expect(periodTitle({ key: PERIOD.DAY, day: { year: 2026, month: 7, day: 28 } }, NOW)).toBe(
      'за 28-07-2026',
    );
  });

  it('сегодня названо словом и датой', () => {
    expect(periodTitle(DEFAULT_PERIOD, NOW)).toBe('за сегодня, 30-07-2026');
  });
});

describe('Период рассылки', () => {
  it('конкретного дня в рассылке нет — он не повторяем', () => {
    // В ежедневной задаче фиксированная дата означала бы отчёт, который завтра
    // пришлёт ровно те же числа, что сегодня.
    expect(SCHEDULE_PERIODS).not.toContain(PERIOD.DAY);
  });

  it('неизвестное значение из базы схлопывается в «сегодня», а не роняет отчёт', () => {
    expect(schedulePeriod(undefined)).toBe(PERIOD.TODAY);
    expect(schedulePeriod('day')).toBe(PERIOD.TODAY);
    expect(schedulePeriod('мусор')).toBe(PERIOD.TODAY);
    expect(schedulePeriod('week')).toBe(PERIOD.WEEK);
  });

  it('перебор идёт по кругу и возвращается к началу', () => {
    let period = PERIOD.TODAY;
    const seen = [period];
    for (let i = 0; i < SCHEDULE_PERIODS.length; i += 1) {
      period = nextSchedulePeriod(period);
      seen.push(period);
    }
    expect(seen.at(-1)).toBe(PERIOD.TODAY);
    expect(new Set(seen).size).toBe(SCHEDULE_PERIODS.length);
  });
});
