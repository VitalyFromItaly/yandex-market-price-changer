import { Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Context, Telegraf, Telegram } from 'telegraf';

import { AppConfigService } from '../../../config/app-config.service';
import { Bot, BotDocument } from '../../../database/schemas/bot.schema';
import { ActionLogService } from '../../../database/services/action-log.service';
import { ErrorReporter } from '../../errors/error-reporter.service';
import { EBotType, THandleUpdatePayload, TTelegrafBot, TWebHookResponse } from '../domain.telegram';

import { PriceChangerComposer } from './price-changer-bot/price-changer.composer';
import { OUTGOING_METHODS, describeOutgoing, outgoingSourceOf } from './shared/action-log.domain';

export interface RegisteredBot {
  /** _id документа Bot в Mongo — по нему приходит вебхук. */
  id: string;
  /**
   * Числовой id бота в Telegram (`getMe().id`). Это ДРУГОЙ идентификатор:
   * записи доступа и расписания хранят именно его, потому что в обработчиках
   * доступен `ctx.botInfo.id`, а не документ Mongo.
   */
  telegramId: number;
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
export class BotRegistry implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(BotRegistry.name);
  /** Отдельный контекст: исходящие видно в консоли рядом с входящими. */
  private readonly outgoingLogger = new Logger('ActionLog');
  private readonly bots = new Map<string, Map<string, RegisteredBot>>();

  constructor(
    @InjectModel(Bot.name) private readonly botModel: Model<BotDocument>,
    private readonly composer: PriceChangerComposer,
    private readonly config: AppConfigService,
    private readonly logs: ActionLogService,
    private readonly errors: ErrorReporter,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    // Опечатку в id администратора Joi не поймает — она пройдёт валидацию как
    // валидное число, и заявки будут молча уходить в никуда. Печатаем список
    // при старте, чтобы её было видно глазами. Id не секретны.
    this.logger.log(`Администраторы: ${this.config.telegramAdminIds.join(', ')}`);
    // Куда реально уходят запросы, видно только здесь: при неверном зеркале
    // ошибки выглядят как обычные сетевые таймауты, без намёка на причину.
    this.logger.log(`Bot API: ${this.config.telegramApiUrl}`);

    const docs = await this.loadOrSeedBots();
    // Раньше launchBots() вызывался БЕЗ await — промис не джойнился, и ошибки
    // запуска терялись. Здесь дожидаемся каждого бота.
    for (const doc of docs) {
      await this.registerBot(doc);
    }
    this.logger.log(`Готово ботов: ${this.count}`);
  }

  /**
   * Останавливает long polling при завершении процесса.
   *
   * Без этого контейнер, получивший SIGTERM при редеплое, продолжает держать
   * цикл getUpdates до принудительного kill — а новый экземпляр в это время
   * получает от Bot API 409 Conflict, потому что второго читателя апдейтов
   * Telegram не допускает. Внешне это выглядит как «задеплоили, а бот молчит».
   *
   * Работает только при app.enableShutdownHooks() в main.ts.
   */
  onApplicationShutdown(signal?: string): void {
    for (const byType of this.bots.values()) {
      for (const entry of byType.values()) {
        try {
          entry.telegraf.stop(signal ?? 'shutdown');
        } catch {
          // telegraf.stop() бросает «Bot is not running!», если приём апдейтов
          // не запускался (режим webhook). Это не ошибка остановки.
        }
      }
    }
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
    // apiRoot — единственная точка, где задаётся адрес Bot API для ВСЕХ
    // исходящих вызовов этого бота: и методы (sendMessage, setWebhook, getMe),
    // и ссылки на файлы из getFileLink строятся telegraf'ом от него.
    const telegraf: TTelegrafBot = new Telegraf(doc.token, {
      telegram: { apiRoot: this.config.telegramApiUrl },
      // Перехват исходящих ответов хендлеров (ctx.reply): telegraf на каждый
      // апдейт создаёт НОВЫЙ экземпляр Telegram и отдаёт его контексту, поэтому
      // патч синглтона (logOutgoing ниже) их не видит — только этот подкласс.
      contextType: this.loggingContextType(doc),
    });

    this.logOutgoing(telegraf, doc);

    // Единая точка обработки ошибок вместо глотающего TryCatch (TASK-013):
    // ошибка логируется целиком и пользователь получает внятный ответ.
    telegraf.catch(async (err, ctx) => {
      // В журнал — со стеком, классом и пользователем. ActionLogHandler к
      // этому моменту уже записал апдейт со status: 'error', но там есть
      // только текст сообщения: по нему не отличить сетевой сбой Яндекса от
      // опечатки в коде.
      void this.errors.report({
        error: err,
        source: 'bot',
        context: 'telegraf',
        telegramUserId: ctx.from?.id?.toString(),
        username: ctx.from?.username,
        chatId: ctx.chat?.id?.toString(),
        botId: ctx.botInfo?.id?.toString() ?? doc.id,
      });

      try {
        await ctx.reply('Произошла ошибка. Попробуйте позже.');
      } catch {
        // не смогли ответить — уже залогировано выше
      }
    });

    await this.composer.compose(telegraf);

    // getMe() один раз при регистрации: telegraf кэширует результат в botInfo,
    // а нам нужен числовой id, чтобы находить бота по тому же ключу, который
    // лежит в записях доступа и расписаниях.
    const info = await telegraf.telegram.getMe();
    telegraf.botInfo = info;

    const entry: RegisteredBot = {
      id: doc.id,
      telegramId: info.id,
      type: doc.type,
      name: doc.name,
      telegraf,
    };
    if (!this.bots.has(doc.type)) this.bots.set(doc.type, new Map());
    this.bots.get(doc.type).set(doc.id, entry);

    // Приём апдейтов включается ПОСЛЕ записи в реестр: в режиме polling первый
    // getUpdates уходит немедленно, и обработчик, дошедший до findByTelegramId
    // раньше этой строки, не нашёл бы собственного бота.
    await this.startReceiving(telegraf, doc);

    this.logger.log(`Бот "${doc.name}" (${doc.type}/${doc.id}) готов`);
  }

