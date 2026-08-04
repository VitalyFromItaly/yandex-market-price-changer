import { describe, it, expect } from 'vitest';

import { ActionLogService } from '../../src/database/services/action-log.service';
import { inMemoryModel } from '../helpers/in-memory-model';

/**
 * Отбор для вкладки «Мусор».
 *
 * 404-зонды сканеров пишутся с `source=scanner`. БЕЗ явного source они СКРЫТЫ —
 * не должны засорять ни основной журнал, ни счётчик ошибок обзора; вкладка
 * «Мусор» запрашивает их явным `source=scanner`. Проверяем через count(),
 * который ходит тем же filterOf, что и list().
 */
describe('ActionLogService: фильтр «Мусор»', () => {
  function service() {
    const model = inMemoryModel([
      { telegramUserId: '1', kind: 'menu', source: undefined },
      { telegramUserId: 'system', kind: 'error', source: 'http', httpStatus: 500 },
      { telegramUserId: 'system', kind: 'error', source: 'scanner', httpStatus: 404 },
      { telegramUserId: 'system', kind: 'error', source: 'scanner', httpStatus: 404 },
    ]);
    return new ActionLogService(model as never);
  }

  it('без source мусор сканеров скрыт', async () => {
    // Остаются действие продавца и обычная 5xx-ошибка, два scanner-скрыты.
    expect(await service().count({})).toBe(2);
  });

  it('source=scanner отдаёт только мусор (вкладка «Мусор»)', async () => {
    expect(await service().count({ source: 'scanner' })).toBe(2);
  });

  it('явный source=http исключением мусора не задевается', async () => {
    expect(await service().count({ source: 'http' })).toBe(1);
  });
});
