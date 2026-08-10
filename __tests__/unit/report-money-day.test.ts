import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  DEPRECATED_MONEY_FIELDS,
  NBSP,
  ZERO_TOTALS,
  addTotals,
  amountValue,
  formatRubles,
  orderTotals,
  subsidiesTotal,
  sumTotals,
  type IMoneyTotals,
} from '../../src/modules/yandex/reports/money';
import {
  moscowClock,
  moscowDateParam,
  moscowDayBounds,
  moscowDayStart,
  moscowOffset,
  moscowStamp,
} from '../../src/modules/yandex/reports/moscow-day';

/**
 * Денежная арифметика — то место, где ошибка не видна: отчёт приходит, числа
 * правдоподобные, и расхождение с личным кабинетом замечают через недели.
 */
describe('Денежные суммы', () => {
  it('берутся itemsTotal и deliveryTotal', () => {
    expect(orderTotals({ itemsTotal: 1000, deliveryTotal: 250 })).toEqual({
      sales: 1000,
      subsidies: 0,
      withDelivery: 1250,
    });
  });

  it('заказ без доставки не теряет сумму товаров', () => {
    expect(orderTotals({ itemsTotal: 500 })).toEqual({
      sales: 500,
      subsidies: 0,
      withDelivery: 500,
    });
  });

  it('отсутствующие и битые значения дают 0, а не NaN', () => {
    // NaN протёк бы через все сложения и превратил итог отчёта в «NaN ₽».
    expect(orderTotals({})).toEqual({ sales: 0, subsidies: 0, withDelivery: 0 });
    expect(orderTotals({ itemsTotal: undefined, deliveryTotal: null as never })).toEqual({
      sales: 0,
      subsidies: 0,
      withDelivery: 0,
    });
    expect(orderTotals({ itemsTotal: 'нет' as never })).toEqual({
      sales: 0,
      subsidies: 0,
      withDelivery: 0,
    });
  });

  it('устаревшие поля игнорируются, даже если они есть в ответе', () => {
    // total и buyerTotal приходят вместе с актуальными и выглядят так же —
    // взять их вместо itemsTotal очень легко. subsidyTotal здесь особенно
    // коварен: он устаревший, но по имени просится в новое поле subsidies.
    const order = {
      itemsTotal: 100,
      deliveryTotal: 50,
      total: 9999,
      buyerTotal: 8888,
      subsidyTotal: 777,
    } as never;

    expect(orderTotals(order)).toEqual({ sales: 100, subsidies: 0, withDelivery: 150 });
  });

  /**
   * ПРОДАЖА ПРОДАВЦА = платёж покупателя + субсидии Маркета. Скидку по акции
   * даёт Маркет, а продавцу компенсирует, поэтому отчёты показывают именно эту
   * сумму, а не то, что заплатил покупатель. DELIVERY исключается — это
   * вознаграждение за доставку, а не за товар.
   */
  it('субсидии входят в продажу и видны отдельной величиной', () => {
    expect(
      orderTotals({
        itemsTotal: 10000,
        deliveryTotal: 500,
        subsidies: [
          { type: 'SUBSIDY', amount: 1500 },
          { type: 'YANDEX_CASHBACK', amount: 500 },
          { type: 'DELIVERY', amount: 900 },
        ],
      }),
    ).toEqual({ sales: 12000, subsidies: 2000, withDelivery: 12500 });
  });

  /**
   * Отдельного поля «платёж покупателя» в IMoneyTotals нет намеренно: два
   * похожих числа рядом — та же ловушка, что total vs itemsTotal. Оно
   * восстанавливается вычитанием, и это должно оставаться правдой.
   */
  it('платёж покупателя восстанавливается как sales − subsidies', () => {
    for (const order of [
      { itemsTotal: 1000, subsidies: [{ type: 'SUBSIDY', amount: 200 }] },
      { itemsTotal: 0, subsidies: [{ type: 'YANDEX_CASHBACK', amount: 50 }] },
      { itemsTotal: 777, deliveryTotal: 23 },
      {},
    ]) {
      const totals = orderTotals(order);
      expect(totals.sales - totals.subsidies).toBe(Number(order.itemsTotal) || 0);
    }
  });

  it('суммирование по списку', () => {
    expect(
      sumTotals([
        { itemsTotal: 100, deliveryTotal: 10 },
        { itemsTotal: 200, deliveryTotal: 20, subsidies: [{ type: 'SUBSIDY', amount: 30 }] },
        {},
      ]),
    ).toEqual({ sales: 330, subsidies: 30, withDelivery: 360 });
  });

  it('пустой список даёт нули, а не пустоту', () => {
    expect(sumTotals([])).toEqual({ sales: 0, subsidies: 0, withDelivery: 0 });
  });

  it('сумма с доставкой всегда не меньше суммы продаж', () => {
    // Инвариант отчёта: обратное означало бы ошибку знака или порядка полей.
    for (const order of [
      { itemsTotal: 100, deliveryTotal: 0 },
      { itemsTotal: 0, deliveryTotal: 300 },
      { itemsTotal: 1000, deliveryTotal: 1 },
      { itemsTotal: 1000, subsidies: [{ type: 'SUBSIDY', amount: 100 }] },
      {},
    ]) {
      const totals = orderTotals(order);
      expect(totals.withDelivery).toBeGreaterThanOrEqual(totals.sales);
    }
  });

  it('addTotals складывает все величины', () => {
    expect(
      addTotals(
        { sales: 1, subsidies: 3, withDelivery: 2 },
        { sales: 10, subsidies: 30, withDelivery: 20 },
      ),
    ).toEqual({ sales: 11, subsidies: 33, withDelivery: 22 });
  });

  /**
   * Дрейф-гард: новое поле в IMoneyTotals нельзя забыть в сумматоре. Забытое
   * слагаемое не падает — оно молча занижает итог отчёта, то есть ошибка ровно
   * того класса, ради которого написан весь модуль.
   */
  it('addTotals складывает КАЖДОЕ поле итогов, а не перечисленные руками', () => {
    const keys = Object.keys(ZERO_TOTALS);
    const one = Object.fromEntries(keys.map((key, i) => [key, i + 1])) as IMoneyTotals;
    const sum = addTotals(one, one) as unknown as Record<string, number>;

    expect(keys.length).toBeGreaterThan(0);
    for (const key of keys) {
      expect(sum[key]).toBe((one as unknown as Record<string, number>)[key] * 2);
    }
  });

  it('сумма возврата берётся из объекта amount', () => {
    expect(amountValue({ value: 2500 })).toBe(2500);
    expect(amountValue(undefined)).toBe(0);
    expect(amountValue({} as never)).toBe(0);
  });

  /**
   * Субсидии считаются по ЗАКАЗУ, а не по позициям: у позиции сумма указана НА
   * ЕДИНИЦУ товара. Проверено на боевом заказе #58841189889 — позиция с count 2
   * несла 276/565, а заказ 552/1130.
   */
  it('субсидии заказа складываются, доставочная исключается', () => {
    expect(
      subsidiesTotal({
        subsidies: [
          { type: 'SUBSIDY', amount: 1130 },
          { type: 'YANDEX_CASHBACK', amount: 552 },
          { type: 'DELIVERY', amount: 300 },
        ],
      }),
    ).toBe(1682);
  });

  it('нет субсидий — ноль, а не NaN', () => {
    expect(subsidiesTotal({})).toBe(0);
    expect(subsidiesTotal({ subsidies: [] })).toBe(0);
    expect(subsidiesTotal({ subsidies: [{ type: 'SUBSIDY' }] })).toBe(0);
    expect(subsidiesTotal(undefined as never)).toBe(0);
  });
});

