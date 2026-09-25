import type { INestApplication } from '@nestjs/common';

import { Global, Module } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AppConfigService } from '../../src/config/app-config.service';
import { DatabaseModule } from '../../src/database/database.module';
import { ActionLog } from '../../src/database/schemas/action-log.schema';
import { AdminCredential } from '../../src/database/schemas/admin-credential.schema';
import { CrmCredential } from '../../src/database/schemas/crm-credential.schema';
import { UserAccess } from '../../src/database/schemas/user-access.schema';
import { YandexMarket } from '../../src/database/schemas/yandex-market.schema';
import { ActionLogService } from '../../src/database/services/action-log.service';
import { AdminCredentialService } from '../../src/database/services/admin-credential.service';
import { CrmCredentialService } from '../../src/database/services/crm-credential.service';
import { UserAccessService } from '../../src/database/services/user-access.service';
import { YandexMarketService } from '../../src/database/services/yandex-market.service';
import { CrmModule } from '../../src/modules/crm/crm.module';
import { CrmFeedbackController } from '../../src/modules/crm/feedback/crm-feedback.controller';
import {
  parseFeedbackId,
  parseReplyText,
  toCrmFeedbackView,
} from '../../src/modules/crm/feedback/crm-feedback.domain';
import { ErrorReporter } from '../../src/modules/errors/error-reporter.service';
import { FEATURE } from '../../src/modules/telegram/bots/shared/features.domain';
import { FeedbackReplyInvalidError } from '../../src/modules/yandex/feedback/feedback.domain';
import { FeedbackService } from '../../src/modules/yandex/feedback/feedback.service';
import { storeKeyOf } from '../../src/modules/yandex/stores/stores.domain';
import { StoresService } from '../../src/modules/yandex/stores/stores.service';
import { YandexApiError, YandexAuthError } from '../../src/modules/yandex/yandex-api.errors';
import { YandexClientFactory } from '../../src/modules/yandex/yandex-client.factory';
import { inMemoryModel } from '../helpers/in-memory-model';

const INITIAL = 'tg_rules_2026';
const SELLER_ID = '222';
const TOKEN = 'ACMA:SECRET-TOKEN';

const FBS = {
  campaignId: '148655119',
  businessId: '164225008',
  businessName: 'SBrand',
  storeName: 'Время с SBrand',
  placementType: 'FBS',
};
const OTHER = {
  campaignId: '555000',
  businessId: '777000',
  businessName: 'Другой кабинет',
  storeName: 'other.ru',
  placementType: 'FBS',
};

const FEEDBACKS = [
  {
    feedbackId: 101,
    createdAt: '2026-09-20T10:00:00Z',
    author: 'Иван',
    rating: 2,
    orderId: 58841189889,
    comment: 'Стрелки отстают',
  },
  // Маркет может не прислать ничего, кроме id; пустая строка — тоже «нет».
  { feedbackId: 102, author: '', advantages: '' },
];

/**
 * «Отзывы» CRM на настоящем HTTP. Пинится: фича закрывает маршрут, магазин —
 * из ключа, отсутствующие поля — null, длинный или пустой ответ не доходит до
 * Маркета, отзыв вне живого списка не публикуется второй раз, сбой — 502.
 */
