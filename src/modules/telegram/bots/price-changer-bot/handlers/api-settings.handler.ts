import type { IStoreRef } from '../../../../yandex/yandex-api.client';

import { Injectable, Logger } from '@nestjs/common';
import { Context } from 'telegraf';

import { AppConfigService } from '../../../../../config/app-config.service';
import {
  UserAccessService,
  type TDraftField,
} from '../../../../../database/services/user-access.service';
import { YandexMarketService } from '../../../../../database/services/yandex-market.service';
import {
  DEFAULT_RATES,
  RATE_CB_CANCEL,
  RATE_CB_PATTERN,
  RATE_FIELDS,
  isRateField,
  parseRateCallback,
  parseRateInput,
  parseRateValue,
  rateInputLabel,
  rateTitle,
  ratesOf,
  validateRate,
  type IRateInput,
  type TRateField,
} from '../../../../yandex/reports/profit';
import { YandexAuthError } from '../../../../yandex/yandex-api.errors';
import { YandexClientFactory } from '../../../../yandex/yandex-client.factory';
import { TTelegrafBot } from '../../../domain.telegram';
import { b, esc, htmlOptions } from '../../../formatting/telegram-format';
import { AdminNotifierService } from '../../shared/services/admin-notifier.service';
import { MENU, MENU_LABELS, SUPPORT_CONTACT } from '../menu.constants';
import {
  nextStep,
  stepHelp,
  parseLabelledValue,
  stepPrompt,
  stepTitle,
  validateStep,
  type TOnboardingDraft,
} from '../onboarding';
import { PriceChangerKeyboard } from '../price-changer.keyboard';
import { settingsKeyboardRows, settingsText } from '../settings.text';
import {
  PICK_BUSINESS_PREFIX,
  PICK_BUSINESS_SWITCH_PREFIX,
  PICK_STORE_PREFIX,
  PICK_STORE_SWITCH_PREFIX,
  decidePick,
  groupByBusiness,
  storeLabel,
  uniqueLabels,
  type IBusinessGroup,
} from '../store-picker';

import { ReportsHandler } from './reports.handler';
import { ScheduleHandler } from './schedule.handler';

/** Префикс callback_data подсказки. Дальше идёт название шага. */
export const HELP_PREFIX = 'onboarding_help:';

/** Что ответить пользователю. */
interface IReply {
  message: string;
  keyboard?: any;
}

/** Итог попытки определить магазин по токену. */
interface IAutofillResult {
  draft: TOnboardingDraft;
  /**
   * Заполнено, только если токен НЕ годится и продолжать визард с ним нельзя.
   * Недоступность Яндекса сюда не относится — это причина отступить на ручной
   * ввод, а не забраковать токен.
   */
  rejected?: string;
}

/**
 * Свободный текст: либо очередной шаг визарда онбординга, либо правка настройки
 * уже одобренным пользователем. Что именно — решает СТАТУС ДОСТУПА, а не форма
 * присланной строки.
 *
 * Регистрируется предпоследним (перед catch-all): слушает любой текст, поэтому
 * обязан стоять после hears кнопок меню и слэш-команд.
 */
@Injectable()
export class ApiSettingsHandler {
  private readonly logger = new Logger(ApiSettingsHandler.name);

  /**
   * Ставку без магазина писать некуда: документ настроек создаётся один раз и
   * сразу целиком. Текст один на все три места, где это выясняется (кнопка,
   * ответ на вопрос, правка сообщением), — иначе три формулировки одного отказа.
   */
  private readonly NO_STORE_FOR_RATES =
    '⚠️ Сначала подключите магазин — пришлите API-токен одним сообщением. ' +
    'Ставки настраиваются после этого.';

  constructor(
    private keyboard: PriceChangerKeyboard,
    private yandexMarketService: YandexMarketService,
    private accessService: UserAccessService,
    private adminNotifier: AdminNotifierService,
    private config: AppConfigService,
    private scheduleHandler: ScheduleHandler,
    private readonly clients: YandexClientFactory,
    private readonly reportsHandler: ReportsHandler,
  ) {}

