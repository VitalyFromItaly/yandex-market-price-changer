import { Context } from 'telegraf';
import { Injectable } from '@nestjs/common';
import { MENU, menuLayout } from '../menu.constants';
import { ITelegramKeyboard, TTelegrafBot } from '../../../domain.telegram';
import { YandexMarketService } from '../../../../../database/services/yandex-market.service';
import { PriceChangerKeyboard } from '../price-changer.keyboard';
import { esc, htmlOptions } from '../../../formatting/telegram-format';

@Injectable()
export class CallbackQueryHandler {
  constructor(
    private keyboard: PriceChangerKeyboard,
    private yandexMarketService: YandexMarketService,
  ) {}

  public register(bot: TTelegrafBot) {
    console.log('Setting up callback query handlers...');

    bot.on('callback_query', async (ctx) => {
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
            🔧 <b>Настройка API Яндекс Маркета</b>

            📋 <b>Для настройки потребуется:</b>

            🔑 <b>Campaign ID</b> - ID кампании в Яндекс.Маркете
            🏢 <b>Business ID</b> - ID бизнеса в Яндекс.Маркете
            🎫 <b>API токен</b> - токен авторизации

            📍 <b>Где найти:</b>
            1. Войдите в личный кабинет partner.market.yandex.ru
            2. Campaign ID: в URL кабинета после /campaigns/
            3. Business ID: в разделе "Настройки" → "Общие"
            4. API токен: "Настройки" → "API" → "Создать токен"

            💡 <b>Отправьте данные в формате:</b>
            <code>campaign_id: 12345</code>
<code>business_id: 67890</code>
            <code>token: ваш_токен_здесь</code>

            Или по отдельности, бот автоматически определит тип данных.`, htmlOptions());
          break;

        case 'help_api_setup':
          await ctx.editMessageText(`❓ <b>Подробная инструкция настройки API</b>

            📋 <b>Шаг 1: Получение Campaign ID</b>
            • Откройте partner.market.yandex.ru
            • В URL после /campaigns/ будет ваш Campaign ID
            • Пример: partner.market.yandex.ru/campaigns/12345

            🏢 <b>Шаг 2: Получение Business ID</b>
            • В кабинете: "Настройки" → "Общие настройки"
            • Найдите "ID бизнеса" или "Business ID"

            🔑 <b>Шаг 3: Создание API токена</b>
            • "Настройки" → "API и веб-сервисы"
            • "Создать токен" → выберите нужные права
            • Скопируйте созданный токен

            📤 <b>Отправка данных:</b>
            Отправьте каждый параметр отдельным сообщением:
            1. Campaign ID: 12345
            2. Business ID: 67890
            3. Token: ваш_длинный_токен

✅ Бот автоматически сохранит настройки.`, htmlOptions());
          break;

        case 'main_menu':
          // Раскладка — из menu.constants (TASK-014). Раньше здесь была
          // третья независимая копия списка подписей.
          const mainKeyboard = await this.keyboard.createKeyboard(menuLayout());
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
              const settingsText = `🔧 <b>Текущие настройки API</b>

🔑 <b>Campaign ID:</b> ${settings.campaign_id ? `<code>${esc(settings.campaign_id)}</code>` : '❌ Не заполнен'}
🏢 <b>Business ID:</b> ${settings.business_id ? `<code>${esc(settings.business_id)}</code>` : '❌ Не заполнен'}
🎫 <b>API токен:</b> ${settings.token ? `<code>${esc(settings.token.substring(0, 10))}...</code>` : '❌ Не заполнен'}

${await this.yandexMarketService.isConfigured(ctx.from.id.toString()) ? '✅ Все настройки заполнены' : '⚠️ Требуется дозаполнение'}`;

              await ctx.editMessageText(settingsText, htmlOptions());
            } else {
              await ctx.editMessageText('❌ Настройки не найдены.');
            }
          } catch (error) {
            await ctx.editMessageText('❌ Ошибка получения настроек.');
          }
          break;

        default:
          await ctx.editMessageText(`Неизвестная команда: ${esc(callbackData)}`);
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

      const successMessage = `✅ <b>Коэффициент цены установлен!</b>

💰 Новый коэффициент: <b>x${coefficient}</b> (${percentageText})

📊 Это означает:
${coefficient > 1 ? '• Цены будут увеличены' : coefficient < 1 ? '• Цены будут уменьшены' : '• Цены останутся без изменений'}

🔄 Коэффициент будет применен к следующим загруженным прайс-листам.`;

      const keyboard = await this.keyboard.createInlineButtons([
        { text: '📄 Загрузить прайс-лист', callback_data: 'upload_file' },
        { text: '💰 Изменить коэффициент', callback_data: 'change_coefficient' },
        { text: MENU.MAIN, callback_data: 'main_menu' },
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
