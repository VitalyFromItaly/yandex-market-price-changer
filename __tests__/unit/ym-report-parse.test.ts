import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';

import { parseYmReport, parseYmReportSync } from '../../src/modules/finance/ym-report-parse';

const nettingZip = (rows: unknown[]) =>
  Buffer.from(zipSync({ 'transaction_date.json': strToU8(JSON.stringify({ rows })) }));

const servicesZip = Buffer.from(
  zipSync({
    'Размещение товаров.json': strToU8(
      JSON.stringify({
        rows: [
          { actDate: '30.09.2026', servicePrice: 252, totalAmount: 252, orderId: 7, extra: 'x' },
        ],
      }),
    ),
  }),
);

describe('parseYmReport — разбор отчётов ЯМ в воркере', () => {
  // Воркер под vitest поднимается через ts-node — даём ему время на старт.
  const slow = { timeout: 30_000 };

  it('netting: воркер отдаёт те же строки, что разбор в процессе', slow, async () => {
    const zip = nettingZip([{ orderId: 1, transactionSum: 1000 }, null, { orderId: 2 }]);

    const inWorker = await parseYmReport('netting', zip, { worker: true });

    expect(inWorker).toEqual(parseYmReportSync('netting', zip));
    expect(inWorker).toEqual([{ orderId: 1, transactionSum: 1000 }, { orderId: 2 }]);
  });

  it('services: воркер отдаёт выжимку листов картой', slow, async () => {
    const inWorker = await parseYmReport('services', servicesZip, { worker: true });

    expect(inWorker).toBeInstanceOf(Map);
    expect(inWorker).toEqual(parseYmReportSync('services', servicesZip));
    expect(inWorker.get('Размещение товаров')).toEqual({
      rows: [{ actDate: '30.09.2026', servicePrice: 252, totalAmount: 252 }],
    });
  });

  it('ошибка разбора приходит из воркера с русским текстом', slow, async () => {
    await expect(
      parseYmReport('netting', Buffer.from('{"a":1}'), { worker: true }),
    ).rejects.toThrow(/не ZIP/);
    const noSheet = Buffer.from(zipSync({ 'other.json': strToU8('{"rows":[]}') }));
    await expect(parseYmReport('netting', noSheet, { worker: true })).rejects.toThrow(
      /нет листа transaction_date/,
    );
  });

  it('буфер не отсоединяется — ZIP остаётся для сохранения оригинала', slow, async () => {
    const zip = nettingZip([{ orderId: 1 }]);
    const length = zip.byteLength;

    await parseYmReport('netting', zip, { worker: true });

    expect(zip.byteLength).toBe(length);
  });

  it('без флага под ts-node разбор идёт в процессе', async () => {
    const zip = nettingZip([{ orderId: 3 }]);
    expect(await parseYmReport('netting', zip)).toEqual([{ orderId: 3 }]);
  });
});
