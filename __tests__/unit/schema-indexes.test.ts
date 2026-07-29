import { describe, it, expect } from 'vitest';
import { UserSchema } from '../../src/database/schemas/user.schema';
import { YandexMarketSchema } from '../../src/database/schemas/yandex-market.schema';
import { UserAccessSchema } from '../../src/database/schemas/user-access.schema';
import { ReportScheduleSchema } from '../../src/database/schemas/report-schedule.schema';

/**
 * Индексы — то, что теряется при миграции схем молча: приложение работает,
 * дубли просто накапливаются, и обнаруживаются они уже данными («почему отчёт
 * то по одному магазину, то по другому»).
 */
type TIndex = [Record<string, unknown>, Record<string, unknown>];

function indexes(schema: { indexes(): TIndex[] }): TIndex[] {
  return schema.indexes();
}

function findIndex(schema: { indexes(): TIndex[] }, fields: string[]): TIndex | undefined {
  return indexes(schema).find(([keys]) => {
    const actual = Object.keys(keys);
    return actual.length === fields.length && fields.every((f) => actual.includes(f));
  });
}

describe('YandexMarket', () => {
  it('магазин уникален по пользователю', () => {
    // Два документа на одного пользователя означали бы, что findByTelegramUser
    // возвращает произвольный из них. Такие дубли в базе уже находились.
    const index = findIndex(YandexMarketSchema, ['telegramUserId']);

    expect(index).toBeDefined();
    expect(index[1].unique).toBe(true);
  });

  it('unique на необязательном поле объявлен со sparse', () => {
    expect(findIndex(YandexMarketSchema, ['telegramUserId'])[1].sparse).toBe(true);
  });
});

describe('User: unique на необязательных полях', () => {
  it.each(['telegramId', 'email', 'apiToken'])(
    '%s объявлен со sparse — иначе второй документ с null ловит дубликат',
    (field) => {
      const index = findIndex(UserSchema, [field]);

      expect(index).toBeDefined();
      expect(index[1].unique).toBe(true);
      expect(index[1].sparse).toBe(true);
    },
  );

  it('обязательный username остаётся unique без sparse', () => {
    // sparse здесь не нужен и только скрыл бы отсутствие значения.
    const index = findIndex(UserSchema, ['username']);
    expect(index[1].unique).toBe(true);
    expect(index[1].sparse).toBeUndefined();
  });
});

describe('Составные unique новых схем', () => {
  it('доступ уникален по паре (пользователь, бот)', () => {
    const index = findIndex(UserAccessSchema, ['telegramUserId', 'botId']);

    expect(index).toBeDefined();
    expect(index[1].unique).toBe(true);
  });

  it('расписание уникально по (пользователь, бот, отчёт)', () => {
    const index = findIndex(ReportScheduleSchema, [
      'telegramUserId',
      'botId',
      'reportKey',
    ]);

    expect(index).toBeDefined();
    expect(index[1].unique).toBe(true);
  });

  it('под сверку расписаний есть индекс по enabled', () => {
    expect(findIndex(ReportScheduleSchema, ['enabled'])).toBeDefined();
  });
});
