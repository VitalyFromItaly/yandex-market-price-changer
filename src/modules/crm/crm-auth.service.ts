import type { CrmCredentialDocument } from '../../database/schemas/crm-credential.schema';

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';

import { AppConfigService } from '../../config/app-config.service';
import { AdminCredentialService } from '../../database/services/admin-credential.service';
import {
  CRM_BCRYPT_ROUNDS,
  CrmCredentialService,
} from '../../database/services/crm-credential.service';
import { UserAccessService } from '../../database/services/user-access.service';
import { YandexMarketService } from '../../database/services/yandex-market.service';
import { LoginThrottle, minutesLeft } from '../admin/login-throttle';
import { storeTitle } from '../telegram/bots/price-changer-bot/store-title';
import { allFeaturesEnabled, resolveFeatures } from '../telegram/bots/shared/features.domain';
import { placementOfCampaign } from '../yandex/stocks/placement';

import {
  CRM_AUDIENCE,
  CRM_NO_ACCESS,
  IMPERSONATION_FORBIDDEN,
  WEAK_PASSWORD,
  WRONG_CURRENT_PASSWORD,
  isNumericLogin,
  normalizeLogin,
  resolveAccount,
  validateNewPassword,
} from './crm-auth.domain';
import { visibleSections } from './crm-features.domain';

/** Сколько живёт выданный токен — как у админ-панели. */
export const CRM_TOKEN_TTL = '7d';

/**
 * Сколько живёт токен режима «за продавца». Коротко: это чужой кабинет с
 * полными правами, и забытая вкладка не должна держать его неделю.
 */
export const CRM_IMPERSONATION_TTL = '2h';

export interface ICrmTokenPayload {
  /** Telegram id продавца. */
  sub: string;
  /** Версия пароля — `passwordChangedAt` в миллисекундах. В токене режима «за продавца» — 0. */
  pwdv: number;
  /** Telegram id админа, вошедшего за продавца; нет — обычная сессия продавца. */
  imp?: string;
}

/** Кто вошёл — то, что гвард кладёт в запрос. */
export interface ICrmUser {
  telegramUserId: string;
  isAdmin: boolean;
  mustChangePassword: boolean;
  /**
   * Разрешённые фичи — из той же записи доступа, которую `verify` читает ради
   * статуса, так что гейт маршрута второго чтения Mongo не стоит. У админа
   * записи нет — всё открыто, как в `featureGate` бота.
   */
  features: Record<string, boolean>;
  /** Снимок для журнала: кто это был, без похода в другую коллекцию. */
  username?: string;
  name?: string;
  /** Админ, действующий за продавца (режим из карточки продавца в панели). */
  impersonatedBy?: string;
}

export interface ICrmSession {
  token: string;
  mustChangePassword: boolean;
}

/**
 * Профиль для фронта. Собирается ПЕРЕЧИСЛЕНИЕМ полей, не разворотом документа:
 * token / campaign_id / business_id не должны попасть в ответ ни при какой
 * будущей правке схемы.
 */
export interface ICrmMe {
  telegramUserId: string;
  name: string;
  username: string | null;
  isAdmin: boolean;
  mustChangePassword: boolean;
  store: { name: string; placementType: string | null } | null;
  features: Record<string, boolean>;
  /**
   * Разделы навигации, которые показать (имена маршрутов CRM), — белый список
   * из `visibleSections`. Сайдбар строится из него, а не из статичной таблицы.
   */
  sections: string[];
  /** Режим «за продавца»: кто из админов вошёл. null — продавец сам. */
  impersonation: { adminId: string } | null;
}

/**
 * Учётка CRM глазами админ-панели: когда входил и сменён ли стартовый пароль.
 * Хеша здесь нет по построению — поля перечислены, документ не разворачивается.
 */
export interface ICrmAccountState {
  lastLoginAt: Date | null;
  mustChangePassword: boolean;
  passwordChangedAt: Date;
}

function stateOf(credential: CrmCredentialDocument): ICrmAccountState {
  return {
    lastLoginAt: credential.lastLoginAt ?? null,
    mustChangePassword: credential.mustChangePassword,
    passwordChangedAt: credential.passwordChangedAt,
  };
}

