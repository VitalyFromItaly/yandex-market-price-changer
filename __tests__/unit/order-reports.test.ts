import { describe, it, expect, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import { OrderReportsService } from '../../src/modules/yandex/reports/order-reports.service';
import { YandexClientFactory } from '../../src/modules/yandex/yandex-client.factory';
import { REPORT } from '../../src/modules/yandex/reports/report-status-map';
import { formatReport } from '../../src/modules/yandex/reports/report-message';
import { NBSP } from '../../src/modules/yandex/reports/money';
import { PERIOD } from '../../src/modules/yandex/reports/report-period';

const NOW = new Date('2026-07-29T10:00:00Z');
/**
 * Дата оформления возврата в пределах NOW по Москве.
 *
 * Обязательна: период возвратов фильтруется НА НАШЕЙ стороне (метод дат не
 * принимает), и запись без даты считается вне периода — намеренно.
 */
const RETURN_DATE = '2026-07-29T12:00:00+03:00';
const STORE = { token: 'ACMA:x', campaign_id: '1', business_id: '2' } as never;

/** Клиент-заглушка: отдаёт заранее заданные заказы и возвраты. */
function buildService(opts: { orders?: unknown[]; returns?: unknown[] } = {}) {
  const queries: Record<string, unknown>[] = [];
  const returnQueries: Record<string, unknown>[] = [];

  const client = {
    async *iterateOrders(query: Record<string, unknown>) {
      queries.push(query);
      if (opts.orders?.length) yield opts.orders;
    },
    async *iterateReturns(query: Record<string, unknown>) {
      returnQueries.push(query);
      if (opts.returns?.length) yield opts.returns;
    },
  };

  const factory = { forStore: vi.fn(() => client) };

  return { factory, queries, returnQueries };
}

async function service(opts: Parameters<typeof buildService>[0] = {}) {
  const { factory, queries, returnQueries } = buildService(opts);
  const moduleRef = await Test.createTestingModule({
    providers: [OrderReportsService, { provide: YandexClientFactory, useValue: factory }],
  }).compile();
  return {
    reports: moduleRef.get(OrderReportsService),
    queries,
    returnQueries,
    factory,
  };
}

describe('Отчёт «уехало клиенту» (TASK-023)', () => {
  it('фильтрует по дате ОТГРУЗКИ, а не по дате создания', async () => {
    // Заказ мог быть создан неделю назад, а уехать сегодня.
    const { reports, queries } = await service();
    await reports.build(STORE, REPORT.SHIPPED_TODAY, NOW);

    expect(queries[0].supplierShipmentDateFrom).toBe('29-07-2026');
    expect(queries[0].supplierShipmentDateTo).toBe('29-07-2026');
    expect(queries[0]).not.toHaveProperty('fromDate');
    expect(queries[0].status).toEqual(['DELIVERY']);
  });

  it('считает количество и обе суммы', async () => {
    const { reports } = await service({
      orders: [
        { id: 1, status: 'DELIVERY', itemsTotal: 1000, deliveryTotal: 100 },
        { id: 2, status: 'DELIVERY', itemsTotal: 500, deliveryTotal: 50 },
      ],
    });

    const result = await reports.build(STORE, REPORT.SHIPPED_TODAY, NOW);

    expect(result.count).toBe(2);
    expect(result.totals).toEqual({ items: 1500, withDelivery: 1650 });
  });

  it('заказы не того статуса отсеиваются даже если пришли в ответе', async () => {
    const { reports } = await service({
      orders: [
        { id: 1, status: 'DELIVERY', itemsTotal: 100 },
        { id: 2, status: 'CANCELLED', itemsTotal: 999 },
      ],
    });

    const result = await reports.build(STORE, REPORT.SHIPPED_TODAY, NOW);
    expect(result.count).toBe(1);
    expect(result.totals.items).toBe(100);
  });
});

describe('Отчёт «выкуплено» (TASK-024)', () => {
  it('фильтрует по updatedAt в ISO со смещением', async () => {
    // Без смещения Яндекс истолкует время как UTC и отчёт сдвинется на 3 часа.
    const { reports, queries } = await service();
    await reports.build(STORE, REPORT.REDEEMED, NOW);

    expect(queries[0].updatedAtFrom).toBe('2026-07-29T00:00:00+03:00');
    expect(queries[0].updatedAtTo).toBe('2026-07-29T23:59:59+03:00');
    expect(queries[0].status).toEqual(['DELIVERED']);
  });

  it('диапазон укладывается в сутки, то есть заведомо в 30-дневный лимит', async () => {
    const { reports, queries } = await service();
    await reports.build(STORE, REPORT.REDEEMED, NOW);

    const from = new Date(queries[0].updatedAtFrom as string);
    const to = new Date(queries[0].updatedAtTo as string);
    const days = (to.getTime() - from.getTime()) / 86_400_000;
    expect(days).toBeLessThan(1);
  });
});

describe('Отчёт «едет обратно» (TASK-025)', () => {
  it('заказ с подстатусом-опечаткой не теряется', async () => {
    const { reports } = await service({
      orders: [
        { id: 1, status: 'DELIVERY', substatus: 'DELIVERY_SERIVCE_UNDELIVERED', itemsTotal: 700 },
        { id: 2, status: 'DELIVERY', substatus: 'DELIVERY_SERVICE_UNDELIVERED', itemsTotal: 300 },
      ],
    });

    const result = await reports.build(STORE, REPORT.RETURNING, NOW);
    expect(result.count).toBe(2);
    expect(result.totals.items).toBe(1000);
  });

  it('обычная доставка без возвратного подстатуса в отчёт не попадает', async () => {
    // Фильтр по статусу уходит в запрос, но подстатус Partner API отбирать не
    // умеет — без проверки поверх ответа сюда попали бы все заказы в доставке.
    const { reports } = await service({
      orders: [
        { id: 1, status: 'DELIVERY', substatus: 'DELIVERY_SERVICE_RECEIVED', itemsTotal: 999 },
        { id: 2, status: 'DELIVERY', substatus: 'FULL_NOT_RANSOM', itemsTotal: 100 },
      ],
    });

    const result = await reports.build(STORE, REPORT.RETURNING, NOW);
    expect(result.count).toBe(1);
    expect(result.totals.items).toBe(100);
  });

  it('возвраты берутся по ВСЕМ стадиям пути, а не по одной', async () => {
    // С единственным IN_TRANSIT отчёт показывал 38 возвратов там, где в
    // кабинете 50: «в пути» — только один шаг из нескольких.
    const { reports, returnQueries } = await service();
    await reports.build(STORE, REPORT.RETURNING, NOW);

    expect(returnQueries[0].shipmentStatuses).toEqual([
      'CREATED',
      'RECEIVED',
      'IN_TRANSIT',
      'READY_FOR_PICKUP',
      'PICKED',
    ]);
  });

  it('заказ из ОБОИХ источников считается один раз', async () => {
    // Невыкуп приходит и заказом с подстатусом, и записью в методе возвратов.
    const { reports } = await service({
      orders: [{ id: 42, status: 'DELIVERY', substatus: 'FULL_NOT_RANSOM', itemsTotal: 500 }],
      returns: [
        {
          returnId: 7,
          orderId: 42,
          creationDate: RETURN_DATE,
          amount: { value: 500, currencyId: 'RUR' },
        },
      ],
    });

    const result = await reports.build(STORE, REPORT.RETURNING, NOW);

    expect(result.count).toBe(1);
    expect(result.totals.items).toBe(500);
  });

  it('возврат без соответствующего заказа добавляется к отчёту', async () => {
    const { reports } = await service({
      orders: [{ id: 42, status: 'DELIVERY', substatus: 'FULL_NOT_RANSOM', itemsTotal: 500 }],
      returns: [
        {
          returnId: 7,
          orderId: 99,
          creationDate: RETURN_DATE,
          amount: { value: 300, currencyId: 'RUR' },
        },
      ],
    });

    const result = await reports.build(STORE, REPORT.RETURNING, NOW);

    expect(result.count).toBe(2);
    expect(result.totals.items).toBe(800);
  });

  it('дубли внутри самого списка возвратов тоже схлопываются', async () => {
    const { reports } = await service({
      returns: [
        { returnId: 1, orderId: 5, creationDate: RETURN_DATE, amount: { value: 100 } },
        { returnId: 2, orderId: 5, creationDate: RETURN_DATE, amount: { value: 100 } },
      ],
    });

    const result = await reports.build(STORE, REPORT.RETURNING, NOW);
    expect(result.count).toBe(1);
  });
});

describe('Отчёт «едет до клиента» (TASK-026)', () => {
  it('берёт статусы доставки и НЕ ставит фильтр даты', async () => {
    // Это срез «что сейчас в пути», а не события за период.
    // PROCESSING в запрос не уходит: заказ в обработке у продавца ещё не едет,
    // и кабинет его в «доставке» не показывает (сверка 31-07-2026).
    const { reports, queries } = await service();
    await reports.build(STORE, REPORT.IN_TRANSIT, NOW);

    expect(queries[0].status).toEqual(['DELIVERY', 'PICKUP']);
    expect(queries[0]).not.toHaveProperty('updatedAtFrom');
    expect(queries[0]).not.toHaveProperty('supplierShipmentDateFrom');
  });

  it('метод возвратов для него не вызывается', async () => {
    const { reports, returnQueries } = await service();
    await reports.build(STORE, REPORT.IN_TRANSIT, NOW);

    expect(returnQueries).toHaveLength(0);
  });
});

describe('Мультитенантность', () => {
  it('клиент создаётся под КОНКРЕТНЫЙ магазин на каждый отчёт', async () => {
    const { reports, factory } = await service();
    await reports.build(STORE, REPORT.REDEEMED, NOW);

    expect(factory.forStore).toHaveBeenCalledWith(STORE);
  });
});

describe('Текст отчёта', () => {
  it('пустой результат — понятное сообщение, а не пустая таблица', async () => {
    const { reports } = await service();
    const result = await reports.build(STORE, REPORT.SHIPPED_TODAY, NOW);

    const text = formatReport(result, NOW);
    expect(text).toContain('данных нет');
    expect(text).not.toContain('0 ₽');
  });

  it('пустой «едет обратно» звучит как отсутствие возвратов, а не как сбой', async () => {
    const { reports } = await service();
    const result = await reports.build(STORE, REPORT.RETURNING, NOW);

    expect(formatReport(result, NOW)).toContain('Возвратов и невыкупов нет');
  });

  it('непустой отчёт содержит количество и обе суммы', async () => {
    const { reports } = await service({
      orders: [{ id: 1, status: 'DELIVERED', itemsTotal: 1000, deliveryTotal: 234 }],
    });
    const result = await reports.build(STORE, REPORT.REDEEMED, NOW);

    const text = formatReport(result, NOW);
    expect(text).toContain('Заказов');
    expect(text).toContain('Товары');
    expect(text).toContain('С доставкой');
    expect(text).toContain(`1${NBSP}000${NBSP}₽`);
    expect(text).toContain(`1${NBSP}234${NBSP}₽`);
  });

  it('в отчёте за период указан ПЕРИОД, а в срезе «в пути» — МОМЕНТ съёмки', async () => {
    const { reports } = await service({
      orders: [{ id: 1, status: 'DELIVERY', itemsTotal: 1 }],
    });
    const shipped = await reports.build(STORE, REPORT.SHIPPED_TODAY, NOW);
    expect(formatReport(shipped, NOW)).toContain('за сегодня, 29-07-2026');

    const { reports: r2 } = await service({
      orders: [{ id: 1, status: 'DELIVERY', itemsTotal: 1 }],
    });
    const inTransit = await r2.build(STORE, REPORT.IN_TRANSIT, NOW);
    const text = formatReport(inTransit, NOW);

    // Момент съёмки — с временем: «что сейчас в пути» без него нечем сверить с
    // кабинетом. Но подписи «за сегодня» тут быть не должно: фильтра по дате в
    // срезе нет, и она обещала бы период, которого не было.
    expect(text).toContain('на 29-07-2026 13:00 МСК');
    expect(text).not.toContain('за сегодня');
  });
});

/**
 * Оформленные за период (TASK-055).
 *
 * Второй набор внутри отчёта о прибыли: продавец сверяется с кабинетом, где
 * видит именно оформленные заказы.
 */
describe('Сбор оформленных за период', () => {
  it('фильтрует по дате ОФОРМЛЕНИЯ, верхняя граница — на день вперёд', async () => {
    // toDate у Яндекса исключающая: «заказы, созданные ДО 00:00 указанного дня».
    const { reports, queries } = await service();
    await reports.collectPlacedOrders(STORE, { key: 'today' } as never, NOW);

    expect(queries[0].fromDate).toBe('29-07-2026');
    expect(queries[0].toDate).toBe('30-07-2026');
    expect(queries[0]).not.toHaveProperty('updatedAtFrom');
    expect(queries[0].status).toContain('CANCELLED');
  });

  it('отменённые отделены от остальных, а не выброшены и не смешаны', async () => {
    const { reports } = await service({
      orders: [
        { id: 1, status: 'PROCESSING', itemsTotal: 1000, items: [] },
        { id: 2, status: 'CANCELLED', itemsTotal: 500, items: [] },
        { id: 3, status: 'DELIVERED', itemsTotal: 2000, items: [] },
      ],
    });

    const placed = await reports.collectPlacedOrders(STORE, { key: 'today' } as never, NOW);

    expect(placed.orders.map((o) => o.id)).toEqual([1, 3]);
    expect(placed.cancelled.map((o) => o.id)).toEqual([2]);
  });

  it('недооформленный заказ в набор не попадает', async () => {
    // PLACING/RESERVED — заказа ещё нет; спросить о них Яндекса всё равно нельзя.
    const { reports } = await service({
      orders: [
        { id: 1, status: 'PLACING', itemsTotal: 100, items: [] },
        { id: 2, status: 'PROCESSING', itemsTotal: 100, items: [] },
      ],
    });

    const placed = await reports.collectPlacedOrders(STORE, { key: 'today' } as never, NOW);

    expect(placed.orders.map((o) => o.id)).toEqual([2]);
  });
});

describe('Выгрузка «едет до клиента» файлом (TASK-026)', () => {
  it('пустой результат отдаёт СООБЩЕНИЕ, а не пустой файл', async () => {
    // Продавец, открывший книгу из одной шапки, решит, что сломался бот,
    // а не что заказов нет.
    const { reports } = await service();
    const result = await reports.exportInTransit(STORE, NOW);

    expect(result.empty).toBe(true);
    if (result.empty) expect(result.message).toContain('нет ни одного заказа');
  });

  it('непустой результат отдаёт буфер с именем файла и подписью', async () => {
    const { reports } = await service({
      orders: [{ id: 1, status: 'DELIVERY', itemsTotal: 1000, deliveryTotal: 100 }],
    });
    const result = await reports.exportInTransit(STORE, NOW);

    expect(result.empty).toBe(false);
    if (!result.empty) {
      expect(Buffer.isBuffer(result.buffer)).toBe(true);
      // Дата И время по Москве: за день выгрузок бывает несколько, а Telegram
      // при совпадении содержимого отдаёт ранее загруженный документ со старым
      // именем — и свежий файл выглядит вчерашним.
      expect(result.filename).toBe('edet-do-klienta-29-07-2026-1300.xlsx');
      expect(result.caption).toContain('Заказов');
      expect(result.caption).toContain('на 29-07-2026 13:00 МСК');
      expect(result.caption).not.toContain('не поместились');
    }
  });
});

/**
 * Нарезка периода на окна (лимит Partner API — 30 дней).
 *
 * 31-го числа «с 1 числа месяца» не помещается в один запрос, и отчёты падали с
 * 400 «interval ... is more than 30 days» — весь отчёт целиком.
 */
describe('Период длиннее 30 дней собирается несколькими запросами', () => {
  // Пятница, 31 июля 2026, 12:00 МСК — 31 календарный день с начала месяца.
  const LAST_DAY = new Date('2026-07-31T12:00:00+03:00');
  const MONTH = { key: 'month' } as never;

  it('«выкуплено» за месяц 31-го числа — два запроса, оба в пределах лимита', async () => {
    const { reports, queries } = await service();
    await reports.build(STORE, REPORT.REDEEMED, LAST_DAY, MONTH);

    expect(queries).toHaveLength(2);
    expect(queries[0].updatedAtFrom).toBe('2026-07-01T00:00:00+03:00');
    expect(queries[0].updatedAtTo).toBe('2026-07-30T23:59:59+03:00');
    expect(queries[1].updatedAtFrom).toBe('2026-07-31T00:00:00+03:00');
    expect(queries[1].updatedAtTo).toBe('2026-07-31T23:59:59+03:00');
  });

  it('«оформлено» за месяц 31-го числа — тоже два запроса, без дыры между ними', async () => {
    const { reports, queries } = await service();
    await reports.collectPlacedOrders(STORE, MONTH, LAST_DAY);

    expect(queries).toHaveLength(2);
    // Верхняя граница исключающая, поэтому конец первого окна и начало второго
    // — одна и та же дата: ни потерянного дня, ни нахлёста.
    expect(queries[0].fromDate).toBe('01-07-2026');
    expect(queries[0].toDate).toBe('31-07-2026');
    expect(queries[1].fromDate).toBe('31-07-2026');
    expect(queries[1].toDate).toBe('01-08-2026');
  });

  it('30-го числа запрос остаётся ОДИН', async () => {
    const { reports, queries } = await service();
    await reports.build(STORE, REPORT.REDEEMED, new Date('2026-07-30T12:00:00+03:00'), MONTH);

    expect(queries).toHaveLength(1);
  });

  it('заказ, попавший в оба окна, считается один раз', async () => {
    // Заглушка отдаёт один и тот же список на каждый запрос — как Яндекс,
    // растянувший короткий диапазон до суток. Без дедупликации заказ удвоил бы
    // и количество, и сумму.
    const { reports } = await service({
      orders: [{ id: 777, status: 'DELIVERED', itemsTotal: 1000, deliveryTotal: 100 }],
    });
    const result = await reports.build(STORE, REPORT.REDEEMED, LAST_DAY, MONTH);

    expect(result.count).toBe(1);
    expect(result.totals.items).toBe(1000);
  });

  it('срез «в пути» окон не знает: один запрос и без дат', async () => {
    const { reports, queries } = await service();
    await reports.build(STORE, REPORT.IN_TRANSIT, LAST_DAY, MONTH);

    expect(queries).toHaveLength(1);
    expect(queries[0]).not.toHaveProperty('updatedAtFrom');
    expect(queries[0]).not.toHaveProperty('fromDate');
  });
});

/**
 * Возвраты и период.
 *
 * Метод возвратов дат НЕ принимает — в запросе только pageToken, limit и
 * shipmentStatuses. Пока фильтра не было, половина отчёта резалась по периоду, а
 * половина нет, и «за сегодня» с «с 1 числа месяца» давали одинаковый набор
 * возвратов. Продавец это и увидел как «не видно возвратов за текущий месяц».
 */
describe('Возвраты: период и разбивка', () => {
  const AUG = new Date('2026-08-03T10:00:00+03:00');
  const MONTH = { key: PERIOD.MONTH } as const;
  const TODAY = { key: PERIOD.TODAY } as const;
  const ALL = { key: PERIOD.ALL } as const;

  const ret = (id: number, creationDate: string, shipmentStatus = 'IN_TRANSIT') => ({
    returnId: id,
    orderId: 1000 + id,
    creationDate,
    shipmentStatus,
    amount: { value: 100 },
  });

  it('возврат вне периода не считается', async () => {
    const { reports } = await service({
      returns: [ret(1, '2026-08-02T12:00:00+03:00'), ret(2, '2026-07-15T12:00:00+03:00')],
    });
    const result = await reports.build(STORE, REPORT.RETURNING, AUG, MONTH);

    expect(result.count).toBe(1);
    expect(result.totals.items).toBe(100);
  });

  it('«сегодня» и «с 1 числа» дают РАЗНОЕ — это и был баг', async () => {
    const returns = [ret(1, '2026-08-03T09:00:00+03:00'), ret(2, '2026-08-01T09:00:00+03:00')];

    const month = await (
      await service({ returns })
    ).reports.build(STORE, REPORT.RETURNING, AUG, MONTH);
    const today = await (
      await service({ returns })
    ).reports.build(STORE, REPORT.RETURNING, AUG, TODAY);

    expect(month.count).toBe(2);
    expect(today.count).toBe(1);
  });

  it('на «Всего» период не режет и дат в запрос заказов не уходит', async () => {
    const { reports, queries } = await service({
      returns: [ret(1, '2026-03-19T12:00:00+03:00'), ret(2, '2026-08-02T12:00:00+03:00')],
    });
    const result = await reports.build(STORE, REPORT.RETURNING, AUG, ALL);

    expect(result.count).toBe(2);
    expect(queries[0]).not.toHaveProperty('updatedAtFrom');
    expect(queries[0]).not.toHaveProperty('updatedAtTo');
  });

  it('на «Всего» спрашиваются только АКТИВНЫЕ стадии', async () => {
    // «Все возвраты за всё время» — это 1979 записей, из которых 1928 уже
    // выданы магазину: число, которое ни о чём не говорит. Плюс двадцать
    // страниц запросов вместо одной.
    const { reports, returnQueries } = await service();
    await reports.build(STORE, REPORT.RETURNING, AUG, ALL);

    expect(returnQueries[0].shipmentStatuses).toEqual([
      'RECEIVED',
      'IN_TRANSIT',
      'READY_FOR_PICKUP',
    ]);
  });

  it('за период стадии спрашиваются ВСЕ — нужна полная картина месяца', async () => {
    const { reports, returnQueries } = await service();
    await reports.build(STORE, REPORT.RETURNING, AUG, MONTH);

    expect(returnQueries[0].shipmentStatuses).toHaveLength(5);
    expect(returnQueries[0].shipmentStatuses).toContain('PICKED');
  });

  it('возврат без даты считается ВНЕ периода, а не «сегодняшним»', async () => {
    // Молча зачесть битую дату в текущий месяц хуже, чем не показать: число
    // перестанет сходиться с кабинетом, а понять почему будет не по чему.
    const { reports } = await service({
      returns: [{ returnId: 1, orderId: 5, amount: { value: 100 } }],
    });
    const result = await reports.build(STORE, REPORT.RETURNING, AUG, MONTH);

    expect(result.count).toBe(0);
  });

  it('разбивка «едет / выдано» считается по стадиям', async () => {
    const { reports } = await service({
      returns: [
        ret(1, '2026-08-02T12:00:00+03:00', 'IN_TRANSIT'),
        ret(2, '2026-08-02T12:00:00+03:00', 'RECEIVED'),
        ret(3, '2026-08-02T12:00:00+03:00', 'READY_FOR_PICKUP'),
        ret(4, '2026-08-02T12:00:00+03:00', 'PICKED'),
        // «Создан» не едет и не доехал: покупатель товар ещё не сдал.
        ret(5, '2026-08-02T12:00:00+03:00', 'CREATED'),
      ],
    });
    const result = await reports.build(STORE, REPORT.RETURNING, AUG, MONTH);

    expect(result.count).toBe(5);
    expect(result.returns?.inFlight).toBe(3);
    expect(result.returns?.settled).toBe(1);
  });

  it('текст печатает разбивку, а на «Всего» — оговорку про 30 дней', async () => {
    const { reports } = await service({
      returns: [
        ret(1, '2026-08-02T12:00:00+03:00', 'IN_TRANSIT'),
        ret(2, '2026-08-02T12:00:00+03:00', 'PICKED'),
      ],
    });

    const month = formatReport(await reports.build(STORE, REPORT.RETURNING, AUG, MONTH), AUG);
    expect(month).toContain('едет');
    expect(month).toContain('выдано магазину');
    expect(month).not.toContain('не старше');

    const all = formatReport(await reports.build(STORE, REPORT.RETURNING, AUG, ALL), AUG);
    expect(all).toContain('не старше');
    // Разбивка «выдано магазину 0» на срезе активных ничего не сообщает.
    expect(all).toContain('Активных возвратов');
    expect(all).not.toContain('выдано магазину');
  });

  it('пустой отчёт называет период — иначе «возвратов нет» нечем проверить', async () => {
    const { reports } = await service();
    const text = formatReport(await reports.build(STORE, REPORT.RETURNING, AUG, MONTH), AUG);

    expect(text).toContain('Возвратов и невыкупов нет');
    expect(text).toContain('01-08-2026');
  });

  it('records зеркалят посчитанное: фильтр периода и дедуп по orderId', async () => {
    // Файл .xlsx строится из records и обязан сходиться с числами в сообщении
    // ПО ПОСТРОЕНИЮ: запись попадает в records там же, где count += 1.
    const { reports } = await service({
      orders: [{ id: 1001, status: 'DELIVERY', substatus: 'FULL_NOT_RANSOM' }],
      returns: [
        // Возврат заказа, уже посчитанного половиной невыкупов, — пропускается.
        ret(1, '2026-08-02T12:00:00+03:00'),
        ret(2, '2026-08-02T12:00:00+03:00'),
        // Вне периода — тоже мимо records.
        ret(3, '2026-07-15T12:00:00+03:00'),
      ],
    });
    const result = await reports.build(STORE, REPORT.RETURNING, AUG, MONTH);

    expect(result.returns?.records.map((r) => r.returnId)).toEqual([2]);
    expect(result.returns?.records).toHaveLength(result.returns?.count ?? -1);
  });
});

describe('Выгрузка «едет обратно» файлом', () => {
  const AUG = new Date('2026-08-03T10:00:00+03:00');
  const MONTH = { key: PERIOD.MONTH } as const;

  it('пустой результат отдаёт СООБЩЕНИЕ, а не пустой файл', async () => {
    const { reports } = await service();
    const result = await reports.exportReturning(STORE, MONTH, AUG);

    expect(result.empty).toBe(true);
    if (result.empty) expect(result.message).toContain('Возвратов и невыкупов нет');
  });

  it('непустой результат отдаёт буфер с именем файла и подписью', async () => {
    const { reports } = await service({
      returns: [
        {
          returnId: 1,
          orderId: 555,
          creationDate: '2026-08-02T12:00:00+03:00',
          shipmentStatus: 'IN_TRANSIT',
          amount: { value: 100 },
          // Заглушка минует маппер клиента, поэтому позиция сразу в нашей форме.
          items: [{ offerId: 'ABC-1', count: 1 }],
        },
      ],
    });
    const result = await reports.exportReturning(STORE, MONTH, AUG);

    expect(result.empty).toBe(false);
    if (!result.empty) {
      expect(Buffer.isBuffer(result.buffer)).toBe(true);
      expect(result.filename).toBe('edet-obratno-03-08-2026-1000.xlsx');
      expect(result.caption).toContain('Едет обратно');
      expect(result.caption).not.toContain('не поместились');
    }
  });
});
