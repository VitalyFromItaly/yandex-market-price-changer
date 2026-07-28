export default class TelegramApiService {
  public static async sendMessage(botToken: string, chatId: string, text: string): Promise<void> {
    const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: 'Markdown',
      }),
    });

    if (!response.ok) {
      throw new Error(`Failed to send Telegram message: ${response.statusText}`);
    }
  }
}
