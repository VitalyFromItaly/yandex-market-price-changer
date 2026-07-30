import type { TAccessStatus } from '../../../../database/schemas/user-access.schema';

import { b, code, esc } from '../../formatting/telegram-format';

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
  accessStatus?: TAccessStatus;
  /** Название подключённого магазина; пусто — магазин не подключён. */
  storeName?: string;
  configured: boolean;
  registeredAt?: Date;
}

/** Подпись статуса доступа. */
export function accessLabel(status: TAccessStatus | undefined): string {
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

export function profileText(view: IProfileView): string {
  // Имя и фамилия — произвольный текст от пользователя: один символ `<`
  // в имени ломал разметку всего сообщения и давал 400 от Telegram.
  const name = [view.firstName, view.lastName].filter(Boolean).map(esc).join(' ');

  const lines = [
    `👤 ${b('Ваш профиль')}`,
    '',
    `👨‍💼 ${b('Пользователь:')} ${name || '—'}`,
    `🆔 ${b('ID:')} ${code(view.telegramUserId)}`,
    `📧 ${b('Username:')} @${esc(view.username) || 'не указан'}`,
    '',
    `🔑 ${b('Доступ:')} ${accessLabel(view.accessStatus)}`,
    // Магазин называем по имени, а не «настройки заполнены»: продавцу важно
    // видеть, КУДА бот пишет, особенно если магазинов у него несколько.
    `🏪 ${b('Магазин:')} ${view.configured ? esc(view.storeName) || '✅ подключён' : '❌ не подключён'}`,
  ];

  if (view.registeredAt) {
    lines.push(`📅 ${b('Регистрация:')} ${view.registeredAt.toLocaleDateString('ru-RU')}`);
  }

  return lines.join('\n');
}
