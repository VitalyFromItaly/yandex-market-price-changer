import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema } from 'mongoose';

export type CrmJobResultDocument = CrmJobResult & Document;

/**
 * Сколько живёт результат фоновой задачи CRM. Сутки: продавец успеет вернуться
 * к вкладке и скачать файл, а xlsx на мегабайты не копятся в базе.
 * Смена числа требует `npm run db:sync-indexes` — mongoose не переопределяет
 * существующий индекс с тем же набором ключей.
 */
export const CRM_JOB_TTL_HOURS = 24;

export const CRM_JOB_STATUSES = ['queued', 'active', 'done', 'failed'] as const;
export type TCrmJobStatus = (typeof CRM_JOB_STATUSES)[number];

export interface ICrmJobInput {
  buffer: Buffer;
  filename: string;
}

export interface ICrmJobFile {
  buffer: Buffer;
  filename: string;
  contentType: string;
}

/**
 * Результат фоновой задачи CRM (очередь `crm-jobs`).
 *
 * Процессоры бота доставляют результат в Telegram; вебу его надо где-то
 * забрать, и Redis для этого не годится: `removeOnComplete` режет хвост, а
 * xlsx в Redis — это память. Документ заводится при постановке в очередь, так
 * что опрос статуса никогда не натыкается на «нет такой задачи».
 */
@Schema({ timestamps: true })
export class CrmJobResult {
  /** Он же jobId в Bull: одна задача — один идентификатор в обоих местах. */
  @Prop({ type: String, required: true })
  jobId: string;

  @Prop({ type: String, required: true })
  telegramUserId: string;

  @Prop({ type: String, required: true })
  kind: string;

  @Prop({ type: MongooseSchema.Types.Mixed, default: {} })
  params: Record<string, unknown>;

  @Prop({ type: String, required: true, enum: CRM_JOB_STATUSES, default: 'queued' })
  status: TCrmJobStatus;

  @Prop({ type: MongooseSchema.Types.Mixed, default: null })
  data: unknown;

  @Prop({
    type: { buffer: Buffer, filename: String, contentType: String },
    default: null,
    _id: false,
  })
  file: ICrmJobFile | null;

  /**
   * ВХОДНОЙ файл задачи (прайс из CRM), пока его не забрал процессор.
   *
   * Здесь, а не в payload Bull: буфер в Redis — это память и failed-джобы с
   * чужим прайсом внутри. В Mongo он живёт под тем же TTL и тем же владельцем,
   * что и результат, и снимается `$unset`, как только процессор его прочитал.
   * Статусные опросы его не тянут — `findOwn`/`find` исключают поле.
   */
  @Prop({ type: { buffer: Buffer, filename: String }, default: undefined, _id: false })
  input?: ICrmJobInput | null;

  /** Человеческий текст причины — показывается продавцу как есть. */
  @Prop({ type: String })
  error?: string;

  /**
   * Замок «один такой отчёт за раз»: `<telegramUserId>:<kind>`, есть только
   * пока задача в работе. Уникальный sparse-индекс делает дедуп атомарным —
   * две одновременные вставки не пройдут обе, как прошли бы при
   * find-then-create. Снимается `$unset` при любом завершении.
   */
  @Prop({ type: String })
  activeKey?: string;

  createdAt?: Date;
  updatedAt?: Date;
}

export const CrmJobResultSchema = SchemaFactory.createForClass(CrmJobResult);

CrmJobResultSchema.index({ jobId: 1 }, { unique: true });
CrmJobResultSchema.index({ activeKey: 1 }, { unique: true, sparse: true });
CrmJobResultSchema.index({ createdAt: 1 }, { expireAfterSeconds: CRM_JOB_TTL_HOURS * 60 * 60 });
