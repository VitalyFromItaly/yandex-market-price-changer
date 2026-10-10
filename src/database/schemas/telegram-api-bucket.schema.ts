import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema } from 'mongoose';

export type TelegramApiBucketDocument = TelegramApiBucket & Document;

/**
 * Сколько хранить минутные бакеты. Страница метрик смотрит максимум на неделю
 * назад; месяц — запас на «а как было до релиза». Смена числа требует
 * `npm run db:sync-indexes`.
 */
export const TELEGRAM_API_BUCKET_TTL_DAYS = 30;

/**
 * Вызовы Bot API, свёрнутые по минуте: одна строка на (минута, бот, метод, исход).
 *
 * Не строка на вызов: под polling `getUpdates` идёт непрерывно, и журнал
 * вызовов состоял бы из него одного. Агрегатор (`TelegramApiMetrics`) копит
 * минуту в памяти и сливает её `$inc`-ом, так что запись в базу — раз в минуту
 * на бакет, а не на вызов.
 *
 * `lat` — гистограмма задержек по границам `LATENCY_BOUNDS_MS`
 * (metrics.domain.ts): перцентиль окна из сумм гистограмм считается честно,
 * из средних — нет.
 */
@Schema({ timestamps: false, versionKey: false })
export class TelegramApiBucket {
  @Prop({ type: Date, required: true })
  minute: Date;

  @Prop({ type: String, required: true })
  botId: string;

  /** Имя метода Bot API: sendMessage, getUpdates, … */
  @Prop({ type: String, required: true })
  method: string;

  /** `ok` | код ошибки Telegram строкой (`'403'`) | `network`. */
  @Prop({ type: String, required: true })
  outcome: string;

  @Prop({ type: Number, required: true, default: 0 })
  count: number;

  @Prop({ type: Number, required: true, default: 0 })
  sumMs: number;

  @Prop({ type: Number, required: true, default: 0 })
  maxMs: number;

  /**
   * Гистограмма. В базе это ОБЪЕКТ с числовыми ключами (`{ '0': 3, '5': 1 }`),
   * а не массив: сливается `$inc` по путям `lat.<i>`, а `$inc` по индексу в
   * отсутствующее поле создаёт объект. Mixed без дефолта — иначе mongoose
   * подставил бы `$setOnInsert: { lat: [] }`, конфликтующий с теми же путями.
   * Читатель приводит к массиву (`latArray`).
   */
  @Prop({ type: MongooseSchema.Types.Mixed })
  lat: unknown;
}

export const TelegramApiBucketSchema = SchemaFactory.createForClass(TelegramApiBucket);

// Ключ upsert-а: без уникальности два слива одной минуты завели бы две строки.
TelegramApiBucketSchema.index({ minute: 1, botId: 1, method: 1, outcome: 1 }, { unique: true });

// TTL. Он же обслуживает выборку окна по minute — отдельный индекс не нужен.
TelegramApiBucketSchema.index(
  { minute: 1 },
  { expireAfterSeconds: TELEGRAM_API_BUCKET_TTL_DAYS * 24 * 60 * 60 },
);
