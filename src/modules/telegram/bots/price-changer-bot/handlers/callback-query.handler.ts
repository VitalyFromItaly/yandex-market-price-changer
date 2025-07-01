import { ITelegramKeyboard, TTelegrafBot } from '../../../domain.telegram';
import { YandexMarketService } from '../../../../../database/mongo/services/yandex-market.service';
import { PriceChangerKeyboard } from '../price-changer.keyboard';

export class CallbackQueryHandler {
  constructor(
    private bot: TTelegrafBot,
    private keyboard: ITelegramKeyboard,
  ) {}

  public setupHandlers() {
    console.log('Setting up callback query handlers...');

    this.bot.on('callback_query', async (ctx) => {
      const callbackData = (ctx.callbackQuery as any).data;

      // Обязательно отвечаем на callback query
      await ctx.answerCbQuery();

      switch (callbackData) {
        case 'confirm_yes':
          await ctx.editMessageText('✅ Операция подтверждена!');
          break;

        case 'confirm_no':
          await ctx.editMessageText('❌ Операция отменена.');
          break;

        case 'plan_day':
          await ctx.editMessageText('📅 Выбран тарифный план: День (100₽)');
          break;

        case 'plan_week':
          await ctx.editMessageText('📅 Выбран тарифный план: Неделя (500₽)');
          break;

        case 'plan_month':
          await ctx.editMessageText('📅 Выбран тарифный план: Месяц (1500₽)');
          break;

        case 'plan_year':
          await ctx.editMessageText('📅 Выбран тарифный план: Год (15000₽)');
          break;

        case 'plan_cancel':
          await ctx.editMessageText('❌ Выбор тарифного плана отменен.');
          break;

        case 'settings_api':
          await ctx.editMessageText(`
            🔧 **Настройка API Яндекс Маркета**

            📋 **Для настройки потребуется:**

            🔑 **Campaign ID** - ID кампании в Яндекс.Маркете
            🏢 **Business ID** - ID бизнеса в Яндекс.Маркете
            🎫 **API токен** - токен авторизации

            📍 **Где найти:**
            1. Войдите в личный кабинет partner.market.yandex.ru
            2. Campaign ID: в URL кабинета после /campaigns/
            3. Business ID: в разделе "Настройки" → "Общие"
            4. API токен: "Настройки" → "API" → "Создать токен"

            💡 **Отправьте данные в формате:**
            \`campaign_id: 12345\`
\`business_id: 67890\`
            \`token: ваш_токен_здесь\`

            Или по отдельности, бот автоматически определит тип данных.`);
          break;

        case 'help_api_setup':
          await ctx.editMessageText(`❓ **Подробная инструкция настройки API**

            📋 **Шаг 1: Получение Campaign ID**
            • Откройте partner.market.yandex.ru
            • В URL после /campaigns/ будет ваш Campaign ID
            • Пример: partner.market.yandex.ru/campaigns/12345

            🏢 **Шаг 2: Получение Business ID**
            • В кабинете: "Настройки" → "Общие настройки"
            • Найдите "ID бизнеса" или "Business ID"

            🔑 **Шаг 3: Создание API токена**
            • "Настройки" → "API и веб-сервисы"
            • "Создать токен" → выберите нужные права
            • Скопируйте созданный токен

            📤 **Отправка данных:**
            Отправьте каждый параметр отдельным сообщением:
            1. Campaign ID: 12345
            2. Business ID: 67890
            3. Token: ваш_длинный_токен

✅ Бот автоматически сохранит настройки.`);
          break;

        case 'main_menu':
          const mainKeyboard = await this.keyboard.createKeyboard([
            ['📊 Статистика', '⚙️ Настройки'],
            ['💰 Установить коэффициент цены'],
            ['📄 Загрузить прайс-лист'],
            ['❓ Помощь', '👤 Профиль'],
          ]);
          await ctx.editMessageText('🏠 Главное меню:');
          await ctx.reply('Выберите действие:', mainKeyboard);
          break;

        case 'download_example':
          await ctx.editMessageText(
            '📋 Пример файла будет отправлен вам в личные сообщения...',
          );
          // TODO: Реализовать отправку примера файла
          break;

        case 'change_coefficient':
          await ctx.editMessageText(`💰 **Изменение коэффициента цены**

Выберите новый коэффициент или введите свой:

📝 **Варианты коэффициентов:**
• 0.9 = скидка 10%
• 1.0 = без изменений
• 1.1 = наценка 10%
• 1.2 = наценка 20%
• 1.5 = наценка 50%

💡 Введите свой коэффициент числом (например: 1.15)`);
          break;

        case 'cancel_upload':
          await ctx.editMessageText('❌ Загрузка прайс-листа отменена.');
          break;

        case 'upload_file':
          await ctx.editMessageText(
            '📤 **Отправьте файл прайс-листа**\n\nПоддерживаемые форматы: Excel (.xlsx, .xls), CSV (.csv)',
          );
          break;

        case 'check_settings':
          try {
            const settings = await YandexMarketService.getByTelegramUser(
              ctx.from.id.toString(),
            );
            if (settings) {
              const settingsText = `🔧 **Текущие настройки API**

🔑 **Campaign ID:** ${settings.campaign_id ? `\`${settings.campaign_id}\`` : '❌ Не заполнен'}
🏢 **Business ID:** ${settings.business_id ? `\`${settings.business_id}\`` : '❌ Не заполнен'}
🎫 **API токен:** ${settings.token ? `\`${settings.token.substring(0, 10)}...\`` : '❌ Не заполнен'}
💰 **Коэффициент:** x${settings.priceCoefficient || 1.0}

${settings.isConfigured() ? '✅ Все настройки заполнены' : '⚠️ Требуется дозаполнение'}`;

              await ctx.editMessageText(settingsText);
            } else {
              await ctx.editMessageText('❌ Настройки не найдены.');
            }
          } catch (error) {
            await ctx.editMessageText('❌ Ошибка получения настроек.');
          }
          break;

        // Обработка установки коэффициентов
        case 'set_coefficient_0.9':
          await this.handleCoefficientSet(ctx, 0.9);
          break;

        case 'set_coefficient_1.0':
          await this.handleCoefficientSet(ctx, 1.0);
          break;

        case 'set_coefficient_1.1':
          await this.handleCoefficientSet(ctx, 1.1);
          break;

        case 'set_coefficient_1.2':
          await this.handleCoefficientSet(ctx, 1.2);
          break;

        case 'set_coefficient_1.3':
          await this.handleCoefficientSet(ctx, 1.3);
          break;

        case 'set_coefficient_1.5':
          await this.handleCoefficientSet(ctx, 1.5);
          break;

        case 'input_custom_coefficient':
          await ctx.editMessageText(`💰 **Ввод пользовательского коэффициента**

📝 Отправьте числовое значение коэффициента от 0.1 до 10.0

Примеры:
• \`1.15\` - для наценки 15%
• \`0.85\` - для скидки 15%
• \`2.0\` - для увеличения цены в 2 раза

💡 Отправьте просто число в следующем сообщении.`);
          break;

        default:
          await ctx.editMessageText(`Неизвестная команда: ${callbackData}`);
      }
    });
  }

