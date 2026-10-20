import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, it, expect, vi } from 'vitest';

import type { TFinanceArticle } from '../../src/modules/finance/finance-articles';

import { classifyYmRow, normalizeYmLabel } from '../../src/modules/finance/ym-articles';
import { journalKeys, nettingRowToOperation } from '../../src/modules/finance/ym-journal';
import {
  YM_UNKNOWN_ARTICLE_CONTEXT,
  YmUnknownArticleError,
  reportUnknownArticles,
  unknownArticleGroups,
} from '../../src/modules/finance/ym-unknown-articles';

const row = (
  transactionType: string,
  transactionSource: string,
  offerOrServiceName: string | null = 'G-SHOCK GA-2100-1A',
  transactionSum = 100,
) => ({
  orderId: 58841189889,
  shopSku: 'GA-2100-1A',
  offerOrServiceName,
  transactionType,
  transactionSource,
  transactionDate: '16.09.2026 14:05',
  count: 1,
  transactionSum,
});

const SERVICES = 'Оплата услуг Маркета';

/**
 * Каждый тип живого журнала 09-2026 (кабинет 164225008, 21 663 строки) —
 * строки как в дампе TASK-108, включая регистр и «ё».
 */
const LIVE_TYPES: Array<[string, string, string | null, TFinanceArticle]> = [
  ['Начисление', 'Платёж покупателя', 'G-SHOCK', 'sales'],
  ['Начисление', 'Баллы за скидку Маркета', 'G-SHOCK', 'subsidies'],
  ['Начисление', 'Баллы за скидку Яндекс Плюс', 'G-SHOCK', 'subsidies'],
  ['Возврат', 'Возврат платежа покупателя', 'G-SHOCK', 'returns'],
  ['Возврат', 'Возврат баллов за скидку Маркета', 'G-SHOCK', 'returns'],
  ['Возврат', 'Возврат баллов за скидку Яндекс Плюс', 'G-SHOCK', 'returns'],
  ['Начисление', 'Утрата или порча товаров в доставке', null, 'compensations'],
  ['Начисление', 'Утеря или порча отправления заказа', 'G-SHOCK', 'compensations'],
  ['Начисление', 'Ненадлежащее оказание услуг', null, 'compensations'],
  ['Начисление', 'Премия', 'Денежная премия за участие в совместных акциях', 'other_income'],
  ['Возврат', 'Удержание выплаты за утерю или порчу заказа', 'G-SHOCK', 'withholdings'],
  [
    'Возврат',
    'Выплата расходов покупателю при возврате товара ненадлежащего качества',
    null,
    'withholdings',
  ],
  ['Удержание', SERVICES, 'Размещение товарных предложений', 'commission'],
  ['Удержание', SERVICES, 'Доставка покупателю', 'delivery_to_buyer'],
  ['Удержание', SERVICES, 'Доставка (средняя миля)', 'delivery_to_buyer'],
  ['Удержание', SERVICES, 'Доставка невыкупов и возвратов', 'reverse_logistics'],
  ['Удержание', SERVICES, 'Приём платежа', 'acquiring'],
  ['Удержание', SERVICES, 'Перевод платежа', 'acquiring'],
  ['Удержание', SERVICES, 'Буст продаж, оплата за продажи', 'promotion'],
  ['Удержание', SERVICES, 'Отзывы за баллы', 'paid_options'],
  ['Удержание', SERVICES, null, 'other_services'],
  ['Списание', 'Скидка за участие в совместных акциях', 'Доставка (средняя миля)', 'bonus_payment'],
  [
    'Возврат списания',
    'Возврат скидки за участие в совместных акциях',
    'Размещение товарных предложений',
    'bonus_payment',
  ],
];

const REVERSALS: Array<[string, TFinanceArticle]> = [
  ['Скидка за лояльность', 'commission'],
  ['Возврат за размещение товаров на витрине', 'commission'],
  ['Возврат за доставку покупателю', 'delivery_to_buyer'],
  ['Возврат за доставку в населённый пункт или ФО покупателя', 'delivery_to_buyer'],
  ['Доставка (средняя миля)', 'delivery_to_buyer'],
];

describe('classifyYmRow: типы живого журнала', () => {
  it.each(LIVE_TYPES)('%s · %s · %s → %s', (type, source, service, article) => {
    expect(classifyYmRow(row(type, source, service))).toMatchObject({ article, reversal: false });
  });
});