  /**
   * Inline-кнопки визарда.
   *
   * ОТДЕЛЬНО от register() и раньше него в пайплайне — это не косметика.
   * `bot.action` в telegraf не вызывает next(), поэтому общий обработчик
   * callback_query, зарегистрированный раньше, забирает апдейт себе и его
   * default-ветка отвечает «Неизвестная команда: store_pick:12345». Ровно так
   * весь пикер магазина (TASK-052) и кнопка «Как получить?» (TASK-049) и не
   * работали: их action'ы стояли позади общего switch. Текстовый обработчик
   * при этом обязан остаться ПОЗАДИ menu/slash — отсюда два метода вместо
   * одного.
   */
  public registerCallbacks(bot: TTelegrafBot) {
    // Подсказка по текущему шагу. Регистрируется здесь же, где живёт визард:
    // разносить вопрос и справку к нему по разным обработчикам значит
    // разложить один диалог на два места.
    bot.action(new RegExp(`^${HELP_PREFIX}`), async (ctx) => {
      const data = (ctx.callbackQuery as { data?: string } | undefined)?.data ?? '';
      const step = data.slice(HELP_PREFIX.length) as TDraftField;

      await ctx.answerCbQuery();
      // Состояние визарда НЕ трогаем: справка не продвигает и не сбрасывает
      // шаг, бот по-прежнему ждёт значение того же поля.
      await ctx.reply(stepHelp(step), htmlOptions());
    });

    // Выбор кабинета: показываем магазины внутри него.
    bot.action(new RegExp(`^${PICK_BUSINESS_PREFIX}`), async (ctx) => {
      await ctx.answerCbQuery();
      const businessId = this.callbackTail(ctx, PICK_BUSINESS_PREFIX);
      const stores = await this.storesFromDraft(ctx);
      const group = groupByBusiness(stores).find((g) => g.businessId === businessId);

      if (!group) {
        await ctx.reply('Не удалось получить список магазинов. Пришлите токен заново.');
        return;
      }
      await this.askStore(ctx, group.stores);
    });

    // Выбор магазина: применяем и продолжаем визард.
    //
    // try/catch обязателен: на callback_query необработанное исключение
    // означает для пользователя полную тишину после того, как спиннер на
    // кнопке погас, — он не знает, засчиталось нажатие или нет.
    bot.action(new RegExp(`^${PICK_STORE_PREFIX}`), async (ctx) => {
      await ctx.answerCbQuery();
      try {
        await this.pickStore(ctx);
      } catch (error) {
        this.logger.error('Не удалось подключить выбранный магазин', error as Error);
        await ctx.reply('❌ Не удалось подключить магазин. Попробуйте ещё раз.');
      }
    });

    // Смена магазина уже подключённым продавцом. Отдельный путь от онбординга:
    // токен берётся из YandexMarket (не из черновика), выбор пишется прямо в
    // YandexMarket. Регистрируется здесь (до общего callback_query), иначе
    // default-ветка ответила бы «Неизвестная команда».
    bot.action(/^switch_store$/, async (ctx) => {
      await ctx.answerCbQuery();
      try {
        await this.startSwitch(ctx);
      } catch (error) {
        this.logger.error('Не удалось начать смену магазина', error as Error);
        await ctx.reply('❌ Не удалось получить список магазинов. Попробуйте позже.');
      }
    });

    bot.action(new RegExp(`^${PICK_BUSINESS_SWITCH_PREFIX}`), async (ctx) => {
      await ctx.answerCbQuery();
      const businessId = this.callbackTail(ctx, PICK_BUSINESS_SWITCH_PREFIX);
      const stores = await this.storesFromLiveToken(ctx);
      const group = groupByBusiness(stores).find((g) => g.businessId === businessId);

      if (!group) {
        await ctx.reply('Не удалось получить список магазинов. Попробуйте позже.');
        return;
      }
      await this.askStore(ctx, group.stores, {
        prefix: PICK_STORE_SWITCH_PREFIX,
        currentCampaignId: await this.currentCampaignId(ctx),
      });
    });

    bot.action(new RegExp(`^${PICK_STORE_SWITCH_PREFIX}`), async (ctx) => {
      await ctx.answerCbQuery();
      try {
        await this.switchStorePick(ctx);
      } catch (error) {
        this.logger.error('Не удалось переключить магазин', error as Error);
        await ctx.reply('❌ Не удалось переключить магазин. Попробуйте ещё раз.');
      }
    });

    // Правка ставки прибыли кнопкой. Здесь же, потому что ответ на вопрос
    // «пришлите новое значение» разбирает этот же обработчик текста: вопрос и
    // ответ на него — один диалог, разносить его по двум файлам незачем.
    bot.action(RATE_CB_PATTERN, async (ctx) => {
      await ctx.answerCbQuery();
      try {
        const data = (ctx.callbackQuery as { data?: string } | undefined)?.data ?? '';
        const target = parseRateCallback(data);

        if (target === 'cancel') {
          await this.accessService.setPendingRate(
            ctx.from.id.toString(),
            ctx.botInfo.id.toString(),
            null,
          );
          await this.showSettings(ctx);
          return;
        }

        if (target) await this.askRate(ctx, target);
      } catch (error) {
        this.logger.error('Не удалось начать правку ставки', error as Error);
        await ctx.reply('❌ Не удалось открыть настройку. Попробуйте ещё раз.');
      }
    });
  }

  /**
   * Экран настроек со своими кнопками.
   *
   * Здесь он нужен дважды — после сохранения ставки и после отмены, — чтобы
   * правка второй ставки была следующим тапом, а не походом в меню. Текст и
   * клавиатура берутся из settings.text.ts, единственного источника для всех
   * входов в этот экран.
   */
  private async showSettings(ctx: Context): Promise<void> {
    const store = await this.yandexMarketService.findByTelegramUser(ctx.from.id.toString());
    const keyboard = await this.keyboard.createInlineKeyboardMatrix(settingsKeyboardRows(store));

    await ctx.reply(settingsText(store), htmlOptions({ reply_markup: keyboard.reply_markup }));
  }

