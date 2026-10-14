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
 * говорить, Яндекс — единственный источник данных. Шестая — баланс Polza.ai, и
 * только когда ИИ включён: без неё о кончившихся деньгах первым узнал бы
 * продавец.
 */
export type TCheckKey = 'disk' | 'mongo' | 'redis' | 'telegram' | 'yandex' | 'polza';

/**
 * `warn` — работает, но скоро сломается (бывает у диска и у баланса Polza —
 * ресурсов, которые убывают постепенно; Mongo и Redis либо отвечают, либо нет).
 */
export type TCheckState = 'ok' | 'warn' | 'down';

export interface ICheckResult {
  key: TCheckKey;
  state: TCheckState;
  /** Подробность для сообщения: «свободно 12% (4,8 ГБ из 40 ГБ)». */
  detail: string;
  /**
   * Сколько шла сетевая проверка (Redis, Telegram, Яндекс). Нет — у проверки
   * сетевой части нет (диск, Mongo по readyState). Пишется в историю
   * (`HealthSample`): деградация зеркала видна по ней раньше, чем авария.
   */
  latencyMs?: number;
  /**
   * Что делать админу — строка под последствиями в алерте. Своя у причины:
   * при таймауте совет «пополнить баланс» отправлял бы не туда.
   */
  hint?: string;
}

/** «· 240 мс» — хвост строки сводки; пусто, если задержки нет. */
export function latencySuffix(result: ICheckResult): string {
  return typeof result.latencyMs === 'number' ? ` · ${result.latencyMs} мс` : '';
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
  polza: 'Polza.ai (ИИ)',
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
 * Состояние баланса Polza, ₽.
 *
 * Рубли, а не доля, как у диска: у баланса нет «всего раздела», есть остаток.
 * Ноль и меньше — авария: каждый запрос получит 402, предупреждать уже поздно.
 * Нечитаемое число — тоже авария: «не знаем, есть ли деньги» нельзя показывать
 * зелёным. `warnRub` 0 — предупреждение выключено, авария при нуле остаётся.
 */
export function polzaBalanceStateOf(available: number, warnRub: number): TCheckState {
  if (!Number.isFinite(available) || available <= 0) return 'down';
  if (warnRub > 0 && available < warnRub) return 'warn';
  return 'ok';
}

/** Рубли по-русски: «1 234,56 ₽». */
export function formatRub(value: number): string {
  if (!Number.isFinite(value)) return '—';
  return `${value.toLocaleString('ru-RU', { maximumFractionDigits: 2 })} ₽`;
}

/** «доступно 150 ₽ · порог 200 ₽» — порог печатаем, только когда он сработал. */
export function polzaBalanceDetail(available: number, warnRub: number): string {
  const head = `доступно ${formatRub(available)}`;
  return polzaBalanceStateOf(available, warnRub) === 'ok'
    ? head
    : `${head} · порог ${formatRub(warnRub)}`;
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
    (result) =>
      `${STATE_MARK[result.state]} ${checkTitle(result.key)} — ${result.detail}${latencySuffix(result)}`,
  );
  return [`${title} · ${stamp} МСК`, '', ...lines].join('\n');
}

/**
 * Что именно проверяет самопроверка Яндекса. Без этой строки «API Яндекс.Маркета:
 * авария» читается как «сломался какой-то метод», хотя проверка — сетевая
 * доступность хоста без ключа, и её провал значит, что не работает ВСЁ.
 */
export const YANDEX_SCOPE_NOTE =
  'Что проверялось: сетевой доступ к API Маркета без ключа — не конкретный метод. ' +
  'Не отвечает весь хост, значит не работает весь API у всех продавцов. ' +
  'Ошибки отдельных методов приходят своими алертами со строкой «Запрос: …».';

/**
 * Что значит проблема с Polza. Без неё «Polza.ai: авария» не говорит о
 * последствиях. Куда идти — отдельной строкой (`hint`): у денег и у сети
 * разные адреса.
 */
export const POLZA_SCOPE_NOTE =
  'ИИ-функции перестанут работать у всех продавцов: ключ Polza один на всех.';

/** Мало денег, нет денег, ключ отозван. */
export const POLZA_ACCOUNT_HINT = 'Пополнить баланс или проверить ключ — в кабинете polza.ai.';

/**
 * Таймаут, сеть, 429/502/503: Polza не ответила по существу. Баланс и ключ
 * тут ни при чём — 14-10-2026 алерт с советом «пополнить баланс» пришёл на
 * два таймаута подряд.
 */