  /**
   * Журналирование ИСХОДЯЩИХ вызовов Bot API на КОНКРЕТНОМ экземпляре Telegram.
   *
   * Перехват стоит на `telegram.callApi` — единственная воронка, через которую
   * telegraf проводит все вызовы Bot API: и `ctx.reply`, и `editMessageText`, и
   * отправка файла отчёта, и webhookReply (тот разрешается ВНУТРИ callApi).
   * Оборачивать сами методы контекста бессмысленно — их десяток, и забытый
   * означал бы молчаливую дыру в журнале ровно того вида, который журнал и
   * должен был закрыть.
   *
   * Через ту же воронку идёт служебное — getMe, setWebhook, setMyCommands и, в
   * режиме polling, непрерывный getUpdates. Поэтому пишется только то, что
   * перечислено в OUTGOING_METHODS.
   *
   * botId берётся ЛЕНИВОЙ функцией: у per-update экземпляра (см. loggingContextType)
   * он известен только в момент вызова, а не в момент установки перехвата.
   *
   * Запись не ожидается и ошибку наружу не выпускает: журнал не имеет права
   * помешать боту ответить.
   */
  private installOutgoingLog(telegram: Telegram, botIdOf: () => string): void {
    const original = telegram.callApi.bind(telegram);

    // Приведение типов неизбежно: callApi объявлен дженериком по имени метода
    // (`<M extends keyof Telegram>`), и обёртка, принимающая произвольную
    // строку, под эту сигнатуру не подходит. Перехват при этом честный —
    // аргументы и результат проходят насквозь.
    type TCallApi = (method: string, payload: unknown, options?: unknown) => Promise<unknown>;

    telegram.callApi = (async (method: string, payload: unknown, options?: unknown) => {
      let result: unknown;

      try {
        result = await (original as unknown as TCallApi)(method, payload, options);
      } catch (error) {
        // Неудачная отправка — самый заметный для пользователя класс сбоев:
        // он нажал кнопку и не получил ничего. Раньше запись делалась только
        // после успешного вызова, то есть именно такие случаи в журнал не
        // попадали. Типовая причина — 403: пользователь заблокировал бота.
        if (OUTGOING_METHODS.includes(method)) {
          const failed = outgoingSourceOf(method, payload);
          void this.errors.report({
            error,
            source: 'bot',
            context: `send:${method}`,
            telegramUserId: failed.chatId?.toString(),
            chatId: failed.chatId?.toString(),
            botId: botIdOf(),
            action: describeOutgoing(failed).action,
          });
        }
        throw error;
      }

      if (OUTGOING_METHODS.includes(method)) {
        const source = outgoingSourceOf(method, payload);
        const { kind, action } = describeOutgoing(source);
        const chatId = source.chatId?.toString();

        this.outgoingLogger.log(`→ ${chatId ?? '?'} · ${kind}: ${action}`);

        void this.logs.record({
          // Для лички chat_id совпадает с id пользователя, а бот рассчитан
          // именно на неё — гейт доступа отсекает группы.
          telegramUserId: chatId ?? 'unknown',
          direction: 'out',
          botId: botIdOf(),
          chatId,
          kind,
          action,
        });
      }

      return result;
    }) as unknown as typeof telegram.callApi;
  }

  /**
   * Перехват на СИНГЛТОНЕ telegraf.telegram — покрывает ФОНОВЫЕ отправки, идущие
   * мимо контекста: админ-алерты (error-alert.bridge), уведомления о доступе
   * (access-notifier) и ежедневный дайджест (reports.processor) — все зовут
   * bot.telegraf.telegram.sendMessage напрямую.
   *
   * Ответы хендлеров (ctx.reply) сюда НЕ попадают: telegraf на каждый апдейт
   * создаёт НОВЫЙ экземпляр Telegram и отдаёт его контексту, так что ctx.telegram —
   * это не синглтон. Их ловит loggingContextType. Раньше обёртки не было, и в
   * журнал попадали только фоновые отправки — отсюда «ответа бота нет».
   */
  private logOutgoing(telegraf: TTelegrafBot, doc: BotDocument): void {
    this.installOutgoingLog(telegraf.telegram, () => telegraf.botInfo?.id?.toString() ?? doc.id);
  }

