import { describe, it, expect } from 'vitest';
import {
  ADMIN_CB_PATTERN,
  REJECTION_COOLDOWN_MS,
  canPass,
  classifyUpdate,
  formatAdminCallback,
  hoursUntilRetry,
  isRejectionExpired,
  isStartCommand,
  parseAdminCallback,
  type TUpdateKind,
} from '../../src/modules/telegram/bots/shared/access.domain';
import type { TAccessStatus } from '../../src/database/schemas/user-access.schema';
import { MENU } from '../../src/modules/telegram/bots/price-changer-bot/menu.constants';

/**
 * Правила допуска — то место, где ошибка не даёт ни ошибки компиляции, ни
 * падения в рантайме: гейт просто начинает пускать не тех. Поэтому таблица
 * проверяется целиком, по всем сочетаниям.
 */
describe('canPass: таблица допуска', () => {
  const STATUSES: TAccessStatus[] = ['new', 'pending', 'approved', 'rejected'];
  const KINDS: TUpdateKind[] = [
    'start',
    'credText',
    'menu',
    'command',
    'onboardingCallback',
    'callback',
    'other',
  ];

  it('/start проходит при ЛЮБОМ статусе — иначе пользователю неоткуда узнать о решении', () => {
    for (const status of STATUSES) {
      expect(canPass(status, 'start')).toBe(true);
    }
  });

  it('approved проходит везде', () => {
    for (const kind of KINDS) {
      expect(canPass('approved', kind)).toBe(true);
    }
  });

  it('new пропускает только ввод кредов и подсказки по настройке — это и есть регистрация', () => {
    expect(canPass('new', 'credText')).toBe(true);
    expect(canPass('new', 'onboardingCallback')).toBe(true);
    for (const kind of ['menu', 'command', 'callback', 'other'] as TUpdateKind[]) {
      expect(canPass('new', kind)).toBe(false);
    }
  });

  it.each(['pending', 'rejected'] as TAccessStatus[])(
    '%s не пропускает ничего, кроме /start (креды вводить тоже нельзя)',
    (status) => {
      for (const kind of KINDS.filter((k) => k !== 'start')) {
        expect(canPass(status, kind)).toBe(false);
      }
    },
  );

  it('покрыты все сочетания статуса и типа апдейта', () => {
    for (const status of STATUSES) {
      for (const kind of KINDS) {
        expect(typeof canPass(status, kind)).toBe('boolean');
      }
    }
  });
});

describe('classifyUpdate', () => {
  it('распознаёт /start во всех формах — в группах и по deep-link приходят расширенные', () => {
    expect(isStartCommand('/start')).toBe(true);
    expect(isStartCommand('/start@YandexMarketBot')).toBe(true);
    expect(isStartCommand('/start payload')).toBe(true);
    expect(isStartCommand('/start@YandexMarketBot payload')).toBe(true);
    expect(isStartCommand('/startup')).toBe(false);
    expect(isStartCommand('старт')).toBe(false);
  });

  it('кнопка меню — это не свободный текст, иначе она уйдёт в разбор кредов', () => {
    expect(classifyUpdate({ text: MENU.PROFILE })).toBe('menu');
    expect(classifyUpdate({ text: MENU.SETTINGS })).toBe('menu');
  });

  it('свободный текст — кандидат в креды', () => {
    expect(classifyUpdate({ text: 'campaign_id: 12345' })).toBe('credText');
    expect(classifyUpdate({ text: '123456789' })).toBe('credText');
  });

  it('прочие команды и колбэки', () => {
    expect(classifyUpdate({ text: '/profile' })).toBe('command');
    expect(classifyUpdate({ callbackData: 'settings_api' })).toBe('onboardingCallback');
    expect(classifyUpdate({ callbackData: 'help_api_setup' })).toBe('onboardingCallback');
    expect(classifyUpdate({ callbackData: 'check_settings' })).toBe('callback');
  });

  it('документ, фото и прочее — other', () => {
    expect(classifyUpdate({})).toBe('other');
  });
});

describe('суточный запрет после отказа', () => {
  const base = new Date('2026-07-28T12:00:00Z');

  it('не истёк за минуту до суток', () => {
    const now = new Date(base.getTime() + REJECTION_COOLDOWN_MS - 60_000);
    expect(isRejectionExpired(base, now)).toBe(false);
  });

  it('истёк ровно в сутки — граница включительная', () => {
    const now = new Date(base.getTime() + REJECTION_COOLDOWN_MS);
    expect(isRejectionExpired(base, now)).toBe(true);
  });

  it('истёк через сутки и минуту', () => {
    const now = new Date(base.getTime() + REJECTION_COOLDOWN_MS + 60_000);
    expect(isRejectionExpired(base, now)).toBe(true);
  });

  it('без отметки об отказе запрета нет', () => {
    expect(isRejectionExpired(undefined, base)).toBe(true);
    expect(hoursUntilRetry(undefined, base)).toBe(0);
  });

  it('остаток округляется ВВЕРХ — «через 0 ч.» звучит как «уже можно»', () => {
    expect(hoursUntilRetry(base, new Date(base.getTime() + 1000))).toBe(24);
    expect(hoursUntilRetry(base, new Date(base.getTime() + 23.5 * 3600_000))).toBe(1);
    expect(hoursUntilRetry(base, new Date(base.getTime() + REJECTION_COOLDOWN_MS))).toBe(0);
  });
});

describe('callback_data админских кнопок', () => {
  it('формирование и разбор — обратимы', () => {
    for (const decision of ['approve', 'reject'] as const) {
      const data = formatAdminCallback(decision, '123456789');
      expect(parseAdminCallback(data)).toEqual({
        decision,
        telegramUserId: '123456789',
      });
    }
  });

  it('укладывается в лимит Telegram (64 байта) даже на длинном id', () => {
    const data = formatAdminCallback('approve', '9'.repeat(20));
    expect(Buffer.byteLength(data, 'utf8')).toBeLessThanOrEqual(64);
    expect(ADMIN_CB_PATTERN.test(data)).toBe(true);
  });

  it.each(['adm:xx:1', 'adm:ap:abc', 'adm:ap:', 'admx:ap:1', 'ap:1', 'main_menu', '', undefined])(
    'не разбирает мусор: %o',
    (data) => {
      expect(parseAdminCallback(data as string | undefined)).toBeNull();
    },
  );

  it('шаблон не цепляет обычные callback_data приложения', () => {
    for (const data of ['settings_api', 'check_settings', 'main_menu', 'confirm_yes']) {
      expect(ADMIN_CB_PATTERN.test(data)).toBe(false);
    }
  });
});
