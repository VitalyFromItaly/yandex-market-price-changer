import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';

import { AppConfigService } from '../../../config/app-config.service';
import { ErrorReporter } from '../../errors/error-reporter.service';
import { htmlOptions } from '../formatting/telegram-format';

import { BotRegistry } from './bot-registry.service';

/**
 * Отдаёт ErrorReporter способ достучаться до администраторов.
 *
 * Отдельный класс, а не зависимость внутри ErrorReporter: тот вызывается из
 * telegraf.catch, то есть из самого BotRegistry — прямая связь дала бы цикл в
 * DI. Здесь связь односторонняя и устанавливается на старте.
 *
 * OnApplicationBootstrap, а не OnModuleInit: боты к этому моменту уже
 * зарегистрированы, и отправлять есть чем.
 */
@Injectable()
export class ErrorAlertBridge implements OnApplicationBootstrap {
  private readonly logger = new Logger(ErrorAlertBridge.name);

  constructor(
    private readonly reporter: ErrorReporter,
    private readonly registry: BotRegistry,
    private readonly config: AppConfigService,
  ) {}

  onApplicationBootstrap(): void {
    this.reporter.setAlertSender(async (text) => await this.send(text));
    this.logger.log(`Алерты об ошибках: ${this.config.telegramAdminIds.length} получателей`);
  }

  private async send(text: string): Promise<void> {
    const bot = this.anyBot();
    if (!bot) return;

    for (const adminId of this.config.telegramAdminIds) {
      try {
        await bot.telegraf.telegram.sendMessage(adminId, text, htmlOptions());
      } catch (error) {
        // Типовая причина — администратор не нажимал /start, и Telegram
        // отвечает 403: бот не может написать первым. Один недоступный админ
        // не должен срывать доставку остальным.
        //
        // Через ErrorReporter эту ошибку пропускать НЕЛЬЗЯ: она возникла при
        // отправке алерта, и попытка сообщить о ней породила бы новый алерт —
        // и так по кругу.
        this.logger.warn(
          `Алерт не доставлен администратору ${adminId}: ${(error as Error).message}`,
        );
      }
    }
  }

  /**
   * Любой зарегистрированный бот: алерт админский, и через какого именно бота
   * он ушёл, значения не имеет. Ботов в системе почти всегда один.
   */
  private anyBot() {
    const bot = this.registry.first();
    if (!bot) this.logger.warn('Алерт некому отправить: ни один бот не зарегистрирован');
    return bot;
  }
}