  /**
   * contextType для Telegraf: подкласс Context, оборачивающий callApi СВОЕГО
   * per-update экземпляра Telegram сразу при создании контекста. Только так
   * журналируются ctx.reply и прочие ответы из хендлеров — той же единой
   * воронкой callApi, без обёртки десятка методов контекста.
   *
   * botId берётся из botInfo контекста (тот же числовой id бота, что и
   * telegraf.botInfo.id), с откатом на _id документа.
   */
  private loggingContextType(
    doc: BotDocument,
  ): new (...args: ConstructorParameters<typeof Context>) => Context {
    // eslint-disable-next-line @typescript-eslint/no-this-alias -- нужен в теле класса
    const self = this;
    return class LoggingContext extends Context {
      constructor(
        update: ConstructorParameters<typeof Context>[0],
        telegram: Telegram,
        botInfo: ConstructorParameters<typeof Context>[2],
      ) {
        super(update, telegram, botInfo);
        self.installOutgoingLog(telegram, () => botInfo?.id?.toString() ?? doc.id);
      }
    };
  }

  /**
   * Включает приём апдейтов в режиме из TELEGRAM_UPDATE_MODE.
   *
   * Оба режима взаимоисключающие на стороне Telegram: пока установлен вебхук,
   * getUpdates отвечает 409 Conflict. Переключение в обе стороны выполняется
   * само (launch() снимает вебхук, setWebhook перебивает его обратно), поэтому
   * менять режим можно одной переменной окружения, без ручной чистки.
   */
  private async startReceiving(telegraf: TTelegrafBot, doc: BotDocument): Promise<void> {
    if (this.config.telegramUpdateMode === 'polling') {
      this.startPolling(telegraf, doc);
      return;
    }
    await this.setWebhook(telegraf, doc);
  }

  /**
   * Long polling. Промис launch() намеренно НЕ ожидается.
   *
   * В telegraf 4.16 launch() без опции webhook уходит в `await
   * this.startPolling()` — бесконечный цикл getUpdates, который резолвится
   * только после stop(). `await` здесь подвесил бы onApplicationBootstrap
   * навсегда: Nest дожидается всех хуков до app.listen(), то есть порт не
   * открылся бы вообще, а следующий бот не зарегистрировался бы.
   *
   * Ошибки при этом не теряются — их забирает catch ниже. Вебхук launch()
   * снимает сам (deleteWebhook), накопившиеся апдейты не сбрасывает: пропущенное
   * за время недоступности доедет.
   */
  private startPolling(telegraf: TTelegrafBot, doc: BotDocument): void {
    void telegraf
      .launch(() => {
        this.logger.log(
          `Long polling запущен (бот ${doc.type}/${doc.id}) через ${this.config.telegramApiUrl}`,
        );
      })
      .catch((error) => {
        // 409 Conflict здесь означает второй живой экземпляр бота с тем же
        // токеном — например, не остановленный локальный запуск.
        this.logger.error(`Long polling остановлен (бот ${doc.type}/${doc.id})`, error as Error);
      });
  }

  /**
   * Только setWebhook, БЕЗ launch({webhook}).
   *
   * telegraf 4.16 в launch({webhook}) безусловно вызывает startWebhook(), а тот
   * делает listen(port) — порт не передавался, поэтому на КАЖДОГО бота
   * поднимался лишний HTTP-сервер на случайном порту, в который никто не
   * стучался. Апдейты приходят через TelegramController, так что нужен
   * ровно setWebhook (TASK-012).
   *
   * К режиму polling это не относится: launch() БЕЗ опции webhook никакого
   * сервера не поднимает, только опрашивает Bot API.
   */
  private async setWebhook(telegraf: TTelegrafBot, doc: BotDocument): Promise<void> {
    const url = `${this.config.telegramWebhookUrl}${this.webhookPath(doc.type, doc.id)}`;
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

  /**
   * Поиск по числовому id Telegram. Нужен фоновым задачам: расписание знает
   * `ctx.botInfo.id`, а не _id документа Mongo.
   */
  public findByTelegramId(telegramId: number | string): RegisteredBot | null {
    const wanted = Number(telegramId);
    for (const byType of this.bots.values()) {
      for (const entry of byType.values()) {
        if (entry.telegramId === wanted) return entry;
      }
    }
    return null;
  }

  /** Первый попавшийся бот — для админских рассылок, не привязанных к чату. */
  public first(): RegisteredBot | null {
    for (const byType of this.bots.values()) {
      for (const entry of byType.values()) return entry;
    }
    return null;
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
