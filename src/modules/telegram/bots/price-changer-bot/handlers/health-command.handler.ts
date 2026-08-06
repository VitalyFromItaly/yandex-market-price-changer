import type { TTelegrafBot } from '../../../domain.telegram';

import { Inject, Injectable, Logger, forwardRef } from '@nestjs/common';

import { AppConfigService } from '../../../../../config/app-config.service';
import { HealthMonitorService } from '../../../../health/health-monitor.service';
import { summaryText } from '../../../../health/health.domain';
import { moscowStamp } from '../../../../yandex/reports/moscow-day';
import { esc, htmlOptions } from '../../../formatting/telegram-format';

/**
 * `/health` — состояние окружения по запросу администратора.
 *
 * Зачем, если монитор и так пишет сам. Он пишет ТОЛЬКО когда что-то сломалось
 * или починилось, и это правильно, но у тишины два смысла: «аварий нет» и
 * «уведомления не доходят». Различить их было нечем до первой аварии — то есть
 * до момента, когда цена ошибки максимальна. Команда отвечает на это в один тап
 * и проверяет заодно сам канал доставки: пришёл ответ — канал жив.
 *
 * Данные берутся из HealthMonitorService.collect(), а не считаются заново:
 * администратор должен видеть ровно то, по чему монитор принимает решения.
 *
 * Как и `/users`, посторонним отвечает молчанием, а не отказом: незачем сообщать
 * о существовании команды тому, кому она не положена. По той же причине её нет
 * в setMyCommands.
 */
@Injectable()
export class HealthCommandHandler {
  private readonly logger = new Logger(HealthCommandHandler.name);

  constructor(
    private readonly config: AppConfigService,
    // forwardRef: HealthModule импортирует TelegramModule ради очереди и
    // BotRegistry, а этот обработчик живёт в TelegramModule и смотрит обратно.
    @Inject(forwardRef(() => HealthMonitorService))
    private readonly monitor: HealthMonitorService,
  ) {}

  public register(bot: TTelegrafBot): void {
    bot.command('health', async (ctx) => {
      if (!this.config.isAdmin(ctx.from.id)) return;

      try {
        const results = await this.monitor.collect();
        const text = summaryText('📊 Состояние сейчас', results, moscowStamp());
        await ctx.reply(esc(text), htmlOptions());
      } catch (error) {
        // Проверки уже ловят свои ошибки сами, сюда попадёт разве что сбой
        // отправки. Молчать нельзя: команду нажали и ждут ответа.
        this.logger.error(`Не удалось собрать состояние: ${(error as Error).message}`);
        await ctx.reply('Не удалось собрать состояние. Подробности в логах.');
      }
    });
  }
}