describe('Скрытых надбавок и коэффициентов нет (TASK-032)', () => {
  // Самые дорогие дефекты старого кода жили именно здесь: наценка «+5 ₽»
  // применялась только на ОДНОМ из двух путей обновления, а коэффициент по
  // умолчанию был 2 вместо 1.2 — то есть цена молча удваивалась. Отчёты
  // обязаны отдавать ровно то, что вернул Яндекс.
  // Заказы здесь без субсидий: проверяется, что к пришедшей сумме ничего не
  // прибавляется САМО, а субсидия — не надбавка, а второе слагаемое из ответа.
  it('сумма равна тому, что пришло, — байт в байт', () => {
    expect(orderTotals({ itemsTotal: 1000, deliveryTotal: 0 }).sales).toBe(1000);
    expect(orderTotals({ itemsTotal: 1, deliveryTotal: 0 }).sales).toBe(1);
    expect(orderTotals({ itemsTotal: 0, deliveryTotal: 0 }).sales).toBe(0);
  });

  it('к сумме не прибавляется фиксированная надбавка', () => {
    // «+5 ₽» проявился бы как расхождение на маленьких суммах.
    for (const value of [1, 5, 10, 100]) {
      expect(orderTotals({ itemsTotal: value }).sales).toBe(value);
      expect(orderTotals({ itemsTotal: value }).withDelivery).toBe(value);
    }
  });

  it('сумма не умножается на коэффициент', () => {
    // Удвоение проявилось бы уже на первом заказе.
    const totals = sumTotals([{ itemsTotal: 777, deliveryTotal: 23 }]);
    expect(totals.sales).toBe(777);
    expect(totals.withDelivery).toBe(800);
  });

  it('сумма списка равна сумме слагаемых, без округлений по дороге', () => {
    const orders = [
      { itemsTotal: 100.5, deliveryTotal: 0 },
      { itemsTotal: 200.25, deliveryTotal: 0 },
    ];
    expect(sumTotals(orders).sales).toBeCloseTo(300.75, 10);
  });
});