describe('classifyYmRow: сторно услуг', () => {
  it.each(REVERSALS)('Начисление · Оплата услуг Маркета · %s → %s', (service, article) => {
    expect(classifyYmRow(row('Начисление', SERVICES, service, 17.3))).toEqual({
      article,
      reversal: true,
      signature: `Начисление · ${SERVICES} · ${service}`,
    });
  });

  it('сторно — расход со знаком «+», а не доход', () => {
    const r = row('Начисление', SERVICES, 'Скидка за лояльность', 17.3);
    const op = nettingRowToOperation(r, journalKeys([r])[0], {
      telegramUserId: '1',
      businessId: '2',
      documentId: 'd',
      documentVersion: 1,
      periodKey: 'p',
    });
    expect(op).toMatchObject({ article: 'commission', amountKopecks: 1730 });
  });

  it('у сторно услуга обязательна: без неё — unknown, не «прочее»', () => {
    expect(classifyYmRow(row('Начисление', SERVICES, null)).article).toBe('unknown');
  });
});

describe('classifyYmRow: незнакомое', () => {
  it('новый источник — unknown, в подписи тип и источник без товара', () => {
    expect(classifyYmRow(row('Начисление', 'Компенсация за что-то новое'))).toEqual({
      article: 'unknown',
      reversal: false,
      signature: 'Начисление · Компенсация за что-то новое',
    });
  });

  it('новая услуга — unknown, а не other_services; услуга в подписи', () => {
    expect(classifyYmRow(row('Удержание', SERVICES, 'Хранение товаров'))).toEqual({
      article: 'unknown',
      reversal: false,
      signature: `Удержание · ${SERVICES} · Хранение товаров`,
    });
  });

  it('известный источник под чужим типом не угадывается', () => {
    expect(classifyYmRow(row('Удержание', 'Платёж покупателя')).article).toBe('unknown');
  });

  it('строка без типа — unknown с прочерками', () => {
    expect(classifyYmRow({}).signature).toBe('— · —');
  });
});

describe('нормализация подписей Маркета', () => {
  it('регистр, пробелы и «ё» не рождают unknown', () => {
    expect(classifyYmRow(row(' начисление ', 'ПЛАТЕЖ  покупателя')).article).toBe('sales');
    expect(classifyYmRow(row('Удержание', SERVICES, 'Прием платежа')).article).toBe('acquiring');
    expect(normalizeYmLabel(null)).toBe('');
  });
});

describe('ym-articles — лист', () => {
  it('импортирует только тип статьи', () => {
    const source = readFileSync(
      join(__dirname, '../../src/modules/finance/ym-articles.ts'),
      'utf8',
    );
    const imports = source.match(/^import .*$/gm) ?? [];
    expect(imports).toEqual(["import type { TFinanceArticle } from './finance-articles';"]);
  });
});

describe('нераспознанные: сводка и алерт', () => {
  const ctx = {
    telegramUserId: '111',
    businessId: '2',
    documentId: 'd',
    documentVersion: 1,
    periodKey: 'p',
  };
  const ops = (rows: ReturnType<typeof row>[]) => {
    const keys = journalKeys(rows);
    return rows.map((r, i) => nettingRowToOperation(r, keys[i], ctx));
  };

  it('группы по типу: число строк и сумма в копейках', () => {
    const list = ops([
      row('Удержание', SERVICES, 'Хранение товаров', -10),
      row('Удержание', SERVICES, 'Хранение товаров', -5.5),
      row('Начисление', 'Новое'),
      row('Начисление', 'Платёж покупателя'),
    ]);
    expect(unknownArticleGroups(list)).toEqual([
      { signature: `Удержание · ${SERVICES} · Хранение товаров`, count: 2, amountKopecks: -1550 },
      { signature: 'Начисление · Новое', count: 1, amountKopecks: 10000 },
    ]);
  });

  it('один отчёт на загрузку, место без id, текст без заказов и артикулов', async () => {
    const report = vi.fn(async () => undefined);
    await reportUnknownArticles(
      { report },
      ops([row('Начисление', 'Новое'), row('Возврат', 'Новое-2')]),
      '111',
    );
    expect(report).toHaveBeenCalledTimes(1);
    const input = (report.mock.calls[0] as unknown as [Record<string, unknown>])[0];
    expect(input).toMatchObject({
      source: 'queue',
      context: YM_UNKNOWN_ARTICLE_CONTEXT,
      telegramUserId: '111',
    });
    expect(YM_UNKNOWN_ARTICLE_CONTEXT).not.toMatch(/\d/);
    const error = input.error as Error;
    expect(error).toBeInstanceOf(YmUnknownArticleError);
    expect(error.name).toBe('YmUnknownArticleError');
    expect(error.message).toContain('Начисление · Новое: 1 стр.');
    expect(error.message).not.toContain('58841189889');
    expect(error.message).not.toContain('GA-2100-1A');
  });

  it('всё распознано — алерта нет', async () => {
    const report = vi.fn(async () => undefined);
    await reportUnknownArticles({ report }, ops([row('Начисление', 'Платёж покупателя')]), '1');
    expect(report).not.toHaveBeenCalled();
  });
});
