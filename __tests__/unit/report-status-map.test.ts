import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  ORDER_STATUS,
  PLACED_DEFINITION,
  REPORT,
  REPORT_DEFINITIONS,
  RETURN_SUBSTATUS,
  isCancelled,
  matchesReport,
  queryStatuses,
  reportDefinition,
  type TReportKey,
} from '../../src/modules/yandex/reports/report-status-map';

/**
 * Маппинг статусов — знание предметной области. Ошибка здесь не роняет ничего:
 * отчёт просто отдаёт неверный список, и выглядит это как «у продавца сегодня
 * пусто». Поэтому проверяется каждое правило по отдельности.
 */
describe('Определения отчётов', () => {
  it('описаны все пять отчётов', () => {
    expect(Object.keys(REPORT_DEFINITIONS).sort()).toEqual(
      ['in_transit', 'profit', 'redeemed', 'returning', 'shipped_today'].sort(),
    );
  });

  it('«прибыль» берёт те же заказы, что «выкуплено» — деньги уже получены', () => {
    // Заказ в пути можно не выкупить, и прибыль по нему была бы выдумкой.
    const profit = reportDefinition(REPORT.PROFIT);
    const redeemed = reportDefinition(REPORT.REDEEMED);

    expect(profit.statuses).toEqual([ORDER_STATUS.DELIVERED]);
    expect(profit.statuses).toEqual(redeemed.statuses);
    expect(profit.dateFilter).toBe('updatedAt');
    expect(profit.usesReturnsApi).toBe(false);
  });

  it('«уехало клиенту» — DELIVERY по дате ОТГРУЗКИ', () => {
    // Заказ мог быть создан неделю назад, а уехать сегодня: фильтр по дате
    // создания дал бы совсем другой список.
    const def = reportDefinition(REPORT.SHIPPED_TODAY);
    expect(def.statuses).toEqual([ORDER_STATUS.DELIVERY]);
    expect(def.dateFilter).toBe('supplierShipmentDate');
  });

  it('«выкуплено» — DELIVERED по updatedAt', () => {
    // Выкуп — это смена статуса, то есть обновление заказа.
    const def = reportDefinition(REPORT.REDEEMED);
    expect(def.statuses).toEqual([ORDER_STATUS.DELIVERED]);
    expect(def.dateFilter).toBe('updatedAt');
  });

  it('«едет до клиента» — DELIVERY и PICKUP без фильтра даты', () => {
    const def = reportDefinition(REPORT.IN_TRANSIT);
    expect(def.statuses).toEqual([ORDER_STATUS.DELIVERY, ORDER_STATUS.PICKUP]);
    expect(def.dateFilter).toBe('none');
  });

  it('«едет до клиента» НЕ включает PROCESSING — иначе цифра расходится с кабинетом', () => {
    // Сверка 31-07-2026: кабинет «в доставке» = 192, API = DELIVERY 138 +
    // PICKUP 54. PROCESSING (38) — заказы, ещё не переданные в доставку.
    const def = reportDefinition(REPORT.IN_TRANSIT);
    expect(def.statuses).not.toContain(ORDER_STATUS.PROCESSING);
    expect(matchesReport(REPORT.IN_TRANSIT, { status: ORDER_STATUS.PROCESSING })).toBe(false);
  });

  it('«едет обратно» содержит все пять подстатусов и требует метод возвратов', () => {
    const def = reportDefinition(REPORT.RETURNING);
    expect(def.substatuses).toHaveLength(5);
    expect(def.usesReturnsApi).toBe(true);
  });
});

/**
 * Статусы, запрещённые Яндексом в ФИЛЬТРЕ (TASK-055).
 *
 * Проверено на боевом API 30-07-2026: PLACING, RESERVED, PENDING,
 * PARTIALLY_RETURNED и UNKNOWN отвечают `400 Statuses [X] are not allowed` и
 * роняют ВЕСЬ отчёт. До TASK-054 это не проявлялось: массив уходил как
 * `status[]=`, Partner API его игнорировал, и запрещённые значения до него не
 * доезжали — а «Едет обратно» с тех пор отвечал «Яндекс.Маркет отклонил запрос».
 */
