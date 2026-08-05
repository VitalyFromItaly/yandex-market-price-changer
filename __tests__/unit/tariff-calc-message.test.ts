import { describe, it, expect } from 'vitest';

import type { ITariffCalcReport } from '../../src/modules/yandex/reports/profit.service';
import { formatRubles } from '../../src/modules/yandex/reports/money';
import { DEFAULT_RATES } from '../../src/modules/yandex/reports/profit';
import { formatTariffCalcReport } from '../../src/modules/yandex/reports/tariff-calc-message';

/** Расчёт на 10 000 ₽ продаж: услуги 2400, налог 700, закуп 5000 → чистая 1900. */
const TOTALS = {
  revenue: 10_000,
  subsidies: 1000,
  commission: 2400,
  tax: 700,
  promo: 0,
  purchase: 5000,
  net: 1900,
  orders: 5,
  excludedOrders: 0,
  excludedRevenue: 0,
  unknownSkus: [] as string[],
  returnedOrders: 0,
  returnedRevenue: 0,
  rates: DEFAULT_RATES,
};

const REPORT: ITariffCalcReport = {
  period: { key: 'month' },
  totalOrders: 5,
  totals: TOTALS,
  byService: { FEE: 1500, DELIVERY_TO_CUSTOMER: 600, MIDDLE_MILE: 300 },
  commissionPercent: 16,
  pricesUpdatedAt: new Date('2026-08-01T09:00:00Z'),
};

const withTotals = (patch: Partial<typeof TOTALS>, patchReport: Partial<ITariffCalcReport> = {}) =>
  formatTariffCalcReport({ ...REPORT, totals: { ...TOTALS, ...patch }, ...patchReport });

describe('Экран «Калькулятор Маркета»', () => {
  it('вся цепочка вычитаний и чистая — как в «Прибыли», но с услугами', () => {
    const text = formatTariffCalcReport(REPORT);

    expect(text).toContain(`Продажи: <b>${formatRubles(10_000)}</b>`);
    expect(text).toContain(`в т.ч. субсидии Маркета: <b>${formatRubles(1000)}</b>`);
    expect(text).toContain(`Услуги Маркета: <b>${formatRubles(2400)}</b> (≈24%)`);
    expect(text).toContain(`Налог 7%: <b>${formatRubles(700)}</b>`);
    expect(text).toContain(`Закуп: <b>${formatRubles(5000)}</b>`);
    expect(text).toContain(`Ожидается чистая: <b>${formatRubles(1900)}</b>`);
    // Плоской комиссии на этом экране нет — её место заняли услуги.
    expect(text).not.toContain('Комиссия 23%');
  });

  it('разбивка по услугам — по-русски и по убыванию суммы', () => {
    const lines = formatTariffCalcReport(REPORT)
      .split('\n')
      .filter((l) => l.includes('•'));

    expect(lines).toEqual([
      `   • Размещение на Маркете: ${formatRubles(1500)}`,
      `   • Доставка покупателю: ${formatRubles(600)}`,
      `   • Средняя миля: ${formatRubles(300)}`,
    ]);
  });

  it('неизвестный код услуги печатается как есть, а не прячется', () => {
    // Набор кодов на боевом бывает шире спеки — прецедент заявок FBY.
    expect(formatTariffCalcReport({ ...REPORT, byService: { NEW_SERVICE: 2400 } })).toContain(
      'NEW_SERVICE',
    );
  });

  it('сравнение со ставкой продавца названо и по сумме, и по направлению', () => {
    // Два экрана с разной чистой без этой строки читаются как «один врёт».
    const text = formatTariffCalcReport(REPORT);

    // 16 % от 10 000 = 1600, услуги 2400 → на 800 ₽ меньше, чистая в «Прибыли» выше.
    expect(text).toContain(`По вашей ставке 16% было бы <b>${formatRubles(1600)}</b>`);
    expect(text).toContain(`${formatRubles(800)}`);
    expect(text).toContain('меньше');
    expect(text).toContain('выше');
  });

  it('когда ставка ЗАВЫШЕНА, направление переворачивается', () => {
    const text = formatTariffCalcReport({ ...REPORT, commissionPercent: 40 });

    // 40 % от 10 000 = 4000 против услуг 2400 → услуг больше, чистая ниже.
    expect(text).toContain('больше услуг');
    expect(text).toContain('ниже');
  });

  it('исключённые заказы называют ОБЕ причины: закуп и категорию', () => {
    const text = withTotals({
      excludedOrders: 3,
      excludedRevenue: 7000,
      unknownSkus: ['A-1', 'B-2'],
    });

    expect(text).toContain('Не учтено заказов: <b>3</b>');
    expect(text).toContain(formatRubles(7000));
    expect(text).toContain('нет закупочной цены');
    expect(text).toContain('категории товара');
    expect(text).toContain('A-1');
  });

  it('возвраты названы отдельно — они исключены целиком', () => {
    const text = withTotals({ returnedOrders: 2, returnedRevenue: 3000 });

    expect(text).toContain('Возвраты: <b>2</b>');
    expect(text).toContain('исключены из расчёта целиком');
  });

  it('дата прайса и скидка печатаются так же, как в «Прибыли»', () => {
    const text = formatTariffCalcReport(REPORT);

    expect(text).toContain('01-08-2026');
    expect(text).toContain('минус 10%');
    // Легаси-фолбэк «Востока» виден и здесь: одно объяснение на два экрана.
    expect(text).toContain('Восток 4%');
  });

  it('без закупа в базе честно говорит об этом', () => {
    expect(formatTariffCalcReport({ ...REPORT, pricesUpdatedAt: null })).toContain(
      'Закупочных цен пока нет',
    );
  });

  it('ни одного посчитанного заказа — говорим прямо, а не печатаем нули', () => {
    const text = withTotals({
      orders: 0,
      revenue: 0,
      subsidies: 0,
      commission: 0,
      tax: 0,
      purchase: 0,
      net: 0,
      excludedOrders: 5,
      excludedRevenue: 12_000,
    });

    expect(text).toContain('Посчитать не удалось ни одного заказа');
    expect(text).not.toContain('Ожидается чистая');
    expect(text).toContain('Не учтено заказов: <b>5</b>');
  });

  it('пустой период — результат, а не сбой', () => {
    const text = formatTariffCalcReport({ ...REPORT, totalOrders: 0 });

    expect(text).toContain('заказов нет');
    expect(text).not.toContain('Услуги Маркета');
  });

  it('оговорка о примерности расчёта остаётся', () => {
    expect(formatTariffCalcReport(REPORT)).toContain('примерно');
  });
});
