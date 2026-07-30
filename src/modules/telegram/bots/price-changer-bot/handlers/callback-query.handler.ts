import { Injectable } from '@nestjs/common';

import { AppConfigService } from '../../../../../config/app-config.service';
import { UserAccessService } from '../../../../../database/services/user-access.service';
import { YandexMarketService } from '../../../../../database/services/yandex-market.service';
import { TTelegrafBot } from '../../../domain.telegram';
import { htmlOptions } from '../../../formatting/telegram-format';
import { MENU } from '../menu.constants';
import { nextStep, stepPrompt } from '../onboarding';
import { PriceChangerKeyboard } from '../price-changer.keyboard';
import { settingsText } from '../settings.text';

@Injectable()
export class CallbackQueryHandler {
  constructor(
    private keyboard: PriceChangerKeyboard,
    private yandexMarketService: YandexMarketService,
    private accessService: UserAccessService,
    private config: AppConfigService,
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
          //
          // isAdmin передаём обязательно: `createKeyboard(menuLayout())` в
          // обход `createMenuKeyboard` собирал раскладку без ряда
          // «👥 Пользователи», и администратор терял кнопку при каждом
          // возврате в меню.
          const mainKeyboard = await this.keyboard.createMenuKeyboard(
            this.config.isAdmin(ctx.from.id),
          );
          // Два сообщения здесь неизбежны: editMessageText убирает inline-
          // кнопки из старого сообщения, а reply-клавиатуру можно прицепить
          // только к новому. Подпись берём из MENU.MAIN — раньше тут было
          // «🏠 Главное меню:» с двоеточием, у кнопки «🏠 Главное меню», а у
          // /menu «📋 Главное меню:»: три подписи на один экран.
          await ctx.editMessageText(MENU.MAIN);
          await ctx.reply('Выберите действие:', mainKeyboard);
          break;
        }

        // Ветки download_example, change_coefficient, cancel_upload,
        // upload_file, set_coefficient_* и input_custom_coefficient сняты
        // (TASK-009): изменение цен по API отключено, приём файла тоже.
        // Кнопки с этими callback_data больше не отправляются.

        case 'check_settings':
          try {
            // Тот же текст, что на экране настроек. Раньше здесь печатались
            // сырые Campaign ID и Business ID — вопреки правилу «идентификаторы
            // продавцу не показываем», которое соблюдалось везде, кроме этой
            // ветки. Экран противоречил соседнему экрану того же бота.
            const store = await this.yandexMarketService.findByTelegramUser(ctx.from.id.toString());
            await ctx.editMessageText(settingsText(store), htmlOptions());
          } catch {
            await ctx.editMessageText('❌ Не удалось получить настройки. Попробуйте позже.');
          }
          break;

        default:
          // Сырой callback_data наружу не отдаём: пользователю он ничего не
          // объясняет, а нам показывает внутренности. Такое сообщение вообще
          // означает устаревшую кнопку в старом сообщении.
          await ctx.editMessageText('Эта кнопка устарела. Откройте меню заново: /menu');
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