describe('Статусы, пригодные для запроса', () => {
  it('ни одно определение не уходит в запрос с запрещённым статусом', () => {
    const forbidden = [
      ORDER_STATUS.PLACING,
      ORDER_STATUS.RESERVED,
      ORDER_STATUS.PENDING,
      ORDER_STATUS.PARTIALLY_RETURNED,
      ORDER_STATUS.UNKNOWN,
    ];

    const definitions = [...Object.values(REPORT_DEFINITIONS), PLACED_DEFINITION];

    for (const definition of definitions) {
      const queried = queryStatuses(definition);
      expect(queried.length).toBeGreaterThan(0);
      for (const status of forbidden) {
        expect(queried).not.toContain(status);
      }
    }
  });

  it('«едет обратно» запрашивает DELIVERY и RETURNED, а PARTIALLY_RETURNED — нет', () => {
    // Смысл отчёта не подрезаем: в определении статус остался, отбор ответа по
    // нему работает. Просто спросить о нём Яндекса нельзя.
    const def = reportDefinition(REPORT.RETURNING);
    expect(def.statuses).toContain(ORDER_STATUS.PARTIALLY_RETURNED);
    expect(queryStatuses(def)).toEqual([ORDER_STATUS.DELIVERY, ORDER_STATUS.RETURNED]);
  });

  it('«оформлено» — по дате оформления, с отменёнными и без недооформленных', () => {
    // CANCELLED запрашивается намеренно: в кабинете он в общем списке, и без
    // него наша цифра оказалась бы меньше той, что видит продавец.
    expect(PLACED_DEFINITION.dateFilter).toBe('creationDate');
    expect(queryStatuses(PLACED_DEFINITION)).toContain(ORDER_STATUS.CANCELLED);
    expect(PLACED_DEFINITION.statuses).not.toContain(ORDER_STATUS.PLACING);
    expect(PLACED_DEFINITION.statuses).not.toContain(ORDER_STATUS.RESERVED);
  });

  it('«оформлено» отчётом НЕ является — иначе у него появилась бы кнопка', () => {
    // Object.values(REPORT) питает OrderReportsService.keys, клавиатуру отчётов
    // и рассылку.
    expect(Object.values(REPORT)).not.toContain('placed');
    expect(Object.values(REPORT_DEFINITIONS)).not.toContain(PLACED_DEFINITION);
  });

  it('isCancelled узнаёт отменённый заказ и только его', () => {
    expect(isCancelled({ status: ORDER_STATUS.CANCELLED })).toBe(true);
    expect(isCancelled({ status: ORDER_STATUS.DELIVERED })).toBe(false);
    expect(isCancelled({})).toBe(false);
  });
});

describe('Опечатка Partner API', () => {
  it('присутствуют ОБА варианта написания подстатуса', () => {
    // Опечатка живёт в самом API: Яндекс присылает то SERIVCE, то SERVICE в
    // зависимости от возраста заказа. Матчить нужно оба, иначе часть невыкупов
    // молча выпадет из отчёта — и это будет выглядеть как «возвратов нет».
    const subs = reportDefinition(REPORT.RETURNING).substatuses;
    expect(subs).toContain('DELIVERY_SERIVCE_UNDELIVERED');
    expect(subs).toContain('DELIVERY_SERVICE_UNDELIVERED');
  });

  it('оба варианта действительно попадают в отчёт', () => {
    for (const substatus of [
      RETURN_SUBSTATUS.DELIVERY_SERIVCE_UNDELIVERED,
      RETURN_SUBSTATUS.DELIVERY_SERVICE_UNDELIVERED,
    ]) {
      expect(matchesReport(REPORT.RETURNING, { status: 'DELIVERY', substatus })).toBe(true);
    }
  });

  it('в файле есть предупреждение, что опечатку не надо «чинить»', () => {
    // Без этого комментария следующий разработчик исправит SERIVCE на SERVICE
    // как очевидную опечатку — и половина невыкупов исчезнет из отчёта.
    const source = readFileSync(
      resolve(__dirname, '../../src/modules/yandex/reports/report-status-map.ts'),
      'utf8',
    );
    expect(source).toMatch(/опечатк/i);
    expect(source).toMatch(/самом Partner API|самом API/i);
  });
});

