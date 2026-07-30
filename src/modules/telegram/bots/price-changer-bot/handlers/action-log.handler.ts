import { Injectable, Logger } from '@nestjs/common';
import { Context } from 'telegraf';

import { ActionLogService } from '../../../../../database/services/action-log.service';
import { TTelegrafBot } from '../../../domain.telegram';
import { describeAction, fullName } from '../../shared/action-log.domain';

/**
 * Журнал действий: пишет, КТО и ЧТО сделал — в консоль и в Mongo.
 *
 * Регистрируется ПЕРВЫМ, до гейта доступа. Это не ослабляет гейт: middleware
 * никогда не завершает апдейт сам, он всегда зовёт next(), и гейт остаётся
 * первым, кто МОЖЕТ его не пропустить. Порядок именно такой потому, что
 * заблокированные попытки — самое интересное в журнале: «кто ломился, пока
 * заявка висела в pending» из записи, сделанной после гейта, не узнать вовсе.
 *
 * Запись ждёт завершения обработки (`await next()`), чтобы сохранить итог и
 * длительность: без них журнал отвечает «пользователь нажал кнопку», но не
 * отвечает «и что из этого вышло» — а вопрос всегда второй.
 */
@Injectable()
export class ActionLogHandler {
  private readonly logger = new Logger('ActionLog');

  constructor(private readonly logs: ActionLogService) {}

  public register(bot: TTelegrafBot) {
    bot.use(async (ctx, next) => {
      // Апдейты без отправителя (посты в канале и т.п.) журналу неинтересны:
      // «кто сделал» для них не определён, а именно это здесь и записывается.
      if (!ctx.from) return next();

      const started = Date.now();
      const { kind, action } = describeAction({
        text: this.textOf(ctx),
        callbackData: this.callbackDataOf(ctx),
        documentName: this.documentNameOf(ctx),
      });
      const who = ctx.from.username ? `@${ctx.from.username}` : (fullName(ctx.from.first_name, ctx.from.last_name) ?? 'без имени');

      let status = 'ok';
      let error: string | undefined;

      try {
        await next();
      } catch (e) {
        // Ошибку журнал не глотает: он её записывает и бросает дальше, где её
        // ждёт telegraf.catch. Проглоченное исключение здесь означало бы, что
        // пользователь не получит ответа «Произошла ошибка», а мы не узнаем,
        // что что-то сломалось (ровно чем плох был старый TryCatch).
        status = 'error';
        error = (e as Error).message;
        throw e;
      } finally {
        const durationMs = Date.now() - started;
        this.logger.log(`${who} (${ctx.from.id}) · ${kind}: ${action} · ${status} · ${durationMs}мс`);

        // Запись НЕ ожидается: поход в Mongo не должен добавляться к времени
        // ответа пользователю, а record() внутри себя не бросает.
        void this.logs.record({
          telegramUserId: ctx.from.id.toString(),
          username: ctx.from.username,
          name: fullName(ctx.from.first_name, ctx.from.last_name),
          botId: ctx.botInfo?.id?.toString() ?? 'unknown',
          chatId: ctx.chat?.id?.toString(),
          kind,
          action,
          status,
          durationMs,
          error,
        });
      }
    });
  }

  private textOf(ctx: Context): string | undefined {
    const message = ctx.message as { text?: string } | undefined;
    return message?.text;
  }

  private callbackDataOf(ctx: Context): string | undefined {
    const query = ctx.callbackQuery as { data?: string } | undefined;
    return query?.data;
  }

  private documentNameOf(ctx: Context): string | undefined {
    const message = ctx.message as { document?: { file_name?: string } } | undefined;
    return message?.document ? (message.document.file_name ?? 'файл без имени') : undefined;
  }
}
