import { describe, it, expect, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import { JwtModule } from '@nestjs/jwt';
import { getModelToken } from '@nestjs/mongoose';
import { UnauthorizedException, ServiceUnavailableException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';

import { AdminAuthService } from '../../src/modules/admin/admin-auth.service';
import { AdminJwtGuard } from '../../src/modules/admin/admin-jwt.guard';
import { AdminCredentialService } from '../../src/database/services/admin-credential.service';
import { AdminCredential } from '../../src/database/schemas/admin-credential.schema';
import { AppConfigService } from '../../src/config/app-config.service';
import { LoginThrottle, MAX_ATTEMPTS, LOCK_MS, minutesLeft } from '../../src/modules/admin/login-throttle';
import { inMemoryModel } from '../helpers/in-memory-model';

const ADMIN_ID = '309809755';
const STRANGER_ID = '111222333';

/**
 * Вход в админ-панель. За ней лежат действия и сообщения пользователей, и
 * пароль там один на всех — то есть единственный секрет. Проверяется в первую
 * очередь то, что должно быть ЗАПРЕЩЕНО.
 */
describe('LoginThrottle', () => {
  const NOW = 1_700_000_000_000;

  it('пропускает, пока попыток меньше предела', () => {
    const throttle = new LoginThrottle();
    for (let i = 0; i < MAX_ATTEMPTS - 1; i += 1) throttle.registerFailure('a', NOW);
    expect(throttle.lockedFor('a', NOW)).toBe(0);
  });

  it('блокирует после исчерпания попыток', () => {
    const throttle = new LoginThrottle();
    for (let i = 0; i < MAX_ATTEMPTS; i += 1) throttle.registerFailure('a', NOW);
    expect(throttle.lockedFor('a', NOW)).toBeGreaterThan(0);
  });

  it('снимает блокировку по истечении срока и обнуляет счётчик', () => {
    // Без обнуления следующий же промах блокировал бы снова, и «15 минут»
    // превратились бы в «навсегда».
    const throttle = new LoginThrottle();
    for (let i = 0; i < MAX_ATTEMPTS; i += 1) throttle.registerFailure('a', NOW);

    expect(throttle.lockedFor('a', NOW + LOCK_MS + 1)).toBe(0);
    throttle.registerFailure('a', NOW + LOCK_MS + 1);
    expect(throttle.lockedFor('a', NOW + LOCK_MS + 2)).toBe(0);
  });

  it('успешный вход стирает историю промахов', () => {
    const throttle = new LoginThrottle();
    for (let i = 0; i < MAX_ATTEMPTS - 1; i += 1) throttle.registerFailure('a', NOW);
    throttle.registerSuccess('a');
    for (let i = 0; i < MAX_ATTEMPTS - 1; i += 1) throttle.registerFailure('a', NOW);
    expect(throttle.lockedFor('a', NOW)).toBe(0);
  });

  it('счётчик отдельный на каждый логин', () => {
    const throttle = new LoginThrottle();
    for (let i = 0; i < MAX_ATTEMPTS; i += 1) throttle.registerFailure('a', NOW);
    expect(throttle.lockedFor('b', NOW)).toBe(0);
  });

  it('остаток округляется вверх до минут', () => {
    expect(minutesLeft(61_000)).toBe(2);
    expect(minutesLeft(1)).toBe(1);
  });
});

describe('AdminCredentialService', () => {
  function build() {
    const model = inMemoryModel();
    model.uniqueBy('key');
    return { model, service: new AdminCredentialService(model as never) };
  }

  it('создаёт учётные данные и возвращает пароль при первом вызове', async () => {
    const { model, service } = build();
    const password = await service.ensure();

    expect(password).toHaveLength(24);
    expect(model.documents).toHaveLength(1);
    // Сам пароль не хранится нигде — только его хеш.
    expect(model.documents[0].passwordHash).not.toBe(password);
    expect(model.documents[0].jwtSecret).toBeTruthy();
  });

  it('при повторном старте НЕ создаёт и НЕ показывает пароль', async () => {
    // «Показывается один раз» — это буквально: пароль, повторяющийся в каждом
    // запуске, живёт в истории логов CapRover вечно.
    const { model, service } = build();
    await service.ensure();

    expect(await service.ensure()).toBeNull();
    expect(model.documents).toHaveLength(1);
  });

  it('гонка двух стартов не создаёт вторую пару и не показывает чужой пароль', async () => {
    const { model, service } = build();
    const [first, second] = await Promise.all([service.ensure(), service.ensure()]);

    expect(model.documents).toHaveLength(1);
    expect([first, second].filter(Boolean)).toHaveLength(1);
  });

  it('пароль состоит только из символов алфавита без похожих знаков', async () => {
    // Его читают глазами из логов: 0/O и 1/l/I там не место.
    const { service } = build();
    const password = await service.ensure();
    expect(password).toMatch(/^[A-HJ-NP-Za-km-z2-9]+$/);
  });

  describe('ADMIN_PASSWORD главнее базы', () => {
    const ENV_PASSWORD = 'очень-секретный-пароль';

    it('на пустой базе заводит учётные данные с паролем из окружения', async () => {
      const { model, service } = build();

      expect(await service.ensure(ENV_PASSWORD)).toBeNull();
      expect(model.documents).toHaveLength(1);
      expect(await bcrypt.compare(ENV_PASSWORD, model.documents[0].passwordHash)).toBe(true);
      expect(model.documents[0].jwtSecret).toBeTruthy();
    });

    it('пароль из окружения в лог НЕ печатается', async () => {
      // Он и так у того, кто задал переменную, а логи контейнера видит всякий,
      // у кого есть доступ к CapRover.
      const { service } = build();
      expect(await service.ensure(ENV_PASSWORD)).toBeNull();
    });

    it('перебивает уже сгенерированный пароль, а не уступает ему', async () => {
      // Обратное правило означало бы, что правка переменной в конфиге деплоя
      // не делает ничего: администратор «сменил» пароль, который не сменился.
      const { model, service } = build();
      const generated = await service.ensure();

      await service.ensure(ENV_PASSWORD);

      expect(model.documents).toHaveLength(1);
      expect(await bcrypt.compare(ENV_PASSWORD, model.documents[0].passwordHash)).toBe(true);
      expect(await bcrypt.compare(generated!, model.documents[0].passwordHash)).toBe(false);
    });

    it('смена значения переменной меняет пароль', async () => {
      const { model, service } = build();
      await service.ensure(ENV_PASSWORD);
      await service.ensure('другой-пароль-подлиннее');

      expect(model.documents).toHaveLength(1);
      expect(await bcrypt.compare('другой-пароль-подлиннее', model.documents[0].passwordHash)).toBe(
        true,
      );
    });

    it('jwtSecret переживает смену пароля', async () => {
      // Иначе каждый деплой с новым ADMIN_PASSWORD разлогинивал бы всех
      // администраторов, а секрет в базе именно для того и лежит, чтобы
      // переживать рестарт.
      const { model, service } = build();
      await service.ensure(ENV_PASSWORD);
      const secret = model.documents[0].jwtSecret;

      await service.ensure('другой-пароль-подлиннее');

      expect(model.documents[0].jwtSecret).toBe(secret);
    });

    it('неизменная переменная не перезаписывает хеш на каждом старте', async () => {
      // bcrypt со стоимостью 12 — это ~0,3 с и запись в Mongo; на каждый
      // рестарт без повода это лишнее. Плюс новый хеш того же пароля отличался
      // бы солью, то есть отличить «поменяли» от «не трогали» стало бы нельзя.
      const { model, service } = build();
      await service.ensure(ENV_PASSWORD);
      const hash = model.documents[0].passwordHash;

      await service.ensure(ENV_PASSWORD);

      expect(model.documents[0].passwordHash).toBe(hash);
    });

    it('убрали переменную — действует последний установленный пароль', async () => {
      // Молча генерировать новый нельзя: администратор остался бы с паролем,
      // которого он не видел, и без единой строчки об этом в логах.
      const { model, service } = build();
      await service.ensure(ENV_PASSWORD);

      expect(await service.ensure()).toBeNull();
      expect(await bcrypt.compare(ENV_PASSWORD, model.documents[0].passwordHash)).toBe(true);
    });

    it('пустая строка — это «не задан», а не пароль из нуля символов', async () => {
      // Забытый `ADMIN_PASSWORD=` в .env иначе открывал бы панель пустым
      // паролем. Приведение к undefined живёт в AppConfigService, здесь —
      // страховка на случай, если сюда всё же дойдёт пустая строка.
      const { service } = build();
      const password = await service.ensure('');

      expect(password).toHaveLength(24);
    });
  });
});

describe('AdminAuthService и AdminJwtGuard', () => {
  async function build() {
    const model = inMemoryModel();
    model.uniqueBy('key');

    const moduleRef = await Test.createTestingModule({
      imports: [JwtModule.register({})],
      providers: [
        AdminAuthService,
        AdminJwtGuard,
        AdminCredentialService,
        { provide: getModelToken(AdminCredential.name), useValue: model },
        {
          provide: AppConfigService,
          useValue: { isAdmin: (id: number | string) => String(id) === ADMIN_ID },
        },
      ],
    }).compile();

    const credentials = moduleRef.get(AdminCredentialService);
    const password = await credentials.ensure();

    return {
      auth: moduleRef.get(AdminAuthService),
      guard: moduleRef.get(AdminJwtGuard),
      password: password!,
      model,
    };
  }

  function contextOf(authorization?: string) {
    const request: Record<string, unknown> = { headers: { authorization } };
    return {
      request,
      context: { switchToHttp: () => ({ getRequest: () => request }) } as never,
    };
  }

  it('пускает администратора с верным паролем', async () => {
    const { auth, password } = await build();
    const { token } = await auth.login(ADMIN_ID, password);
    expect(token).toBeTruthy();
    expect(await auth.verify(token)).toBe(ADMIN_ID);
  });

  it('отклоняет верный пароль у чужого id', async () => {
    // Пароль общий, поэтому единственное, что отделяет постороннего от панели, —
    // список TELEGRAM_ADMIN_IDS.
    const { auth, password } = await build();
    await expect(auth.login(STRANGER_ID, password)).rejects.toThrow(UnauthorizedException);
  });

  it('отклоняет неверный пароль у администратора', async () => {
    const { auth } = await build();
    await expect(auth.login(ADMIN_ID, 'неверный')).rejects.toThrow(UnauthorizedException);
  });

  it('блокирует вход после пяти промахов подряд', async () => {
    const { auth, password } = await build();
    for (let i = 0; i < MAX_ATTEMPTS; i += 1) {
      await expect(auth.login(ADMIN_ID, 'неверный')).rejects.toThrow();
    }

    // Даже верный пароль теперь не проходит — иначе ограничитель бесполезен.
    await expect(auth.login(ADMIN_ID, password)).rejects.toThrow(/через \d+ мин/);
  });

  it('без учётных данных говорит про первый запуск, а не про неверный пароль', async () => {
    // Иначе администратор будет искать опечатку там, где её нет.
    const model = inMemoryModel();
    const moduleRef = await Test.createTestingModule({
      imports: [JwtModule.register({})],
      providers: [
        AdminAuthService,
        AdminCredentialService,
        { provide: getModelToken(AdminCredential.name), useValue: model },
        { provide: AppConfigService, useValue: { isAdmin: () => true } },
      ],
    }).compile();

    await expect(moduleRef.get(AdminAuthService).login(ADMIN_ID, 'что угодно')).rejects.toThrow(
      ServiceUnavailableException,
    );
  });

  it('отзыв админа закрывает панель немедленно, не дожидаясь истечения токена', async () => {
    const model = inMemoryModel();
    model.uniqueBy('key');
    const admins = new Set([ADMIN_ID]);

    const moduleRef = await Test.createTestingModule({
      imports: [JwtModule.register({})],
      providers: [
        AdminAuthService,
        AdminCredentialService,
        { provide: getModelToken(AdminCredential.name), useValue: model },
        { provide: AppConfigService, useValue: { isAdmin: (id: string) => admins.has(String(id)) } },
      ],
    }).compile();

    const credentials = moduleRef.get(AdminCredentialService);
    const password = await credentials.ensure();
    const auth = moduleRef.get(AdminAuthService);
    const { token } = await auth.login(ADMIN_ID, password!);

    admins.delete(ADMIN_ID);

    await expect(auth.verify(token)).rejects.toThrow(UnauthorizedException);
  });

  it('подделанный токен не проходит', async () => {
    const { auth, password } = await build();
    const { token } = await auth.login(ADMIN_ID, password);
    const tampered = `${token.slice(0, -3)}xyz`;
    await expect(auth.verify(tampered)).rejects.toThrow(UnauthorizedException);
  });

  it('гвард требует заголовок Authorization', async () => {
    const { guard } = await build();
    const { context } = contextOf(undefined);
    await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
  });

  it('гвард кладёт id вошедшего в запрос', async () => {
    const { guard, auth, password } = await build();
    const { token } = await auth.login(ADMIN_ID, password);
    const { context, request } = contextOf(`Bearer ${token}`);

    expect(await guard.canActivate(context)).toBe(true);
    expect(request.adminId).toBe(ADMIN_ID);
  });

  it('сбой создания учётных данных на старте не роняет приложение', async () => {
    // Бот и отчёты от панели не зависят; падение здесь означало бы, что
    // админка уронила рабочего бота.
    const { auth } = await build();
    vi.spyOn(auth as never, 'credentials', 'get').mockReturnValue({
      ensure: () => Promise.reject(new Error('mongo недоступна')),
    } as never);

    await expect(auth.onApplicationBootstrap()).resolves.toBeUndefined();
  });
});
