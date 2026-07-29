import { Injectable, Logger } from '@nestjs/common';
import { Context } from 'telegraf';

import { AppConfigService } from '../../../../../config/app-config.service';
import {
  UserAccessService,
  type TDraftField,
} from '../../../../../database/services/user-access.service';
import { YandexMarketService } from '../../../../../database/services/yandex-market.service';
import { TTelegrafBot } from '../../../domain.telegram';
import { esc, htmlOptions } from '../../../formatting/telegram-format';
import { AdminNotifierService } from '../../shared/services/admin-notifier.service';
import { MENU, MENU_LABELS } from '../menu.constants';
import {
  ONBOARDING_TOTAL,
  nextStep,
  stepHelp,
  parseLabelledValue,
  stepNumber,
  stepPrompt,
  stepTitle,
  validateStep,
  type TOnboardingDraft,
} from '../onboarding';
import { PriceChangerKeyboard } from '../price-changer.keyboard';

import { ScheduleHandler } from './schedule.handler';

/** Префикс callback_data подсказки. Дальше идёт название шага. */
export const HELP_PREFIX = 'onboarding_help:';

/** Что ответить пользователю. */
interface IReply {
  message: string;
  keyboard?: any;
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

  constructor(
    private keyboard: PriceChangerKeyboard,
    private yandexMarketService: YandexMarketService,
    private accessService: UserAccessService,
    private adminNotifier: AdminNotifierService,
    private config: AppConfigService,
    private scheduleHandler: ScheduleHandler,
  ) {}

  public register(bot: TTelegrafBot) {
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
      // Незакрытый вопрос про время рассылки важнее правки настроек: иначе
      // «09:00» было бы истолковано как попытка изменить Campaign ID.
      if (await this.scheduleHandler.handlePendingTime(ctx, text)) {
        return { message: '' }; // ответ уже отправлен внутри
      }
      return await this.editSetting(ctx, text);
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
    const newDraft = updated?.draft ?? {};
    const following = nextStep(newDraft);

    if (!following) {
      return await this.submitApplication(ctx, newDraft);
    }

    return {
      message: `${this.acceptedLabel(field, value)}\n\n${stepPrompt(following)}`,
      keyboard: await this.restartKeyboard(following),
    };
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
    const labelled = parseLabelledValue(text);

    if (!labelled) {
      return {
        message: [
          '❓ Не понял, что именно нужно изменить.',
          '',
          'Пришлите значение с подписью:',
          '<code>token: ваш_токен</code>',
          '<code>campaign_id: 12345678</code>',
          '<code>business_id: 87654321</code>',
        ].join('\n'),
      };
    }

    const validation = validateStep(labelled.field, labelled.value);
    if (!validation.ok) {
      return { message: `❌ ${esc(validation.error)}` };
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
      keyboard: await this.keyboard.createInlineButtons([
        { text: '👀 Проверить настройки', callback_data: 'check_settings' },
        { text: MENU.MAIN, callback_data: 'main_menu' },
      ]),
    };
  }

  /**
   * Все три креда собраны — создаём документ магазина и подаём заявку.
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

    // Администратор-продавец не должен присылать заявку сам себе.
    if (this.config.isAdmin(ctx.from.id)) {
      await saveStore();
      await this.accessService.grant({
        telegramUserId,
        botId,
        telegramChatId: ctx.chat.id.toString(),
        username: ctx.from.username,
        firstName: ctx.from.first_name,
        lastName: ctx.from.last_name,
      });
      // Отдаём именно REPLY-клавиатуру, а не inline: до этого момента у
      // пользователя была сокращённая раскладка без отчётов, и её нужно
      // заменить прямо сейчас. Inline-кнопки живут в сообщении и меню под
      // полем ввода не меняют — пришлось бы жать «Главное меню» отдельно.
      return {
        message: '🎉 <b>Все настройки API заполнены!</b>\n\nОтчёты появились в меню ниже.',
        keyboard: await this.keyboard.createMenuKeyboard(),
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
        message:
          '⚠️ Не удалось отправить заявку администратору. Попробуйте позже или свяжитесь с поддержкой.',
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
    const step = stepNumber(field);
    return `✅ ${stepTitle(field)} принят (${step} из ${ONBOARDING_TOTAL}): <code>${shown}</code>`;
  }
}
