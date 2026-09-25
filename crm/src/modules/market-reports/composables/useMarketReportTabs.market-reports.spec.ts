import { describe, expect, it } from 'vitest';

import { openMarketReports } from './useMarketReportTabs.market-reports';

describe('openMarketReports', () => {
  it('вкладки — ровно отчёты, которые сервер открыл магазину (turn у FBS уже скрыт)', () => {
    const tabs = openMarketReports([
      { key: 'real', label: 'Реализация (помесячно)', hourlyLimit: null },
      { key: 'comp', label: 'Конкурентная позиция', hourlyLimit: 10 },
    ]);
    expect(tabs.map((tab) => tab.key)).toEqual(['real', 'comp']);
  });

  it('пока варианты не загружены — вкладок нет, а не «все подряд»', () => {
    expect(openMarketReports(undefined)).toEqual([]);
  });
});
