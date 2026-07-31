import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type ActionLogDocument = ActionLog & Document;

/** Сколько хранить записи. Дальше их удаляет сама Mongo по TTL-индексу. */
export const ACTION_LOG_TTL_DAYS = 90;

/**
 * Журнал действий: одна запись на один апдейт телеграма.
 *
 * Зачем отдельная коллекция, а не только консоль. Логи контейнера в CapRover
 * живут до перезапуска и не ищутся по пользователю, а вопрос всегда звучит как
 * «что делал вот этот продавец» — то есть нужен запрос по telegramUserId за
 * период. Консольная строка при этом тоже пишется: она нужна ровно в тот
 * момент, когда база недоступна.
 *
 * Кто именно совершил действие, хранится ДВУМЯ полями. `telegramUserId` —
 * настоящий ключ: он не меняется и по нему идёт связь с UserAccess и
 * YandexMarket. `username` — только для чтения глазами: пользователь может
 * его сменить или не иметь вовсе, поэтому искать по нему нельзя, а вот
 * прочитать «кто это был» без похода в другую коллекцию — можно.
 */
@Schema({ timestamps: true })
export class ActionLog {
  @Prop({ type: String, required: true })
  telegramUserId: string;

  /** `@username` на момент действия. Может отсутствовать — это норма. */
  @Prop({ type: String })
  username?: string;

  /** Имя и фамилия из профиля — тоже снимок на момент действия. */
  @Prop({ type: String })
  name?: string;

  /** Числовой id бота (`ctx.botInfo.id`) — тенант. */
  @Prop({ type: String, required: true })
  botId: string;

  /** `ctx.chat.id` — единственное, куда можно писать ответ. */
  @Prop({ type: String })
  chatId?: string;

  /**
   * Направление: `in` — пользователь боту, `out` — бот пользователю.
   *
   * Отдельное поле, а не ещё одно значение kind: у входящих kind это вид
   * действия (команда/кнопка/файл), у исходящих — метод Bot API. Смешав их в
   * одном поле, фильтр «покажи только команды» начал бы попадать и в ответы.
   *
   * Дефолт `in`: записи, сделанные до появления исходящих, — входящие.
   */
  @Prop({ type: String, required: true, default: 'in' })
  direction: string;

  /**
   * Что произошло.
   *
   * У входящих: command | menu | callback | document | text | other.
   * У исходящих: имя метода Bot API (sendMessage, editMessageText, …).
   */
  @Prop({ type: String, required: true })
  kind: string;

  /**
   * Что именно сделано: текст команды, подпись кнопки, callback_data, имя файла.
   *
   * Значение уже очищено от секретов (см. maskSecrets в action-log.domain.ts):
   * во время регистрации пользователь присылает токен Яндекс.Маркета обычным
   * сообщением, и хранить его здесь означало бы завести вторую копию чужих
   * доступов в коллекции, которую заводили ради удобства.
   */
  @Prop({ type: String, required: true })
  action: string;

  /** Дошёл ли апдейт до конца пайплайна без исключения. */
  @Prop({ type: String, required: true, default: 'ok' })
  status: string;

  /** Сколько заняла обработка — видно подвисания на Partner API. */
  @Prop({ type: Number })
  durationMs?: number;

  /** Сообщение исключения, если обработка упала. */
  @Prop({ type: String })
  error?: string;

  /**
   * Откуда пришла ошибка: `bot` | `http` | `queue` | `process` | `yandex`.
   *
   * У обычных действий не заполняется — поле существует ради вопроса «где
   * сломалось», а он возникает только при разборе ошибки.
   */
  @Prop({ type: String })
  source?: string;

  /** Имя класса исключения. По нему ошибки группируются и троттлятся алерты. */
  @Prop({ type: String })
  errorType?: string;

  /** Стек. Обрезается при записи: полный стек Node — это килобайты на запись. */
  @Prop({ type: String })
  stack?: string;

  /** HTTP-код: наш ответ клиенту либо код, которым ответил Яндекс. */
  @Prop({ type: Number })
  httpStatus?: number;

  /**
   * Запрос, на котором сломалось: `GET /api/logs` или `GET v2/campaigns/…`.
   * Ради него в YandexApiError добавлены method и url — до этого они
   * терялись в toDomainError и попадали только в текст лога.
   */
  @Prop({ type: String })
  requestUrl?: string;

  /** Короткая метка места: `report:profit`, `stock-upload`, `digest`. */
  @Prop({ type: String })
  context?: string;

  createdAt?: Date;
  updatedAt?: Date;
}

export const ActionLogSchema = SchemaFactory.createForClass(ActionLog);

/*
 * Выборка «все ошибки за период». Без этого индекса она читала бы коллекцию
 * целиком: ошибки — доли процента записей, и статус в фильтре без индекса
 * означает полный скан ради двух строк.
 */
ActionLogSchema.index({ status: 1, createdAt: -1 });

// Основной запрос админа — «действия пользователя, свежие сверху».
// Направление в индекс не входит: оно принимает два значения, и выборка по
// нему всё равно читает половину коллекции.
ActionLogSchema.index({ telegramUserId: 1, createdAt: -1 });

/*
 * TTL: Mongo удаляет записи сама.
 *
 * Индекс объявлен по возрастанию, и это же поле обслуживает сортировку общего
 * списка по убыванию — Mongo умеет читать индекс в обратную сторону, поэтому
 * второй индекс по createdAt не нужен.
 *
 * Менять expireAfterSeconds правкой этой строки недостаточно: mongoose создаёт
 * отсутствующий индекс, но НЕ переопределяет существующий с тем же набором
 * полей. После изменения срока нужен `npm run db:sync-indexes`.
 */
ActionLogSchema.index({ createdAt: 1 }, { expireAfterSeconds: ACTION_LOG_TTL_DAYS * 24 * 60 * 60 });
