/**
 * Логика самопроверки: пороги, оценка состояния, правило «слать или нет» и
 * тексты сообщений.
 *
 * Модуль намеренно без единого импорта — как access.domain.ts и telegram-html.ts.
 * Здесь нет ни Nest, ни mongoose, ни telegraf, поэтому всё проверяется юнит-тестом
 * без поднятия приложения, а `now` приходит параметром, а не из Date.now():
 * иначе тест на «напоминание через час» пришлось бы писать таймерами.
 *
 * Тексты отдаются БЕЗ HTML-разметки. Отправляются они с parse_mode: HTML, но
 * экранирование — работа отправляющего слоя: сюда попадает message от ioredis,
 * а в нём легко встречается `<`.
 */

/** Как часто опрашиваем зависимости. */
export const CHECK_INTERVAL_MS = 5 * 60 * 1000;

/**
 * Пауза перед первой проверкой. Соединения с Mongo и Redis поднимаются не
 * мгновенно, и без задержки монитор отрапортовал бы об аварии на ровном месте
 * при каждом старте.
 */
export const FIRST_CHECK_DELAY_MS = 30 * 1000;

/**
 * Как часто напоминать, пока проблема не ушла. Алерт шлётся по СМЕНЕ состояния,
 * иначе сутки аварии — это 288 одинаковых сообщений, после которых алерты
 * перестают читать вообще (тот же довод, что у AlertThrottle). Но и молчать
 * сутками нельзя: напоминание раз в час подтверждает, что всё ещё лежит.
 */
export const REMIND_INTERVAL_MS = 60 * 60 * 1000;

/**
 * Как часто печатать в консоль строку «всё в порядке».
 *
 * Проверка идёт каждые пять минут, и если печатать её итог каждый раз, за сутки
 * набегает под тысячу строк — `docker logs` превращается в ленту, где реальную
 * аварию нужно искать. Проблемы печатаются ВСЕГДА, норма — раз в час: этого
 * хватает, чтобы видеть, что монитор жив.
 */
export const LOG_OK_INTERVAL_MS = 60 * 60 * 1000;

/** Доля свободного места, ниже которой пора чистить диск. */
export const DISK_WARN_RATIO = 0.15;

/**
 * Доля, ниже которой авария уже близко: на этом уровне перестаёт собираться
 * образ (`npm ci` падает с ENOSPC), а Mongo — открывать журнал.
 */
export const DISK_CRITICAL_RATIO = 0.07;

/**
 * Потолок ожидания пинга. У ioredis свои ретраи, и без гонки проверка Redis
 * может не вернуться вовсе, подвесив весь цикл.
 */
export const PING_TIMEOUT_MS = 5000;

/**
 * Что проверяем. Две внутренние зависимости (Mongo, Redis), диск под ними и два
 * внешних API, без которых бот бесполезен: Telegram — его единственный способ
 * говорить, Яндекс — единственный источник данных.
 */
export type TCheckKey = 'disk' | 'mongo' | 'redis' | 'telegram' | 'yandex';

/**
 * `warn` — работает, но скоро сломается (бывает только у диска: Mongo и Redis
 * либо отвечают, либо нет).
 */
export type TCheckState = 'ok' | 'warn' | 'down';

export interface ICheckResult {
  key: TCheckKey;
  state: TCheckState;
  /** Подробность для сообщения: «свободно 12% (4,8 ГБ из 40 ГБ)». */
  detail: string;
}

/**
 * Ошибка самопроверки. Отдельный класс, а не голый Error: его имя становится
 * заголовком записи в журнале (`errorType`), и «Error» там не сказало бы ничего.
 */
export class HealthCheckError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HealthCheckError';
  }
}

const CHECK_TITLE: Record<TCheckKey, string> = {
  disk: 'Место на диске',
  mongo: 'MongoDB',
  redis: 'Redis',
  telegram: 'Telegram Bot API',
  yandex: 'API Яндекс.Маркета',
};

/** Заголовок проверки для сообщения. */
export function checkTitle(key: TCheckKey): string {
  return CHECK_TITLE[key];
}

/**
 * Состояние диска по свободным блокам.
 *
 * Считаем именно долю, а не абсолютные гигабайты: порог в гигабайтах пришлось
 * бы подбирать под конкретный сервер и он молча устарел бы при смене тарифа.
 */
export function diskStateOf(available: number, total: number): TCheckState {
  if (!(total > 0)) return 'down';

  const ratio = available / total;
  if (ratio < DISK_CRITICAL_RATIO) return 'down';
  if (ratio < DISK_WARN_RATIO) return 'warn';
  return 'ok';
}