const WRONG_CREDENTIALS = 'Неверный логин или пароль';
const NO_ACCESS = 'Нет доступа к CRM: заявка в боте не одобрена или магазин не подключён';

/**
 * Вход продавцов в CRM. Устроен по образцу AdminAuthService.
 *
 * JWT — обычный, подписан тем же секретом, что и токены админ-панели
 * (`AdminCredential.jwtSecret`: он уже в Mongo и переживает рестарты). Токены
 * двух панелей различаются аудиторией: CRM подписывает и проверяет `aud: crm`,
 * админский токен её не несёт, а `AdminAuthService.verify` отвергает любой
 * токен с аудиторией. Второй секрет ради этого не нужен.
 */
@Injectable()
export class CrmAuthService {
  private readonly logger = new Logger(CrmAuthService.name);
  private readonly throttle = new LoginThrottle();
  private initialHashPromise: Promise<string> | null = null;

  constructor(
    private readonly credentials: CrmCredentialService,
    private readonly adminCredentials: AdminCredentialService,
    private readonly access: UserAccessService,
    private readonly stores: YandexMarketService,
    private readonly config: AppConfigService,
    private readonly jwt: JwtService,
  ) {}

  /**
   * Вход по нику или Telegram id.
   *
   * Порядок значим, как в админке: блокировка → разбор логина → bcrypt → права.
   * bcrypt выполняется ВСЕГДА, в том числе когда логин не найден или доступа
   * нет, — иначе время ответа выдавало бы, кто есть в базе.
   */
  async login(rawLogin: string, password: string): Promise<ICrmSession> {
    return (await this.loginAs(rawLogin, password)).session;
  }

  /**
   * То же, плюс id вошедшего — для журнала (`CrmActionLogMiddleware`). В ответ
   * клиенту id не попадает: сессии он не нужен.
   */
  async loginAs(
    rawLogin: string,
    password: string,
  ): Promise<{ session: ICrmSession; telegramUserId: string }> {
    const login = normalizeLogin(rawLogin);
    const now = Date.now();

    const locked = this.throttle.lockedFor(login, now);
    if (locked > 0) {
      throw new UnauthorizedException(
        `Слишком много неудачных попыток. Попробуйте через ${minutesLeft(locked)} мин.`,
      );
    }

    const numeric = isNumericLogin(login);
    const rows = login ? await this.access.findByLogin(login) : [];
    const account = resolveAccount(rows, numeric ? login : undefined);

    if (account.kind === 'ambiguous') {
      // Не секрет и не промах пароля: ник действительно у двух людей, и
      // угадывать, чей магазин открыть, нельзя (решение crm_login).
      throw new ConflictException(
        'Этот ник есть у нескольких пользователей — войдите по Telegram id',
      );
    }

    const telegramUserId = account.kind === 'found' ? account.telegramUserId : undefined;
    let credential = telegramUserId ? await this.credentials.find(telegramUserId) : null;

    // Нет своей учётки (или нет человека) — сверяем со стартовым паролем.
    // Для несуществующего логина это и есть «bcrypt впустую» ради времени ответа.
    const passwordHash = credential?.passwordHash ?? (await this.initialHash());
    const passwordOk = await bcrypt.compare(password, passwordHash);

    const allowed =
      account.kind === 'found' &&
      (await this.isAllowed(account.telegramUserId, account.access?.status));

    if (!passwordOk || !allowed) {
      this.throttle.registerFailure(login, now);
      this.logger.warn(`Неудачный вход в CRM: ${login}`);
      // Отказ в доступе называется своим именем только при ВЕРНОМ пароле
      // (решение crm_no_access_message): «неверный пароль» отправил бы продавца
      // перебирать пароли, когда ему нужно в бот. Без пароля ответ прежний —
      // по нему не узнать, кто есть в базе.
      if (passwordOk && account.kind === 'found') {
        throw new ForbiddenException({ statusCode: 403, code: CRM_NO_ACCESS, message: NO_ACCESS });
      }
      throw new UnauthorizedException(WRONG_CREDENTIALS);
    }

    this.throttle.registerSuccess(login);

    if (!credential) {
      credential = await this.credentials.createInitial(telegramUserId, passwordHash, new Date());
    }
    await this.credentials.touchLogin(telegramUserId, new Date());
    this.logger.log(`Вход в CRM: ${telegramUserId}`);

    return {
      session: {
        token: await this.sign(telegramUserId, credential.passwordChangedAt),
        mustChangePassword: credential.mustChangePassword,
      },
      telegramUserId,
    };
  }

