import { Injectable } from '@nestjs/common';

import { AppConfigService } from '../../../config/app-config.service';
import { TELEGRAM_PARSE_MODE, splitMessage } from '../formatting/telegram-format';

/**
 * Отправка сообщений без экземпляра Telegraf — воркеры очередей знают только
 * botToken, поэтому собирают запрос к Bot API сами.
 *
 * «Сами» не значит «на api.telegram.org»: базовый адрес берётся из
 * AppConfigService.telegramApiUrl, тот же, что получает Telegraf через apiRoot.
 * Раньше хост был захардкожен здесь, и эта ветка осталась бы единственной,
 * которая ходит мимо зеркала — то есть итоговый отчёт не доходил бы, а всё
 * остальное работало.
 *
 * Класс перестал быть статическим ровно из-за конфига: читать process.env в
 * обход AppConfigService запрещено, а единственный потребитель
 * (NotificationsProcessor) сам живёт в Nest DI.
 *
 * Здесь раньше был захардкожен legacy `parse_mode: 'Markdown'`, при том что
 * тексты отчётов писались с `**жирный**`. Telegram отвечал 400 «Can't find end
 * of Bold entity», сообщение не доходило, джоба уходила в retry и умирала —
 * то есть итоговый отчёт пользователь не получал НИКОГДА. Режим разметки
 * теперь берётся из единого источника (telegram-format.ts).
 */
@Injectable()
export class TelegramApiService {
  constructor(private readonly config: AppConfigService) {}

  public async sendMessage(botToken: string, chatId: string, text: string): Promise<void> {
    // Длинный отчёт не влезает в лимит Telegram (4096) и тоже даёт 400 —
    // режем на части и шлём по порядку.
    for (const chunk of splitMessage(text)) {
      await this.send(botToken, chatId, chunk);
    }
  }

  private async send(botToken: string, chatId: string, text: string): Promise<void> {
    const url = `${this.config.telegramApiUrl}/bot${botToken}/sendMessage`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: TELEGRAM_PARSE_MODE,
      }),
    });

    if (!response.ok) {
      // Раньше бралcя только statusText («Bad Request»), а настоящая причина
      // отказа лежит в теле ответа, в поле description — без неё отладка вслепую.
      let description = '';
      try {
        const body = (await response.json()) as { description?: string };
        description = body?.description ? ` — ${body.description}` : '';
      } catch {
        // тело не JSON, обойдёмся статусом
      }
      throw new Error(
        `Telegram sendMessage failed: ${response.status} ${response.statusText}${description}`,
      );
    }
  }
}
