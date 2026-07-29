import { describe, it, expect, vi } from 'vitest';

import { YandexApiClient } from '../../src/modules/yandex/yandex-api.client';

/**
 * Автоопределение магазина по токену.
 *
 * `GET v2/campaigns` отдаёт и campaignId, и businessId одним запросом. Это
 * снимает два самых частых источника ошибки при регистрации: перепутать
 * campaign_id с идентификатором магазина (документация Яндекса выделяет это
 * отдельным предупреждением — с ним запросы к API не работают) и ошибиться
 * цифрой при переписывании.
 */
function clientWith(response: unknown) {
  const client = new YandexApiClient(
    { token: 't', campaignId: '', businessId: '' },
    'https://example.test',
    { retry: { attempts: 1, baseDelayMs: 1 }, sleep: async () => undefined },
  );

  // Подменяем сетевой слой: проверяем разбор ответа, а не axios.
  vi.spyOn(
    client as unknown as { get: (p: string, q: unknown) => Promise<unknown> },
    'get',
  ).mockResolvedValue(response);

  return client;
}

describe('listStores: разбор ответа GET campaigns', () => {
  it('достаёт обе пары идентификаторов из одного ответа', async () => {
    const client = clientWith({
      campaigns: [
        {
          id: 134874104,
          domain: 'allbestwatch.ru',
          business: { id: 182608006, name: 'ALL BEST WATCH' },
        },
      ],
    });

    expect(await client.listStores()).toEqual([
      { campaignId: '134874104', businessId: '182608006', name: 'ALL BEST WATCH' },
    ]);
  });

  it('идентификаторы приводятся к строкам — в схеме они строковые', async () => {
    const client = clientWith({
      campaigns: [{ id: 1, business: { id: 2, name: 'x' } }],
    });
    const [store] = await client.listStores();

    expect(typeof store.campaignId).toBe('string');
    expect(typeof store.businessId).toBe('string');
  });

  it('несколько магазинов возвращаются все — выбор за пользователем', async () => {
    const client = clientWith({
      campaigns: [
        { id: 1, business: { id: 10, name: 'Первый' } },
        { id: 2, business: { id: 20, name: 'Второй' } },
      ],
    });

    expect(await client.listStores()).toHaveLength(2);
  });

  it('запись без business отбрасывается, а не даёт undefined в id', async () => {
    // Подставить undefined в campaign_id значило бы записать в базу мусор,
    // который всплыл бы первым же запросом к API.
    const client = clientWith({
      campaigns: [{ id: 1 }, { id: 2, business: { id: 20, name: 'Годный' } }],
    });

    const stores = await client.listStores();
    expect(stores).toHaveLength(1);
    expect(stores[0].businessId).toBe('20');
  });

  it('пустой ответ — пустой список, а не исключение', async () => {
    expect(await clientWith({}).listStores()).toEqual([]);
    expect(await clientWith({ campaigns: [] }).listStores()).toEqual([]);
  });

  it('название берётся из бизнеса, иначе из домена, иначе по id', async () => {
    const byName = await clientWith({
      campaigns: [{ id: 1, domain: 'd.ru', business: { id: 2, name: 'Имя' } }],
    }).listStores();
    expect(byName[0].name).toBe('Имя');

    const byDomain = await clientWith({
      campaigns: [{ id: 1, domain: 'd.ru', business: { id: 2 } }],
    }).listStores();
    expect(byDomain[0].name).toBe('d.ru');

    const byId = await clientWith({
      campaigns: [{ id: 7, business: { id: 2 } }],
    }).listStores();
    expect(byId[0].name).toContain('7');
  });
});