describe('CRM «Отзывы» по HTTP', { timeout: 60_000 }, () => {
  let app: INestApplication;
  let base: string;
  let token: string;
  const getFeedbacksNeedingReaction = vi.fn();
  const updateFeedbackComment = vi.fn();
  const skipFeedbackReaction = vi.fn();
  const forStore = vi.fn();

  async function boot(features: Record<string, boolean> = { [FEATURE.GOODS_FEEDBACK]: true }) {
    const access = inMemoryModel([
      { telegramUserId: SELLER_ID, botId: '999', status: 'approved', username: 'Vasya', features },
    ]);
    const stores = inMemoryModel([
      {
        telegramUserId: SELLER_ID,
        campaign_id: FBS.campaignId,
        business_id: FBS.businessId,
        name: FBS.storeName,
        token: TOKEN,
        stores: [FBS, OTHER],
      },
    ]);
    const crm = inMemoryModel();
    crm.uniqueBy('telegramUserId');
    const admin = inMemoryModel();
    admin.uniqueBy('key');

    @Global()
    @Module({
      providers: [
        ActionLogService,
        AdminCredentialService,
        CrmCredentialService,
        UserAccessService,
        YandexMarketService,
        { provide: getModelToken(ActionLog.name), useValue: inMemoryModel() },
        { provide: getModelToken(AdminCredential.name), useValue: admin },
        { provide: getModelToken(CrmCredential.name), useValue: crm },
        { provide: getModelToken(UserAccess.name), useValue: access },
        { provide: getModelToken(YandexMarket.name), useValue: stores },
        { provide: ErrorReporter, useValue: { report: async () => undefined } },
        {
          provide: AppConfigService,
          useValue: { isAdmin: () => false, crmInitialPassword: INITIAL },
        },
      ],
      exports: [
        ActionLogService,
        AdminCredentialService,
        CrmCredentialService,
        UserAccessService,
        YandexMarketService,
        ErrorReporter,
        AppConfigService,
      ],
    })
    class FakeDatabaseModule {}

    @Module({
      imports: [CrmModule],
      controllers: [CrmFeedbackController],
      providers: [
        StoresService,
        FeedbackService,
        { provide: YandexClientFactory, useValue: { forStore } },
      ],
    })
    class FeedbackTestModule {}

    const moduleRef = await Test.createTestingModule({ imports: [FeedbackTestModule] })
      .overrideModule(DatabaseModule)
      .useModule(FakeDatabaseModule)
      .compile();
    await moduleRef.get(AdminCredentialService).ensure();

    app = moduleRef.createNestApplication({ logger: false });
    app.setGlobalPrefix('api');
    await app.listen(0);
    base = (await app.getUrl()).replace('[::1]', 'localhost');

    const login = await fetch(`${base}/api/crm/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ login: 'vasya', password: INITIAL }),
    });
    const first = ((await login.json()) as { token: string }).token;
    const change = await fetch(`${base}/api/crm/auth/password`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${first}` },
      body: JSON.stringify({ current: INITIAL, next: 'my-own-password' }),
    });
    token = ((await change.json()) as { token: string }).token;
  }

  function call(method: string, path: string, body?: unknown) {
    return fetch(`${base}/api/crm/ym/feedback${path}`, {
      method,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }

  const key = storeKeyOf(FBS.campaignId);

  beforeEach(() => {
    getFeedbacksNeedingReaction.mockReset().mockResolvedValue({ items: FEEDBACKS });
    updateFeedbackComment.mockReset().mockResolvedValue(undefined);
    skipFeedbackReaction.mockReset().mockResolvedValue(undefined);
    forStore.mockReset().mockReturnValue({
      getFeedbacksNeedingReaction,
      updateFeedbackComment,
      skipFeedbackReaction,
    });
  });

  afterEach(async () => {
    await app?.close();
  });

  it('фича закрыта → 403 FEATURE_DISABLED на чтении и записи, Маркет не спрошен', async () => {
    await boot({});
    const list = await call('GET', `?store=${key}`);
    expect(list.status).toBe(403);
    expect((await list.json()).code).toBe('FEATURE_DISABLED');
    const reply = await call('POST', '/reply', { store: key, feedbackId: 101, text: 'Спасибо' });
    expect(reply.status).toBe(403);
    expect(forStore).not.toHaveBeenCalled();
  });

  it('без магазина → 400, чужой ключ → 404 STORE_NOT_FOUND, Маркет не спрошен', async () => {
    await boot();
    expect((await call('GET', '')).status).toBe(400);
    const response = await call('GET', `?store=${storeKeyOf('999999')}`);
    expect(response.status).toBe(404);
    expect((await response.json()).code).toBe('STORE_NOT_FOUND');
    const reply = await call('POST', '/reply', {
      store: storeKeyOf('999999'),
      feedbackId: 101,
      text: 'Спасибо',
    });
    expect(reply.status).toBe(404);
    expect(forStore).not.toHaveBeenCalled();
  });

  it('GET: отсутствующие поля — null, не ""; ни токена, ни id магазина', async () => {
    await boot();
    const response = await call('GET', `?store=${storeKeyOf(OTHER.campaignId)}`);
    expect(response.status).toBe(200);
    const text = await response.text();
    for (const secret of [TOKEN, FBS.campaignId, FBS.businessId, OTHER.campaignId]) {
      expect(text).not.toContain(secret);
    }
    const view = JSON.parse(text);
    expect(view.note).toContain(`кабинета «${OTHER.businessName}»`);
    expect(view.productNote).toContain('номер заказа');
    expect(view.more).toBeNull();
    expect(view.replyMaxLength).toBe(4096);
    expect(view.feedbacks).toEqual([
      {
        feedbackId: 101,
        createdAt: '2026-09-20T10:00:00Z',
        author: 'Иван',
        rating: 2,
        orderId: 58841189889,
        advantages: null,
        disadvantages: null,
        comment: 'Стрелки отстают',
      },
      {
        feedbackId: 102,
        createdAt: null,
        author: null,
        rating: null,
        orderId: null,
        advantages: null,
        disadvantages: null,
        comment: null,
      },
    ]);
    // Клиент построен по ОТКРЫТОМУ магазину, не по активному в боте.
    expect(forStore.mock.calls[0][0]).toMatchObject({
      campaign_id: OTHER.campaignId,
      business_id: OTHER.businessId,
    });
  });

  it('GET: есть следующая страница — «показаны первые N»', async () => {
    await boot();
    getFeedbacksNeedingReaction.mockResolvedValue({ items: FEEDBACKS, nextPageToken: 'next' });
    const view = await (await call('GET', `?store=${key}`)).json();
    expect(view.more).toContain('Показаны первые 2');
  });

  it('reply: публикует ровно присланный текст один раз', async () => {
    await boot();
    const text = '  Спасибо!\nРазберёмся.  ';
    const response = await call('POST', '/reply', { store: key, feedbackId: 101, text });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(updateFeedbackComment).toHaveBeenCalledTimes(1);
    expect(updateFeedbackComment).toHaveBeenCalledWith(101, text);
  });

  it('reply: длиннее 4096 или пустой → 400 INVALID_REPLY с field, Маркет не тронут', async () => {
    await boot();
    for (const text of ['x'.repeat(4097), '   ', undefined]) {
      const response = await call('POST', '/reply', { store: key, feedbackId: 101, text });
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ code: 'INVALID_REPLY', field: 'text' });
    }
    expect(forStore).not.toHaveBeenCalled();
    expect(updateFeedbackComment).not.toHaveBeenCalled();
  });

  it('reply: ровно 4096 символов — публикуется', async () => {
    await boot();
    const response = await call('POST', '/reply', {
      store: key,
      feedbackId: 101,
      text: 'x'.repeat(4096),
    });
    expect(response.status).toBe(200);
  });

  it('битый feedbackId → 400 INVALID_FEEDBACK', async () => {
    await boot();
    for (const feedbackId of [undefined, 0, -1, 1.5, 'abc']) {
      const response = await call('POST', '/skip', { store: key, feedbackId });
      expect(response.status).toBe(400);
      expect((await response.json()).code).toBe('INVALID_FEEDBACK');
    }
    expect(skipFeedbackReaction).not.toHaveBeenCalled();
  });

  it('отзыва уже нет в живом списке → 409 FEEDBACK_GONE, второго комментария нет', async () => {
    await boot();
    getFeedbacksNeedingReaction.mockResolvedValue({ items: [FEEDBACKS[1]] });
    const reply = await call('POST', '/reply', { store: key, feedbackId: 101, text: 'Спасибо' });
    expect(reply.status).toBe(409);
    expect((await reply.json()).code).toBe('FEEDBACK_GONE');
    const skip = await call('POST', '/skip', { store: key, feedbackId: 101 });
    expect(skip.status).toBe(409);
    expect(updateFeedbackComment).not.toHaveBeenCalled();
    expect(skipFeedbackReaction).not.toHaveBeenCalled();
  });

  it('сбой публикации → 502 MARKET_ERROR с текстом Маркета', async () => {
    await boot();
    const failure = new YandexApiError('boom', 500);
    updateFeedbackComment.mockRejectedValue(failure);
    const response = await call('POST', '/reply', { store: key, feedbackId: 101, text: 'Ок' });
    expect(response.status).toBe(502);
    const body = await response.json();
    expect(body.code).toBe('MARKET_ERROR');
    expect(body.message).toBe(failure.userMessage);
    expect(updateFeedbackComment).toHaveBeenCalledTimes(1);
  });

  it('skip: помечает прочитанным один отзыв', async () => {
    await boot();
    const response = await call('POST', '/skip', { store: key, feedbackId: '102' });
    expect(response.status).toBe(200);
    expect(skipFeedbackReaction).toHaveBeenCalledWith([102]);
  });

  it('ошибка Маркета на чтении → 502 MARKET_ERROR с его текстом', async () => {
    await boot();
    getFeedbacksNeedingReaction.mockRejectedValue(new YandexAuthError('nope', 401));
    const response = await call('GET', `?store=${key}`);
    expect(response.status).toBe(502);
    const body = await response.json();
    expect(body.code).toBe('MARKET_ERROR');
    expect(body.message).toBe(new YandexAuthError('nope', 401).userMessage);
  });
});