  /**
   * Спросить новое значение ставки.
   *
   * Подписи в вопросе не требуем: бот сам только что спросил про конкретную
   * ставку, и переспрашивать «а какую именно» значило бы не поверить своему же
   * вопросу. Текстовая форма всё равно упомянута — тем, кто правит ставки часто,
   * так быстрее, и это тот же путь, что работал до кнопок.
   */
  private async askRate(ctx: Context, field: TRateField): Promise<void> {
    const telegramUserId = ctx.from.id.toString();

    // Без магазина ставку писать некуда: документ настроек создаётся один раз и
    // сразу целиком. Отвечаем тем же текстом, что и editRate, и вопрос НЕ
    // открываем — иначе следующее число ушло бы в никуда.
    const store = await this.yandexMarketService.findByTelegramUser(telegramUserId);
    if (!store) {
      await ctx.reply(this.NO_STORE_FOR_RATES, htmlOptions());
      return;
    }

    await this.accessService.setPendingRate(telegramUserId, ctx.botInfo.id.toString(), field);

    const current = ratesOf(store)[field];
    const keyboard = await this.keyboard.createInlineButtons([
      { text: '⬅️ Отмена', callback_data: RATE_CB_CANCEL },
    ]);

    await ctx.reply(
      [
        `${esc(rateTitle(field))} — сейчас ${b(`${current}%`)}.`,
        '',
        'Пришлите новое значение в процентах — например <code>23</code>.',
        `Можно и с подписью: <code>${esc(rateInputLabel(field))}: ${current}</code>.`,
      ].join('\n'),
      htmlOptions({ reply_markup: keyboard.reply_markup }),
    );
  }

  /**
   * Ответ на вопрос «пришлите новое значение ставки».
   *
   * Забирает ТОЛЬКО числовой ввод. Это и делает безопасным вызов раньше вопросов
   * про день отчёта и время рассылки: «28-07-2026» и «09:00» числами не
   * являются и уходят своим обработчикам. Нечисловой текст закрывает вопрос и
   * идёт дальше обычным маршрутом — иначе открытый вопрос про ставку превратил
   * бы бота в глухого: на любое сообщение он отвечал бы «нужно число».
   *
   * @returns true, если сообщение было значением ставки и обработано здесь.
   */
  public async handlePendingRate(ctx: Context, text: string): Promise<boolean> {
    const telegramUserId = ctx.from.id.toString();
    const botId = ctx.botInfo.id.toString();

    const account = await this.accessService.findByUserAndBot(telegramUserId, botId);
    const field = account?.pendingRate;
    if (!isRateField(field)) return false;

    const value = parseRateValue(text);
    if (value === null) {
      await this.accessService.setPendingRate(telegramUserId, botId, null);
      return false;
    }

    const validation = validateRate(field, value);
    if (!validation.ok) {
      // Вопрос остаётся открытым: продавец должен ответить ещё раз, не начиная
      // всё заново, — так же ведут себя вопросы про день и время.
      await ctx.reply(`❌ ${esc(validation.error)}\n\nПопробуйте ещё раз.`, htmlOptions());
      return true;
    }

    const updated = await this.yandexMarketService.updateRate(telegramUserId, field, value);
    await this.accessService.setPendingRate(telegramUserId, botId, null);

    if (!updated) {
      await ctx.reply(this.NO_STORE_FOR_RATES, htmlOptions());
      return true;
    }

    await ctx.reply(`✅ ${esc(rateTitle(field))}: ${b(`${value}%`)}`, htmlOptions());
    await this.showSettings(ctx);
    return true;
  }

  private async pickStore(ctx: Context): Promise<void> {
    const campaignId = this.callbackTail(ctx, PICK_STORE_PREFIX);
    const stores = await this.storesFromDraft(ctx);
    const store = stores.find((s) => s.campaignId === campaignId);

    if (!store) {
      await ctx.reply('Не удалось получить данные магазина. Пришлите токен заново.');
      return;
    }

    const access = await this.accessService.findByUserAndBot(
      ctx.from.id.toString(),
      ctx.botInfo.id.toString(),
    );
    const draft = await this.applyStore(ctx, store, access?.draft ?? {});

    // Черновик заполнен целиком — заявка уходит сразу, без лишнего шага.
    const following = nextStep(draft);
    const reply = following
      ? { message: stepPrompt(following), keyboard: await this.restartKeyboard(following) }
      : await this.submitApplication(ctx, draft);

    if (reply.message) await ctx.reply(reply.message, htmlOptions(reply.keyboard));
  }

  /** Свободный текст. Обязан регистрироваться ПОСЛЕ menu и slash. */
  public register(bot: TTelegrafBot) {
    bot.on('text', async (ctx) => {
      try {
        const text = ctx.message.text.trim();

        if (text.startsWith('/')) return;
        if (this.isMenuButton(text)) return;

        // Текст пользователя НЕ логируем: через этот обработчик проходит токен
        // продавца, а логи не место для чужих секретов.
        this.logger.debug(`Онбординг: сообщение от пользователя ${ctx.from.id}`);

        const reply = await this.handleText(ctx, text);
        // Пустое сообщение означает «обработчик уже ответил сам» (так делает
        // ветка расписания). Отправлять пустую строку нельзя — Telegram
        // отвечает на неё 400.
        if (!reply.message) return;
        await ctx.reply(reply.message, htmlOptions(reply.keyboard));
      } catch (error) {
        this.logger.error('Ошибка обработки настроек API', error as Error);
        await ctx.reply('❌ Произошла ошибка при обработке настроек. Попробуйте позже.');
      }
    });
  }