describe('Формат рублей', () => {
  it('копейки округляются', () => {
    expect(formatRubles(12345.67)).toContain('12');
    expect(formatRubles(12345.67)).not.toContain(',');
  });

  it('ноль выводится как ноль, а не как пустая строка', () => {
    expect(formatRubles(0)).toBe(`0${NBSP}₽`);
  });

  it('разряды разделяются НЕРАЗРЫВНЫМ пробелом', () => {
    // Обычный пробел Telegram переносит по строке, и «1 234 567 ₽»
    // разваливается посреди числа.
    const formatted = formatRubles(1234567);
    expect(formatted).toBe(`1${NBSP}234${NBSP}567${NBSP}₽`);
    // Обычных пробелов не должно быть ни одного.
    expect(formatted).not.toMatch(/\u0020/);
  });

  it('битое значение не даёт NaN в сообщении', () => {
    expect(formatRubles(NaN)).toBe(`0${NBSP}₽`);
    expect(formatRubles(undefined as never)).toBe(`0${NBSP}₽`);
  });
});

describe('Московские сутки', () => {
  it('дата берётся по Москве, а не по времени сервера', () => {
    // 29 июля 22:30 UTC — это уже 30 июля в Москве. Сервер в UTC сказал бы
    // «29-е», и продавец получил бы отчёт за вчера.
    const late = new Date('2026-07-29T22:30:00Z');
    expect(moscowDateParam(late)).toBe('30-07-2026');
  });

  it('в начале суток по UTC московская дата та же', () => {
    expect(moscowDateParam(new Date('2026-07-29T05:00:00Z'))).toBe('29-07-2026');
  });

  it('формат даты — DD-MM-YYYY с ведущими нулями', () => {
    expect(moscowDateParam(new Date('2026-01-02T10:00:00Z'))).toBe('02-01-2026');
  });

  it('время тоже московское, а не серверное', () => {
    // 06:12 UTC — это 09:12 в Москве. getHours() в контейнере вернул бы шесть,
    // и подпись «на 06:12 МСК» разошлась бы с реальностью на три часа.
    expect(moscowClock(new Date('2026-07-31T06:12:00Z'))).toBe('09:12');
  });

  it('полночь печатается как 00:00, а не как 24:00', () => {
    expect(moscowClock(new Date('2026-07-30T21:00:00Z'))).toBe('00:00');
  });

  it('момент съёмки — дата и время вместе', () => {
    // 23:30 МСК: сутки ещё сегодняшние, и дата не должна убежать вперёд.
    expect(moscowStamp(new Date('2026-07-31T20:30:00Z'))).toBe('31-07-2026 23:30');
    expect(moscowStamp(new Date('2026-07-31T06:12:00Z'))).toBe('31-07-2026 09:12');
  });

  it('границы суток — ISO со смещением, иначе Яндекс сдвинет отчёт на три часа', () => {
    const bounds = moscowDayBounds(new Date('2026-07-29T10:00:00Z'));

    expect(bounds.from).toBe('2026-07-29T00:00:00+03:00');
    expect(bounds.to).toBe('2026-07-29T23:59:59+03:00');
    expect(bounds.from).toMatch(/[+-]\d{2}:\d{2}$/);
  });

  it('границы суток соответствуют московской, а не серверной полуночи', () => {
    const late = new Date('2026-07-29T22:30:00Z');
    expect(moscowDayBounds(late).from).toBe('2026-07-30T00:00:00+03:00');
  });

  it('смещение берётся у Intl, а не зашито числом', () => {
    // Зашитая константа — мина, которая срабатывает через годы.
    expect(moscowOffset(new Date('2026-01-15T00:00:00Z'))).toBe('+03:00');
    expect(moscowOffset(new Date('2026-07-15T00:00:00Z'))).toBe('+03:00');
  });

  it('расчёт НЕ зависит от часового пояса сервера', () => {
    // Приложение живёт в контейнере с UTC, разработчик — в своём поясе, а
    // продавец ждёт московские сутки. Методы локального времени (getFullYear,
    // getHours и прочие) дали бы три разных ответа на трёх машинах — поэтому в
    // moscow-day.ts их не должно быть вовсе, там только Intl с явным поясом.
    const source = readFileSync(
      resolve(__dirname, '../../src/modules/yandex/reports/moscow-day.ts'),
      'utf8',
    );

    for (const method of [
      'getFullYear',
      'getMonth',
      'getDate',
      'getHours',
      'getMinutes',
      'getTimezoneOffset',
    ]) {
      expect(source).not.toContain(`.${method}(`);
    }
    expect(source).toContain('Europe/Moscow');
  });

  it('одинаковый ответ при разных TZ процесса', () => {
    // Явная проверка того же самого: подменяем пояс процесса и убеждаемся, что
    // граница суток не поехала.
    const moment = new Date('2026-07-29T22:30:00Z');
    const original = process.env.TZ;

    const results: string[] = [];
    for (const tz of ['UTC', 'America/New_York', 'Asia/Vladivostok']) {
      process.env.TZ = tz;
      results.push(moscowDayBounds(moment).from);
    }
    process.env.TZ = original;

    expect(new Set(results).size).toBe(1);
    expect(results[0]).toBe('2026-07-30T00:00:00+03:00');
  });

  it('начало суток разбирается обратно в корректный момент', () => {
    const start = moscowDayStart(new Date('2026-07-29T10:00:00Z'));
    expect(start.toISOString()).toBe('2026-07-28T21:00:00.000Z');
  });
});