describe('matchesReport', () => {
  it('отбирает по статусу', () => {
    expect(matchesReport(REPORT.REDEEMED, { status: 'DELIVERED' })).toBe(true);
    expect(matchesReport(REPORT.REDEEMED, { status: 'DELIVERY' })).toBe(false);
  });

  it('пустой список подстатусов означает «подстатус не важен»', () => {
    // А не «подстатус должен отсутствовать» — иначе отчёт «выкуплено» терял бы
    // все заказы, у которых подстатус проставлен.
    expect(matchesReport(REPORT.REDEEMED, { status: 'DELIVERED', substatus: 'ANY' })).toBe(true);
    expect(matchesReport(REPORT.REDEEMED, { status: 'DELIVERED' })).toBe(true);
  });

  it('«едет обратно» требует и статус, и подстатус', () => {
    expect(
      matchesReport(REPORT.RETURNING, { status: 'DELIVERY', substatus: 'FULL_NOT_RANSOM' }),
    ).toBe(true);
    // Статус подходит, подстатус — нет: обычная доставка, не возврат.
    expect(
      matchesReport(REPORT.RETURNING, {
        status: 'DELIVERY',
        substatus: 'DELIVERY_SERVICE_RECEIVED',
      }),
    ).toBe(false);
    // Подстатус возвратный, но статус не из списка.
    expect(
      matchesReport(REPORT.RETURNING, { status: 'CANCELLED', substatus: 'FULL_NOT_RANSOM' }),
    ).toBe(false);
  });

  it('битые и пустые заказы не роняют проверку', () => {
    expect(matchesReport(REPORT.REDEEMED, {})).toBe(false);
    expect(matchesReport(REPORT.REDEEMED, undefined as never)).toBe(false);
  });

  it('поведение отчёта меняется правкой маппинга, а не кода', () => {
    // Ровно то, ради чего маппинг вынесен: логика читает определение, поэтому
    // добавление статуса в список немедленно меняет отбор.
    const def = reportDefinition(REPORT.IN_TRANSIT);
    for (const status of def.statuses) {
      expect(matchesReport(REPORT.IN_TRANSIT, { status })).toBe(true);
    }
    expect(matchesReport(REPORT.IN_TRANSIT, { status: ORDER_STATUS.DELIVERED })).toBe(false);
  });
});

describe('Статусы не размазаны по коду', () => {
  const SRC = resolve(__dirname, '../../src/modules/yandex');
  const MAP_FILE = join(SRC, 'reports', 'report-status-map.ts');

  function tsFiles(dir: string): string[] {
    // Сгенерированный OpenAPI-клиент и его yaml трогать нельзя — там статусы
    // описаны как часть контракта.
    if (dir.includes(`${'/'}api`)) return [];
    return readdirSync(dir).flatMap((entry) => {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) return tsFiles(full);
      return full.endsWith('.ts') ? [full] : [];
    });
  }

  it('строковых литералов статусов вне файла маппинга нет', () => {
    const offenders: string[] = [];

    for (const file of tsFiles(SRC)) {
      if (file === MAP_FILE) continue;
      const code = readFileSync(file, 'utf8')
        .split('\n')
        .filter((line) => {
          const t = line.trimStart();
          return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*');
        })
        .join('\n');

      // UNKNOWN из проверки исключён: слово слишком общее и даёт ложные
      // срабатывания (в price.changer.handler.ts это заглушка ИМЕНИ ТОВАРА,
      // а не статус заказа). Остальные значения достаточно характерны.
      const watched = [
        ...Object.values(ORDER_STATUS).filter((s) => s !== ORDER_STATUS.UNKNOWN),
        ...Object.values(RETURN_SUBSTATUS),
      ];

      for (const status of watched) {
        if (code.includes(`'${status}'`) || code.includes(`"${status}"`)) {
          offenders.push(`${file.slice(SRC.length + 1)}: ${status}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  it('каждый ключ отчёта имеет определение', () => {
    for (const key of Object.values(REPORT) as TReportKey[]) {
      expect(reportDefinition(key)).toBeDefined();
      expect(reportDefinition(key).title.length).toBeGreaterThan(0);
    }
  });
});
