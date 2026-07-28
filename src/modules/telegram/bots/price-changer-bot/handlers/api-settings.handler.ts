import { Context } from 'telegraf';
import { ITelegramKeyboard, TTelegrafBot } from '../../../domain.telegram';
import { YandexMarketService } from '../../../../../database/services/yandex-market.service';
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
          await ctx.reply(result.message, result.keyboard);
        } else {
          await ctx.reply(result.message);
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
    const menuButtons = [
      '📊 Статистика',
      '⚙️ Настройки',
      '💰 Установить коэффициент цены',
      '📄 Загрузить прайс-лист',
      '❓ Помощь',
      '👤 Профиль',
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
        message: `🤔 Получен ID: **${cleanText}**

📋 **Уточните тип данных:**
Отправьте сообщение в формате:
• \`campaign_id: ${cleanText}\` - если это Campaign ID
• \`business_id: ${cleanText}\` - если это Business ID

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
      message: `❓ **Не удалось определить тип данных**

📝 **Получено:** "${cleanText}"

💡 **Отправьте данные в правильном формате:**
• \`campaign_id: 12345\` - ID кампании
• \`business_id: 67890\` - ID бизнеса
• \`token: ваш_токен\` - API токен
• \`coefficient: 1.2\` - коэффициент цены

📋 **Примеры корректного ввода:**
• campaign_id: 123456789
• business_id: 987654321
• token: ACMA:bhD15nJMV71y4UZPbAFOVTZvNVGgHzkfPIH9QdWm:e0035103
• coefficient: 1.15
• 1.2 (коэффициент без префикса)`,
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

      case 'coefficient':
        const coef = parseFloat(value);
        if (isNaN(coef) || coef <= 0 || coef > 10) {
          return {
            isValid: false,
            error:
              '❌ Коэффициент должен быть числом от 0.1 до 10.\nПример: coefficient: 1.2',
          };
        }
        break;

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
        campaign_id: `✅ **Campaign ID сохранен**\n🔑 ID кампании: \`${value}\``,
        business_id: `✅ **Business ID сохранен**\n🏢 ID бизнеса: \`${value}\``,
        token: `✅ **API токен сохранен**\n🎫 Токен: \`${String(value).substring(0, 10)}...\``,
        coefficient: `✅ **Коэффициент цены обновлен**\n💰 Новый коэффициент: **x${value}** (${Number(value) > 1 ? '+' : ''}${((Number(value) - 1) * 100).toFixed(1)}%)`,
      };

      let message = successMessages[type];

      console.log({ message });

      // Проверяем, все ли настройки заполнены
      if (await this.yandexMarketService.isConfigured(telegramUserId)) {
        message += `\n\n🎉 **Все настройки API заполнены!**\n✅ Теперь вы можете загружать прайс-листы`;

        const keyboard = await this.keyboard.createInlineButtons([
          { text: '📄 Загрузить прайс-лист', callback_data: 'upload_file' },
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
          message += `\n\n📋 **Осталось заполнить:**\n${missingFields.map((field) => `• ${field}`).join('\n')}`;
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
