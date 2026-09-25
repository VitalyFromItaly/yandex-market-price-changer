import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';

import {
  CrmJobResult,
  CrmJobResultDocument,
  ICrmJobFile,
  ICrmJobInput,
} from '../schemas/crm-job-result.schema';

const DUPLICATE_KEY = 11000;

export interface ICrmJobCreate {
  jobId: string;
  telegramUserId: string;
  kind: string;
  params: Record<string, unknown>;
  /** Входной файл (прайс из CRM) — до тех пор, пока его не заберёт процессор. */
  input?: ICrmJobInput;
  /**
   * Сужение замка: отчёт по магазину — `campaignId`. Две вкладки на РАЗНЫХ
   * магазинах не должны получать задачу друг друга. Без поля — замок на
   * продавца и kind (загрузка прайса: одна запись остатков за раз).
   */
  scope?: string;
}

/** Статусу файл не нужен: 10 МБ на каждый опрос раз в секунду — не опрос, а выкачка. */
const WITHOUT_INPUT = '-input';

/** Итог вставки: новая задача или уже идущая с тем же kind. */
export interface ICrmJobClaim {
  jobId: string;
  created: boolean;
}

export function activeKeyOf(telegramUserId: string, kind: string, scope?: string): string {
  return scope ? `${telegramUserId}:${kind}:${scope}` : `${telegramUserId}:${kind}`;
}

@Injectable()
export class CrmJobResultService {
  constructor(
    @InjectModel(CrmJobResult.name)
    private readonly model: Model<CrmJobResultDocument>,
  ) {}

  /**
   * Заводит задачу в статусе `queued` — или отдаёт уже идущую того же продавца
   * и того же kind. Дубль ловит уникальный индекс по `activeKey`, а не
   * предварительный find: между find и create успела бы вклиниться вторая
   * вкладка.
   */
  async claim(input: ICrmJobCreate): Promise<ICrmJobClaim> {
    const { scope, ...fields } = input;
    const activeKey = activeKeyOf(input.telegramUserId, input.kind, scope);
    try {
      await this.model.create({ ...fields, status: 'queued', activeKey });
      return { jobId: input.jobId, created: true };
    } catch (error) {
      if ((error as { code?: number }).code !== DUPLICATE_KEY) throw error;
      const running = await this.model.findOne({ activeKey }).select(WITHOUT_INPUT).exec();
      // Задача успела завершиться между вставкой и чтением — пробуем ещё раз.
      if (!running) return await this.claim(input);
      return { jobId: running.jobId, created: false };
    }
  }

  async markActive(jobId: string): Promise<void> {
    await this.model.updateOne({ jobId }, { $set: { status: 'active' } }).exec();
  }

  /**
   * Входной файл задачи. `null` — его нет (задача завершена или не та).
   *
   * Читается БЕЗ снятия: воркер, умерший на редеплое, Bull перезапустит
   * (stalled-jobs), и повторному прогону файл снова нужен — у бота ту же
   * гарантию даёт повторное скачивание по file_id. Снимается поле в
   * `finishDone`/`finishFailed`, то есть при любом исходе.
   */
  async readInput(jobId: string): Promise<ICrmJobInput | null> {
    const doc = await this.model.findOne({ jobId }).select('input').exec();
    const input = doc?.input;
    if (!input?.buffer) return null;
    // Из Mongo приходит BSON Binary, а не Buffer, — приводим явно.
    return { buffer: Buffer.from(input.buffer as unknown as Uint8Array), filename: input.filename };
  }

  async finishDone(jobId: string, data: unknown, file: ICrmJobFile | null): Promise<void> {
    await this.model
      .updateOne(
        { jobId },
        { $set: { status: 'done', data, file }, $unset: { activeKey: 1, input: 1 } },
      )
      .exec();
  }

  async finishFailed(jobId: string, error: string): Promise<void> {
    await this.model
      .updateOne(
        { jobId },
        {
          $set: { status: 'failed', error, data: null, file: null },
          $unset: { activeKey: 1, input: 1 },
        },
      )
      .exec();
  }

  /** Только своя задача: чужой jobId неотличим от несуществующего. */
  async findOwn(jobId: string, telegramUserId: string): Promise<CrmJobResultDocument | null> {
    return await this.model.findOne({ jobId, telegramUserId }).select(WITHOUT_INPUT).exec();
  }

  async find(jobId: string): Promise<CrmJobResultDocument | null> {
    return await this.model.findOne({ jobId }).select(WITHOUT_INPUT).exec();
  }
}