  /**
   * Обработка установки коэффициента цены
   */
  private async handleCoefficientSet(ctx: any, coefficient: number): Promise<void> {
    try {
      // Сохраняем коэффициент в базе данных
      await YandexMarketService.upsertByTelegramUser(
        ctx.from.id.toString(),
        ctx.chat.id.toString(),
        { priceCoefficient: coefficient }
      );

      // Формируем сообщение об успехе
      const percentageText = coefficient === 1.0 
        ? 'без изменений'
        : `${coefficient > 1 ? '+' : ''}${((coefficient - 1) * 100).toFixed(1)}%`;

      const successMessage = `✅ **Коэффициент цены установлен!**

💰 Новый коэффициент: **x${coefficient}** (${percentageText})

📊 Это означает:
${coefficient > 1 ? '• Цены будут увеличены' : coefficient < 1 ? '• Цены будут уменьшены' : '• Цены останутся без изменений'}

🔄 Коэффициент будет применен к следующим загруженным прайс-листам.`;

      const keyboard = await this.keyboard.createInlineButtons([
        { text: '📄 Загрузить прайс-лист', callback_data: 'upload_file' },
        { text: '💰 Изменить коэффициент', callback_data: 'change_coefficient' },
        { text: '🏠 Главное меню', callback_data: 'main_menu' },
      ]);

      await ctx.editMessageText(successMessage, { reply_markup: keyboard.reply_markup });
      await ctx.answerCbQuery('Коэффициент обновлен!');

    } catch (error) {
      console.error('Ошибка при сохранении коэффициента:', error);
      await ctx.editMessageText(
        '❌ Ошибка при сохранении коэффициента.\n\n' +
        '💡 Попробуйте позже или обратитесь к администратору.'
      );
      await ctx.answerCbQuery('Ошибка!');
    }
  }
}
