import { describe, expect, it, vi } from 'vitest';

import {
  ozonPushErrorView,
  toCrmOzonPush,
} from '../../src/modules/crm/stock-push/crm-stock-push.domain';
import { OZON_PUSH_ORDER_TYPES, planOzonPush } from '../../src/modules/ozon/ozon-push.domain';
import { OzonPushService } from '../../src/modules/ozon/ozon-push.service';
import { mapNotificationUrls, mapPushTypes } from '../../src/modules/ozon/ozon.client';

/**
 * Подписка на push Ozon через Seller API (ozon_push_subscribe_via_api): узнаём свою
 * подписку по префиксу адреса, чужую интеграцию не трогаем, смена секрета
 * перенаправляет свою.
 */

const PREFIX = 'https://bot.ru/api/webhooks/ozon/';
const OUR = `${PREFIX}${'a'.repeat(48)}`;
const OLD = `${PREFIX}${'b'.repeat(48)}`;

function url(overrides: Partial<ReturnType<typeof mapNotificationUrls>[number]> = {}) {
  return {
    id: '7',
    url: OUR,
    enabled: true,
    availability: 'GREEN',
    disableReason: '',
    types: [...OZON_PUSH_ORDER_TYPES],
    ...overrides,
  };
}

describe('мапперы ответов Ozon', () => {
  it('/v1/notification/list и /push-type/list', () => {
    expect(
      mapNotificationUrls({
        urls: [
          {
            id: 7,
            url: OUR,
            enable: true,
            availability_status: 'YELLOW',
            types: [{ type: 'TYPE_NEW_POSTING', description: 'x' }],
          },
          { id: 8 },
        ],
      }),
    ).toEqual([
      {
        id: '7',
        url: OUR,
        enabled: true,
        availability: 'YELLOW',
        disableReason: '',
        types: ['TYPE_NEW_POSTING'],
      },
    ]);
    expect(
      mapPushTypes({
        types: [
          { type: 'TYPE_NEW_POSTING', seller_endpoint: { id: 1, url: 'https://wms.ru/hook' } },
          { type: 'TYPE_CHAT_CLOSED' },
        ],
      }),
    ).toEqual([
      { type: 'TYPE_NEW_POSTING', endpointUrl: 'https://wms.ru/hook' },
      { type: 'TYPE_CHAT_CLOSED', endpointUrl: null },
    ]);
  });
});

describe('planOzonPush', () => {
  it('ничего нет — подключить', () => {
    expect(planOzonPush([], [], OUR, PREFIX)).toEqual({
      status: { state: 'none' },
      action: { kind: 'set' },
    });
  });

  it('свой адрес на обоих типах — подключено, со статусом Ozon', () => {
    expect(planOzonPush([url()], [], OUR, PREFIX).status).toEqual({
      state: 'connected',
      availability: 'GREEN',
      enabled: true,
      disableReason: '',
    });
  });

  it('свой старый адрес или не все типы — перенаправить тот же id', () => {
    expect(planOzonPush([url({ url: OLD })], [], OUR, PREFIX).action).toEqual({
      kind: 'update',
      id: '7',
    });
    expect(planOzonPush([url({ types: ['TYPE_NEW_POSTING'] })], [], OUR, PREFIX).action).toEqual({
      kind: 'update',
      id: '7',
    });
  });

  it('тип уже идёт на чужую интеграцию — занято, ничего не пишем', () => {
    const types = [{ type: 'TYPE_POSTING_CANCELLED', endpointUrl: 'https://wms.ru/hook' }];
    expect(planOzonPush([], types, OUR, PREFIX)).toEqual({
      status: { state: 'occupied', host: 'wms.ru' },
      action: { kind: 'none' },
    });
    // Чужой адрес на другом типе (чаты) — не мешает.
    const chats = [{ type: 'TYPE_NEW_MESSAGE', endpointUrl: 'https://crm.ru/chat' }];
    expect(planOzonPush([], chats, OUR, PREFIX).action).toEqual({ kind: 'set' });
  });
});

describe('OzonPushService', () => {
  function service(
    urls: ReturnType<typeof url>[],
    types: { type: string; endpointUrl: string | null }[] = [],
  ) {
    const client = {
      listNotificationUrls: vi.fn(async () => urls),
      listPushTypes: vi.fn(async () => types),
      setNotificationUrl: vi.fn(async () => undefined),
      updateNotificationUrl: vi.fn(async () => undefined),
    };
    const clients = { forCredentials: vi.fn(() => client) };
    const connections = { credentialsOf: vi.fn(async () => ({ clientId: '1', apiKey: 'k' })) };
    return { s: new OzonPushService(clients as never, connections as never), client };
  }

  it('connect: нет подписки — set на оба типа; занято чужим — без записи', async () => {
    const fresh = service([]);
    await fresh.s.connect('1', OUR, PREFIX);
    expect(fresh.client.setNotificationUrl).toHaveBeenCalledWith(OUR, OZON_PUSH_ORDER_TYPES);

    const busy = service([], [{ type: 'TYPE_NEW_POSTING', endpointUrl: 'https://wms.ru/x' }]);
    expect(await busy.s.connect('1', OUR, PREFIX)).toEqual({ state: 'occupied', host: 'wms.ru' });
    expect(busy.client.setNotificationUrl).not.toHaveBeenCalled();
    expect(busy.client.updateNotificationUrl).not.toHaveBeenCalled();
  });

  it('repoint: своя подписка — update на новый адрес; чужая/нет — ничего', async () => {
    const ours = service([url({ url: OLD })]);
    expect(await ours.s.repoint('1', OUR, PREFIX)).toBe(true);
    expect(ours.client.updateNotificationUrl).toHaveBeenCalledWith('7', OUR, OZON_PUSH_ORDER_TYPES);

    const foreign = service([url({ url: 'https://wms.ru/x' })]);
    expect(await foreign.s.repoint('1', OUR, PREFIX)).toBe(false);
    expect(foreign.client.updateNotificationUrl).not.toHaveBeenCalled();
  });
});

describe('вид подписки Ozon в CRM', () => {
  it('словами, без адресов чужих интеграций целиком', () => {
    expect(
      toCrmOzonPush({
        state: 'connected',
        availability: 'GREEN',
        enabled: true,
        disableReason: '',
      }),
    ).toEqual({
      state: 'connected',
      ok: true,
      text: 'Подключено · Ozon видит адрес доступным.',
    });
    expect(
      toCrmOzonPush({ state: 'connected', availability: 'RED', enabled: true, disableReason: '' })
        .ok,
    ).toBe(false);
    const paused = toCrmOzonPush({
      state: 'connected',
      availability: 'RED',
      enabled: false,
      disableReason: 'таймаут',
    });
    expect(paused.text).toContain('приостановил');
    expect(toCrmOzonPush({ state: 'occupied', host: 'wms.ru' }).text).toContain('wms.ru');
  });

  it('ошибки Ozon — его текстом продавцу, неподключённый Ozon — своим', () => {
    const notConnected = Object.assign(new Error('x'), { name: 'OzonNotConnectedError' });
    expect(ozonPushErrorView(notConnected).text).toContain('Подключениях');
    expect(ozonPushErrorView({ userMessage: 'Ключ без прав' }).text).toBe('Ключ без прав');
    expect(ozonPushErrorView(new Error('boom')).text).toContain('попробуйте позже');
  });
});
