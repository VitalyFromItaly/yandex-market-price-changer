import { Context } from 'telegraf';
import { ITelegramKeyboard, TTelegrafBot } from '../../../domain.telegram';
import { YandexMarketService } from '../../../../../database/services/yandex-market.service';
import { PriceChangerKeyboard } from '../price-changer.keyboard';

export class CallbackQueryHandler {
  constructor(
    private bot: TTelegrafBot,
    private keyboard: ITelegramKeyboard,
    private yandexMarketService: YandexMarketService,
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
          // Подписи обязаны совпадать с PriceChangerKeyboard.menuCommands и с
          // bot.hears в MenuCommandsHandler — иначе кнопка молча не работает.
          // Здесь это ТРЕТЬЯ копия списка; сведение в единый источник — TASK-014.
          // Кнопки про коэффициент и прайс-лист убраны (TASK-009).
          const mainKeyboard = await this.keyboard.createKeyboard([
            ['⚙️ Настройки API'],
            ['❓ Помощь', '📊 Мой профиль'],
          ]);
          await ctx.editMessageText('🏠 Главное меню:');
          await ctx.reply('Выберите действие:', mainKeyboard);
          break;

        // Ветки download_example, change_coefficient, cancel_upload,
        // upload_file, set_coefficient_* и input_custom_coefficient сняты
        // (TASK-009): изменение цен по API отключено, приём файла тоже.
        // Кнопки с этими callback_data больше не отправляются.

        case 'check_settings':
          try {
            const settings = await this.yandexMarketService.getByTelegramUser(
              ctx.from.id.toString(),
            );
            if (settings) {
              const settingsText = `🔧 **Текущие настройки API**

🔑 **Campaign ID:** ${settings.campaign_id ? `\`${settings.campaign_id}\`` : '❌ Не заполнен'}
🏢 **Business ID:** ${settings.business_id ? `\`${settings.business_id}\`` : '❌ Не заполнен'}
🎫 **API токен:** ${settings.token ? `\`${settings.token.substring(0, 10)}...\`` : '❌ Не заполнен'}

${await this.yandexMarketService.isConfigured(ctx.from.id.toString()) ? '✅ Все настройки заполнены' : '⚠️ Требуется дозаполнение'}`;

              await ctx.editMessageText(settingsText);
            } else {
              await ctx.editMessageText('❌ Настройки не найдены.');
            }
          } catch (error) {
            await ctx.editMessageText('❌ Ошибка получения настроек.');
          }
          break;

        default:
          await ctx.editMessageText(`Неизвестная команда: ${callbackData}`);
      }
    });
  }

  /**
   * Обработка установки коэффициента цены
   */
  /** @deprecated Кнопки set_coefficient_* сняты (TASK-009). Не вызывается.
   *  Дефект на память: метод повторно звал answerCbQuery, хотя обработчик
   *  callback_query уже отвечал на запрос выше — второй вызов возвращал 400. */
  private async handleCoefficientSet(ctx: any, coefficient: number): Promise<void> {
    try {
      // Сохраняем коэффициент в базе данных
      await this.yandexMarketService.upsertByTelegramUser(
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
