import { describe, expect, it } from 'vitest';

import { helpModel, helpText } from '../../src/modules/telegram/bots/price-changer-bot/help.text';
import { stepHelp } from '../../src/modules/telegram/bots/price-changer-bot/onboarding';
import {
  profileText,
  profileView,
} from '../../src/modules/telegram/bots/price-changer-bot/profile.text';
import { FEATURE } from '../../src/modules/telegram/bots/shared/features.domain';

/**
 * Эталоны сняты с текста бота ДО выноса моделей (TASK-073). Бот рендерит из
 * модели, CRM получает ту же модель — и текст бота при этом не должен сдвинуться
 * ни на символ. Единственное намеренное изменение — строка «Доступ» у админа.
 */
const HELP =
  '❓ <b>Справка</b>\n\n<b>Отчёты по заказам</b>\n• 🚚 Уехало клиенту — сколько уехало клиентам за сегодня и на какую сумму\n• ✅ Выкуплено — сколько выкуплено\n• ↩️ Едет обратно — что едет обратно: возвраты и невыкупы\n• 📦 Едет до клиента — всё в пути, файлом Excel\n\nСуммы показываются двумя числами: за товары и с доставкой.\n\n<b>Прибыль</b>\n💰 Прибыль — две цифры за выбранный период: по заказам, оформленным\nза период (их же вы видите в кабинете), и по уже выкупленным.\nЭто разные заказы: сегодняшние выкупят позже, а сегодняшние выкупы\nоформлены раньше — складывать их нельзя.\nИз суммы продажи вычитаются комиссия Маркета, налог и закуп.\nЗакупочные цены бот берёт из того же прайса, которым вы обновляете остатки:\nзакуп — это цена прайса минус скидка (свою можно задать каждому бренду).\nПроценты задаются в ⚙️ Настройки.\n\nЗаказы с товарами, которых нет в прайсе, в расчёт не попадают —\nбот пишет, сколько их и на какую сумму.\n\n<b>Ежедневная рассылка</b>\n⏰ Рассылка — выберите отчёты и время, бот будет присылать их сам.\nВремя московское.\n\n<b>Обновление остатков</b>\nПришлите файл прайс-листа — бот проставит остатки в Яндекс.Маркете.\nЧтобы сначала проверить без записи, добавьте к файлу подпись <code>проверка</code>:\nбот сверит артикулы с каталогом и покажет, что нашлось, ничего не меняя.\n\nПозиции, которых нет в вашем каталоге, пропускаются — обычно это новинки,\nещё не заведённые на Маркете.\n\n<b>Настройки</b>\n⚙️ Настройки — подключение магазина. Нужен только API-токен,\nбольше ничего искать в кабинете не придётся.\n\n🎫 <b>Как получить API-токен</b>\n\n1. Откройте кабинет продавца: partner.market.yandex.ru\n2. Значок аккаунта → <b>Настройки</b>\n3. В меню слева — <b>API и модули</b>\n4. Раздел <b>Токены авторизации</b> → <b>Создать новый токен</b>\n5. Отметьте доступ <b>«Обработка заказов и учёт товаров»</b>\n\n⚠️ Не выбирайте вариант «Просмотр информации о заказах» — это доступ\nтолько на чтение. С ним бот покажет отчёты, но <b>не сможет обновлять\nостатки</b> из прайса, и токен придётся выпускать заново.\n\nТокен создаётся один раз и действует, пока вы его не удалите.\nСкопируйте его целиком — он показывается только при создании.\n\n<b>Команды</b>\n<code>/start</code> — начать сначала\n<code>/menu</code> — главное меню\n<code>/settings</code> — настройки\n<code>/profile</code> — профиль\n<code>/help</code> — эта справка\n\n💬 Поддержка: @Vitality45';
const TOKEN_HELP =
  '🎫 <b>Как получить API-токен</b>\n\n1. Откройте кабинет продавца: partner.market.yandex.ru\n2. Значок аккаунта → <b>Настройки</b>\n3. В меню слева — <b>API и модули</b>\n4. Раздел <b>Токены авторизации</b> → <b>Создать новый токен</b>\n5. Отметьте доступ <b>«Обработка заказов и учёт товаров»</b>\n\n⚠️ Не выбирайте вариант «Просмотр информации о заказах» — это доступ\nтолько на чтение. С ним бот покажет отчёты, но <b>не сможет обновлять\nостатки</b> из прайса, и токен придётся выпускать заново.\n\nТокен создаётся один раз и действует, пока вы его не удалите.\nСкопируйте его целиком — он показывается только при создании.';
const PROFILE_FULL =
  '👤 <b>Ваш профиль</b>\n\n👨‍💼 <b>Пользователь:</b> Вася &lt;Пупкин&gt;\n🆔 <b>ID:</b> <code>222</code>\n📧 <b>Username:</b> @vasya\n\n🔑 <b>Доступ:</b> ✅ Выдан\n🏪 <b>Магазин:</b> Время с SBrand · FBY\n📅 <b>Регистрация:</b> 28.07.2026';