describe('FeedbackService', () => {
  const updateFeedbackComment = vi.fn();
  const skipFeedbackReaction = vi.fn();
  const service = new FeedbackService({
    forStore: () => ({ updateFeedbackComment, skipFeedbackReaction }),
  } as unknown as YandexClientFactory);
  const store = {} as never;

  beforeEach(() => {
    updateFeedbackComment.mockReset();
    skipFeedbackReaction.mockReset();
  });

  it('последний барьер: длинный или пустой ответ не уходит в Маркет', async () => {
    await expect(service.reply(store, 1, 'x'.repeat(4097))).rejects.toBeInstanceOf(
      FeedbackReplyInvalidError,
    );
    await expect(service.reply(store, 1, ' ')).rejects.toBeInstanceOf(FeedbackReplyInvalidError);
    expect(updateFeedbackComment).not.toHaveBeenCalled();
  });

  it('пустой skip — без запроса', async () => {
    await service.skip(store, []);
    expect(skipFeedbackReaction).not.toHaveBeenCalled();
  });
});

describe('crm-feedback.domain', () => {
  it('parseFeedbackId: положительное целое, в том числе строкой', () => {
    expect(parseFeedbackId(5)).toBe(5);
    expect(parseFeedbackId('7')).toBe(7);
    expect(parseFeedbackId('')).toBeNull();
    expect(parseFeedbackId(null)).toBeNull();
    expect(parseFeedbackId(2 ** 60)).toBeNull();
  });

  it('parseReplyText: текст не обрезается, ошибка называет длину', () => {
    expect(parseReplyText(' ok ')).toEqual({ text: ' ok ' });
    expect(parseReplyText('x'.repeat(5000))).toEqual({
      error: expect.stringContaining('5000'),
    });
  });

  it('toCrmFeedbackView: без кабинета — нейтральная подпись', () => {
    expect(toCrmFeedbackView('', { items: [] }).note).toContain('всех магазинов кабинета:');
  });
});