describe('Устаревшие денежные поля не читаются в коде', () => {
  const SRC = resolve(__dirname, '../../src/modules/yandex');

  function tsFiles(dir: string): string[] {
    if (dir.includes('/api')) return [];
    return readdirSync(dir).flatMap((entry) => {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) return tsFiles(full);
      return full.endsWith('.ts') ? [full] : [];
    });
  }

  it('ни одно из устаревших полей не используется', () => {
    const MAP = join(SRC, 'reports', 'money.ts');
    const offenders: string[] = [];

    for (const file of tsFiles(SRC)) {
      // В money.ts они перечислены намеренно — как список запрещённого.
      if (file === MAP) continue;
      readFileSync(file, 'utf8')
        .split('\n')
        .forEach((line, index) => {
          const t = line.trimStart();
          if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) return;
          for (const field of DEPRECATED_MONEY_FIELDS) {
            // Ищем ОБРАЩЕНИЕ К ПОЛЮ (`order.total`, `total:`, `total?:`), а не
            // любое вхождение слова: «total» встречается в обычном тексте —
            // например, в логе «(15 total)» — и голый \b даёт ложные
            // срабатывания, из-за которых инвариант приходится отключать.
            const asProperty = new RegExp(`\\.${field}\\b|\\b${field}\\s*\\??\\s*:`);
            if (asProperty.test(line)) {
              offenders.push(`${file.slice(SRC.length + 1)}:${index + 1} — ${field}`);
            }
          }
        });
    }

    expect(offenders).toEqual([]);
  });
});
