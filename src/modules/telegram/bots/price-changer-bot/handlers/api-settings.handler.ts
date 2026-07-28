import { Context } from 'telegraf';
import { Injectable, Logger } from '@nestjs/common';
import { MENU, MENU_LABELS } from '../menu.constants';
import { ITelegramKeyboard, TTelegrafBot } from '../../../domain.telegram';
import { YandexMarketService } from '../../../../../database/services/yandex-market.service';
import {
  UserAccessService,
  type TDraftField,
} from '../../../../../database/services/user-access.service';
import { AppConfigService } from '../../../../../config/app-config.service';
import { AdminNotifierService } from '../../shared/services/admin-notifier.service';
import { esc, htmlOptions } from '../../../formatting/telegram-format';
import { PriceChangerKeyboard } from '../price-changer.keyboard';

@Injectable()
export class ApiSettingsHandler {
  private readonly logger = new Logger(ApiSettingsHandler.name);

  constructor(
    private keyboard: PriceChangerKeyboard,
    private yandexMarketService: YandexMarketService,
    private accessService: UserAccessService,
    private adminNotifier: AdminNotifierService,
    private config: AppConfigService,
  ) {}

  public register(bot: TTelegrafBot) {
    bot.on('text', async (ctx) => {
      try {
        const text = ctx.message.text.trim();

        // Игнорируем только команды
        if (text.startsWith('/')) return;

        // Игнорируем кнопки меню - они обрабатываются в MenuCommandsHandler
        if (this.isMenuButton(text)) return;

        // Текст пользователя НЕ логируем: через этот обработчик проходит токен
        // продавца, а логи не место для чужих секретов.
        this.logger.debug(`Разбор настроек API от пользователя ${ctx.from.id}`);

        const result = await this.parseAndSaveApiSettings(ctx, text);

        if (result.success) {
          await ctx.reply(result.message, htmlOptions(result.keyboard));
        } else {
          await ctx.reply(result.message, htmlOptions());
        }
      } catch (error) {
        this.logger.error('Ошибка обработки настроек API', error as Error);
        await ctx.reply(
          '❌ Произошла ошибка при обработке настроек. Попробуйте позже.',
        );
      }
    });
  }

  /**
   * Проверка, является ли текст кнопкой меню
   */
  private isMenuButton(text: string): boolean {
    // Раньше здесь был свой, ЧЕТВЁРТЫЙ по счёту список подписей. Он разъехался
    // с клавиатурой, и нажатие кнопки проваливалось сюда, где гасилось без
    // ответа — так и были сломаны все кнопки меню. Теперь источник один
    // (menu.constants), рассинхронизация невозможна (TASK-014).
    return (MENU_LABELS as readonly string[]).includes(text);
  }

  /**
   * Парсинг и сохранение настроек API
   */
  private async parseAndSaveApiSettings(
    ctx: Context,
    text: string,
  ): Promise<{
    success: boolean;
    message: string;
    keyboard?: any;
  }> {
    try {
      // Определяем тип данных и извлекаем значение
      const parseResult = this.parseApiData(text);

      if (!parseResult.success) {
        return {
          success: false,
          message: parseResult.message,
        };
      }

      // Сохраняем в базу данных
      const saveResult = await this.saveApiSetting(
        ctx,
        parseResult.type!,
        parseResult.value!,
      );

      return saveResult;
    } catch (error) {
      this.logger.error('Ошибка парсинга настроек API', error as Error);
      return {
        success: false,
        message:
          '❌ Ошибка обработки данных. Проверьте формат и попробуйте снова.',
      };
    }
  }

