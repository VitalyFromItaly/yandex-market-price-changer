import { BadRequestException, Controller, Get, Query, UseGuards } from '@nestjs/common';

import { AdminJwtGuard } from '../admin/admin-jwt.guard';

import { isMetricsRange } from './metrics.domain';
import { MetricsService } from './metrics.service';

/**
 * `GET /api/metrics?range=24h|7d` — сводка для страницы «Метрики».
 *
 * Гвард на весь контроллер, как у LogsController: незакрытым остаётся ровно
 * тот метод, который забыли пометить.
 */
@Controller('metrics')
@UseGuards(AdminJwtGuard)
export class MetricsController {
  constructor(private readonly metrics: MetricsService) {}

  @Get()
  async report(@Query('range') range = '24h') {
    // Мусор не подменяется умолчанием молча: `?range=30d` вернул бы сутки, и
    // это выглядело бы корректным ответом на заданный вопрос.
    if (!isMetricsRange(range)) {
      throw new BadRequestException('range: ожидается 24h или 7d');
    }
    return await this.metrics.report(range);
  }
}