  private isMenuButton(text: string): boolean {
    // Раньше здесь был свой, ЧЕТВЁРТЫЙ по счёту список подписей. Он разъехался
    // с клавиатурой, и нажатие кнопки проваливалось сюда, где гасилось без
    // ответа — так и были сломаны все кнопки меню. Теперь источник один
    // (menu.constants), рассинхронизация невозможна (TASK-014).
    return (MENU_LABELS as readonly string[]).includes(text);
  }

  private async handleText(ctx: Context, text: string): Promise<IReply> {
    const telegramUserId = ctx.from.id.toString();
    const botId = ctx.botInfo.id.toString();

    // Администраторы гейт не проходят, поэтому записи доступа у них может не
    // быть — заводим её здесь.
    const access = await this.accessService.ensure({
      telegramUserId,
      botId,
      telegramChatId: ctx.chat.id.toString(),
      username: ctx.from.username,
      firstName: ctx.from.first_name,
      lastName: ctx.from.last_name,
    });

    if (access.status === 'approved') {
      // Незакрытые вопросы важнее правки настроек: иначе «09:00» было бы
      // истолковано как попытка изменить настройку, а «28-07-2026» — тем более.
      //
      // Ставка спрашивается первой, и это безопасно ровно потому, что
      // handlePendingRate забирает ТОЛЬКО числовой ввод: дата и время числами не
      // являются и доходят до своих обработчиков ниже.
      if (await this.handlePendingRate(ctx, text)) {
        return { message: '' }; // ответ уже отправлен внутри
      }
      if (await this.reportsHandler.handlePendingDay(ctx, text)) {
        return { message: '' }; // ответ уже отправлен внутри
      }
      if (await this.scheduleHandler.handlePendingTime(ctx, text)) {
        return { message: '' }; // ответ уже отправлен внутри
      }

      /**
       * Правка — только когда есть что править.
       *
       * У одобренного пользователя может не быть магазина: доступ выдал
       * администратор, а токен ещё не прислан. Такой человек попадал в
       * editSetting, тот требовал подписи вида `token: …` и на голый токен
       * отвечал «Не понял, что именно нужно изменить» — то есть бот отвергал
       * ровно то, что сам только что попросил прислать.
       */
      if (await this.yandexMarketService.isConfigured(telegramUserId)) {
        return await this.editSetting(ctx, text);
      }
    }

    return await this.wizardStep(ctx, access.draft, text);
  }

  /**
   * Один шаг визарда.
   *
   * Тип значения определяется ТЕКУЩИМ ШАГОМ, а не формой строки. Раньше бот
   * угадывал: длинная строка — токен, число из 5–15 цифр — «не знаю, уточните
   * сами», всё остальное — «не удалось определить тип данных». Пользователь
   * получал встречный вопрос вместо ответа.
   */
  private async wizardStep(
    ctx: Context,
    draft: TOnboardingDraft | undefined,
    text: string,
  ): Promise<IReply> {
    const telegramUserId = ctx.from.id.toString();
    const botId = ctx.botInfo.id.toString();

    const current = nextStep(draft);
    if (!current) {
      // Черновик полон, но заявка не подана — например, предыдущая попытка
      // упала после сохранения последнего креда.
      return await this.submitApplication(ctx, draft ?? {});
    }

    // Явно подписанное значение относим к названному полю: тип назвал сам
    // пользователь, догадки по форме строки здесь нет.
    const labelled = parseLabelledValue(text);
    const field: TDraftField = labelled?.field ?? current;
    const value = labelled?.value ?? text;

    const validation = validateStep(field, value);
    if (!validation.ok) {
      // Переспрашиваем ТОТ ЖЕ шаг — с объяснением, что не так.
      return {
        message: `❌ ${esc(validation.error)}\n\n${stepPrompt(field)}`,
        keyboard: await this.restartKeyboard(field),
      };
    }

    const updated = await this.accessService.saveDraftField(telegramUserId, botId, field, value);
    let newDraft = updated?.draft ?? {};

    // Токен принят — пробуем узнать идентификаторы у самого Маркета.
    if (field === 'token') {
      const autofill = await this.autofillFromToken(ctx, value, newDraft);

      // Маркет отклонил токен. Дальше идти нельзя: спрашивать Campaign ID у
      // человека, которому обещали, что ничего кроме токена не понадобится, —
      // это подменить ошибку вопросом. Токен убираем, иначе nextStep решил бы,
      // что он уже собран, и визард поехал бы дальше с негодным значением.
      if (autofill.rejected) {
        await this.accessService.clearDraftField(telegramUserId, botId, 'token');
        return {
          message: `❌ ${esc(autofill.rejected)}\n\n${stepPrompt('token')}`,
          keyboard: await this.restartKeyboard('token'),
        };
      }

      newDraft = autofill.draft;
    }

    const following = nextStep(newDraft);

    if (!following) {
      return await this.submitApplication(ctx, newDraft);
    }

    return {
      message: `${this.acceptedLabel(field, value)}\n\n${stepPrompt(following)}`,
      keyboard: await this.restartKeyboard(following),
    };
  }

