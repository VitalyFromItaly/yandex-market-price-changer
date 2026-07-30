import { BadRequestException, Controller, Get, Query, UseGuards } from '@nestjs/common';

import { ActionLogService, MAX_PAGE_SIZE } from '../../database/services/action-log.service';
import { AdminJwtGuard } from '../admin/admin-jwt.guard';

/**
 * Чтение журнала действий. Только для администраторов — весь контроллер
 * закрыт AdminJwtGuard, а не отдельные методы: незакрытым останется ровно тот
 * метод, который забудут пометить.
 *
 * Полный адрес — /api/logs (глобальный префикс задан в main.ts).
 */
@Controller('logs')
@UseGuards(AdminJwtGuard)
export class LogsController {
  constructor(private readonly logs: ActionLogService) {}

  @Get()
  async list(
    @Query('telegramUserId') telegramUserId?: string,
    @Query('kind') kind?: string,
    @Query('since') since?: string,
    @Query('until') until?: string,
    @Query('limit') limit?: string,
    @Query('skip') skip?: string,
  ) {
    const query = {
      telegramUserId,
      kind,
      since: this.dateOf(since, 'since'),
      until: this.dateOf(until, 'until'),
      limit: this.numberOf(limit, 'limit'),
      skip: this.numberOf(skip, 'skip'),
    };

    // total считается по тому же фильтру: клиенту нужно знать, есть ли ещё
    // страницы, а выдача ограничена потолком MAX_PAGE_SIZE.
    const [items, total] = await Promise.all([this.logs.list(query), this.logs.count(query)]);

    return { total, limit: Math.min(query.limit ?? 100, MAX_PAGE_SIZE), skip: query.skip ?? 0, items };
  }

  /**
   * Дата из query. Молча игнорировать мусор нельзя: `?since=вчера` вернул бы
   * полную выдачу, которая выглядит как корректный ответ на заданный фильтр.
   */
  private dateOf(value: string | undefined, field: string): Date | undefined {
    if (!value) return undefined;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      throw new BadRequestException(`${field}: ожидается дата ISO, например 2026-07-30`);
    }
    return date;
  }

  private numberOf(value: string | undefined, field: string): number | undefined {
    if (!value) return undefined;
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 0) {
      throw new BadRequestException(`${field}: ожидается целое неотрицательное число`);
    }
    return parsed;
  }
}