const PROFILE_BARE =
  '👤 <b>Ваш профиль</b>\n\n👨‍💼 <b>Пользователь:</b> —\n🆔 <b>ID:</b> <code>333</code>\n📧 <b>Username:</b> @не указан\n\n🔑 <b>Доступ:</b> ❌ Заявка не подана\n🏪 <b>Магазин:</b> ❌ не подключён';
const PROFILE_NO_NAME =
  '👤 <b>Ваш профиль</b>\n\n👨‍💼 <b>Пользователь:</b> Петя\n🆔 <b>ID:</b> <code>444</code>\n📧 <b>Username:</b> @не указан\n\n🔑 <b>Доступ:</b> ⏳ Заявка на рассмотрении\n🏪 <b>Магазин:</b> ✅ подключён';
const PROFILE_REJECTED =
  '👤 <b>Ваш профиль</b>\n\n👨‍💼 <b>Пользователь:</b> —\n🆔 <b>ID:</b> <code>555</code>\n📧 <b>Username:</b> @не указан\n\n🔑 <b>Доступ:</b> ⛔ Отклонена\n🏪 <b>Магазин:</b> allbestwatch.ru';

const STORE = {
  name: 'Время с SBrand',
  campaign_id: '148704883',
  business_id: '164225008',
  token: 'SECRET-TOKEN',
  stores: [{ campaignId: '148704883', placementType: 'FBY' }],
};

describe('Справка: модель и текст бота', () => {
  it('helpText из модели совпадает с прежним текстом байт в байт', () => {
    expect(helpText()).toBe(HELP);
  });

  it('инструкция по токену у визарда не изменилась', () => {
    expect(stepHelp('token')).toBe(TOKEN_HELP);
  });

  it('в модели нет HTML — разметку добавляет канал', () => {
    expect(JSON.stringify(helpModel())).not.toMatch(/<\/?(b|code|i|a)\b/);
  });

  it('контакт поддержки едет моделью', () => {
    expect(helpModel().supportContact).toMatch(/^@\w+$/);
  });
});

describe('Профиль: модель и текст бота', () => {
  it('полный профиль — прежний текст', () => {
    const view = profileView({
      telegramUserId: 222,
      firstName: 'Вася',
      lastName: '<Пупкин>',
      username: 'vasya',
      isAdmin: false,
      access: { status: 'approved', createdAt: new Date(2026, 6, 28) },
      store: STORE,
    });
    expect(profileText(view)).toBe(PROFILE_FULL);
  });

  it('без записи и без магазина — прежний текст', () => {
    expect(profileText(profileView({ telegramUserId: 333, isAdmin: false }))).toBe(PROFILE_BARE);
  });

  it('магазин без имени — «подключён»', () => {
    const view = profileView({
      telegramUserId: 444,
      firstName: 'Петя',
      isAdmin: false,
      access: { status: 'pending' },
      store: { ...STORE, name: '', stores: [] },
    });
    expect(profileText(view)).toBe(PROFILE_NO_NAME);
  });

  it('модель неизвестна — голое имя', () => {
    const view = profileView({
      telegramUserId: 555,
      isAdmin: false,
      access: { status: 'rejected' },
      store: { ...STORE, name: 'allbestwatch.ru', stores: [] },
    });
    expect(profileText(view)).toBe(PROFILE_REJECTED);
  });

  it('админ без записи UserAccess — «Администратор», а не «Заявка не подана»', () => {
    const view = profileView({ telegramUserId: 1, isAdmin: true, store: STORE });
    expect(view.accessLabel).toBe('👑 Администратор');
    expect(profileText(view)).toBe(
      PROFILE_BARE.replace('<code>333</code>', '<code>1</code>')
        .replace('❌ Заявка не подана', '👑 Администратор')
        .replace('❌ не подключён', 'Время с SBrand · FBY'),
    );
  });

  it('открытые функции считаются только по переданным флагам, FBY-only — только на FBY', () => {
    expect(profileView({ telegramUserId: 1, isAdmin: false }).openFeatures).toBeUndefined();

    const fbs = profileView({
      telegramUserId: 1,
      isAdmin: false,
      store: { ...STORE, stores: [{ campaignId: STORE.campaign_id, placementType: 'FBS' }] },
      features: { [FEATURE.FBY]: true, [FEATURE.REPORT_PROFIT]: false },
    });
    const keys = fbs.openFeatures.map((feature) => feature.key);
    expect(keys).not.toContain(FEATURE.FBY);
    expect(keys).not.toContain(FEATURE.REPORT_PROFIT);
    expect(keys).toContain(FEATURE.REPORT_REDEEMED);

    const fby = profileView({
      telegramUserId: 1,
      isAdmin: false,
      store: STORE,
      features: { [FEATURE.FBY]: true },
    });
    expect(fby.openFeatures.map((feature) => feature.key)).toContain(FEATURE.FBY);
  });
});
