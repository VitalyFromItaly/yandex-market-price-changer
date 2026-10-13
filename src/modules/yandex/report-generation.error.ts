import type { IReportInfo } from './yandex-api.client';

import { reportInfoPath } from './yandex-api.paths';

/**
 * Асинхронный отчёт Маркета не дошёл до файла: провален (FAILED) или не готов
 * к нашему потолку ожидания.
 *
 * Отдельный класс ради разбора, а не ради ветвления. 12–13-10-2026 отчёт
 * остатков FBY падал трижды, и на вопрос «что с ним было» отвечали только
 * `docker logs` и curl к `reports/info`: reportId жил в отладочной строке
 * консоли, а время, когда Маркет его принял и провалил, — нигде. Этот класс
 * несёт всё, что Маркет о нём сказал, и ErrorReporter кладёт это в строку
 * журнала (`details`), которую видно в админке.
 */
export class ReportGenerationError extends Error {
  public readonly request: string;

  constructor(
    message: string,
    public readonly reportId: string,
    /** Последний ответ reports/info. Нет — до опроса дело не дошло. */
    public readonly info: IReportInfo | undefined,
    /** Сколько ждали мы, мс. */
    public readonly waitedMs: number,
  ) {
    super(message);
    this.name = new.target.name;
    this.request = `GET ${reportInfoPath(reportId)}`;
  }

  /** Плоская сводка для журнала. Пустые поля не пишем — в модалке они шум. */
  public get details(): Record<string, string | number> {
    const raw: Record<string, string | number | undefined> = {
      reportId: this.reportId,
      status: this.info?.status,
      subStatus: this.info?.subStatus,
      requestedAt: this.info?.requestedAt,
      finishedAt: this.info?.finishedAt,
      estimatedMs: this.info?.estimatedMs,
      waitedMs: this.waitedMs,
    };
    const out: Record<string, string | number> = {};
    for (const [key, value] of Object.entries(raw)) {
      if (value !== undefined && value !== null && value !== '') out[key] = value;
    }
    return out;
  }
}
