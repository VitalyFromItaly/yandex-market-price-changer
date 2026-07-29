import { TELEGRAM_PARSE_MODE, splitMessage } from '../formatting/telegram-format';

/**
 * Отправка сообщений без экземпляра Telegraf — воркеры очередей знают только
 * botToken, поэтому ходят в Bot API напрямую.
 *
 * Здесь раньше был захардкожен legacy `parse_mode: 'Markdown'`, при том что
 * тексты отчётов писались с `**жирный**`. Telegram отвечал 400 «Can't find end
 * of Bold entity», сообщение не доходило, джоба уходила в retry и умирала —
 * то есть итоговый отчёт пользователь не получал НИКОГДА. Режим разметки
 * теперь берётся из единого источника (telegram-format.ts).
 */
export default class TelegramApiService {
  public static async sendMessage(botToken: string, chatId: string, text: string): Promise<void> {
    // Длинный отчёт не влезает в лимит Telegram (4096) и тоже даёт 400 —
    // режем на части и шлём по порядку.
    for (const chunk of splitMessage(text)) {
      await this.send(botToken, chatId, chunk);
    }
  }

  private static async send(botToken: string, chatId: string, text: string): Promise<void> {
    const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
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
