import type { IStoreTitleSource } from './store-title';
import type { TAccessStatus } from '../../../../database/schemas/user-access.schema';
import type { TFeatureKey, TFeatureMap } from '../shared/features.domain';

import { placementOfCampaign } from '../../../yandex/stocks/placement';
import { b, code, esc } from '../../formatting/telegram-format';
import { FEATURE_KEYS, FEATURE_META, isFeatureOpen } from '../shared/features.domain';

import { withPlacement } from './store-title';

/**
 * Профиль — ОДИН текст на кнопку «📊 Мой профиль» и на `/profile`.
 *
 * Экранов было два, и они разошлись до неузнаваемости: кнопка показывала три
 * поля и заголовок «Мой профиль», команда — шесть полей и «Ваш профиль», с
 * другой пунктуацией в подписях. Тот же дефект, что TASK-051 закрыл для
 * справки: пока текстов два, они гарантированно отстают друг от друга.
 *
 * За основу взят богатый вариант из `/profile` — статус доступа и дата
 * регистрации полезны, и терять их при переходе на кнопку незачем.
 */
export interface IProfileView {
  firstName?: string;
  lastName?: string;
  telegramUserId: number | string;
  username?: string;
  /** Админ из `TELEGRAM_ADMIN_IDS`: записи `UserAccess` у него нет, статус — не «заявка не подана». */
  isAdmin: boolean;
  accessStatus?: TAccessStatus;
  /** Подпись статуса доступа — одна на бот и CRM. */
  accessLabel: string;
  /** Голое имя магазина; пусто — имени нет. Модель — отдельным полем. */
  storeName: string;
  /** Модель размещения активной кампании (FBS/FBY/…), если кэш `stores` её знает. */
  placementType?: string;
  configured: boolean;
  registeredAt?: Date;
  /** Дата последней загрузки прайса; бот её не печатает, CRM — да. */
  priceListUpdatedAt?: Date | null;
  /** Открытые функции; считаются, только если источник передал флаги. */
  openFeatures?: IProfileFeature[];
}

export interface IProfileFeature {
  key: TFeatureKey;
  label: string;
}

/** Магазин в объёме, нужном профилю. Токен читается только как «есть/нет». */
export interface IProfileStore extends IStoreTitleSource {
  business_id?: string;
  token?: string;
}

/**
 * Сырые данные профиля — то, что знают вызывающие (бот из `ctx.from`, CRM из
 * `UserAccess`). Вьюху из них строит ОДНА функция `profileView`: пока «подключён
 * ли магазин», «как он называется» и «какой статус» считали два хендлера бота
 * каждый у себя, третья копия в CRM была бы делом времени.
 */
export interface IProfileSource {
  telegramUserId: number | string;
  firstName?: string;
  lastName?: string;
  username?: string;
  isAdmin: boolean;
  access?: { status?: TAccessStatus; createdAt?: Date | string } | null;
  store?: IProfileStore | null;
  priceListUpdatedAt?: Date | null;
  features?: TFeatureMap;
}

/** Подпись статуса доступа. */
export function accessLabel(status: TAccessStatus | undefined, isAdmin = false): string {
  // У админа записи UserAccess нет, и без этой ветки он видел «Заявка не
  // подана» — неправду о человеке, который раздаёт доступы остальным.
  if (isAdmin) return '👑 Администратор';

  switch (status) {
    case 'approved':
      return '✅ Выдан';
    case 'pending':
      return '⏳ Заявка на рассмотрении';
    case 'rejected':
      return '⛔ Отклонена';
    default:
      return '❌ Заявка не подана';
  }
}

export function profileView(source: IProfileSource): IProfileView {
  const { store, access } = source;
  const placementType = placementOfCampaign(store?.stores, store?.campaign_id);

  return {
    firstName: source.firstName,
    lastName: source.lastName,
    telegramUserId: source.telegramUserId,
    username: source.username,
    isAdmin: source.isAdmin,
    accessStatus: access?.status,
    accessLabel: accessLabel(access?.status, source.isAdmin),
    storeName: store?.name?.trim() ?? '',
    placementType,
    configured: !!(store?.campaign_id && store?.business_id && store?.token),
    registeredAt: access?.createdAt ? new Date(access.createdAt) : undefined,
    priceListUpdatedAt: source.priceListUpdatedAt,
    openFeatures:
      source.features === undefined
        ? undefined
        : FEATURE_KEYS.filter((key) => isFeatureOpen(source.features, key, placementType)).map(
            (key) => ({ key, label: FEATURE_META[key].label }),
          ),
  };
}

export function profileText(view: IProfileView): string {
  // Имя и фамилия — произвольный текст от пользователя: один символ `<`
  // в имени ломал разметку всего сообщения и давал 400 от Telegram.
  const name = [view.firstName, view.lastName].filter(Boolean).map(esc).join(' ');
  // Имя склеивается с моделью там же, где и во всём приложении (store-title.ts).
  const storeName = view.storeName ? withPlacement(view.storeName, view.placementType) : '';

  const lines = [
    `👤 ${b('Ваш профиль')}`,
    '',
    `👨‍💼 ${b('Пользователь:')} ${name || '—'}`,
    `🆔 ${b('ID:')} ${code(view.telegramUserId)}`,
    `📧 ${b('Username:')} @${esc(view.username) || 'не указан'}`,
    '',
    `🔑 ${b('Доступ:')} ${view.accessLabel}`,
    // Магазин называем по имени, а не «настройки заполнены»: продавцу важно
    // видеть, КУДА бот пишет, особенно если магазинов у него несколько.
    `🏪 ${b('Магазин:')} ${view.configured ? esc(storeName) || '✅ подключён' : '❌ не подключён'}`,
  ];

  if (view.registeredAt) {
    lines.push(`📅 ${b('Регистрация:')} ${view.registeredAt.toLocaleDateString('ru-RU')}`);
  }

  return lines.join('\n');
}