  /**
   * Проверка токена на каждом запросе.
   *
   * Всё, что может измениться после выдачи токена, читается ЗАНОВО: версия
   * пароля (смена пароля гасит старые токены) и статус доступа в боте (отзыв
   * закрывает CRM на следующем же запросе, а не через семь дней).
   */
  async verify(token: string): Promise<ICrmUser> {
    const secret = await this.secret();

    let payload: ICrmTokenPayload;
    try {
      payload = await this.jwt.verifyAsync<ICrmTokenPayload>(token, {
        secret,
        audience: CRM_AUDIENCE,
      });
    } catch {
      throw new UnauthorizedException('Сессия истекла, войдите заново');
    }

    if (!payload.sub) throw new UnauthorizedException('Сессия истекла, войдите заново');
    if (payload.imp !== undefined) return await this.verifyImpersonation(payload.sub, payload.imp);

    const credential = await this.credentials.find(payload.sub);
    if (!credential || credential.passwordChangedAt?.getTime() !== payload.pwdv) {
      throw new UnauthorizedException('Сессия истекла, войдите заново');
    }

    const isAdmin = this.config.isAdmin(payload.sub);
    // Читается и у админа: записи доступа у него обычно нет, но если есть —
    // из неё берутся ник и имя для журнала. Админов единицы.
    const rows = await this.access.findByLogin(payload.sub);
    if (!isAdmin && !rows.some((row) => row.status === 'approved')) {
      throw new UnauthorizedException('Доступ отозван');
    }
    const account = resolveAccount(rows, payload.sub);
    const access = account.kind === 'found' ? account.access : null;

    return {
      telegramUserId: payload.sub,
      isAdmin,
      mustChangePassword: credential.mustChangePassword,
      // Админ проходит featureGate бота целиком — CRM говорит то же самое.
      features: isAdmin ? allFeaturesEnabled() : resolveFeatures(access?.features),
      username: access?.username || undefined,
      name: [access?.firstName, access?.lastName].filter(Boolean).join(' ') || undefined,
    };
  }

  /**
   * Токен режима «за продавца» — его выдаёт только админ-панель
   * (`AccessController.impersonateCrm`), админ взят из её JWT.
   *
   * Продавец должен быть таким, которого CRM пустила бы саму: одобрен (или
   * админ) и с магазином. Учётка CRM продавцу не нужна и не создаётся: токен не
   * привязан к его паролю (`pwdv: 0`), а «последний вход» продавца остаётся его.
   */
  async impersonate(adminId: string, telegramUserId: string): Promise<ICrmSession> {
    if (!this.config.isAdmin(adminId)) throw new ForbiddenException('Только для администратора');
    const rows = await this.access.findByLogin(telegramUserId);
    const account = resolveAccount(rows, telegramUserId);
    const status = account.kind === 'found' ? account.access?.status : undefined;
    if (!(await this.isAllowed(telegramUserId, status))) {
      throw new ConflictException(
        'Продавец не может войти в CRM: доступ не одобрен или магазин не подключён',
      );
    }

    const payload: ICrmTokenPayload = { sub: telegramUserId, pwdv: 0, imp: adminId };
    this.logger.log(`Вход в CRM за продавца ${telegramUserId}: админ ${adminId}`);
    return {
      token: await this.jwt.signAsync(payload, {
        secret: await this.secret(),
        audience: CRM_AUDIENCE,
        expiresIn: CRM_IMPERSONATION_TTL,
      }),
      mustChangePassword: false,
    };
  }