  /**
   * Парсинг данных API из текста
   */
  private parseApiData(text: string): {
    success: boolean;
    type?: 'campaign_id' | 'business_id' | 'token' | 'coefficient';
    value?: string | number;
    message: string;
  } {
    const cleanText = text.trim();

    // Проверяем форматированный ввод (campaign_id: 12345)
    const formattedMatch = cleanText.match(
      /^(campaign_id|business_id|token|coefficient)\s*:\s*(.+)$/i,
    );
    if (formattedMatch) {
      const type = formattedMatch[1].toLowerCase() as
        | 'campaign_id'
        | 'business_id'
        | 'token'
        | 'coefficient';
      const value = formattedMatch[2].trim();

      const validation = this.validateApiValue(type, value);
      if (!validation.isValid) {
        return { success: false, message: validation.error };
      }

      return {
        success: true,
        type,
        value: type === 'coefficient' ? parseFloat(value) : value,
        message: '',
      };
    }

    // Автоматическое определение типа данных

    // Проверяем коэффициент (число от 0.1 до 10)
    const coefficientMatch = cleanText.match(/^(x?)(\d+\.?\d*)$/);
    if (coefficientMatch) {
      const coefficient = parseFloat(coefficientMatch[2]);
      if (coefficient >= 0.1 && coefficient <= 10) {
        return {
          success: true,
          type: 'coefficient',
          value: coefficient,
          message: '',
        };
      }
    }

    // Проверяем Campaign ID / Business ID (только цифры, обычно 5-15 символов)
    if (/^\d{5,15}$/.test(cleanText)) {
      // Не можем автоматически определить campaignId или businessId, спрашиваем
      return {
        success: false,
        message: `🤔 Получен ID: <b>${esc(cleanText)}</b>

📋 <b>Уточните тип данных:</b>
Отправьте сообщение в формате:
• <code>campaign_id: ${cleanText}</code> - если это Campaign ID
• <code>business_id: ${cleanText}</code> - если это Business ID

💡 Или воспользуйтесь кнопками для уточнения.`,
      };
    }

    // Проверяем токен (длинная строка)
    if (cleanText.length > 20 && /^[A-Za-z0-9_:-]+$/.test(cleanText)) {
      return {
        success: true,
        type: 'token',
        value: cleanText,
        message: '',
      };
    }

    // Не удалось определить тип данных
    return {
      success: false,
      message: `❓ <b>Не удалось определить тип данных</b>

📝 <b>Получено:</b> "${esc(cleanText)}"

💡 <b>Отправьте данные в правильном формате:</b>
• <code>campaign_id: 12345</code> - ID кампании
• <code>business_id: 67890</code> - ID бизнеса
• <code>token: ваш_токен</code> - API токен

📋 <b>Примеры корректного ввода:</b>
• campaign_id: 123456789
• business_id: 987654321
• token: ACMA:bhD15nJMV71y4UZPbAFOVTZvNVGgHzkfPIH9QdWm:e0035103`,
    };
  }

  /**
   * Валидация значений API
   */
  private validateApiValue(
    type: string,
    value: string,
  ): { isValid: boolean; error: string } {
    switch (type) {
      case 'campaign_id':
        if (!/^\d{5,15}$/.test(value)) {
          return {
            isValid: false,
            error:
              '❌ Campaign ID должен содержать только цифры (5-15 символов).\nПример: campaign_id: 123456789',
          };
        }
        break;

      case 'business_id':
        if (!/^\d{5,15}$/.test(value)) {
          return {
            isValid: false,
            error:
              '❌ Business ID должен содержать только цифры (5-15 символов).\nПример: business_id: 987654321',
          };
        }
        break;

      case 'token':
        if (value.length < 10) {
          return {
            isValid: false,
            error:
              '❌ API токен должен содержать минимум 10 символов.\n',
          };
        }
        if (!/^[A-Za-z0-9_:-]+$/.test(value)) {
          return {
            isValid: false,
            error: '❌ API токен содержит недопустимые символы.',
          };
        }
        break;

      // Коэффициент цены больше не принимается (TASK-009): изменение цен
      // по API отключено, значение всё равно никем не читается.
      case 'coefficient':
        return {
          isValid: false,
          error:
            '❌ Коэффициент цены больше не используется — бот работает только на чтение и не меняет цены в магазине.',
        };

      default:
        return {
          isValid: false,
          error: '❌ Неизвестный тип данных.',
        };
    }

    return { isValid: true, error: '' };
  }

