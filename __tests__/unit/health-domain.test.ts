import type { TCheckKey } from '../../src/modules/health/health.domain';

import { describe, it, expect } from 'vitest';

import {
  DISK_CRITICAL_RATIO,
  DISK_WARN_RATIO,
  POLZA_SCOPE_NOTE,
  REMIND_INTERVAL_MS,
  checkTitle,
  diskDetail,
  diskStateOf,
  formatBytes,
  networkErrorDetail,
  polzaBalanceDetail,
  polzaBalanceStateOf,
  problemText,
  recoveryText,
  shouldNotify,
  shouldSendDailySummary,
  summaryText,
} from '../../src/modules/health/health.domain';

/**
 * Самопроверка окружения.
 *
 * Проверяется именно домен: пороги и правило отправки — это единственное, что
 * решает, узнает администратор об аварии или нет, и ошибка здесь не падает и не
 * ловится компилятором. Всё остальное в мониторе — вызовы statfs, readyState и
 * ping, проверяемые только на живом окружении.
 */
describe('Оценка свободного места', () => {
  const TOTAL = 100;

  it('считает норму, когда свободного места выше порога предупреждения', () => {
    expect(diskStateOf(50, TOTAL)).toBe('ok');
    expect(diskStateOf(DISK_WARN_RATIO * TOTAL, TOTAL)).toBe('ok');
  });

  it('предупреждает, когда места меньше порога, но авария ещё не близко', () => {
    expect(diskStateOf(DISK_WARN_RATIO * TOTAL - 1, TOTAL)).toBe('warn');
    expect(diskStateOf(DISK_CRITICAL_RATIO * TOTAL, TOTAL)).toBe('warn');
  });

  it('считает аварией то, на чём падают npm ci и журнал Mongo', () => {
    expect(diskStateOf(DISK_CRITICAL_RATIO * TOTAL - 1, TOTAL)).toBe('down');
    expect(diskStateOf(0, TOTAL)).toBe('down');
  });

  /**
   * Нулевой размер раздела — это не «места сколько угодно», а неудачное чтение.
   * Без этой ветки деление дало бы NaN, и все сравнения молча вернули бы 'ok'.
   */
  it('считает нечитаемый раздел аварией, а не нормой', () => {
    expect(diskStateOf(0, 0)).toBe('down');
    expect(diskStateOf(10, -1)).toBe('down');
  });
});

describe('Правило отправки сообщений', () => {
  const NOW = 1_000_000;

  it('сообщает о каждой смене состояния', () => {
    expect(shouldNotify('ok', 'warn', null, NOW)).toBe(true);
    expect(shouldNotify('warn', 'down', NOW, NOW + 1000)).toBe(true);
    expect(shouldNotify('down', 'ok', NOW, NOW + 1000)).toBe(true);
  });

  /**
   * Главное свойство: раз в пять минут одно и то же сообщение не уходит. Иначе
   * сутки аварии — это 288 одинаковых алертов, после которых их перестают
   * читать, и ловитель делает наблюдаемость хуже своего отсутствия.
   */
  it('не повторяет одно и то же на каждой проверке', () => {
    expect(shouldNotify('down', 'down', NOW, NOW + 5 * 60 * 1000)).toBe(false);
    expect(shouldNotify('warn', 'warn', NOW, NOW + REMIND_INTERVAL_MS - 1)).toBe(false);
  });

  it('напоминает раз в час, пока проблема держится', () => {
    expect(shouldNotify('down', 'down', NOW, NOW + REMIND_INTERVAL_MS)).toBe(true);
  });

  it('молчит, пока всё в порядке', () => {
    expect(shouldNotify('ok', 'ok', null, NOW)).toBe(false);
    expect(shouldNotify('ok', 'ok', NOW, NOW + REMIND_INTERVAL_MS * 10)).toBe(false);
  });

  /**
   * Первая же проверка после старта при уже сломанной зависимости: предыдущего
   * состояния нет, отправлять не отправляли — молчать нельзя.
   */
  it('сообщает о проблеме, найденной на первой проверке', () => {
    expect(shouldNotify('down', 'down', null, NOW)).toBe(true);
  });
});

/**
 * Баланс Polza убывает постепенно, как диск: предупреждение должно прийти до
 * того, как каждый ИИ-запрос продавца получит 402.
 */
