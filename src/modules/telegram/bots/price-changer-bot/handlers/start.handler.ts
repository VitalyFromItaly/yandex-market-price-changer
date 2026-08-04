import type { TFeatureMap } from '../../shared/features.domain';

import { Injectable, Logger } from '@nestjs/common';
import { Context } from 'telegraf';

import { AppConfigService } from '../../../../../config/app-config.service';
import { UserAccessService } from '../../../../../database/services/user-access.service';
import { YandexMarketService } from '../../../../../database/services/yandex-market.service';
import { placementOfCampaign } from '../../../../yandex/stocks/placement';
import { TTelegrafBot } from '../../../domain.telegram';
import { htmlOptions } from '../../../formatting/telegram-format';
import { hoursUntilRetry, isRejectionExpired } from '../../shared/access.domain';
import { PENDING_TEXT, rejectedText, type TOnboardingDraft } from '../onboarding';
import { PriceChangerKeyboard } from '../price-changer.keyboard';

import { ApiSettingsHandler } from './api-settings.handler';

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
    private readonly apiSettings: ApiSettingsHandler,
  ) {}

  public register(bot: TTelegrafBot) {
    bot.start(async (ctx) => {
      // ctx.botInfo telegraf заполняет сам и кэширует — отдельный getMe() не нужен.
      const botId = ctx.botInfo.id.toString();

      if (this.config.isAdmin(ctx.from.id)) {
        // Записи доступа у администратора нет — раскладка соберётся по
        // умолчаниям реестра возможностей, то есть полной.
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
          await this.replyApproved(ctx, access.features);
          return;

        case 'pending':
          await ctx.reply(PENDING_TEXT, htmlOptions());
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
          await ctx.reply(rejectedText(hours), htmlOptions());
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
  private async replyApproved(ctx: Context, features?: TFeatureMap) {
    const isAdmin = this.config.isAdmin(ctx.from.id);
    const store = await this.yandexMarketService.findByTelegramUser(ctx.from.id.toString());
    const configured = !!(store?.campaign_id && store?.business_id && store?.token);

    if (!configured) {
      /**
       * Спрашиваем токен ПРЯМО ЗДЕСЬ, а не отправляем нажимать «Настройки».
       *
       * Бот уже знает, что магазина нет, — это и есть ответ на вопрос «что
       * дальше». Отправлять человека за ним в меню значило перекладывать на
       * него лишний шаг ради сведений, которые у бота уже есть.
       *
       * Двумя сообщениями, потому что Telegram разрешает одному сообщению
       * только один reply_markup: первое ставит сокращённую reply-клавиатуру,
       * второе несёт inline-кнопку «Как получить?» рядом с самим вопросом.
       */
      const kb = await this.keyboard.createUnconfiguredKeyboard(isAdmin);
      await ctx.reply('👋 Осталось подключить магазин — и появятся отчёты.', htmlOptions(kb));

      const reply = await this.apiSettings.firstStepReply();
      await ctx.reply(reply.message, htmlOptions(reply.keyboard));
      return;
    }

    // Кэш магазинов у подключившихся ДО появления «🏪 Сменить магазин» пуст, а
    // заполняется он только при подключении токена — без этого добора кнопка не
    // появилась бы у них никогда. Фоном: кнопка придёт со следующей отрисовкой.
    this.apiSettings.ensureStoresCached(ctx, store);

    const kb = await this.keyboard.createMenuKeyboard(
      isAdmin,
      features,
      (store?.stores?.length ?? 0) > 1,
      placementOfCampaign(store?.stores, store?.campaign_id),
    );
    await ctx.reply('🎉 С возвращением! Выберите отчёт:', htmlOptions(kb));
  }

  /**
   * Приглашение в визард. Если пользователь уже что-то ввёл, продолжаем с того
   * шага, где он остановился, — переспрашивать введённое незачем.
   *
   * Текст вопроса и клавиатуру берём у самого визарда, а не собираем здесь
   * свои: раньше это приглашение уходило БЕЗ кнопок «Как получить?» и «Начать
   * заново», хотя тот же вопрос из ApiSettingsHandler их всегда нёс. Один и тот
   * же экран выглядел по-разному в зависимости от того, каким путём в него
   * пришли.
   */
  private async replyOnboarding(ctx: Context, draft?: TOnboardingDraft) {
    const intro = [
      '👋 Добро пожаловать!',
      '',
      'Доступ к боту выдаёт администратор. Чтобы подать заявку, пришлите',
      'API-токен Яндекс.Маркета — магазин бот определит по нему сам.',
      '',
      // Пустая строка ОТДЕЛЬНЫМ элементом: join склеивает через один \n, и без
      // неё вопрос визарда прилипал к приветствию вплотную.
      '',
    ].join('\n');

    const reply = await this.apiSettings.firstStepReply(draft);
    await ctx.reply(intro + reply.message, htmlOptions(reply.keyboard));
  }
}
