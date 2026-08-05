import { describe, it, expect } from 'vitest';

import type { ITariffCalcReport } from '../../src/modules/yandex/reports/profit.service';
import { formatRubles } from '../../src/modules/yandex/reports/money';
import { formatTariffCalcReport } from '../../src/modules/yandex/reports/tariff-calc-message';

const REPORT: ITariffCalcReport = {
  period: { key: 'month' },
  ordersCount: 5,
  revenue: 10_000,
  commissionPercent: 16,
  estimate: {
    scope: 'placed',
    servicesTotal: 2400,
    byService: { FEE: 1500, DELIVERY_TO_CUSTOMER: 600, MIDDLE_MILE: 300 },
    coveredOrders: 5,
    totalOrders: 5,
    coveredRevenue: 10_000,
  },
};

describe('Экран «Калькулятор Маркета»', () => {
  it('сумма услуг, процент и строка сравнения с плоской ставкой', () => {
    const text = formatTariffCalcReport(REPORT);

    expect(text).toContain('Калькулятор Маркета');
    expect(text).toContain(`Оформлено: <b>5</b> на <b>${formatRubles(10_000)}</b>`);
    expect(text).toContain(`Услуги Маркета: <b>${formatRubles(2400)}</b> (≈24%)`);
    // Сравнение — по той же базе, что сумма услуг (выручка покрытых заказов).
    expect(text).toContain(`Комиссия по вашей ставке 16%: <b>${formatRubles(1600)}</b>`);
    expect(text).toContain('Расчёт примерный');
  });

  it('разбивка по услугам — по-русски и по убыванию суммы', () => {
    const text = formatTariffCalcReport(REPORT);
    const lines = text.split('\n').filter((l) => l.includes('•'));

    expect(lines).toEqual([
      `   • Размещение на Маркете: ${formatRubles(1500)}`,
      `   • Доставка покупателю: ${formatRubles(600)}`,
      `   • Средняя миля: ${formatRubles(300)}`,
    ]);
  });

  it('неизвестный код услуги печатается как есть, а не прячется', () => {
    // Набор кодов на боевом бывает шире спеки — прецедент заявок FBY.
    const text = formatTariffCalcReport({
      ...REPORT,
      estimate: { ...REPORT.estimate, byService: { NEW_SERVICE: 2400 } },
    });

    expect(text).toContain('NEW_SERVICE');
  });

  it('частичное покрытие названо счётчиком и причиной', () => {
    const text = formatTariffCalcReport({
      ...REPORT,
      estimate: { ...REPORT.estimate, coveredOrders: 3, totalOrders: 5 },
    });

    expect(text).toContain('Посчитано 3 из 5 заказов');
    expect(text).toContain('нет категории');
  });

  it('ни одного покрытого заказа — причина вместо нуля', () => {
    // «Услуги: 0 ₽» читалось бы как «Маркет бесплатный».
    const text = formatTariffCalcReport({
      ...REPORT,
      estimate: {
        ...REPORT.estimate,
        coveredOrders: 0,
        servicesTotal: 0,
        coveredRevenue: 0,
        byService: {},
      },
    });

    expect(text).toContain('Посчитать услуги не удалось');
    expect(text).not.toContain('Услуги Маркета:');
  });

  it('пустой период — результат, а не сбой', () => {
    const text = formatTariffCalcReport({ ...REPORT, ordersCount: 0 });
    expect(text).toContain('заказов нет');
    expect(text).not.toContain('Услуги');
  });
});