  /**
   * Подставить campaign_id и business_id по токену.
   *
   * `GET v2/campaigns` отдаёт оба идентификатора сразу — искать их в кабинете
   * вручную не нужно вовсе. Это снимает два самых частых источника ошибки:
   * перепутать campaign_id с идентификатором магазина (документация выделяет
   * это отдельным предупреждением — с ним запросы к API не работают) и просто
   * ошибиться цифрой.
   *
   * Недоступность API НЕ прерывает регистрацию: при сетевой ошибке или 5xx
   * возвращаем черновик как есть, и визард продолжится ручным вводом. Запереть
   * человека из-за того, что Яндекс лежит, было бы хуже, чем спросить два числа.
   *
   * А вот ОТКАЗ В ДОСТУПЕ — другое дело, и различать их обязательно. Раньше
   * ловилось всё подряд, поэтому продавец с отозванным или read-only токеном
   * получал не сообщение об ошибке, а вопрос про Campaign ID: бот подменял
   * диагноз лишней работой, причём ровно той, которой обещал избавить.
   *
   * Магазинов может быть несколько — тогда автоподстановки не делаем, иначе
   * молча выбрали бы за пользователя не тот.
   */
  private async autofillFromToken(
    ctx: Context,
    token: string,
    draft: TOnboardingDraft,
  ): Promise<IAutofillResult> {
    // botId здесь не нужен: сохранение полей уехало в applyStore, а запрос к
    // API идёт по токену.
    const telegramUserId = ctx.from.id.toString();

    let stores: IStoreRef[];
    try {
      stores = await this.clients.forTokenOnly(token).listStores();
    } catch (error) {
      // Токен НЕ логируем ни здесь, ни где-либо ещё.
      this.logger.warn(
        `Не удалось определить магазины по токену пользователя ${telegramUserId}: ${
          error instanceof Error ? error.constructor.name : 'неизвестная ошибка'
        }`,
      );

      if (error instanceof YandexAuthError) {
        return { draft, rejected: error.userMessage };
      }
      return { draft };
    }

    const pick = decidePick(stores);

    // Пустая выдача — не отказ: это может быть и незаполненный кабинет.
    // Оставляем тихий откат на ручной ввод, как было.
    if (pick.kind === 'none') return { draft };

    // Несколько магазинов — спрашиваем, какой подключить. Молча выбрать за
    // продавца нельзя: он узнал бы об ошибке по пустым отчётам.
    if (pick.kind === 'business') {
      await this.askBusiness(ctx, pick.groups);
      return { draft };
    }
    if (pick.kind === 'store') {
      await this.askStore(ctx, pick.stores);
      return { draft };
    }

    return { draft: await this.applyStore(ctx, pick.store, draft) };
  }

  private callbackTail(ctx: Context, prefix: string): string {
    const data = (ctx.callbackQuery as { data?: string } | undefined)?.data ?? '';
    return data.slice(prefix.length).trim();
  }

  /**
   * Заново спросить у Маркета список магазинов, взяв токен из черновика.
   *
   * Список НЕ кэшируется между нажатиями: держать его в памяти процесса значит
   * потерять при рестарте (и тогда кнопка перестанет работать), а класть в базу
   * ради двух секунд диалога — заводить ещё одно состояние, которое надо
   * инвалидировать. Один дешёвый запрос надёжнее.
   */
  private async storesFromDraft(ctx: Context): Promise<IStoreRef[]> {
    const access = await this.accessService.findByUserAndBot(
      ctx.from.id.toString(),
      ctx.botInfo.id.toString(),
    );
    const token = access?.draft?.token;
    if (!token) return [];

    try {
      return await this.clients.forTokenOnly(token).listStores();
    } catch (error) {
      this.logger.warn(
        `Не удалось получить магазины: ${
          error instanceof Error ? error.constructor.name : 'неизвестная ошибка'
        }`,
      );
      return [];
    }
  }

  /**
   * Список магазинов для СМЕНЫ: токен берём из подключённого документа настроек,
   * а не из черновика (после онбординга он стёрт). Список не кэшируем — как и в
   * онбординге, один свежий запрос надёжнее протухающего кэша.
   */
  private async storesFromLiveToken(ctx: Context): Promise<IStoreRef[]> {
    const store = await this.yandexMarketService.findByTelegramUser(ctx.from.id.toString());
    const token = store?.token;
    if (!token) return [];

    try {
      return await this.clients.forTokenOnly(token).listStores();
    } catch (error) {
      this.logger.warn(
        `Не удалось получить магазины для смены: ${
          error instanceof Error ? error.constructor.name : 'неизвестная ошибка'
        }`,
      );
      return [];
    }
  }

  /** Активная кампания подключённого магазина — чтобы пометить её «✓» в пикере. */
  private async currentCampaignId(ctx: Context): Promise<string | undefined> {
    const store = await this.yandexMarketService.findByTelegramUser(ctx.from.id.toString());
    return store?.campaign_id;
  }

