import { Context } from 'telegraf';
import { ITelegramKeyboard } from '../../../domain.telegram';
import { YandexMarketService } from '../../../../../database/services/yandex-market.service';

export class SharedCommandsHandler {
  constructor(
    private keyboard: ITelegramKeyboard,
    private yandexMarketService: YandexMarketService
  ) {}

  /**
   * Обработчик установки коэффициента цены
   */
  async handlePriceCoefficientCommand(ctx: Context): Promise<void> {
    try {
      // Получаем текущие настройки
      const yandexSettings = await this.yandexMarketService.getByTelegramUser(
        ctx.from.id.toString()
      );

      const currentCoefficient = yandexSettings?.priceCoefficient || 1.2;
      const coefficientText = currentCoefficient === 1.0
        ? 'без изменений'
        : `x${currentCoefficient} (${currentCoefficient > 1 ? '+' : ''}${((currentCoefficient - 1) * 100).toFixed(1)}%)`;

      const message = `💰 Установка коэффициента цены

Текущий коэффициент: **${coefficientText}**

📝 Выберите готовый коэффициент или введите свой:`;

      const keyboard = await this.keyboard.createInlineKeyboardMatrix([
        [
          { text: 'x0.9 (-10%)', callback_data: 'set_coefficient_0.9' },
          { text: 'x1.0 (без изменений)', callback_data: 'set_coefficient_1.0' }
        ],
        [
          { text: 'x1.1 (+10%)', callback_data: 'set_coefficient_1.1' },
          { text: 'x1.2 (+20%)', callback_data: 'set_coefficient_1.2' }
        ],
        [
          { text: 'x1.3 (+30%)', callback_data: 'set_coefficient_1.3' },
          { text: 'x1.5 (+50%)', callback_data: 'set_coefficient_1.5' }
        ],
        [{ text: '📝 Ввести свой коэффициент', callback_data: 'input_custom_coefficient' }],
        [{ text: '❌ Отмена', callback_data: 'main_menu' }],
      ]);

      await ctx.reply(message, keyboard);
    } catch (error) {
      console.error('Ошибка при получении коэффициента:', error);
      await ctx.reply('❌ Ошибка при загрузке данных. Попробуйте позже.');
    }
  }

  /**
   * Обработчик команды загрузки прайс-листа
   */
  async handleUploadPriceListCommand(ctx: Context): Promise<void> {
    try {
      // Проверяем настройки Яндекс Маркета
      const yandexSettings = await this.yandexMarketService.getByTelegramUser(
        ctx.from.id.toString()
      );

      // Если настройки не найдены или не заполнены
      const isConfigured = await this.yandexMarketService.isConfigured(ctx.from.id.toString());
      if (!yandexSettings || !isConfigured) {
        await this.handleMissingApiSettings(ctx, yandexSettings);
        return;
      }

      // Если настройки заполнены - разрешаем загрузку
      await this.handleAllowedUpload(ctx, yandexSettings);
    } catch (error) {
      console.error('Ошибка при проверке настроек:', error);
      await ctx.reply(
        '❌ Произошла ошибка при проверке настроек. Пожалуйста, попробуйте позже.',
      );
    }
  }

  /**
   * Обработка случая когда настройки API отсутствуют
   */
  private async handleMissingApiSettings(ctx: Context, yandexSettings: any): Promise<void> {
    const missingFields = [];

    if (!yandexSettings?.campaign_id) {
      missingFields.push('🔑 Campaign ID');
    }
    if (!yandexSettings?.business_id) {
      missingFields.push('🏢 Business ID');
    }
    if (!yandexSettings?.token) {
      missingFields.push('🎫 API токен');
    }

    const settingsMessage = `🚫 **Загрузка прайс-листа недоступна**

❗ Для загрузки прайс-листа необходимо заполнить настройки Яндекс Маркета:

❌ **Отсутствуют данные:**
${missingFields.map((field) => `• ${field}`).join('\n')}

🔧 **Где найти эти данные:**
• Campaign ID и Business ID - в личном кабинете Яндекс.Маркета
• API токен - в разделе "API" личного кабинета

💡 **Следующие шаги:**
1. Нажмите "⚙️ Настроить API"
2. Заполните все необходимые поля
3. Вернитесь к загрузке прайс-листа`;

    const keyboard = await this.keyboard.createInlineButtons([
      { text: '⚙️ Настроить API', callback_data: 'settings_api' },
      { text: '❓ Инструкция', callback_data: 'help_api_setup' },
      { text: '🏠 Главное меню', callback_data: 'main_menu' },
    ]);

    await ctx.reply(settingsMessage, keyboard);
  }