describe('Баланс Polza', () => {
  it('ноль, минус и нечитаемое число — авария', () => {
    expect(polzaBalanceStateOf(0, 200)).toBe('down');
    expect(polzaBalanceStateOf(-3.5, 200)).toBe('down');
    expect(polzaBalanceStateOf(Number.NaN, 200)).toBe('down');
  });

  it('ниже порога — предупреждение, на пороге и выше — норма', () => {
    expect(polzaBalanceStateOf(199.99, 200)).toBe('warn');
    expect(polzaBalanceStateOf(200, 200)).toBe('ok');
    expect(polzaBalanceStateOf(5000, 200)).toBe('ok');
  });

  it('порог 0 выключает предупреждение, но не аварию', () => {
    expect(polzaBalanceStateOf(0.01, 0)).toBe('ok');
    expect(polzaBalanceStateOf(0, 0)).toBe('down');
  });

  it('порог в тексте — только когда он сработал', () => {
    expect(polzaBalanceDetail(1234.5, 200)).toMatch(/^доступно 1\s234,5 ₽$/);
    expect(polzaBalanceDetail(150, 200)).toMatch(/доступно 150 ₽ · порог 200 ₽/);
  });

  it('алерт объясняет последствия и куда идти', () => {
    const text = problemText({ key: 'polza', state: 'warn', detail: 'доступно 150 ₽' });
    expect(text).toContain('Polza.ai');
    expect(text).toContain('⚠️');
    expect(text).toContain(POLZA_SCOPE_NOTE);
    expect(text).not.toMatch(/[<>]/);
  });

  it('совет печатается строкой после последствий; без него — только последствия', () => {
    const withHint = problemText({ key: 'polza', state: 'down', detail: 'x', hint: 'СОВЕТ' });
    expect(withHint.endsWith(`${POLZA_SCOPE_NOTE}\nСОВЕТ`)).toBe(true);
    const bare = problemText({ key: 'polza', state: 'down', detail: 'x' });
    expect(bare.endsWith(POLZA_SCOPE_NOTE)).toBe(true);
    expect(bare).not.toContain('баланс');
  });
});

describe('Тексты', () => {
  /**
   * Забытый заголовок для нового ключа даёт `undefined` в сообщении админу —
   * Record<TCheckKey, string> ловит это компилятором, а тест закрывает случай,
   * когда ключ добавили вместе с пустой строкой.
   */
  it('называет каждую проверку, включая внешние API', () => {
    const keys: TCheckKey[] = ['disk', 'mongo', 'redis', 'telegram', 'yandex', 'polza'];

    for (const key of keys) {
      expect(checkTitle(key).length).toBeGreaterThan(0);
    }

    expect(checkTitle('telegram')).toContain('Telegram');
    expect(checkTitle('yandex')).toContain('Яндекс');
  });

  it('различает предупреждение и аварию', () => {
    const warn = problemText({ key: 'disk', state: 'warn', detail: 'свободно 10%' });
    const down = problemText({ key: 'mongo', state: 'down', detail: 'readyState=0' });

    expect(warn).toContain('Место на диске');
    expect(warn).toContain('⚠️');
    expect(down).toContain('MongoDB');
    expect(down).toContain('🚨');
  });

  it('говорит о возврате в норму отдельным сообщением', () => {
    const text = recoveryText({ key: 'redis', state: 'ok', detail: 'отвечает на ping' });

    expect(text).toContain('Redis');
    expect(text).toContain('норме');
  });

  /**
   * Тексты уходят с parse_mode: HTML и экранируются на отправляющем слое —
   * значит своей разметки в них быть не должно, иначе она приедет к
   * администратору как видимые теги.
   */
  it('не содержат HTML-разметки', () => {
    const texts = [
      problemText({ key: 'disk', state: 'down', detail: 'свободно 1%' }),
      recoveryText({ key: 'disk', state: 'ok', detail: 'свободно 40%' }),
    ];

    for (const text of texts) {
      expect(text).not.toMatch(/[<>]/);
    }
  });
});

describe('Сводка состояния', () => {
  const RESULTS = [
    { key: 'disk' as const, state: 'ok' as const, detail: 'свободно 34%' },
    { key: 'mongo' as const, state: 'down' as const, detail: 'readyState=0' },
    { key: 'yandex' as const, state: 'ok' as const, detail: 'отвечает (HTTP 401)' },
  ];

  it('перечисляет все проверки с их состоянием', () => {
    const text = summaryText('📊 Состояние сейчас', RESULTS, '06-08-2026 09:00');

    expect(text).toContain('06-08-2026 09:00 МСК');
    expect(text).toContain('✅ Место на диске');
    expect(text).toContain('🚨 MongoDB');
    expect(text).toContain('✅ API Яндекс.Маркета');
  });

  it('не содержит HTML-разметки — экранирование на отправляющем слое', () => {
    expect(summaryText('Заголовок', RESULTS, '06-08-2026 09:00')).not.toMatch(/[<>]/);
  });
});

