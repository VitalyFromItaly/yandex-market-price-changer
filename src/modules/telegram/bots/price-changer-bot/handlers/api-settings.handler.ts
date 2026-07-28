import { Context } from 'telegraf';
import { ITelegramKeyboard, TTelegrafBot } from '../../../domain.telegram';
import { YandexMarketService } from '../../../../../database/services/yandex-market.service';
import { esc, htmlOptions } from '../../../formatting/telegram-format';
import { PriceChangerKeyboard } from '../price-changer.keyboard';

export class ApiSettingsHandler {
  constructor(
    private bot: TTelegrafBot,
    private keyboard: ITelegramKeyboard,
    private yandexMarketService: YandexMarketService,
  ) {}

  public setupHandlers() {
    console.log('Setting up API settings handler...');

    this.bot.on('text', async (ctx) => {
      try {
        const text = ctx.message.text.trim();
        console.log(
          `🔄 Text received in ApiSettingsHandler: "${text}" from user ${ctx.from.id}`,
        );

        // Игнорируем только команды
        if (text.startsWith('/')) {
          console.log(`⚡ Ignoring command: ${text}`);
          return;
        }

        // Игнорируем кнопки меню - они обрабатываются в MenuCommandsHandler
        if (this.isMenuButton(text)) {
          console.log(`🔘 Ignoring menu button: ${text}`);
          return;
        }

        console.log(
          `📝 Processing API settings text from user ${ctx.from.id}: "${text}"`,
        );

        // Парсим и сохраняем настройки API
        const result = await this.parseAndSaveApiSettings(
          ctx.from.id.toString(),
          ctx.botInfo.id.toString(),
          text,
        );

        if (result.success) {
          await ctx.reply(result.message, htmlOptions(result.keyboard));
        } else {
          await ctx.reply(result.message, htmlOptions());
        }
      } catch (error) {
        console.error('Ошибка обработки настроек API:', error);
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
    // Список ОБЯЗАН совпадать с актуальными подписями меню, иначе нажатие
    // кнопки проваливается сюда и гасится без ответа — именно так и были
    // сломаны все кнопки. Кнопки про цены и прайс-лист убраны (TASK-009).
    // Четвёртая копия списка подписей; сведение в один источник — TASK-014.
    const menuButtons = [
      '⚙️ Настройки API',
      '❓ Помощь',
      '📊 Мой профиль',
      '🏠 Главное меню',
    ];

    return menuButtons.includes(text);
  }

  /**
   * Парсинг и сохранение настроек API
   */
  private async parseAndSaveApiSettings(
    telegramUserId: string,
    telegramChatId: string,
    text: string,
  ): Promise<{
    success: boolean;
    message: string;
    keyboard?: any;
  }> {
    try {
      // Определяем тип данных и извлекаем значение
      const parseResult = this.parseApiData(text);

      console.log({ parseResult });

      if (!parseResult.success) {
        return {
          success: false,
          message: parseResult.message,
        };
      }

      // Сохраняем в базу данных
      const saveResult = await this.saveApiSetting(
        telegramUserId,
        telegramChatId,
        parseResult.type!,
        parseResult.value!,
      );

      return saveResult;
    } catch (error) {
      console.error('Ошибка парсинга настроек API:', error);
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
   * Сохранение настройки API в базу данных
   */
  private async saveApiSetting(
    telegramUserId: string,
    telegramChatId: string,
    type: 'campaign_id' | 'business_id' | 'token' | 'coefficient',
    value: string | number,
  ): Promise<{ success: boolean; message: string; keyboard?: any }> {
    try {
      console.log({ telegramUserId, telegramChatId, type, value });
      // Подготавливаем данные для обновления
      const updateData: any = {};
      updateData[type] = value;

      // Сохраняем в базу
      await this.yandexMarketService.upsertByTelegramUser(
        telegramUserId,
        telegramChatId,
        updateData,
      );

      // Получаем обновленные настройки для проверки
      const updatedSettings = await this.yandexMarketService.getByTelegramUser(telegramUserId);

      console.log({ updatedSettings });

      // Формируем сообщение об успехе
      const successMessages = {
        campaign_id: `✅ <b>Campaign ID сохранен</b>\n🔑 ID кампании: <code>${value}</code>`,
        business_id: `✅ <b>Business ID сохранен</b>\n🏢 ID бизнеса: <code>${value}</code>`,
        token: `✅ <b>API токен сохранен</b>\n🎫 Токен: <code>${String(value).substring(0, 10)}...</code>`,
      };

      let message = successMessages[type];

      console.log({ message });

      // Проверяем, все ли настройки заполнены
      if (await this.yandexMarketService.isConfigured(telegramUserId)) {
        message += `\n\n🎉 <b>Все настройки API заполнены!</b>`;

        const keyboard = await this.keyboard.createInlineButtons([
          { text: '👀 Проверить настройки', callback_data: 'check_settings' },
          { text: '🏠 Главное меню', callback_data: 'main_menu' },
        ]);

        return { success: true, message, keyboard };
      } else {
        // Показываем какие настройки еще нужно заполнить
        const missingFields = [];
        if (!updatedSettings?.campaign_id) {
          missingFields.push('🔑 Campaign ID');
        }
        if (!updatedSettings?.business_id) {
          missingFields.push('🏢 Business ID');
        }
        if (!updatedSettings?.token) {
          missingFields.push('🎫 API токен');
        }

        if (missingFields.length > 0) {
          message += `\n\n📋 <b>Осталось заполнить:</b>\n${missingFields.map((field) => `• ${field}`).join('\n')}`;
        }

        const keyboard = await this.keyboard.createInlineButtons([
          { text: '⚙️ Продолжить настройку', callback_data: 'settings_api' },
          { text: '🏠 Главное меню', callback_data: 'main_menu' },
        ]);

        return { success: true, message, keyboard };
      }
    } catch (error) {
      console.error('Ошибка сохранения настройки API:', error);
      return {
        success: false,
        message: '❌ Ошибка сохранения данных в базу. Попробуйте позже.',
      };
    }
  }
}