  /**
   * Обработка случая когда настройки API заполнены
   */
  private async handleAllowedUpload(ctx: Context, yandexSettings: any): Promise<void> {
    const currentCoefficient = yandexSettings.priceCoefficient || 1.2;
    const coefficientText =
      currentCoefficient === 1.2
        ? 'без изменений'
        : `x${currentCoefficient} (${currentCoefficient > 1 ? '+' : ''}${((currentCoefficient - 1) * 100).toFixed(1)}%)`;

    const message = `📄 **Загрузка прайс-листа**

✅ Настройки Яндекс Маркета настроены
💰 Текущий коэффициент цены: **${coefficientText}**

📊 **Поддерживаемые форматы:**
• Excel (.xlsx, .xls)
• CSV (.csv)

📋 **Требуемые колонки:**
• **Название товара** (name, title, товар, наименование)
• **Цена** (price, цена, cost, стоимость)
• **Артикул/SKU** (sku, артикул, код) - обязательно!
• Количество (quantity, количество, остаток) - опционально

⚠️ **Важно:**
• Колонка с артикулом (SKU) обязательна для обновления цен
• Цены будут автоматически умножены на коэффициент
• Максимальный размер файла: 10MB

📤 **Отправьте файл прайс-листа для обработки**`;

    const keyboard = await this.keyboard.createInlineButtons([
      { text: '📋 Скачать пример', callback_data: 'download_example' },
      {
        text: '💰 Изменить коэффициент',
        callback_data: 'change_coefficient',
      },
      { text: '❌ Отмена', callback_data: 'cancel_upload' },
    ]);

    await ctx.reply(message, keyboard);
  }

  /**
   * Обработка ввода коэффициента (кнопки или текст)
   */
  async handleCoefficientInput(ctx: any, input: string): Promise<void> {
    try {
      // Извлекаем число из ввода (убираем 'x' если есть)
      const coefficientValue = parseFloat(input.replace('x', ''));

      // Валидация
      if (isNaN(coefficientValue) || coefficientValue <= 0 || coefficientValue > 10) {
        await ctx.reply(
          '❌ Некорректный коэффициент!\n\n' +
          '💡 Коэффициент должен быть числом от 0.1 до 10\n' +
          'Примеры: 1.2, 0.9, 1.5'
        );
        return;
      }

      // Сохраняем коэффициент
      await this.yandexMarketService.upsertByTelegramUser(
        ctx.from.id.toString(),
        ctx.chat.id.toString(),
        { priceCoefficient: coefficientValue }
      );

      // Формируем сообщение об успехе
      const percentageText = coefficientValue === 1.0 
        ? 'без изменений'
        : `${coefficientValue > 1 ? '+' : ''}${((coefficientValue - 1) * 100).toFixed(1)}%`;

      const successMessage = `✅ **Коэффициент цены обновлен!**

💰 Новый коэффициент: **x${coefficientValue}** (${percentageText})

📊 Это означает:
• При коэффициенте > 1.0 - цены увеличатся
• При коэффициенте < 1.0 - цены уменьшатся
• При коэффициенте = 1.0 - цены останутся без изменений

🔄 Коэффициент будет применен к следующим загруженным прайс-листам.`;

      const keyboard = await this.keyboard.createInlineButtons([
        { text: '📄 Загрузить прайс-лист', callback_data: 'upload_file' },
        { text: '💰 Изменить коэффициент', callback_data: 'change_coefficient' },
        { text: '🏠 Главное меню', callback_data: 'main_menu' },
      ]);

      await ctx.reply(successMessage, keyboard);

    } catch (error) {
      console.error('Ошибка при сохранении коэффициента:', error);
      await ctx.reply(
        '❌ Ошибка при сохранении коэффициента.\n\n' +
        '💡 Попробуйте позже или обратитесь к администратору.'
      );
    }
  }
} 