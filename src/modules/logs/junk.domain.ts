/**
 * Сводка вкладки «Мусор»: кто сканирует. Чистая функция — группировка по IP
 * над строками журнала, без Mongo (in-memory модель тестов aggregate не умеет,
 * а объём окна — тысячи строк, не миллионы).
 *
 * Зачем сводка, а не только лента: решение «блокировать ли на краю» (nginx
 * deny / CrowdSec, см. README модуля errors) принимается по тому, повторяются
 * ли адреса. Лента из сотни одинаковых `POST /` этого не показывает.
 */

/** Строка журнала, нужная сводке. */
export interface IJunkRow {
  createdAt: Date;
  ip?: string;
  userAgent?: string;
  requestUrl?: string;
}

/** Один источник: адрес и что он делал за окно. */
export interface IJunkSource {
  /** Пусто — записи до появления поля ip. */
  ip: string;
  count: number;
  firstAt: Date;
  lastAt: Date;
  /** Самые частые запросы источника, по убыванию. */
  topRequests: { request: string; count: number }[];
  /** User-Agent последнего запроса. */
  userAgent?: string;
}

/** Адрес записей, сделанных до того, как журнал начал хранить IP. */
export const UNKNOWN_IP = '';

const TOP_REQUESTS = 5;

/** Сгруппировать по IP; источники — по убыванию числа запросов. */
export function summarizeJunk(rows: IJunkRow[], limit: number): IJunkSource[] {
  const byIp = new Map<string, { source: IJunkSource; requests: Map<string, number> }>();

  for (const row of rows) {
    const ip = row.ip || UNKNOWN_IP;
    const at = new Date(row.createdAt);
    let group = byIp.get(ip);
    if (!group) {
      group = {
        source: {
          ip,
          count: 0,
          firstAt: at,
          lastAt: at,
          topRequests: [],
          userAgent: row.userAgent,
        },
        requests: new Map(),
      };
      byIp.set(ip, group);
    }

    const { source } = group;
    source.count += 1;
    if (at < source.firstAt) source.firstAt = at;
    if (at >= source.lastAt) {
      source.lastAt = at;
      if (row.userAgent) source.userAgent = row.userAgent;
    }

    const request = row.requestUrl ?? '—';
    group.requests.set(request, (group.requests.get(request) ?? 0) + 1);
  }

  return [...byIp.values()]
    .map(({ source, requests }) => ({
      ...source,
      topRequests: [...requests.entries()]
        .map(([request, count]) => ({ request, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, TOP_REQUESTS),
    }))
    .sort((a, b) => b.count - a.count || b.lastAt.getTime() - a.lastAt.getTime())
    .slice(0, limit);
}
