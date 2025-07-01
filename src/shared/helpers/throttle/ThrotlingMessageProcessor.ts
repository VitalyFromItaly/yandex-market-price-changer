import { MAX_MESSAGE_LENGTH } from '../../../modules/telegram/bots/shared/constants';
import { IMessageSorter } from '../../../modules/telegram/domain.telegram';

export default class ThrottlingMessageProcessor {
  private bufferMap: Map<number, string[]>; // ключ - user_id, значение - буфер сообщений
  private isProcessing: boolean;

  constructor(
    private throttleTime: number = 1000,
    private handleAction: (id: number, message: string) => Promise<void>,
    private messageSorter?: IMessageSorter
  ) {
    this.bufferMap = new Map();
    this.isProcessing = false;
  }

  public addMessage(userId: number, message: string): void {
    // Добавляем сообщение в буфер пользователя
    if (this.bufferMap.has(userId)) {
      this.bufferMap.get(userId)?.push(message);
    } else {
      this.bufferMap.set(userId, [message]);
    }

    // Если буферы начали наполняться, запустим обработку через короткую задержку
    if (!this.isProcessing) {
      setTimeout(() => this.processBuffers(), 1000);
    }
  }

  private processBuffers(): void {
    this.isProcessing = true;

    // Создаем копию буферов, чтобы не модифицировать оригинал во время обработки
    const buffersSnapshot = Array.from(this.bufferMap.entries());

    // Очищаем буферы
    this.bufferMap.clear();

    // Обрабатываем каждый буфер отдельно
    buffersSnapshot.forEach(async ([userId, messages]) => {
      const sortedMessages = this.messageSorter ? this.messageSorter.sort(messages) : messages;
      let combinedMessage = '';
      let currentLength = 0;

      // Склеиваем сообщения, пока не достигнем максимальной длины
      for (const message of sortedMessages) {
        if (currentLength + message.length <= MAX_MESSAGE_LENGTH) {
          combinedMessage += message + '\n\n';
          currentLength += message.length + 2; // +2 для '\n\n'
        } else {
          // Если добавление следующего сообщения превысит длину, отправляем текущее
          try {
            await this.handleAction(userId, combinedMessage);
          } catch (error) {
            console.error(`Ошибка отправки сообщения пользователю ${userId}:`, error);
          }
          // Начинаем новое сообщение
          combinedMessage = message;
          currentLength = message.length;
        }
      }

      // Отправляем последнее склеенное сообщение
      if (combinedMessage.length) {
        try {
          await this.handleAction(userId, combinedMessage);
        } catch (error) {
          console.error(`Ошибка отправки сообщения пользователю ${userId}:`, error);
        }
      }
    });


    // Ждем установленное время перед следующей отправкой
    setTimeout(() => {
      this.processBuffers();
    }, this.throttleTime);
    this.isProcessing = false;
  }
}
