import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Test } from '@nestjs/testing';
import { JwtModule } from '@nestjs/jwt';
import { getModelToken } from '@nestjs/mongoose';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';

import { AppConfigService } from '../../src/config/app-config.service';
import { AdminCredential } from '../../src/database/schemas/admin-credential.schema';
import { CrmCredential } from '../../src/database/schemas/crm-credential.schema';
import { MarketplaceConnection } from '../../src/database/schemas/marketplace-connection.schema';
import { UserAccess } from '../../src/database/schemas/user-access.schema';
import { YandexMarket } from '../../src/database/schemas/yandex-market.schema';
import { AdminCredentialService } from '../../src/database/services/admin-credential.service';
import { CrmCredentialService } from '../../src/database/services/crm-credential.service';
import { MarketplaceConnectionService } from '../../src/database/services/marketplace-connection.service';
import { UserAccessService } from '../../src/database/services/user-access.service';
import { YandexMarketService } from '../../src/database/services/yandex-market.service';
import { AdminAuthService } from '../../src/modules/admin/admin-auth.service';
import { AdminJwtGuard } from '../../src/modules/admin/admin-jwt.guard';
import { MAX_ATTEMPTS } from '../../src/modules/admin/login-throttle';
import { CrmAuthController } from '../../src/modules/crm/crm-auth.controller';
import {
  ALLOW_PENDING_PASSWORD_CHANGE,
  ALLOW_WITHOUT_PLATFORM,
  REQUIRE_FEATURE,
} from '../../src/modules/crm/crm-auth.decorators';
import {
  CRM_NO_ACCESS,
  NO_PLATFORM,
  PASSWORD_CHANGE_REQUIRED,
  WEAK_PASSWORD,
  WRONG_CURRENT_PASSWORD,
  normalizeLogin,
  resolveAccount,
  validateNewPassword,
} from '../../src/modules/crm/crm-auth.domain';
import { CrmAuthService } from '../../src/modules/crm/crm-auth.service';
import { FBY_ONLY, FEATURE_DISABLED } from '../../src/modules/crm/crm-features.domain';
import { CrmJwtGuard } from '../../src/modules/crm/crm-jwt.guard';
import { CrmConnectionsController } from '../../src/modules/crm/connections/crm-connections.controller';
import { CrmMarketplacesController } from '../../src/modules/crm/marketplaces/crm-marketplaces.controller';
import { CrmOzonController } from '../../src/modules/crm/ozon/crm-ozon.controller';
import { CrmProfileController } from '../../src/modules/crm/profile/crm-profile.controller';
import { CrmWbController } from '../../src/modules/crm/wb/crm-wb.controller';
import { CrmFinanceController } from '../../src/modules/crm/finance/crm-finance.controller';
import { CrmStoresController } from '../../src/modules/crm/stores/crm-stores.controller';
import { fbyOnlyScreenText } from '../../src/modules/yandex/stocks/placement';
import { FEATURE } from '../../src/modules/telegram/bots/shared/features.domain';
import { inMemoryModel } from '../helpers/in-memory-model';

// Настоящий bcrypt, но со шпионом на compare: свойство модуля не
// переопределяется через vi.spyOn, поэтому обёртка ставится на уровне модуля.
vi.mock('bcrypt', async (importOriginal) => {
  const actual = await importOriginal<typeof import('bcrypt')>();
  return { ...actual, compare: vi.fn(actual.compare) };
});

const INITIAL = 'tg_rules_2026';
const ADMIN_ID = '309809755';
const SELLER_ID = '222';

/**
 * Вход продавцов в CRM. Как и у админки, первым делом проверяется то, что
 * должно быть ЗАПРЕЩЕНО: общий стартовый пароль открывает чужие токены Маркета
 * каждому, кто знает ник, — если его не заставить сменить.
 */