  /**
   * Сохранение настройки API.
   *
   * Ветки различает СТАТУС ДОСТУПА, а не наличие документа YandexMarket:
   *
   * 1. approved — пользователь правит свою настройку. Пишем напрямую,
   *    администратора не трогаем.
   * 2. иначе — идёт регистрация. Креды копятся в черновике UserAccess, потому
   *    что три поля YandexMarket объявлены required, а пользователь вводит их
   *    по одному: попытка создать документ с одним полем падала ValidationError,
   *    и первый же ввод креда выдавал «Ошибка сохранения данных в базу».
   *
   * Различать ветки по наличию документа нельзя: документ может существовать у
   * НЕодобренного пользователя — он остаётся от прежней версии бота, а также
   * после отката недоставленной заявки. Такой пользователь попадал в тупик:
   * ввод креда молча обновлял магазин, статус навсегда оставался new, и заявка
   * не уходила никогда.
   */
  private async saveApiSetting(
    ctx: Context,
    type: 'campaign_id' | 'business_id' | 'token' | 'coefficient',
    value: string | number,
  ): Promise<{ success: boolean; message: string; keyboard?: any }> {
    // Коэффициент распознаётся автоопределением (голое число), но не проходит
    // валидацию форматированного ввода. Без этой ветки для него не находилось
    // текста ответа и пользователь получал сообщение "undefined".
    if (type === 'coefficient') {
      return {
        success: false,
        message:
          '❌ Коэффициент цены больше не используется — бот работает только на чтение и не меняет цены в магазине.',
      };
    }

    const telegramUserId = ctx.from.id.toString();
    const botId = ctx.botInfo.id.toString();

    try {
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
        const updated = await this.yandexMarketService.updateByTelegramUser(
          telegramUserId,
          { [type]: value },
        );
        // Одобренный без магазина — редкий случай (доступ выдан вручную);
        // тогда проваливаемся в сбор черновика ниже.
        if (updated) {
          return {
            success: true,
            message: `${this.savedLabel(type, value)}\n\n✅ Настройка обновлена.`,
            keyboard: await this.keyboard.createInlineButtons([
              { text: '👀 Проверить настройки', callback_data: 'check_settings' },
              { text: MENU.MAIN, callback_data: 'main_menu' },
            ]),
          };
        }
      }

      const withDraft = await this.accessService.saveDraftField(
        telegramUserId,
        botId,
        type as TDraftField,
        String(value),
      );
      const draft = withDraft?.draft ?? {};

      const missing = this.missingFields(draft);
      if (missing.length) {
        return {
          success: true,
          message:
            `${this.savedLabel(type, value)}\n\n📋 <b>Осталось заполнить:</b>\n` +
            missing.map((field) => `• ${field}`).join('\n'),
          keyboard: await this.keyboard.createInlineButtons([
            { text: '⚙️ Продолжить настройку', callback_data: 'settings_api' },
          ]),
        };
      }

      return await this.submitApplication(ctx, access.status, draft, type, value);
    } catch (error) {
      this.logger.error('Ошибка сохранения настройки API', error as Error);
      return {
        success: false,
        message: '❌ Ошибка сохранения данных в базу. Попробуйте позже.',
      };
    }
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
  private async submitApplication(
    ctx: Context,
    status: string,
    draft: { token?: string; campaign_id?: string; business_id?: string },
    type: string,
    value: string | number,
  ): Promise<{ success: boolean; message: string; keyboard?: any }> {
    const telegramUserId = ctx.from.id.toString();
    const botId = ctx.botInfo.id.toString();
    const saved = this.savedLabel(type, value);

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

    // Администратор-продавец не должен присылать заявку сам себе. Уже
    // одобренный без магазина — тоже: доступ у него есть, заявка не нужна.
    if (this.config.isAdmin(ctx.from.id) || status === 'approved') {
      await saveStore();
      await this.accessService.grant({
        telegramUserId,
        botId,
        telegramChatId: ctx.chat.id.toString(),
        username: ctx.from.username,
        firstName: ctx.from.first_name,
        lastName: ctx.from.last_name,
      });
      return {
        success: true,
        message: `${saved}\n\n🎉 <b>Все настройки API заполнены!</b>`,
        keyboard: await this.keyboard.createInlineButtons([
          { text: '👀 Проверить настройки', callback_data: 'check_settings' },
          { text: MENU.MAIN, callback_data: 'main_menu' },
        ]),
      };
    }

    const applied = await this.accessService.tryApply(telegramUserId, botId);
    if (!applied) {
      // Заявка уже подана параллельным апдейтом — второй карточки быть не должно.
      return {
        success: true,
        message: `${saved}\n\n⏳ Заявка уже отправлена администратору, ожидайте решения.`,
      };
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
        success: false,
        message:
          `${saved}\n\n⚠️ Не удалось отправить заявку администратору. ` +
          'Попробуйте позже или свяжитесь с поддержкой.',
      };
    }

    return {
      success: true,
      message: `${saved}\n\n✅ <b>Заявка отправлена администратору.</b>\n\nКак только он примет решение, бот пришлёт сообщение сюда.`,
    };
  }

  private savedLabel(type: string, value: string | number): string {
    switch (type) {
      case 'campaign_id':
        return `✅ <b>Campaign ID сохранён</b>\n🔑 ID кампании: <code>${esc(value)}</code>`;
      case 'business_id':
        return `✅ <b>Business ID сохранён</b>\n🏢 ID бизнеса: <code>${esc(value)}</code>`;
      default:
        return `✅ <b>API токен сохранён</b>\n🎫 Токен: <code>${esc(String(value).substring(0, 10))}...</code>`;
    }
  }

  private missingFields(draft: {
    token?: string;
    campaign_id?: string;
    business_id?: string;
  }): string[] {
    const missing: string[] = [];
    if (!draft.campaign_id) missing.push('🔑 Campaign ID');
    if (!draft.business_id) missing.push('🏢 Business ID');
    if (!draft.token) missing.push('🎫 API токен');
    return missing;
  }
}
