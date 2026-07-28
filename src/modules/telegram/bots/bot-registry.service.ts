import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Telegraf } from 'telegraf';
import { Bot, BotDocument } from '../../../database/schemas/bot.schema';
import { AppConfigService } from '../../../config/app-config.service';
import { PriceChangerComposer } from './price-changer-bot/price-changer.composer';
import {
  EBotType,
  THandleUpdatePayload,
  TTelegrafBot,
  TWebHookResponse,
} from '../domain.telegram';

export interface RegisteredBot {
  id: string;
  type: string;
  name: string;
  telegraf: TTelegrafBot;
}

/**
 * Реестр ботов поверх Nest DI. Заменяет ручной граф `new` из BotFather.
 *
 * Используется OnApplicationBootstrap, а НЕ OnModuleInit: вебхук регистрируется
 * в Telegram только после того, как HTTP-сервер начал принимать соединения.
 * Иначе Telegram может прислать первый апдейт в ещё не поднятый листенер.
 */
@Injectable()
export class BotRegistry implements OnApplicationBootstrap {
  private readonly logger = new Logger(BotRegistry.name);
  private readonly bots = new Map<string, Map<string, RegisteredBot>>();

  constructor(
    @InjectModel(Bot.name) private readonly botModel: Model<BotDocument>,
    private readonly composer: PriceChangerComposer,
    private readonly config: AppConfigService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    // Опечатку в id администратора Joi не поймает — она пройдёт валидацию как
    // валидное число, и заявки будут молча уходить в никуда. Печатаем список
    // при старте, чтобы её было видно глазами. Id не секретны.
    this.logger.log(`Администраторы: ${this.config.telegramAdminIds.join(', ')}`);

    const docs = await this.loadOrSeedBots();
    // Раньше launchBots() вызывался БЕЗ await — промис не джойнился, и ошибки
    // запуска терялись. Здесь дожидаемся каждого бота.
    for (const doc of docs) {
      await this.registerBot(doc);
    }
    this.logger.log(`Готово ботов: ${this.count}`);
  }

  private async loadOrSeedBots(): Promise<BotDocument[]> {
    const bots = await this.botModel.find();
    if (bots.length) return bots;

    this.logger.warn('В базе нет ботов — создаю бота из TELEGRAM_TOKEN');
    const seeded = await this.botModel.create({
      type: EBotType.PRICE_CHANGER_BOT,
      token: this.config.telegramToken,
      name: 'Yandex Market reports bot',
      description: 'Отчёты по заказам Яндекс.Маркета',
    });
    return [seeded];
  }

  private async registerBot(doc: BotDocument): Promise<void> {
    const telegraf: TTelegrafBot = new Telegraf(doc.token);

    // Единая точка обработки ошибок вместо глотающего TryCatch (TASK-013):
    // ошибка логируется целиком и пользователь получает внятный ответ.
    telegraf.catch(async (err, ctx) => {
      this.logger.error(`Ошибка при обработке апдейта (бот ${doc.id})`, err as Error);
      try {
        await ctx.reply('Произошла ошибка. Попробуйте позже.');
      } catch {
        // не смогли ответить — уже залогировано выше
      }
    });

    await this.composer.compose(telegraf);
    await this.setWebhook(telegraf, doc);

    const entry: RegisteredBot = {
      id: doc.id,
      type: doc.type,
      name: doc.name,
      telegraf,
    };
    if (!this.bots.has(doc.type)) this.bots.set(doc.type, new Map());
    this.bots.get(doc.type).set(doc.id, entry);

    this.logger.log(`Бот "${doc.name}" (${doc.type}/${doc.id}) готов`);
  }

  /**
   * Только setWebhook, БЕЗ bot.launch().
   *
   * telegraf 4.16 в launch({webhook}) безусловно вызывает startWebhook(), а тот
   * делает listen(port) — порт не передавался, поэтому на КАЖДОГО бота
   * поднимался лишний HTTP-сервер на случайном порту, в который никто не
   * стучался. Апдейты приходят через TelegramController, так что нужен
   * ровно setWebhook (TASK-012).
   */
  private async setWebhook(telegraf: TTelegrafBot, doc: BotDocument): Promise<void> {
    const url = `${this.config.telegramProxyUrl}${this.webhookPath(doc.type, doc.id)}`;
    await telegraf.telegram.setWebhook(url);
    this.logger.log(`Вебхук установлен: ${url}`);
  }

  /** Должен совпадать с роутом TelegramController с учётом префикса /api. */
  public webhookPath(type: string, id: string): string {
    return `/api/telegram/webhooks/${type}/${id}`;
  }

  public find(type: string, id: string): RegisteredBot | null {
    return this.bots.get(type)?.get(id) ?? null;
  }

  public get count(): number {
    let n = 0;
    for (const byType of this.bots.values()) n += byType.size;
    return n;
  }

  public async handleUpdate(
    type: string,
    id: string,
    payload: THandleUpdatePayload,
    response?: TWebHookResponse,
  ): Promise<void> {
    const entry = this.find(type, id);
    if (!entry) throw new Error(`Бот ${type}/${id} не зарегистрирован`);
    await entry.telegraf.handleUpdate(payload, response);
  }
}