describe('crm-auth.domain', () => {
  it('логин нормализуется: без @, без регистра, без пробелов', () => {
    expect(normalizeLogin('  @@Vasya_Shop ')).toBe('vasya_shop');
  });

  it('один ник у разных id — неоднозначен', () => {
    const rows = [
      { telegramUserId: '1', status: 'approved' },
      { telegramUserId: '2', status: 'approved' },
    ];
    expect(resolveAccount(rows).kind).toBe('ambiguous');
  });

  it('несколько botId у одного id — берётся одобренная запись', () => {
    const rows = [
      { telegramUserId: '1', status: 'rejected', botId: 'a' },
      { telegramUserId: '1', status: 'approved', botId: 'b' },
    ];
    const result = resolveAccount(rows);
    expect(result.kind === 'found' && result.access?.botId).toBe('b');
  });

  it('числовой логин — это id, даже без записей доступа (админ)', () => {
    expect(resolveAccount([], ADMIN_ID)).toEqual({
      kind: 'found',
      telegramUserId: ADMIN_ID,
      access: null,
    });
  });

  it('новый пароль: не короче 10, не стартовый, не текущий', () => {
    expect(validateNewPassword('short', 'x', INITIAL)).toMatch(/10/);
    expect(validateNewPassword(INITIAL, 'x', INITIAL)).toMatch(/Стартовый/);
    expect(validateNewPassword('same-password-1', 'same-password-1', INITIAL)).toBeTruthy();
    expect(validateNewPassword('my-own-password', INITIAL, INITIAL)).toBeNull();
  });
});

