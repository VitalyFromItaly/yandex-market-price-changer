import { Injectable, Logger } from '@nestjs/common';

import { TTelegrafBot } from '../../domain.telegram';

import { AccessGateHandler } from './handlers/access-gate.handler';
import { AdminApprovalHandler } from './handlers/admin-approval.handler';
import { AdminUsersHandler } from './handlers/admin-users.handler';
import { ApiSettingsHandler } from './handlers/api-settings.handler';
import { CallbackQueryHandler } from './handlers/callback-query.handler';
import { FallbackHandler } from './handlers/fallback.handler';
import { MenuCommandsHandler } from './handlers/menu-commands.handler';
import { ReportsHandler } from './handlers/reports.handler';
import { ScheduleHandler } from './handlers/schedule.handler';
import { SlashCommandsHandler } from './handlers/slash-commands.handler';
import { StartHandler } from './handlers/start.handler';
import { StockUploadHandler } from './handlers/stock-upload.handler';

/**
 * Собирает бота из синглтон-обработчиков.
 *
 * Раньше вместо этого был ручной граф `new`: BotFather -> PriceChangerBot ->
 * шесть хендлеров, каждый захватывал свой экземпляр Telegraf. Теперь хендлеры
 * не хранят бота вовсе, а получают его в register() — поэтому один и тот же
 * экземпляр обработчика обслуживает сколько угодно ботов.
 */
@Injectable()
export class PriceChangerComposer {
  private readonly logger = new Logger(PriceChangerComposer.name);

  /**
   * ПОРЯДОК ЗНАЧИМ. Telegraf вызывает обработчики в порядке регистрации,
   * первый подходящий забирает апдейт. Catch-all обязан быть последним.
   * Этот массив — единственный источник правды о порядке, и он же проверяется
   * тестом: перестановка fallback выше сразу красит тест.
   */
  private get pipeline(): Array<{ name: string; register: (bot: TTelegrafBot) => void }> {
    return [
      // Гейт доступа — строго первым: bot.use, зарегистрированный после
      // хендлеров, ничего не защищает, так как апдейт до него не дойдёт.
      { name: 'accessGate', register: (b) => this.accessGate.register(b) },
      { name: 'start', register: (b) => this.start.register(b) },
      { name: 'menu', register: (b) => this.menu.register(b) },
      { name: 'slash', register: (b) => this.slash.register(b) },
      // Админские колбэки — ДО общего обработчика: тот разбирает callback_data
      // точным switch и на неизвестной строке затирает сообщение.
      { name: 'adminCallbacks', register: (b) => this.adminCallbacks.register(b) },
      // Список пользователей и отзыв доступа — тоже до общего callback_query:
      // тот разбирает данные точным switch и на неизвестной строке затирает
      // сообщение «Неизвестная команда».
      { name: 'adminUsers', register: (b) => this.adminUsers.register(b) },
      { name: 'scheduleCallbacks', register: (b) => this.scheduleCallbacks.register(b) },
      // Выбор периода отчёта — тоже ДО общего callback_query.
      { name: 'reportCallbacks', register: (b) => this.reports.registerCallbacks(b) },
      // Кнопки визарда (выбор магазина, «Как получить?») — тоже ДО общего
      // callback_query, по той же причине. Пока они регистрировались вместе с
      // текстовым обработчиком, то есть ПОСЛЕ, весь пикер магазина отвечал
      // «Неизвестная команда: store_pick:12345».
      { name: 'onboardingCallbacks', register: (b) => this.apiSettings.registerCallbacks(b) },
      { name: 'callbacks', register: (b) => this.callbacks.register(b) },
      { name: 'apiSettings', register: (b) => this.apiSettings.register(b) },
      // Приём прайса. После apiSettings (тот слушает текст, а не документы),
      // но строго ДО catch-all, иначе документ уйдёт в «не понимаю команду».
      { name: 'stockUpload', register: (b) => this.stockUpload.register(b) },
      // catch-all — строго последним
      { name: 'fallback', register: (b) => this.fallback.register(b) },
    ];
  }

  // Правило max-params отключено осознанно. Композер — это и есть список
  // обработчиков: его единственная задача — держать их и знать порядок.
  // «Сгруппировать» их в объект-контейнер значит спрятать состав пайплайна
  // за лишним слоем, а порядок регистрации — тот самый инвариант, который
  // ломался и стоил неработающих кнопок, — должен читаться прямо здесь.
  // eslint-disable-next-line max-params
  constructor(
    private readonly accessGate: AccessGateHandler,
    private readonly start: StartHandler,
    private readonly menu: MenuCommandsHandler,
    private readonly slash: SlashCommandsHandler,
    private readonly adminCallbacks: AdminApprovalHandler,
    private readonly adminUsers: AdminUsersHandler,
    private readonly scheduleCallbacks: ScheduleHandler,
    private readonly reports: ReportsHandler,
    private readonly callbacks: CallbackQueryHandler,
    private readonly apiSettings: ApiSettingsHandler,
    private readonly stockUpload: StockUploadHandler,
    private readonly fallback: FallbackHandler,
  ) {}

  /** Имена шагов в порядке регистрации — для теста на инвариант. */
  public get registrationOrder(): string[] {
    return this.pipeline.map((s) => s.name);
  }

  public async compose(bot: TTelegrafBot): Promise<void> {
    await this.slash.setupBotCommands(bot);
    for (const step of this.pipeline) {
      step.register(bot);
    }
    this.logger.log(`Обработчики зарегистрированы: ${this.registrationOrder.join(' → ')}`);
  }
}