  /**
   * Кнопка «🏪 Сменить магазин»: показать магазины токена и предложить выбор.
   * Один магазин — переключать не на что; несколько кабинетов — сперва кабинет.
   */
  private async startSwitch(ctx: Context): Promise<void> {
    const stores = await this.storesFromLiveToken(ctx);
    const pick = decidePick(stores);

    if (pick.kind === 'none') {
      await ctx.reply('Не удалось получить список магазинов. Попробуйте позже.', htmlOptions());
      return;
    }
    if (pick.kind === 'single') {
      await ctx.reply('У вас один магазин — переключать не на что.', htmlOptions());
      return;
    }

    const current = await this.currentCampaignId(ctx);
    if (pick.kind === 'business') {
      await this.askBusiness(ctx, pick.groups, { prefix: PICK_BUSINESS_SWITCH_PREFIX });
      return;
    }
    await this.askStore(ctx, pick.stores, {
      prefix: PICK_STORE_SWITCH_PREFIX,
      currentCampaignId: current,
    });
  }

  /**
   * Выбран магазин для смены: перезаписываем campaign_id/business_id/name в том
   * же документе. Токен и ставки прибыли не трогаем — продавец тот же.
   */
  private async switchStorePick(ctx: Context): Promise<void> {
    const campaignId = this.callbackTail(ctx, PICK_STORE_SWITCH_PREFIX);
    const stores = await this.storesFromLiveToken(ctx);
    const store = stores.find((s) => s.campaignId === campaignId);

    if (!store) {
      await ctx.reply('Не удалось получить данные магазина. Попробуйте позже.', htmlOptions());
      return;
    }

    await this.yandexMarketService.updateByTelegramUser(ctx.from.id.toString(), {
      campaign_id: store.campaignId,
      business_id: store.businessId,
      name: store.storeName,
    });

    await ctx.reply(`✅ Магазин переключён: ${b(store.storeName)}`, htmlOptions());
  }

  /** Сохранить выбранный магазин в черновик и подтвердить пользователю. */
  private async applyStore(
    ctx: Context,
    store: IStoreRef,
    draft: TOnboardingDraft,
  ): Promise<TOnboardingDraft> {
    const telegramUserId = ctx.from.id.toString();
    const botId = ctx.botInfo.id.toString();

    await this.accessService.saveDraftField(telegramUserId, botId, 'campaign_id', store.campaignId);
    await this.accessService.saveDraftField(telegramUserId, botId, 'business_id', store.businessId);
    // Название кладём в черновик, чтобы оно попало в документ настроек.
    // Экран настроек не должен ходить в API ради одной подписи.
    const saved = await this.accessService.saveDraftField(
      telegramUserId,
      botId,
      'store_name',
      store.storeName,
    );

    // Идентификаторы пользователю НЕ показываем: это технический шум, который
    // ни о чём ему не говорит, а перепутать их легко.
    await ctx.reply(`🔎 Подключаю магазин: ${b(store.storeName)}`, htmlOptions());

    return saved?.draft ?? draft;
  }

  private async askBusiness(
    ctx: Context,
    groups: IBusinessGroup[],
    opts: { prefix?: string } = {},
  ): Promise<void> {
    const prefix = opts.prefix ?? PICK_BUSINESS_PREFIX;
    const labels = uniqueLabels(groups.map((g) => g.businessName));

    await ctx.reply(
      'У этого токена несколько кабинетов. Выберите нужный:',
      htmlOptions({
        reply_markup: {
          inline_keyboard: groups.map((g, i) => [
            { text: labels[i], callback_data: `${prefix}${g.businessId}` },
          ]),
        },
      }),
    );
  }

  /**
   * `prefix` различает онбординг (`store_pick:`) и смену (`store_switch:`).
   * `currentCampaignId` помечает текущий магазин «✓» — при смене видно, где
   * стоишь сейчас. Подпись включает FBS/FBY (storeLabel), иначе кампании одного
   * бизнеса без домена неразличимы.
   */
  private async askStore(
    ctx: Context,
    stores: IStoreRef[],
    opts: { prefix?: string; currentCampaignId?: string } = {},
  ): Promise<void> {
    const prefix = opts.prefix ?? PICK_STORE_PREFIX;
    const labels = uniqueLabels(stores.map((s) => storeLabel(s)));

    await ctx.reply(
      'Выберите магазин:',
      htmlOptions({
        reply_markup: {
          inline_keyboard: stores.map((s, i) => [
            {
              text: s.campaignId === opts.currentCampaignId ? `✓ ${labels[i]}` : labels[i],
              callback_data: `${prefix}${s.campaignId}`,
            },
          ]),
        },
      }),
    );
  }

  /** Приглашение к первому шагу — используется и при старте, и при сбросе. */
  public async firstStepReply(draft?: TOnboardingDraft): Promise<IReply> {
    const step = nextStep(draft) ?? 'token';
    return {
      message: stepPrompt(step),
      keyboard: await this.restartKeyboard(step),
    };
  }

