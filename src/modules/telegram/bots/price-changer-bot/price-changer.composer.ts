import { Injectable, Logger } from '@nestjs/common';
import { TTelegrafBot } from '../../domain.telegram';
import { StartHandler } from './handlers/start.handler';
import { MenuCommandsHandler } from './handlers/menu-commands.handler';
import { SlashCommandsHandler } from './handlers/slash-commands.handler';
import { CallbackQueryHandler } from './handlers/callback-query.handler';
import { ApiSettingsHandler } from './handlers/api-settings.handler';
import { FallbackHandler } from './handlers/fallback.handler';

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
      { name: 'start', register: (b) => this.start.register(b) },
      { name: 'menu', register: (b) => this.menu.register(b) },
      { name: 'slash', register: (b) => this.slash.register(b) },
      { name: 'callbacks', register: (b) => this.callbacks.register(b) },
      { name: 'apiSettings', register: (b) => this.apiSettings.register(b) },
      // catch-all — строго последним
      { name: 'fallback', register: (b) => this.fallback.register(b) },
    ];
  }

  constructor(
    private readonly start: StartHandler,
    private readonly menu: MenuCommandsHandler,
    private readonly slash: SlashCommandsHandler,
    private readonly callbacks: CallbackQueryHandler,
    private readonly apiSettings: ApiSettingsHandler,
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
