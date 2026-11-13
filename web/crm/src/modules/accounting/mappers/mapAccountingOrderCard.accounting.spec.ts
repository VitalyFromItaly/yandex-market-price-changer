import { describe, expect, it } from 'vitest';

import { amount, cardResponse } from './accountingOrders.fixtures.accounting';
import { mapAccountingOrderCard, toOrderCostLineRow } from './mapAccountingOrderCard.accounting';

describe('mapAccountingOrderCard', () => {
  it('неизвестная закупка — «Неизвестная закупка» с причиной, никогда 0', () => {
    const view = mapAccountingOrderCard(cardResponse());
    expect(view.netLabel).toBe('Неизвестная закупка');
    expect(view.netUnknown).toBe(true);
    expect(view.isLoss).toBe(false);
    expect(view.unknownNote).toMatch(/^Неизвестная закупка\. Нет закупочной цены/);
    const cogs = view.amounts.find((a) => a.key === 'cogs');
    expect(cogs?.amountLabel).toBe('Неизвестная закупка');
    expect(cogs?.tags.map((t) => t.label)).toEqual(['Неизвестная закупка']);
    expect(cogs?.costLines[0]).toMatchObject({ unitLabel: 'Неизвестная закупка', unknown: true });
    expect(cogs?.expandable).toBe(true);
  });

  it('предварительная не выглядит окончательной: подпись и тон warn', () => {
    const view = mapAccountingOrderCard(cardResponse());
    expect(view.provisionalNote).toBe('Прибыль не окончательная');
    expect(view.stateTone).toBe('warn');
    expect(view.stateHint).toMatch(/не окончательная/);
    const final = mapAccountingOrderCard(
      cardResponse({
        final: true,
        state: 'reconciled',
        stateTitle: 'Сверено',
        netKopecks: -500,
        unknown: null,
      }),
    );
    expect(final.provisionalNote).toBeNull();
    expect(final.stateTone).toBe('ok');
    expect(final.isLoss).toBe(true);
    expect(final.unknownNote).toBeNull();
  });

  it('метки строк: ожидается + оценка с основанием, распределено с методикой', () => {
    const view = mapAccountingOrderCard(cardResponse());
    const commission = view.amounts.find((a) => a.key === 'commission');
    expect(commission?.tags.map((t) => t.label)).toEqual(['ожидается', 'оценка']);
    expect(commission?.notes).toEqual(['Оценка по средним ставкам за 30 дней']);
    const opex = view.amounts.find((a) => a.key === 'opex_allocated');
    expect(opex?.tags.map((t) => t.label)).toEqual(['распределено']);
    expect(opex?.notes[0]).toBe('Пропорционально выручке · расходы 01-10-2026 — 31-10-2026');
    expect(view.amounts[0]?.tags).toEqual([]);
  });

  it('«Прочие расходы» (TASK-220) — методика и каждая запись «Расходов» строкой', () => {
    const view = mapAccountingOrderCard(
      cardResponse({
        amounts: [
          amount({
            key: 'other_expenses',
            title: 'Прочие расходы',
            kopecks: -50_000,
            source: 'allocated',
            method: 'Расход заказа',
            expenses: [{ id: 'x1', title: 'Упаковка', kopecks: -50_000, method: 'Расход заказа' }],
          }),
        ],
      }),
    );
    const [other] = view.amounts;
    expect(other?.tags.map((t) => t.label)).toEqual(['распределено']);
    expect(other?.notes[0]).toBe('Расход заказа');
    expect(other?.notes[1]).toMatch(/^Упаковка: .*500/);
  });

  it('раскрытие — операции с услугой, суммой, датой, id, площадкой и документом', () => {
    const [revenue] = mapAccountingOrderCard(cardResponse()).amounts;
    expect(revenue?.operations).toEqual([
      {
        id: 'op-1',
        title: 'Оплата заказа',
        amountLabel: expect.stringMatching(/^1\s?000/) as unknown as string,
        dayLabel: '05-10-2026',
        marketplaceLabel: 'Яндекс Маркет',
        documentLabel: 'doc-7',
        manual: false,
      },
    ]);
  });

  it('неизвестная не-закупка — «Неизвестно: <строка>», ручная операция помечена', () => {
    const view = mapAccountingOrderCard(
      cardResponse({
        unknown: { key: 'revenue', reason: 'no-lines' },
        amounts: [
          amount({
            kopecks: null,
            source: 'unknown',
            reason: 'no-lines',
            operations: [
              {
                id: 'm1',
                title: 'Корректировка',
                kopecks: 100,
                accruedOn: '2026-10-07',
                marketplace: 'ym',
                documentId: null,
                origin: 'manual',
              },
            ],
          }),
        ],
      }),
    );
    expect(view.netLabel).toBe('Неизвестно');
    expect(view.unknownNote).toBe('Неизвестно: Выручка продавца. Строки заказа ещё не загружены');
    expect(view.amounts[0]?.operations[0]).toMatchObject({ manual: true, documentLabel: '—' });
  });

  it('версии — подписью причины и состояния; campaign_id в виде нет', () => {
    const view = mapAccountingOrderCard(cardResponse());
    expect(view.versions[0]).toMatchObject({
      label: 'Версия 1 · Первый расчёт',
      stateLabel: 'Прогноз',
      netLabel: 'Неизвестно',
    });
    expect(JSON.stringify(view)).not.toMatch(/campaign/i);
    expect(view.subtitle).toBe('Яндекс Маркет от 03-10-2026');
  });
});

describe('метка метода себестоимости (TASK-216)', () => {
  it('метод — с сервера (cogsMethodTitle), не методика распределения costMethod', () => {
    expect(mapAccountingOrderCard(cardResponse()).cogsMethodLabel).toBe(
      'Себестоимость: Закуп из прайса на момент продажи',
    );
    const lots = mapAccountingOrderCard(
      cardResponse({ cogsMethod: 'lot_fifo', cogsMethodTitle: 'Партии закупок (FIFO)' }),
    );
    expect(lots.cogsMethodLabel).toBe('Себестоимость: Партии закупок (FIFO)');
    expect(lots.cogsMethodLabel).not.toContain('Пропорционально');
  });
});

describe('toOrderCostLineRow — режим Б (партии)', () => {
  const base = {
    itemId: '1',
    offerId: 'A1',
    offerName: 'Часы',
    count: 2,
    recordFrom: null,
    reason: null,
  };

  it('штуки из разных партий: сумма за все, партии в пометке, не «Неизвестная закупка»', () => {
    const row = toOrderCostLineRow({
      ...base,
      unitKopecks: null,
      totalKopecks: 330_000,
      portions: [
        { receivedDay: '2026-10-01', units: 1, kopecks: 150_000 },
        { receivedDay: '2026-10-03', units: 1, kopecks: 180_000 },
      ],
    });
    expect(row.unknown).toBe(false);
    expect(row.unitLabel).not.toBe('Неизвестная закупка');
    expect(row.unitLabel).toMatch(/за все$/);
    expect(row.note).toBe('Партии: 01-10-2026 × 1, 03-10-2026 × 1');
  });

  it('нет партии — «Неизвестная закупка» с причиной', () => {
    const row = toOrderCostLineRow({
      ...base,
      unitKopecks: null,
      totalKopecks: null,
      reason: 'no-lot',
    });
    expect(row).toMatchObject({ unknown: true, unitLabel: 'Неизвестная закупка' });
    expect(row.note).toMatch(/^Нет партии закупки/);
  });
});