  /**
   * Клавиатура под вопросом визарда.
   *
   * «Как получить?» ведёт себя как справка, а не как шаг: показывает
   * инструкцию и НЕ трогает состояние — бот по-прежнему ждёт значение того же
   * поля. Кнопка привязана к конкретному шагу, поэтому подсказка приходит
   * ровно про то, что спрашивают сейчас.
   */
  private async restartKeyboard(step?: TDraftField) {
    const buttons = [];
    if (step) {
      buttons.push({ text: '❓ Как получить?', callback_data: `${HELP_PREFIX}${step}` });
    }
    buttons.push({ text: '🔄 Начать заново', callback_data: 'onboarding_restart' });
    return await this.keyboard.createInlineButtons(buttons);
  }

  /** Уже одобренный пользователь правит одну настройку. */
  private async editSetting(ctx: Context, text: string): Promise<IReply> {
    const telegramUserId = ctx.from.id.toString();

    // Ставки прибыли разбираются ПЕРВЫМИ и своим парсером: расширять
    // parseLabelledValue нельзя, он возвращает поле черновика онбординга.
    const rate = parseRateInput(text);
    if (rate) return await this.editRate(ctx, rate);

    const labelled = parseLabelledValue(text);

    if (!labelled) {
      return {
        // Про campaign_id и business_id больше не рассказываем: их не вводят
        // руками, и на экране настроек их тоже нет. Предлагать пользователю
        // поле, которого он нигде не видит, — приглашение к ошибке.
        message: [
          '❓ Не понял, что именно нужно изменить.',
          '',
          'Чтобы сменить магазин или токен, пришлите значение с подписью:',
          '<code>token: ваш_токен</code>',
          '',
          `Ставки расчёта прибыли проще менять кнопками — ${esc(MENU.SETTINGS)}.`,
          'Сообщением тоже можно:',
          // Подписи И примеры — из profit.ts, оттуда же, откуда их берёт парсер
          // и схема. Пока это были литералы, подсказка «комиссия: 23» жила
          // рядом с настройкой продавца в 25 %.
          ...RATE_FIELDS.map(
            (field) => `<code>${esc(rateInputLabel(field))}: ${DEFAULT_RATES[field]}</code>`,
          ),
        ].join('\n'),
      };
    }

    const validation = validateStep(labelled.field, labelled.value);
    if (!validation.ok) {
      return { message: `❌ ${esc(validation.error)}` };
    }

    /**
     * Новый токен — это, как правило, ДРУГОЙ магазин, и записать один лишь
     * токен здесь нельзя: campaign_id, business_id и название остались бы от
     * прежнего, а бот продолжил бы писать не туда. Экран настроек при этом
     * прямо обещает «чтобы сменить магазин — пришлите новый токен».
     *
     * Поэтому отдаём токен обычному визарду: он сам сходит в Маркет, при
     * нескольких магазинах покажет кнопки выбора и перезапишет все поля
     * разом. Второй путь подключения магазина заводить незачем — он бы и
     * разошёлся с первым.
     */
    if (labelled.field === 'token') {
      // Черновик чистим перед делегированием: остатки прошлой регистрации
      // сделали бы nextStep() пустым, и визард подал бы старые значения, ни
      // разу не взглянув на присланный токен.
      await this.accessService.clearDraft(telegramUserId, ctx.botInfo.id.toString());
      return await this.wizardStep(ctx, undefined, text);
    }

    const updated = await this.yandexMarketService.updateByTelegramUser(telegramUserId, {
      [labelled.field]: labelled.value,
    });

    // Одобренный без магазина — редкий случай (доступ выдан вручную);
    // заводим документ через обычный черновик.
    if (!updated) {
      return await this.wizardStep(ctx, undefined, text);
    }

    return {
      message: `${this.acceptedLabel(labelled.field, labelled.value)}\n\n✅ Настройка обновлена.`,
      keyboard: await this.settingsKeyboard(),
    };
  }

  /**
   * Изменение ставки расчёта прибыли.
   *
   * В визард такой текст НЕ отдаём, даже если магазина почему-то нет: «пришлите
   * токен» в ответ на «комиссия: 25» — это бот, не понявший, о чём его просят.
   */
  private async editRate(ctx: Context, rate: IRateInput): Promise<IReply> {
    const validation = validateRate(rate.field, rate.value);
    if (!validation.ok) {
      return { message: `❌ ${esc(validation.error)}` };
    }

    const updated = await this.yandexMarketService.updateRate(
      ctx.from.id.toString(),
      rate.field,
      rate.value,
    );

    if (!updated) {
      return { message: this.NO_STORE_FOR_RATES };
    }

    return {
      message:
        `✅ ${esc(rateTitle(rate.field))}: <b>${rate.value}%</b>\n\n` +
        'Прибыль пересчитается при следующем открытии отчёта.',
      keyboard: await this.settingsKeyboard(),
    };
  }

  /** Кнопки под подтверждением правки настройки. */
  private async settingsKeyboard() {
    return await this.keyboard.createInlineButtons([
      { text: '👀 Проверить настройки', callback_data: 'check_settings' },
      { text: MENU.MAIN, callback_data: 'main_menu' },
    ]);
  }

