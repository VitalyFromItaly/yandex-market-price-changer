import { Injectable, Logger } from '@nestjs/common';
import { Context } from 'telegraf';

import { AppConfigService } from '../../../../../config/app-config.service';
import { UserAccessService } from '../../../../../database/services/user-access.service';
import { YandexMarketService } from '../../../../../database/services/yandex-market.service';
import { TTelegrafBot } from '../../../domain.telegram';
import { htmlOptions } from '../../../formatting/telegram-format';
import { hoursUntilRetry, isRejectionExpired } from '../../shared/access.domain';
import { nextStep, stepPrompt, type TOnboardingDraft } from '../onboarding';
import { PriceChangerKeyboard } from '../price-changer.keyboard';

/**
 * Обработчик /start — единственная команда, доступная при любом статусе
 * доступа. Гейт (AccessGateHandler) пропускает её всегда, поэтому именно здесь
 * пользователь узнаёт, что с ним происходит: заявка на рассмотрении, отказ или
 * пора вводить креды.
 *
 * Раньше здесь стояла проверка подписки — единственная во всём приложении,
 * из-за чего загрузка файла её просто обходила (TASK-036/TASK-039).
 */
@Injectable()
export class StartHandler {
  private readonly logger = new Logger(StartHandler.name);

  constructor(
    private readonly keyboard: PriceChangerKeyboard,
    private readonly accessService: UserAccessService,
    private readonly config: AppConfigService,
    private readonly yandexMarketService: YandexMarketService,
  ) {}

  public register(bot: TTelegrafBot) {
    bot.start(async (ctx) => {
      // ctx.botInfo telegraf заполняет сам и кэширует — отдельный getMe() не нужен.
      const botId = ctx.botInfo.id.toString();

      if (this.config.isAdmin(ctx.from.id)) {
        await this.replyApproved(ctx);
        return;
      }

      const access = await this.accessService.ensure({
        telegramUserId: ctx.from.id.toString(),
        botId,
        telegramChatId: ctx.chat.id.toString(),
        username: ctx.from.username,
        firstName: ctx.from.first_name,
        lastName: ctx.from.last_name,
      });

      switch (access.status) {
        case 'approved':
          await this.replyApproved(ctx);
          return;

        case 'pending':
          await ctx.reply(
            [
              '⏳ Заявка на рассмотрении.',
              '',
              'Администратор проверяет ваши данные. Как только он примет решение,',
              'бот пришлёт сообщение сюда же.',
            ].join('\n'),
            htmlOptions(),
          );
          return;

        case 'rejected': {
          // Гейт снимает протухший отказ сам, но /start он пропускает ДО этой
          // проверки — иначе пользователь час видел бы «отказано» после того,
          // как запрет уже истёк.
          if (isRejectionExpired(access.rejectedAt, new Date())) {
            await this.replyOnboarding(ctx, access.draft);
            return;
          }
          const hours = hoursUntilRetry(access.rejectedAt, new Date());
          await ctx.reply(
            [
              '⛔ Заявка отклонена.',
              '',
              `Повторная регистрация будет доступна через ${hours} ч.`,
            ].join('\n'),
            htmlOptions(),
          );
          return;
        }

        default:
          await this.replyOnboarding(ctx, access.draft);
      }
    });
  }

  /**
   * Приветствие одобренного пользователя.
   *
   * Клавиатура зависит от готовности кредов. Показывать кнопки отчётов при
   * пустых настройках — значит вести в тупик: нажатие упирается в «Сначала
   * заполните настройки API». Раньше меню было одно на все случаи, и
   * администратор, минующий проверку доступа, видел все восемь кнопок сразу
   * после /start при пустом токене.
   *
   * Текст держим КОРОТКИМ: разворачиваясь, клавиатура на четыре ряда
   * закрывает собой длинное сообщение, и пользователь его просто не видит.
   * Подробности живут в /help, где клавиатуры нет.
   */
  private async replyApproved(ctx: Context) {
    const configured = await this.yandexMarketService.isConfigured(ctx.from.id.toString());

    if (!configured) {
      const kb = await this.keyboard.createUnconfiguredKeyboard();
      await ctx.reply(
        [
          '👋 Осталось подключить магазин.',
          '',
          'Нажмите «⚙️ Настройки API» и введите три значения из личного кабинета',
          'Яндекс.Маркета. После этого появятся отчёты.',
        ].join('\n'),
        htmlOptions(kb),
      );
      return;
    }

    const kb = await this.keyboard.createMenuKeyboard();
    await ctx.reply('🎉 С возвращением! Выберите отчёт:', htmlOptions(kb));
  }

  /**
   * Приглашение в визард. Если пользователь уже что-то ввёл, продолжаем с того
   * шага, где он остановился, — переспрашивать введённое незачем.
   */
  private async replyOnboarding(ctx: Context, draft?: TOnboardingDraft) {
    const step = nextStep(draft) ?? 'token';
    const intro = [
      '👋 Добро пожаловать!',
      '',
      'Доступ к боту выдаёт администратор. Заполните три значения из личного',
      'кабинета Яндекс.Маркета — бот спросит их по одному.',
      '',
    ].join('\n');

    await ctx.reply(intro + stepPrompt(step), htmlOptions());
  }
}