describe('CrmAuthService + CrmJwtGuard', { timeout: 60_000 }, () => {
  let access: ReturnType<typeof inMemoryModel>;
  let stores: ReturnType<typeof inMemoryModel>;
  let crm: ReturnType<typeof inMemoryModel>;
  let connections: ReturnType<typeof inMemoryModel>;
  let auth: CrmAuthService;
  let guard: CrmJwtGuard;
  let adminAuth: AdminAuthService;
  let adminGuard: AdminJwtGuard;
  let adminPassword: string;
  let admins: Set<string>;

  const STORE = (telegramUserId: string) => ({
    telegramUserId,
    name: 'Всё для часов',
    campaign_id: '12345678',
    business_id: '87654321',
    token: 'ACMA:секрет',
    stores: [{ campaignId: '12345678', placementType: 'FBS' }],
  });

  beforeEach(async () => {
    admins = new Set([ADMIN_ID]);
    access = inMemoryModel([
      {
        telegramUserId: SELLER_ID,
        botId: '999',
        status: 'approved',
        username: 'Vasya',
        firstName: 'Вася',
        features: { [FEATURE.REPORT_PROFIT]: false },
      },
      // Тот же человек у второго бота — без доступа.
      { telegramUserId: SELLER_ID, botId: '888', status: 'new', username: 'Vasya' },
      { telegramUserId: '333', botId: '999', status: 'pending', username: 'petya' },
      { telegramUserId: '444', botId: '999', status: 'rejected', username: 'kolya' },
      { telegramUserId: '555', botId: '999', status: 'approved', username: 'nostore' },
      // Без магазина ЯМ, но с площадкой Ozon/WB (TASK-192).
      { telegramUserId: '556', botId: '999', status: 'approved', username: 'ozonly' },
      { telegramUserId: '557', botId: '999', status: 'approved', username: 'wbrejected' },
      { telegramUserId: '558', botId: '999', status: 'pending', username: 'ozonpending' },
      // Один ник у двух разных людей.
      { telegramUserId: '601', botId: '999', status: 'approved', username: 'twin' },
      { telegramUserId: '602', botId: '999', status: 'approved', username: 'Twin' },
    ]);
    stores = inMemoryModel([
      STORE(SELLER_ID),
      STORE('333'),
      STORE('444'),
      STORE(ADMIN_ID),
      STORE('601'),
    ]);
    connections = inMemoryModel([
      { telegramUserId: '556', marketplace: 'ozon', status: 'ok', accounts: [] },
      // Ключ отвергнут площадкой — продавца всё равно пускаем: заменить ключ можно только в CRM.
      { telegramUserId: '557', marketplace: 'wb', status: 'rejected', accounts: [] },
      { telegramUserId: '558', marketplace: 'ozon', status: 'ok', accounts: [] },
      // ЯМ + Ozon — две площадки: дашборд «Площадки» (TASK-191).
      { telegramUserId: '333', marketplace: 'ozon', status: 'ok', accounts: [] },
      { telegramUserId: '601', marketplace: 'wb', status: 'rejected', accounts: [] },
    ]);
    crm = inMemoryModel();
    crm.uniqueBy('telegramUserId');
    const adminModel = inMemoryModel();
    adminModel.uniqueBy('key');

    const moduleRef = await Test.createTestingModule({
      imports: [JwtModule.register({})],
      controllers: [CrmAuthController],
      providers: [
        CrmAuthService,
        CrmJwtGuard,
        AdminAuthService,
        AdminJwtGuard,
        AdminCredentialService,
        CrmCredentialService,
        UserAccessService,
        YandexMarketService,
        MarketplaceConnectionService,
        { provide: getModelToken(MarketplaceConnection.name), useValue: connections },
        { provide: getModelToken(AdminCredential.name), useValue: adminModel },
        { provide: getModelToken(CrmCredential.name), useValue: crm },
        { provide: getModelToken(UserAccess.name), useValue: access },
        { provide: getModelToken(YandexMarket.name), useValue: stores },
        {
          provide: AppConfigService,
          useValue: {
            isAdmin: (id: number | string) => admins.has(String(id)),
            crmInitialPassword: INITIAL,
          },
        },
      ],
    }).compile();

    adminPassword = (await moduleRef.get(AdminCredentialService).ensure())!;
    auth = moduleRef.get(CrmAuthService);
    guard = moduleRef.get(CrmJwtGuard);
    adminAuth = moduleRef.get(AdminAuthService);
    adminGuard = moduleRef.get(AdminJwtGuard);
  });

  /**
   * Контекст маршрута. `allowPending` — стоит ли на нём пометка «до смены пароля»,
   * `withoutPlatform` — пометка «и без площадки».
   */
  function contextOf(
    token: string | undefined,
    allowPending = false,
    features?: string[],
    withoutPlatform = false,
  ) {
    const handler = () => undefined;
    if (allowPending) Reflect.defineMetadata(ALLOW_PENDING_PASSWORD_CHANGE, true, handler);
    if (features) Reflect.defineMetadata(REQUIRE_FEATURE, features, handler);
    if (withoutPlatform) Reflect.defineMetadata(ALLOW_WITHOUT_PLATFORM, true, handler);
    const request: Record<string, any> = {
      headers: { authorization: token ? `Bearer ${token}` : undefined },
    };
    return {
      request,
      context: {
        switchToHttp: () => ({ getRequest: () => request }),
        getHandler: () => handler,
        getClass: () => class {},
      } as never,
    };
  }

  describe('вход', () => {
    it('по нику с любым регистром и @ — первый вход требует смены пароля', async () => {
      const session = await auth.login('@VASYA', INITIAL);
      expect(session.mustChangePassword).toBe(true);
      expect(crm.documents).toHaveLength(1);
      expect(crm.documents[0].telegramUserId).toBe(SELLER_ID);
      // Хранится хеш, а не пароль.
      expect(crm.documents[0].passwordHash).not.toBe(INITIAL);
    });

    it('по числовому id — так же, как по нику', async () => {
      const session = await auth.login(SELLER_ID, INITIAL);
      const user = await auth.verify(session.token);
      expect(user).toMatchObject({
        telegramUserId: SELLER_ID,
        isAdmin: false,
        mustChangePassword: true,
        username: 'Vasya',
        name: 'Вася',
      });
    });

    it('ник у двух разных людей → 409 с подсказкой войти по id', async () => {
      await expect(auth.login('twin', INITIAL)).rejects.toThrow(ConflictException);
      await expect(auth.login('twin', INITIAL)).rejects.toThrow(/Telegram id/);
    });

    it.each([
      ['pending', 'petya'],
      ['rejected', 'kolya'],
      ['pending с подключением Ozon', 'ozonpending'],
    ])('%s с верным паролем → 403 «нет доступа», учётка не создаётся', async (_, login) => {
      const error = await auth.login(login, INITIAL).catch((e) => e);
      expect(error).toBeInstanceOf(ForbiddenException);
      expect(error.getResponse().code).toBe(CRM_NO_ACCESS);
      expect(crm.documents).toHaveLength(0);
    });

    it.each([
      ['pending', 'petya'],
      ['без площадок', 'nostore'],
    ])('%s с неверным паролем → общий 401: без пароля о доступе не узнать', async (_, login) => {
      await expect(auth.login(login, 'не тот')).rejects.toThrow(UnauthorizedException);
    });

    it.each([
      ['с подключением Ozon', 'ozonly', '556'],
      ['с отвергнутым ключом WB', 'wbrejected', '557'],
    ])('без магазина ЯМ, %s → входит; профиль без магазина (TASK-192)', async (_, login, id) => {
      const session = await auth.login(login, INITIAL);
      const user = await auth.verify(session.token);
      expect(user.telegramUserId).toBe(id);

      const me = await auth.me(user);
      expect(me.store).toBeNull();
      // Разделы магазина ЯМ отдаёт только `/ym/stores/:key` — в профиле аккаунта их нет.
      expect(me.sections).toContain('connections');
      expect(me.sections).not.toContain('ym-orders');
    });

    it('одобренный без площадок → входит, видит только «Подключения», профиль и помощь (TASK-193)', async () => {
      const session = await auth.login('nostore', INITIAL);
      expect(crm.documents).toHaveLength(1);

      const me = await auth.me(await auth.verify(session.token));
      expect(me.store).toBeNull();
      expect(me.sections).toEqual(['connections', 'profile', 'help']);
    });

    it('несуществующий логин → 401', async () => {
      await expect(auth.login('nobody', INITIAL)).rejects.toThrow(UnauthorizedException);
      expect(crm.documents).toHaveLength(0);
    });

    it('неверный пароль → 401', async () => {
      await expect(auth.login('vasya', 'не тот')).rejects.toThrow(UnauthorizedException);
    });

    it('bcrypt выполняется и для несуществующего логина', async () => {
      // Иначе время ответа выдавало бы, кто есть в базе.
      const compare = vi.mocked(bcrypt.compare);
      compare.mockClear();
      await expect(auth.login('nobody', INITIAL)).rejects.toThrow(UnauthorizedException);
      expect(compare).toHaveBeenCalledTimes(1);
    });

    it('админ входит по id; без площадок — как продавец, только три раздела (TASK-193)', async () => {
      const session = await auth.login(ADMIN_ID, INITIAL);
      expect((await auth.verify(session.token)).isAdmin).toBe(true);

      admins.add('777');
      const bare = await auth.verify((await auth.login('777', INITIAL)).token);
      expect((await auth.me(bare)).sections).toEqual(['connections', 'profile', 'help']);
    });

    it('после пяти промахов — блокировка с числом минут, до сверки пароля', async () => {
      for (let i = 0; i < MAX_ATTEMPTS; i += 1) {
        await expect(auth.login('vasya', 'не тот')).rejects.toThrow(UnauthorizedException);
      }

      const compare = vi.mocked(bcrypt.compare);
      compare.mockClear();
      // Даже верный пароль не пускает, и bcrypt не вызывается вовсе.
      await expect(auth.login('@Vasya', INITIAL)).rejects.toThrow(/через 15 мин/);
      expect(compare).not.toHaveBeenCalled();
    });
  });

  describe('гвард', () => {
    it('до смены пароля пускает только помеченные маршруты', async () => {
      const { token } = await auth.login('vasya', INITIAL);

      const allowed = contextOf(token, true);
      expect(await guard.canActivate(allowed.context)).toBe(true);
      expect(allowed.request.crmUser.telegramUserId).toBe(SELLER_ID);

      const other = contextOf(token);
      const error = await guard.canActivate(other.context).catch((e) => e);
      expect(error).toBeInstanceOf(ForbiddenException);
      expect(error.getResponse().code).toBe(PASSWORD_CHANGE_REQUIRED);
    });

    it('смена пароля: новый токен ходит везде, старый — 401, стартовый больше не пускает', async () => {
      const first = await auth.login('vasya', INITIAL);
      const next = await auth.changePassword(SELLER_ID, INITIAL, 'my-own-password');

      expect(next.mustChangePassword).toBe(false);
      expect(await guard.canActivate(contextOf(next.token).context)).toBe(true);
      await expect(guard.canActivate(contextOf(first.token, true).context)).rejects.toThrow(
        UnauthorizedException,
      );

      await expect(auth.login('vasya', INITIAL)).rejects.toThrow(UnauthorizedException);
      const again = await auth.login('vasya', 'my-own-password');
      expect(again.mustChangePassword).toBe(false);
    });

    it('стартовый и короткий пароли не принимаются, неверный текущий — 400', async () => {
      await auth.login('vasya', INITIAL);
      await expect(auth.changePassword(SELLER_ID, INITIAL, INITIAL)).rejects.toThrow(
        BadRequestException,
      );
      await expect(auth.changePassword(SELLER_ID, INITIAL, 'short')).rejects.toThrow(
        BadRequestException,
      );
      await expect(auth.changePassword(SELLER_ID, 'не тот', 'my-own-password')).rejects.toThrow(
        /Текущий пароль неверен/,
      );
      // Коды — по ним фронт ставит ошибку под нужное поле.
      const weak = await auth.changePassword(SELLER_ID, INITIAL, 'short').catch((e) => e);
      expect(weak.getResponse().code).toBe(WEAK_PASSWORD);
      const wrong = await auth
        .changePassword(SELLER_ID, 'не тот', 'my-own-password')
        .catch((e) => e);
      expect(wrong.getResponse().code).toBe(WRONG_CURRENT_PASSWORD);
    });

    it('отзыв доступа в боте закрывает CRM на следующем запросе', async () => {
      const { token } = await auth.login('vasya', INITIAL);
      access.documents.find((d) => d.botId === '999' && d.telegramUserId === SELLER_ID)!.status =
        'rejected';

      await expect(guard.canActivate(contextOf(token, true).context)).rejects.toThrow(
        /Доступ отозван/,
      );
    });

    it('без заголовка и с мусором — 401', async () => {
      await expect(guard.canActivate(contextOf(undefined, true).context)).rejects.toThrow(
        UnauthorizedException,
      );
      await expect(guard.canActivate(contextOf('мусор', true).context)).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  describe('без площадки — только маршруты @AllowWithoutPlatform (TASK-193)', () => {
    async function nostoreToken(): Promise<string> {
      await auth.login('nostore', INITIAL);
      return (await auth.changePassword('555', INITIAL, 'my-own-password')).token;
    }

    it('помеченный маршрут пускает, остальные — 403 NO_PLATFORM', async () => {
      const token = await nostoreToken();
      expect(await guard.canActivate(contextOf(token, false, undefined, true).context)).toBe(true);

      const error = await guard.canActivate(contextOf(token).context).catch((e) => e);
      expect(error).toBeInstanceOf(ForbiddenException);
      expect(error.getResponse().code).toBe(NO_PLATFORM);
    });

    it('первый ключ Ozon открывает остальное: вход, разделы и маршруты', async () => {
      const token = await nostoreToken();
      // То, что пишет `OzonConnectionService.connect` после проверки ключа.
      await connections.create({ telegramUserId: '555', marketplace: 'ozon', status: 'ok', accounts: [] });

      expect(await guard.canActivate(contextOf(token).context)).toBe(true);
      const session = await auth.login('nostore', 'my-own-password');
      const me = await auth.me(await auth.verify(session.token));
      expect(me.sections).toEqual(expect.arrayContaining(['connections', 'profile', 'ym-settings']));
    });

    it('у продавца с магазином ЯМ пометка не нужна', async () => {
      await auth.login('vasya', INITIAL);
      const { token } = await auth.changePassword(SELLER_ID, INITIAL, 'my-own-password');
      expect(await guard.canActivate(contextOf(token).context)).toBe(true);
    });

    it('пометка стоит ровно на маршрутах «Подключений», профиля, помощи и входа', () => {
      const marked = (target: object) => Reflect.getMetadata(ALLOW_WITHOUT_PLATFORM, target) === true;
      for (const controller of [
        CrmAuthController,
        CrmConnectionsController,
        CrmMarketplacesController,
        CrmProfileController,
      ]) {
        expect(marked(controller), controller.name).toBe(true);
      }
      // Ozon/WB — только запись ключа, не весь контроллер площадки.
      expect(marked(CrmOzonController)).toBe(false);
      expect(marked(CrmOzonController.prototype.connect)).toBe(true);
      expect(marked(CrmWbController)).toBe(false);
      expect(marked(CrmWbController.prototype.connect)).toBe(true);
      expect(marked(CrmFinanceController)).toBe(false);
      // Токен ЯМ — чтобы карточка ЯМ сказала «подключите в боте» (409), а не NO_PLATFORM.
      expect(marked(CrmStoresController)).toBe(false);
      expect(marked(CrmStoresController.prototype.replaceToken)).toBe(true);
    });
  });

  describe('сброс пароля из админ-панели', () => {
    it('вход пишет lastLoginAt — его показывает карточка продавца', async () => {
      expect(await auth.crmState(SELLER_ID)).toBeNull();
      await auth.login('vasya', INITIAL);

      const state = await auth.crmState(SELLER_ID);
      expect(state?.lastLoginAt).toBeInstanceOf(Date);
      expect(state?.mustChangePassword).toBe(true);
      expect(state).not.toHaveProperty('passwordHash');
    });

    it('сброс: сессии гаснут, вход стартовым паролем снова требует смены', async () => {
      await auth.login('vasya', INITIAL);
      const own = await auth.changePassword(SELLER_ID, INITIAL, 'my-own-password');
      expect(await guard.canActivate(contextOf(own.token).context)).toBe(true);

      // В ту же миллисекунду, что и смена: версия всё равно обязана сдвинуться.
      const frozen = (await auth.crmState(SELLER_ID))!.passwordChangedAt.getTime();
      const now = vi.spyOn(Date, 'now').mockReturnValue(frozen);
      const state = await auth.resetPassword(SELLER_ID);
      now.mockRestore();

      expect(state.mustChangePassword).toBe(true);
      expect(state.passwordChangedAt.getTime()).toBeGreaterThan(frozen);
      expect(state.lastLoginAt).toBeInstanceOf(Date);
      await expect(guard.canActivate(contextOf(own.token).context)).rejects.toThrow(
        UnauthorizedException,
      );

      await expect(auth.login('vasya', 'my-own-password')).rejects.toThrow(UnauthorizedException);
      const again = await auth.login('vasya', INITIAL);
      expect(again.mustChangePassword).toBe(true);
    });

    it('сброс снимает блокировку промахов — и по нику, и по id', async () => {
      await auth.login('vasya', INITIAL);
      for (let i = 0; i < MAX_ATTEMPTS; i += 1) {
        await expect(auth.login('vasya', 'не тот')).rejects.toThrow(UnauthorizedException);
        await expect(auth.login(SELLER_ID, 'не тот')).rejects.toThrow(UnauthorizedException);
      }
      await expect(auth.login('vasya', INITIAL)).rejects.toThrow(/через 15 мин/);

      await auth.resetPassword(SELLER_ID);

      expect((await auth.login('vasya', INITIAL)).mustChangePassword).toBe(true);
      expect((await auth.login(SELLER_ID, INITIAL)).mustChangePassword).toBe(true);
    });

    it('продавец в CRM не входил — 404, учётка не заводится', async () => {
      await expect(auth.resetPassword(SELLER_ID)).rejects.toThrow(NotFoundException);
      expect(await auth.crmState(SELLER_ID)).toBeNull();
    });
  });

  describe('разделение с админ-панелью (aud)', () => {
    it('админский токен не проходит CrmJwtGuard', async () => {
      const { token } = await adminAuth.login(ADMIN_ID, adminPassword);
      await expect(guard.canActivate(contextOf(token, true).context)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('CRM-токен админа не проходит AdminJwtGuard', async () => {
      const { token } = await auth.login(ADMIN_ID, INITIAL);
      const request = { headers: { authorization: `Bearer ${token}` } };
      const context = { switchToHttp: () => ({ getRequest: () => request }) } as never;
      await expect(adminGuard.canActivate(context)).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('/auth/me', () => {
    describe('дашборд «Площадки» — при фиче и ≥2 подключённых открытых площадках (TASK-191)', () => {
      const DASHBOARD = 'ym-marketplaces-dashboard';
      const userOf = (telegramUserId: string, features: Record<string, boolean>) => ({
        telegramUserId,
        isAdmin: false,
        mustChangePassword: false,
        features: { [FEATURE.FINANCE]: true, [FEATURE.MARKETPLACES_DASHBOARD]: true, ...features },
      });
      const sectionsOf = async (id: string, features: Record<string, boolean> = {}) =>
        (await auth.me(userOf(id, features))).sections;

      it('ЯМ + подключённый Ozon с открытой фичей → раздел есть', async () => {
        expect(await sectionsOf('333', { [FEATURE.OZON]: true })).toContain(DASHBOARD);
      });

      it.each([
        ['только ЯМ', SELLER_ID, { [FEATURE.OZON]: true, [FEATURE.WB]: true }],
        ['ЯМ + Ozon, но фича ozon закрыта', '333', {}],
        ['ЯМ + отвергнутый ключ WB', '601', { [FEATURE.WB]: true }],
        ['только Ozon, без ЯМ', '556', { [FEATURE.OZON]: true }],
      ])('%s → раздела нет', async (_, id, features) => {
        expect(await sectionsOf(id, features)).not.toContain(DASHBOARD);
      });

      it('две площадки, но фича дашборда выключена → раздела нет', async () => {
        const sections = await sectionsOf('333', {
          [FEATURE.OZON]: true,
          [FEATURE.MARKETPLACES_DASHBOARD]: false,
        });
        expect(sections).not.toContain(DASHBOARD);
      });
    });

    it('профиль без token/campaign_id/business_id', async () => {
      const session = await auth.login('vasya', INITIAL);
      const me = await auth.me(await auth.verify(session.token));

      expect(me).toMatchObject({
        telegramUserId: SELLER_ID,
        name: 'Вася',
        username: 'Vasya',
        mustChangePassword: true,
        store: { name: 'Всё для часов · FBS', placementType: 'FBS' },
      });
      expect(me.features[FEATURE.REPORT_PROFIT]).toBe(false);
      // Только разделы аккаунта: отчёты живут внутри магазина и приходят с
      // `/ym/stores/:key` — по модели открытого магазина, а не активного в боте.
      expect(me.sections).toEqual(expect.arrayContaining(['ym-stores', 'ym-settings', 'profile']));
      for (const inside of ['ym-dashboard', 'ym-orders', 'ym-profit', 'ym-price-list']) {
        expect(me.sections).not.toContain(inside);
      }

      const json = JSON.stringify(me);
      for (const secret of [
        'ACMA',
        '12345678',
        '87654321',
        'campaign_id',
        'business_id',
        '"token"',
      ]) {
        expect(json).not.toContain(secret);
      }
    });

    it('у админа открыты все фичи', async () => {
      const session = await auth.login(ADMIN_ID, INITIAL);
      const me = await auth.me(await auth.verify(session.token));
      expect(Object.values(me.features).every(Boolean)).toBe(true);
    });
  });

  describe('гейт фич (@RequireFeature)', () => {
    /** Токен после смены пароля — гейт фич проверяется на обычных маршрутах. */
    async function ready(login: string): Promise<string> {
      await auth.login(login, INITIAL);
      const id = login === 'vasya' ? SELLER_ID : login;
      return (await auth.changePassword(id, INITIAL, 'my-own-password')).token;
    }

    it('закрытая фича → 403 FEATURE_DISABLED с понятным текстом, продавец уже в запросе', async () => {
      const { context, request } = contextOf(await ready('vasya'), false, [FEATURE.REPORT_PROFIT]);
      const error = await guard.canActivate(context).catch((e) => e);

      expect(error).toBeInstanceOf(ForbiddenException);
      expect(error.getResponse().code).toBe(FEATURE_DISABLED);
      expect(error.getResponse().message).toMatch(/Прибыль.*администратор/s);
      // Журнал припишет отказ продавцу, а не `system`.
      expect(request.crmUser.telegramUserId).toBe(SELLER_ID);
    });

    it('открытая по умолчанию фича пропускает', async () => {
      const token = await ready('vasya');
      expect(await guard.canActivate(contextOf(token, false, [FEATURE.SCHEDULE]).context)).toBe(
        true,
      );
    });

    it('админ без UserAccess проходит даже выключенную по умолчанию фичу', async () => {
      const token = await ready(ADMIN_ID);
      expect(await guard.canActivate(contextOf(token, false, [FEATURE.TARIFF_CALC]).context)).toBe(
        true,
      );
    });

    it('неизвестный ключ — закрыто, в т.ч. у админа', async () => {
      const token = await ready(ADMIN_ID);
      const error = await guard
        .canActivate(contextOf(token, false, ['no_such_feature']).context)
        .catch((e) => e);
      expect(error).toBeInstanceOf(ForbiddenException);
      expect(error.getResponse().code).toBe(FEATURE_DISABLED);
    });

    it('FBY-экран у FBS-магазина → 403 с текстом бота, и у админа тоже', async () => {
      const token = await ready(ADMIN_ID);
      const error = await guard
        .canActivate(contextOf(token, false, [FEATURE.FBY]).context)
        .catch((e) => e);
      expect(error.getResponse()).toMatchObject({
        code: FBY_ONLY,
        message: fbyOnlyScreenText('FBS', { plain: true }),
      });
    });

    it('FBY-экран у FBY-магазина админа — открыт', async () => {
      stores.documents.find((d) => d.telegramUserId === ADMIN_ID)!.stores = [
        { campaignId: '12345678', placementType: 'FBY' },
      ];
      const token = await ready(ADMIN_ID);
      expect(await guard.canActivate(contextOf(token, false, [FEATURE.FBY]).context)).toBe(true);
    });
  });
});