  /**
   * Черновик собран целиком — создаём документ магазина и, если доступа ещё
   * нет, подаём заявку. Обычно к этому моменту пользователь ввёл ОДИН токен:
   * остальные поля черновика заполнил autofillFromToken.
   *
   * Признаком НОВОЙ заявки служит атомарный переход статуса new → pending, а не
   * факт заполненности кредов: заполненность истинна и при каждом следующем
   * сохранении, из-за чего прежняя ветка «Все настройки API заполнены»
   * срабатывала на каждое сообщение. Проверка живёт в базе, поэтому переживает
   * рестарт и параллельную обработку двух вебхуков.
   */
  private async submitApplication(ctx: Context, draft: TOnboardingDraft): Promise<IReply> {
    const telegramUserId = ctx.from.id.toString();
    const botId = ctx.botInfo.id.toString();

    /**
     * Документ мог остаться от прежней версии бота или от отката заявки —
     * тогда обновляем его, а не заводим второй: unique-индекса на
     * telegramUserId у YandexMarket нет, дубли база не отсечёт.
     */
    const saveStore = async () => {
      const fields = {
        campaign_id: draft.campaign_id,
        business_id: draft.business_id,
        token: draft.token,
        // Название магазина — чтобы показывать его вместо идентификаторов.
        name: draft.store_name,
      };
      const existing = await this.yandexMarketService.findByTelegramUser(telegramUserId);
      return existing
        ? await this.yandexMarketService.updateByTelegramUser(telegramUserId, fields)
        : await this.yandexMarketService.create({
            ...fields,
            telegramUserId,
            telegramChatId: ctx.chat.id.toString(),
          });
    };

    const isAdmin = this.config.isAdmin(ctx.from.id);
    const access = await this.accessService.findByUserAndBot(telegramUserId, botId);

    /**
     * Заявка нужна только тому, у кого доступа ещё нет.
     *
     * Администратор-продавец не должен присылать заявку сам себе — это было
     * учтено и раньше. А вот УЖЕ ОДОБРЕННЫЙ пользователь, меняющий магазин,
     * попадал в tryApply, получал null (фильтр ждёт статус `new`) и читал
     * «Заявка уже отправлена администратору, ожидайте решения» — ответ не о
     * том, что он сделал, и о решении, которого он не ждёт.
     */
    if (isAdmin || access?.status === 'approved') {
      const store = await saveStore();

      if (access?.status !== 'approved') {
        await this.accessService.grant({
          telegramUserId,
          botId,
          telegramChatId: ctx.chat.id.toString(),
          username: ctx.from.username,
          firstName: ctx.from.first_name,
          lastName: ctx.from.last_name,
        });
      } else {
        // grant() чистит черновик сам; для уже одобренного делаем это явно,
        // иначе следующая правка увидит остатки этой.
        await this.accessService.clearDraft(telegramUserId, botId);
      }

      // Отдаём именно REPLY-клавиатуру, а не inline: до этого момента у
      // пользователя была сокращённая раскладка без отчётов, и её нужно
      // заменить прямо сейчас. Inline-кнопки живут в сообщении и меню под
      // полем ввода не меняют — пришлось бы жать «Главное меню» отдельно.
      return {
        // Говорим о том, что произошло, — подключён магазин. Прежнее
        // «🎉 Все настройки API заполнены!» осталось от снятой логики, где
        // признаком успеха считалась заполненность полей.
        message: [
          `✅ <b>Магазин подключён: ${esc(store?.name) || 'готово'}</b>`,
          '',
          'Отчёты доступны в меню ниже.',
        ].join('\n'),
        keyboard: await this.keyboard.createMenuKeyboard(isAdmin, access?.features),
      };
    }

    const applied = await this.accessService.tryApply(telegramUserId, botId);
    if (!applied) {
      // Заявка уже подана параллельным апдейтом — второй карточки быть не должно.
      return { message: '⏳ Заявка уже отправлена администратору, ожидайте решения.' };
    }

    const store = await saveStore();
    const delivered = await this.adminNotifier.sendApplication(ctx, applied, store);

    if (!delivered) {
      // Ни один администратор карточку не получил (типовая причина — админ не
      // нажимал /start и Telegram отвечает 403). Без отката пользователь навсегда
      // завис бы в pending, и узнать об этом было бы некому.
      await this.accessService.revertApply(telegramUserId, botId);
      // Магазин тоже убираем: иначе следующий ввод креда увидит существующий
      // документ, а статус останется new — пользователь застрянет навсегда.
      await this.yandexMarketService.deleteByTelegramUser(telegramUserId);
      return {
        message: [
          '⚠️ Не удалось отправить заявку администратору.',
          '',
          `Попробуйте позже или напишите в поддержку: ${SUPPORT_CONTACT}`,
        ].join('\n'),
      };
    }

    return {
      message: [
        '✅ <b>Заявка отправлена администратору.</b>',
        '',
        'Как только он примет решение, бот пришлёт сообщение сюда.',
      ].join('\n'),
    };
  }

  /**
   * Подтверждение принятого значения. Токен показывается ОБРЕЗАННЫМ: полностью
   * его не должно быть ни в логах, ни в переписке.
   */
  private acceptedLabel(field: TDraftField, value: string): string {
    const shown = field === 'token' ? `${esc(value.slice(0, 10))}…` : esc(value);
    return `✅ ${stepTitle(field)} принят: <code>${shown}</code>`;
  }
}
