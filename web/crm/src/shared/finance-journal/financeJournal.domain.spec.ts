import { describe, expect, it } from 'vitest';

import {
  checkedAtText,
  cooldownText,
  coverageOf,
  missingTitle,
  monthsOfRange,
  pullDone,
  rangeOfReportPeriod,
  refreshableOf,
} from './financeJournal.domain';

const month = (
  m: string,
  loaded: boolean,
  checkedAt: string | null = null,
  error: string | null = null,
) => ({
  month: m,
  loaded,
  checkedAt,
  error,
});

describe('журнал за период экрана', () => {
  it('месяцы периода — от свежего, через границу года', () => {
    expect(monthsOfRange('2026-10-14', '2026-10-20')).toEqual(['2026-10']);
    expect(monthsOfRange('2025-12-20', '2026-02-03')).toEqual(['2026-02', '2026-01', '2025-12']);
  });

  it('незагруженный месяц — missing, даже если первая загрузка завела строку со статусом', () => {
    const months = [
      month('2026-10', false, '2026-10-20T01:00:00Z', 'Маркет не ответил'),
      month('2026-09', true, '2026-10-20T01:05:00Z'),
    ];
    expect(coverageOf(months, ['2026-10', '2026-09'])).toEqual({
      missing: ['2026-10'],
      failed: [{ month: '2026-10', error: 'Маркет не ответил' }],
      checkedAt: '2026-10-20T01:05:00Z',
    });
  });

  it('месяц старше списка не судим: ни загрузить, ни сказать', () => {
    expect(
      coverageOf([month('2026-10', true, '2026-10-20T01:00:00Z')], ['2026-10', '2024-01']),
    ).toEqual({
      missing: [],
      failed: [],
      checkedAt: '2026-10-20T01:00:00Z',
    });
  });

  it('«Обновить» трогает только текущий и прошлый месяц', () => {
    const recent = ['2026-10', '2026-09', '2026-08'];
    expect(refreshableOf(['2026-10', '2026-09', '2026-08'], recent)).toEqual([
      '2026-10',
      '2026-09',
    ]);
    expect(refreshableOf(['2026-08'], recent)).toEqual([]);
  });

  it('загрузка закончилась, когда checkedAt каждого поставленного месяца сменился', () => {
    const before = { '2026-10': null, '2026-09': '2026-10-20T01:00:00Z' };
    expect(
      pullDone(before, [
        month('2026-10', true, 'a'),
        month('2026-09', true, '2026-10-20T01:00:00Z'),
      ]),
    ).toBe(false);
    expect(
      pullDone(before, [month('2026-10', false, 'a', 'сбой'), month('2026-09', true, 'b')]),
    ).toBe(true);
    expect(pullDone(before, [])).toBe(false);
  });

  it('тексты: месяцы по-русски, время по Москве', () => {
    expect(missingTitle(['2026-10'])).toBe(
      'Журнал за октябрь 2026 не загружен — считать не из чего',
    );
    expect(missingTitle(['2026-10', '2026-09'])).toBe(
      'Журнал за сентябрь 2026, октябрь 2026 не загружен — считать не из чего',
    );
    const now = new Date('2026-10-20T15:00:00+03:00');
    expect(checkedAtText('2026-10-20T04:12:00+03:00', now)).toBe('Журнал обновлён в 04:12');
    expect(checkedAtText('2026-10-19T04:12:00+03:00', now)).toBe(
      'Журнал обновлён 19-10-2026 04:12',
    );
    expect(
      cooldownText([{ month: '2026-10', checkedAt: '', until: '2026-10-20T15:10:00+03:00' }], now),
    ).toBe('Этот месяц уже загружали только что — повторить можно после 15:10.');
  });

  it('периоды бота — в даты по Москве', () => {
    const today = '2026-10-22'; // четверг
    expect(rangeOfReportPeriod({ key: 'today', day: null }, today)).toEqual({
      from: today,
      to: today,
    });
    expect(rangeOfReportPeriod({ key: 'day', day: '03-09-2026' }, today)).toEqual({
      from: '2026-09-03',
      to: '2026-09-03',
    });
    expect(rangeOfReportPeriod({ key: 'week', day: null }, today)).toEqual({
      from: '2026-10-19',
      to: today,
    });
    expect(rangeOfReportPeriod({ key: 'month', day: null }, today)).toEqual({
      from: '2026-10-01',
      to: today,
    });
    expect(rangeOfReportPeriod({ key: 'prevmonth', day: null }, today)).toEqual({
      from: '2026-09-01',
      to: '2026-09-30',
    });
    expect(rangeOfReportPeriod({ key: 'all', day: null }, today)).toEqual({
      from: '2026-09-22',
      to: today,
    });
  });
});