describe('Ежедневная сводка', () => {
  const TODAY = '06-08-2026';

  it('молчит до назначенного часа', () => {
    expect(shouldSendDailySummary(null, TODAY, '08:59')).toBe(false);
    expect(shouldSendDailySummary('05-08-2026', TODAY, '00:10')).toBe(false);
  });

  it('уходит один раз за московские сутки', () => {
    expect(shouldSendDailySummary('05-08-2026', TODAY, '09:00')).toBe(true);
    expect(shouldSendDailySummary(TODAY, TODAY, '09:05')).toBe(false);
    expect(shouldSendDailySummary(TODAY, TODAY, '23:59')).toBe(false);
  });

  /**
   * Проверка идёт раз в пять минут, ровно в 09:00 попасть неоткуда — условие
   * обязано срабатывать и позже назначенного времени, иначе сводка не придёт
   * вообще ни разу.
   */
  it('срабатывает и позже назначенного времени, а не только ровно в него', () => {
    expect(shouldSendDailySummary('05-08-2026', TODAY, '14:37')).toBe(true);
  });
});

describe('Человеческий вид чисел', () => {
  it('переводит байты в привычные единицы', () => {
    expect(formatBytes(512)).toBe('512 Б');
    expect(formatBytes(1024)).toBe('1,0 КБ');
    expect(formatBytes(5 * 1024 ** 3)).toBe('5,0 ГБ');
  });

  it('не выдаёт мусор за число', () => {
    expect(formatBytes(NaN)).toBe('—');
    expect(formatBytes(-1)).toBe('—');
  });

  it('печатает и долю, и абсолютные значения — по ним сверяются с df', () => {
    const detail = diskDetail(2 * 1024 ** 3, 40 * 1024 ** 3);

    expect(detail).toContain('5%');
    expect(detail).toContain('2,0 ГБ');
    expect(detail).toContain('40,0 ГБ');
  });
});

/** Ошибка `fetch` в Node: сообщение «fetch failed», причина — в cause. */
function fetchFailed(cause: object): Error {
  return Object.assign(new TypeError('fetch failed'), { cause });
}

describe('Причина сетевой ошибки', () => {
  it('ETIMEDOUT при переборе IPv4/IPv6: код по-русски и оба адреса', () => {
    const cause = Object.assign(new AggregateError([], ''), {
      code: 'ETIMEDOUT',
      errors: [
        { code: 'ETIMEDOUT', address: '93.158.134.216', port: 443 },
        { code: 'ETIMEDOUT', address: '2a02:6b8::2:216', port: 443 },
      ],
    });

    expect(networkErrorDetail(fetchFailed(cause))).toBe(
      'соединение не установилось по таймауту (ETIMEDOUT) · 93.158.134.216:443, [2a02:6b8::2:216]:443',
    );
  });

  it('DNS', () => {
    const detail = networkErrorDetail(
      fetchFailed({ code: 'ENOTFOUND', message: 'getaddrinfo ENOTFOUND x' }),
    );
    expect(detail).toBe('DNS не нашёл адрес (ENOTFOUND)');
  });

  it('неизвестный код — как есть, с текстом причины', () => {
    const detail = networkErrorDetail(fetchFailed({ code: 'EWHATEVER', message: 'странное' }));
    expect(detail).toBe('EWHATEVER: странное');
  });

  it('ошибка без cause — её собственный текст', () => {
    expect(networkErrorDetail(new Error('нет ответа за 5000 мс'))).toBe('нет ответа за 5000 мс');
    expect(networkErrorDetail('строка')).toBe('строка');
  });
});

describe('Алерт о Яндексе', () => {
  const yandex = { key: 'yandex', state: 'down', detail: 'соединение не установилось' } as const;

  it('говорит, что проверялся весь хост, а не метод', () => {
    const text = problemText(yandex);
    expect(text).toContain('не конкретный метод');
    expect(text).toContain('весь API');
    expect(text).toContain('соединение не установилось');
  });

  it('Telegram отвечает — сеть сервера жива, дело в пути к Маркету', () => {
    const text = problemText(yandex, [yandex, { key: 'telegram', state: 'ok', detail: 'ok' }]);
    expect(text).toContain('Telegram в этот момент отвечает');
  });

  it('Telegram тоже лежит — вероятно, сеть сервера', () => {
    const text = problemText(yandex, [yandex, { key: 'telegram', state: 'down', detail: 'x' }]);
    expect(text).toContain('сеть самого сервера');
  });

  it('у других проверок пояснения про Маркет нет', () => {
    expect(problemText({ key: 'mongo', state: 'down', detail: 'x' })).not.toContain('Маркет');
  });
});