export const POLZA_NETWORK_HINT =
  'Баланс и ключ ни при чём: polza.ai не ответила по существу. ' +
  'Проверить с хоста: curl -m 60 https://polza.ai/api/v2/balance. ' +
  'Разовый сбой закроется сам — придёт «снова в норме».';

/**
 * Где искать причину недоступности Яндекса: Telegram в том же проходе — это
 * контрольный внешний адрес. Отвечает он — сеть у контейнера есть.
 */
function yandexContext(all: readonly ICheckResult[]): string | null {
  const telegram = all.find((result) => result.key === 'telegram');
  if (!telegram) return null;
  return telegram.state === 'ok'
    ? 'Telegram в этот момент отвечает: интернет у сервера есть, проблема на пути к Маркету или у Маркета.'
    : 'Telegram тоже недоступен: вероятно, сеть самого сервера.';
}

/**
 * Сообщение о проблеме. Без разметки — экранирование на отправляющем слое.
 *
 * `all` — весь проход проверок: у Яндекса по соседним результатам видно, лёг ли
 * Маркет или сеть сервера целиком.
 */
export function problemText(result: ICheckResult, all: readonly ICheckResult[] = []): string {
  const mark = result.state === 'down' ? '🚨' : '⚠️';
  const verdict = result.state === 'down' ? 'авария' : 'скоро закончится';
  const lines = [`${mark} ${checkTitle(result.key)}: ${verdict}`, result.detail];
  if (result.key === 'yandex') {
    const context = yandexContext(all);
    lines.push('', YANDEX_SCOPE_NOTE);
    if (context) lines.push(context);
  }
  if (result.key === 'polza') lines.push('', POLZA_SCOPE_NOTE);
  if (result.hint) lines.push(result.hint);
  return lines.join('\n');
}

/** Поля сетевой ошибки Node, которые нам нужны; приходят без типов. */
interface INetworkCause {
  name?: string;
  code?: string;
  message?: string;
  address?: string;
  port?: number;
  errors?: INetworkCause[];
  cause?: INetworkCause;
}

const NETWORK_REASON: Array<[RegExp, string]> = [
  [/^(ENOTFOUND|EAI_AGAIN)$/, 'DNS не нашёл адрес'],
  [/^(ETIMEDOUT|UND_ERR_CONNECT_TIMEOUT)$/, 'соединение не установилось по таймауту'],
  [/^ECONNREFUSED$/, 'в соединении отказано'],
  [/^(ECONNRESET|EPIPE|UND_ERR_SOCKET)$/, 'соединение оборвано'],
  [/^(ENETUNREACH|EHOSTUNREACH)$/, 'сеть или хост недостижимы'],
  [/^(CERT_|UNABLE_TO_VERIFY|DEPTH_ZERO|SELF_SIGNED|ERR_TLS)/, 'ошибка TLS-сертификата'],
];

function hostPort(cause: INetworkCause): string | null {
  if (!cause.address) return null;
  const host = cause.address.includes(':') ? `[${cause.address}]` : cause.address;
  return cause.port ? `${host}:${cause.port}` : host;
}

/**
 * Человеческая причина сетевой ошибки.
 *
 * У `fetch` в Node сообщение всегда «fetch failed», а настоящая причина — в
 * `cause` (код и адрес), при переборе IPv4/IPv6 — ещё и в `cause.errors`
 * (AggregateError). Алерт «fetch failed» не говорил ни что сломалось, ни где:
 * 13-10-2026 за ним стоял разовый ETIMEDOUT соединения. Ошибку без `cause`
 * отдаём её текстом, как раньше.
 */
export function networkErrorDetail(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const root = error as INetworkCause;
  if (root.name === 'TimeoutError' || root.name === 'AbortError') {
    return `нет ответа: ${root.message}`;
  }
  const cause = root.cause;
  if (!cause) return error.message;

  const nested = cause.errors?.length ? cause.errors : [cause];
  const code = cause.code ?? nested.find((item) => item.code)?.code ?? cause.name;
  const reason = NETWORK_REASON.find(([pattern]) => code && pattern.test(code))?.[1];
  const addresses = [...new Set(nested.map(hostPort).filter(Boolean))];

  const head = reason
    ? `${reason} (${code})`
    : `${code ?? 'сетевая ошибка'}: ${cause.message || error.message}`;
  return addresses.length ? `${head} · ${addresses.join(', ')}` : head;
}

/**
 * Сообщение о возврате в норму. Отдельное и обязательное: молчание после алерта
 * неотличимо от «монитор тоже умер», и админ идёт проверять руками — то есть
 * ровно то, ради чего монитор и написан.
 */
export function recoveryText(result: ICheckResult): string {
  return `✅ ${checkTitle(result.key)}: снова в норме\n${result.detail}`;
}