  /**
   * Проверка токена режима «за продавца». Перечитывается, как у обычной сессии:
   * админ, убранный из TELEGRAM_ADMIN_IDS, теряет режим на следующем запросе, а
   * продавец с отозванным доступом закрыт и для админа. Фичи — продавца: ради
   * этого режим и существует (у админа были бы все).
   */
  private async verifyImpersonation(telegramUserId: string, adminId: string): Promise<ICrmUser> {
    if (!this.config.isAdmin(adminId)) {
      throw new UnauthorizedException('Режим «за продавца» закрыт: вы больше не администратор');
    }
    const isAdmin = this.config.isAdmin(telegramUserId);
    const rows = await this.access.findByLogin(telegramUserId);
    if (!isAdmin && !rows.some((row) => row.status === 'approved')) {
      throw new UnauthorizedException('Доступ продавца отозван');
    }
    const account = resolveAccount(rows, telegramUserId);
    const access = account.kind === 'found' ? account.access : null;
    return {
      telegramUserId,
      isAdmin,
      // Стартовый пароль продавца — его забота: админа экран смены не держит.
      mustChangePassword: false,
      features: isAdmin ? allFeaturesEnabled() : resolveFeatures(access?.features),
      username: access?.username || undefined,
      name: [access?.firstName, access?.lastName].filter(Boolean).join(' ') || undefined,
      impersonatedBy: adminId,
    };
  }

  /** Смена пароля закрыта в режиме «за продавца» — пароль личный. */
  assertNotImpersonating(user: ICrmUser): void {
    if (!user.impersonatedBy) return;
    throw new ForbiddenException({
      statusCode: 403,
      code: IMPERSONATION_FORBIDDEN,
      message: 'В режиме «за продавца» пароль продавца не меняется',
    });
  }

  /**
   * Модель активного магазина — из кэша `stores` (как у раскладки меню бота),
   * без живого запроса к Маркету. Неизвестная модель = не FBY.
   */
  async placementOf(telegramUserId: string): Promise<string | undefined> {
    const store = await this.stores.findByTelegramUser(telegramUserId);
    return store ? placementOfCampaign(store.stores, store.campaign_id) : undefined;
  }

  /** Смена пароля. Возвращает новый токен: старые гаснут по версии пароля. */
  async changePassword(
    telegramUserId: string,
    current: string,
    next: string,
  ): Promise<ICrmSession> {
    const now = Date.now();
    const key = `pwd:${telegramUserId}`;

    const locked = this.throttle.lockedFor(key, now);
    if (locked > 0) {
      throw new BadRequestException(
        `Слишком много неудачных попыток. Попробуйте через ${minutesLeft(locked)} мин.`,
      );
    }

    const credential = await this.credentials.find(telegramUserId);
    if (!credential) throw new UnauthorizedException('Сессия истекла, войдите заново');

    // 400, а не 401: неверный текущий пароль — ошибка формы, и фронт не должен
    // из-за неё выкидывать продавца на экран входа.
    if (!(await bcrypt.compare(current, credential.passwordHash))) {
      this.throttle.registerFailure(key, now);
      throw new BadRequestException({
        statusCode: 400,
        code: WRONG_CURRENT_PASSWORD,
        message: 'Текущий пароль неверен',
      });
    }
    this.throttle.registerSuccess(key);

    const problem = validateNewPassword(next, current, this.config.crmInitialPassword);
    if (problem) {
      throw new BadRequestException({ statusCode: 400, code: WEAK_PASSWORD, message: problem });
    }

    // Версия обязана сдвинуться даже при смене в ту же миллисекунду, иначе
    // старый токен остался бы валидным.
    const previous = credential.passwordChangedAt?.getTime() ?? 0;
    const at = new Date(Math.max(now, previous + 1));

    const updated = await this.credentials.changePassword(
      telegramUserId,
      await bcrypt.hash(next, CRM_BCRYPT_ROUNDS),
      at,
    );
    if (!updated) throw new UnauthorizedException('Сессия истекла, войдите заново');

    this.logger.log(`Смена пароля CRM: ${telegramUserId}`);
    return {
      token: await this.sign(telegramUserId, updated.passwordChangedAt),
      mustChangePassword: false,
    };
  }

  /**
   * Состояние учётки для карточки продавца в админ-панели. Только даты и флаг —
   * хеш наружу не выходит. `null` — продавец в CRM ещё не входил.
   */
  async crmState(telegramUserId: string): Promise<ICrmAccountState | null> {
    const credential = await this.credentials.find(telegramUserId);
    return credential ? stateOf(credential) : null;
  }

