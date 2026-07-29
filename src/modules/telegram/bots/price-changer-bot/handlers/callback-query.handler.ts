import { Injectable } from '@nestjs/common';

import { UserAccessService } from '../../../../../database/services/user-access.service';
import { YandexMarketService } from '../../../../../database/services/yandex-market.service';
import { TTelegrafBot } from '../../../domain.telegram';
import { esc, htmlOptions } from '../../../formatting/telegram-format';
import { MENU, menuLayout } from '../menu.constants';
import { nextStep, stepPrompt } from '../onboarding';
import { PriceChangerKeyboard } from '../price-changer.keyboard';

@Injectable()
export class CallbackQueryHandler {
  constructor(
    private keyboard: PriceChangerKeyboard,
    private yandexMarketService: YandexMarketService,
    private accessService: UserAccessService,
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

        // Ветки plan_day / plan_week / plan_month / plan_year / plan_cancel
        // сняты вместе с системой подписок (TASK-036): они лишь перерисовывали
        // сообщение ценником, ничего не сохраняя и ничего не списывая.
        // Доступ теперь выдаёт администратор — см. AdminApprovalHandler.

        case 'onboarding_restart': {
          // Единственный способ прервать визард. Reply-кнопкой это сделать
          // нельзя: её подпись попала бы в MENU_LABELS и потребовала hears.
          await this.accessService.clearDraft(ctx.from.id.toString(), ctx.botInfo.id.toString());
          await ctx.editMessageText(
            `🔄 <b>Начинаем заново.</b>\n\n${stepPrompt('token')}`,
            htmlOptions(),
          );
          break;
        }

        case 'settings_api':
        case 'help_api_setup': {
          // Обе кнопки ведут в одно и то же: подробную инструкцию к текущему
          // шагу визарда. Раньше это были два разных текста, и оба обещали, что
          // «бот автоматически определит тип данных» — после перехода на визард
          // это неправда, тип определяется шагом.
          const access = await this.accessService.findByUserAndBot(
            ctx.from.id.toString(),
            ctx.botInfo.id.toString(),
          );
          const step = nextStep(access?.draft) ?? 'token';
          await ctx.editMessageText(
            `🔧 <b>Настройка доступа к Яндекс.Маркету</b>\n\n${stepPrompt(step)}`,
            htmlOptions(),
          );
          break;
        }

        case 'main_menu': {
          // Раскладка — из menu.constants (TASK-014). Раньше здесь была
          // третья независимая копия списка подписей.
          const mainKeyboard = await this.keyboard.createKeyboard(menuLayout());
          await ctx.editMessageText('🏠 Главное меню:');
          await ctx.reply('Выберите действие:', mainKeyboard);
          break;
        }

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

${(await this.yandexMarketService.isConfigured(ctx.from.id.toString())) ? '✅ Все настройки заполнены' : '⚠️ Требуется дозаполнение'}`;

              await ctx.editMessageText(settingsText, htmlOptions());
            } else {
              await ctx.editMessageText('❌ Настройки не найдены.');
            }
          } catch {
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
        { priceCoefficient: coefficient },
      );

      // Формируем сообщение об успехе
      const percentageText =
        coefficient === 1.0
          ? 'без изменений'
          : `${coefficient > 1 ? '+' : ''}${((coefficient - 1) * 100).toFixed(1)}%`;

      const successMessage = `✅ <b>Коэффициент цены установлен!</b>

💰 Новый коэффициент: <b>x${coefficient}</b> (${percentageText})

📊 Это означает:
${describeCoefficient(coefficient)}

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
          '💡 Попробуйте позже или обратитесь к администратору.',
      );
      await ctx.answerCbQuery('Ошибка!');
    }
  }
}

/** Пояснение к коэффициенту. Вынесено из вложенного тернарника. */
function describeCoefficient(coefficient: number): string {
  if (coefficient > 1) return '• Цены будут увеличены';
  if (coefficient < 1) return '• Цены будут уменьшены';
  return '• Цены останутся без изменений';
}