/**
 * Слать ли сообщение.
 *
 * Правило одно и целиком здесь: сообщаем о каждой смене состояния (включая
 * возврат в норму) и напоминаем не чаще раза в час, пока плохо.
 *
 * Троттлинг ErrorReporter для этого НЕ используется: его окно — 15 минут на
 * пару «тип ошибки + место», и переход warn → down через пять минут после
 * предупреждения он бы проглотил, то есть потерялся бы ровно самый важный
 * алерт.
 */
export function shouldNotify(
  prev: TCheckState,
  next: TCheckState,
  lastNotifiedAt: number | null,
  now: number,
): boolean {
  if (next !== prev) return true;
  if (next === 'ok') return false;
  if (lastNotifiedAt === null) return true;
  return now - lastNotifiedAt >= REMIND_INTERVAL_MS;
}

const KIB = 1024;
const UNITS = ['Б', 'КБ', 'МБ', 'ГБ', 'ТБ'];

/** Байты в человеческий вид: «4,8 ГБ». Русская запятая — как в остальных экранах. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';

  let value = bytes;
  let unit = 0;
  while (value >= KIB && unit < UNITS.length - 1) {
    value /= KIB;
    unit += 1;
  }

  const rounded = unit === 0 ? String(Math.round(value)) : value.toFixed(1);
  return `${rounded.replace('.', ',')} ${UNITS[unit]}`;
}

/** «свободно 12% (4,8 ГБ из 40 ГБ)» — одинаково и для алерта, и для лога. */
export function diskDetail(available: number, total: number): string {
  if (!(total > 0)) return 'не удалось прочитать раздел';

  const percent = Math.round((available / total) * 100);
  return `свободно ${percent}% (${formatBytes(available)} из ${formatBytes(total)})`;
}

/**
 * Во сколько по Москве присылать ежедневную сводку.
 *
 * Сводка «всё в норме» существует ради одной вещи: пока её не было, отличить
 * «аварий нет» от «уведомления сломаны» было нельзя, и выяснилось бы это в
 * худший момент. Раз она приходит каждый день, её отсутствие — само по себе
 * сигнал.
 */
export const DAILY_SUMMARY_AT = '09:00';

/**
 * Пора ли слать ежедневную сводку. Сравнение строк «ЧЧ:ММ» лексикографическое —
 * для нуль-дополненного времени это то же, что сравнение моментов, и не тянет
 * арифметику по датам, которой moscow-day.ts сознательно избегает.
 *
 * День передаётся строкой, потому что «сегодня» здесь московское: в контейнере
 * UTC, и по его календарю сводка уезжала бы на три часа.
 */
export function shouldSendDailySummary(
  lastSentDay: string | null,
  today: string,
  clock: string,
): boolean {
  if (clock < DAILY_SUMMARY_AT) return false;
  return lastSentDay !== today;
}

const STATE_MARK: Record<TCheckState, string> = {
  ok: '✅',
  warn: '⚠️',
  down: '🚨',
};

/**
 * Сводка по всем проверкам разом — для команды /health, сообщения при старте и
 * ежедневной рассылки.
 *
 * Один вид на три случая намеренно: три копии одного экрана в этом проекте уже
 * расходились (экраны помощи), и «одна причина — один текст» здесь то же
 * правило.
 */
export function summaryText(title: string, results: ICheckResult[], stamp: string): string {
  const lines = results.map(
    (result) => `${STATE_MARK[result.state]} ${checkTitle(result.key)} — ${result.detail}`,
  );
  return [`${title} · ${stamp} МСК`, '', ...lines].join('\n');
}

/** Сообщение о проблеме. Без разметки — экранирование на отправляющем слое. */
export function problemText(result: ICheckResult): string {
  const mark = result.state === 'down' ? '🚨' : '⚠️';
  const verdict = result.state === 'down' ? 'авария' : 'скоро закончится';
  return `${mark} ${checkTitle(result.key)}: ${verdict}\n${result.detail}`;
}

/**
 * Сообщение о возврате в норму. Отдельное и обязательное: молчание после алерта
 * неотличимо от «монитор тоже умер», и админ идёт проверять руками — то есть
 * ровно то, ради чего монитор и написан.
 */
export function recoveryText(result: ICheckResult): string {
  return `✅ ${checkTitle(result.key)}: снова в норме\n${result.detail}`;
}