  /**
   * Сброс пароля из админ-панели: стартовый пароль и обязательная смена.
   *
   * Сессии гасит сдвиг `passwordChangedAt` — это `pwdv` в токене, и `verify`
   * отвечает 401 на любой прежний токен. Документ не удаляется: удаление дало
   * бы тот же вход со стартовым паролем, но стёрло бы «последний вход», ради
   * которого админ и открыл карточку. Блокировка промахов снимается: продавец,
   * который забыл пароль, как раз и нажимал его пять раз.
   */
  async resetPassword(telegramUserId: string): Promise<ICrmAccountState> {
    const credential = await this.credentials.find(telegramUserId);
    if (!credential) {
      throw new NotFoundException('Продавец в CRM ещё не входил — пароль и так стартовый');
    }

    // Версия обязана сдвинуться даже в ту же миллисекунду — довод changePassword.
    const previous = credential.passwordChangedAt?.getTime() ?? 0;
    const at = new Date(Math.max(Date.now(), previous + 1));

    const updated = await this.credentials.resetToInitial(
      telegramUserId,
      await this.initialHash(),
      at,
    );
    if (!updated) {
      throw new NotFoundException('Продавец в CRM ещё не входил — пароль и так стартовый');
    }

    this.throttle.registerSuccess(normalizeLogin(telegramUserId));
    this.throttle.registerSuccess(`pwd:${telegramUserId}`);
    const rows = await this.access.findByLogin(telegramUserId);
    for (const row of rows) {
      if (row.username) this.throttle.registerSuccess(normalizeLogin(row.username));
    }

    this.logger.log(`Сброс пароля CRM из панели: ${telegramUserId}`);
    return stateOf(updated);
  }

  /** Профиль вошедшего — без идентификаторов магазина и токена Маркета. */
  async me(user: ICrmUser): Promise<ICrmMe> {
    const store = await this.stores.findByTelegramUser(user.telegramUserId);
    const placementType = store ? placementOfCampaign(store.stores, store.campaign_id) : undefined;

    return {
      telegramUserId: user.telegramUserId,
      name: user.name ?? '',
      username: user.username ?? null,
      isAdmin: user.isAdmin,
      mustChangePassword: user.mustChangePassword,
      store: store
        ? { name: storeTitle(store, 'Магазин'), placementType: placementType ?? null }
        : null,
      // Фичи уже разрешены в `verify` (админ — всё открыто).
      features: user.features,
      // Разделы аккаунта; разделы магазина отдаёт `/ym/stores/:key` — по модели
      // магазина, открытого в вебе, а не активного в боте.
      sections: visibleSections(user.features, placementType, 'account'),
      impersonation: user.impersonatedBy ? { adminId: user.impersonatedBy } : null,
    };
  }

  /**
   * Пускать ли в CRM: только тех, кто уже пользуется ботом (решение
   * crm_audience) — одобренный продавец или админ, и в обоих случаях с
   * подключённым магазином.
   */
  private async isAllowed(telegramUserId: string, status: string | undefined): Promise<boolean> {
    if (!this.config.isAdmin(telegramUserId) && status !== 'approved') return false;
    return await this.stores.isConfigured(telegramUserId);
  }

  private async sign(telegramUserId: string, passwordChangedAt: Date): Promise<string> {
    const payload: ICrmTokenPayload = { sub: telegramUserId, pwdv: passwordChangedAt.getTime() };
    return await this.jwt.signAsync(payload, {
      secret: await this.secret(),
      audience: CRM_AUDIENCE,
      expiresIn: CRM_TOKEN_TTL,
    });
  }

  private async secret(): Promise<string> {
    const credential = await this.adminCredentials.find();
    if (!credential) {
      throw new ServiceUnavailableException('Учётные данные ещё не созданы, попробуйте позже');
    }
    return credential.jwtSecret;
  }

  /**
   * Хеш стартового пароля — считается один раз на процесс. Им же сверяется
   * вход без учётки и заполняется новая учётка.
   */
  private async initialHash(): Promise<string> {
    this.initialHashPromise ??= bcrypt.hash(this.config.crmInitialPassword, CRM_BCRYPT_ROUNDS);
    return await this.initialHashPromise;
  }
}
