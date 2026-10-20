import type {
  IChatCompletionRequest,
  IChatCompletionResult,
} from '../../src/modules/ai/polza.client';
import type { IFinancePeriod } from '../../src/modules/finance/finance-period';
import type { ITestFinanceDb } from '../helpers/test-postgres';

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { FinanceAnomalyRepository } from '../../src/database/postgres/repositories/finance-anomaly.repository';
import { FinanceCorrectionRepository } from '../../src/database/postgres/repositories/finance-correction.repository';
import { FinanceDiscrepancyRepository } from '../../src/database/postgres/repositories/finance-discrepancy.repository';
import { FinanceDocumentRepository } from '../../src/database/postgres/repositories/finance-document.repository';
import { FinanceExpenseRepository } from '../../src/database/postgres/repositories/finance-expense.repository';
import { FinanceOperationRepository } from '../../src/database/postgres/repositories/finance-operation.repository';
import { FinancePeriodRepository } from '../../src/database/postgres/repositories/finance-period.repository';
import { FinanceTaxSettingsRepository } from '../../src/database/postgres/repositories/finance-tax-settings.repository';
import { AiDailyLimitError } from '../../src/modules/ai/ai.errors';
import { AiService } from '../../src/modules/ai/ai.service';
import {
  DIGEST_NO_JOURNAL_TEXT,
  lastFullWeek,
  previousWeek,
  weekLabel,
} from '../../src/modules/ai-analyst/weekly-digest.domain';
import { WeeklyDigestService } from '../../src/modules/ai-analyst/weekly-digest.service';
import { FinanceExpensesService } from '../../src/modules/finance/finance-expenses.service';
import { financePeriodKey, monthPeriod } from '../../src/modules/finance/finance-period';
import { FinanceScreenService } from '../../src/modules/finance/finance-screen.service';
import { FinanceTaxService } from '../../src/modules/finance/finance-tax.service';
import { FinanceService } from '../../src/modules/finance/finance.service';
import { journalKeys, nettingRowToOperation } from '../../src/modules/finance/ym-journal';
import { JOB_TYPES } from '../../src/modules/telegram';
import { FEATURE } from '../../src/modules/telegram/bots/shared/features.domain';
import { TELEGRAM_MESSAGE_LIMIT } from '../../src/modules/telegram/formatting/telegram-format';
import {
  DIGEST_LOG,
  WEEKLY_DIGEST_LOG_KIND,
  WeeklyDigestProcessor,
} from '../../src/modules/telegram/queue/processors/weekly-digest.processor';
import {
  DIGEST_CRON,
  digestJobId,
  parseDigestJobId,
  pickDigestUsers,
} from '../../src/modules/telegram/queue/services/weekly-digest-schedule';
import { WeeklyDigestScheduler } from '../../src/modules/telegram/queue/services/weekly-digest.scheduler';
import { weeklyDigestMessages } from '../../src/modules/telegram/queue/services/weekly-digest.text';
import { MOSCOW_TIME_ZONE } from '../../src/modules/yandex/reports/moscow-day';
import { bullRepeatKey, fakeRepeatableQueue } from '../helpers/fake-repeatable-queue';
import { createTestFinanceDb } from '../helpers/test-postgres';

/**
 * Еженедельная ИИ-сводка (TASK-168): неделя по Москве, получатели, расписание
 * без дублей, факты = P&L «Финансов» той же недели, без журнала и при лимите —
 * модель не зовётся и сообщение не уходит, 403 одного чата не мешает другим.
 */

const SELLER = '333';
const OPEN = { [FEATURE.AI_WEEKLY_DIGEST]: true, [FEATURE.AI]: true, [FEATURE.FINANCE]: true };
/** Понедельник 21.09.2026, 10:00 МСК — прошлая неделя 14–20.09, позапрошлая 07–13.09. */
const MONDAY = new Date('2026-09-21T07:00:00Z');
const WEEK = { from: '2026-09-14', to: '2026-09-20' };

// ── Неделя ─────────────────────────────────────────────────────────────────

describe('lastFullWeek — прошлая неделя пн–вс по Москве', () => {
  it('понедельник 10:00 МСК — прошлая неделя', () => {
    expect(lastFullWeek(MONDAY)).toEqual(WEEK);
    expect(previousWeek(WEEK)).toEqual({ from: '2026-09-07', to: '2026-09-13' });
  });

  it('понедельник 00:30 МСК — это воскресенье по UTC, но неделя уже московская', () => {
    expect(lastFullWeek(new Date('2026-09-20T21:30:00Z'))).toEqual(WEEK);
  });

  it('воскресенье 23:30 МСК — неделя ещё не закрыта, берётся позапрошлая', () => {
    expect(lastFullWeek(new Date('2026-09-20T20:30:00Z'))).toEqual({
      from: '2026-09-07',
      to: '2026-09-13',
    });
  });

  it('неделя через границу месяца и года', () => {
    expect(lastFullWeek(new Date('2026-10-05T07:00:00Z'))).toEqual({
      from: '2026-09-28',
      to: '2026-10-04',
    });
    const newYear = lastFullWeek(new Date('2027-01-04T07:00:00Z'));
    expect(newYear).toEqual({ from: '2026-12-28', to: '2027-01-03' });
    expect(weekLabel(newYear)).toBe('28.12.2026–03.01.2027');
    expect(weekLabel(WEEK)).toBe('14.09–20.09.2026');
  });
});

// ── Получатели и расписание ───────────────────────────────────────────────

describe('pickDigestUsers — кому положена сводка', () => {
  const configured = new Set(['1', '2', '3', '4', '5']);

  it('одобренный + фича (с ai и finance) + магазин; админа в списке нет', () => {
    const picked = pickDigestUsers(
      [
        { telegramUserId: '1', status: 'approved', features: OPEN },
        { telegramUserId: '2', status: 'pending', features: OPEN },
        { telegramUserId: '3', status: 'approved', features: { ...OPEN, [FEATURE.AI]: false } },
        {
          telegramUserId: '4',
          status: 'approved',
          features: { ...OPEN, [FEATURE.FINANCE]: false },
        },
        { telegramUserId: '5', status: 'approved' },
        { telegramUserId: '6', status: 'approved', features: OPEN },
      ],
      configured,
    );
    // 2 — не одобрен, 3/4 — закрыта зависимость, 5 — фича выключена по умолчанию, 6 — без магазина.
    expect([...picked.keys()]).toEqual(['1']);
  });

  it('id задачи — через дефис: двоеточие ломает ключ повторяемой задачи Bull', () => {
    expect(digestJobId('42')).toBe('weeklydigest-42');
    expect(parseDigestJobId('weeklydigest-42')).toBe('42');
    expect(parseDigestJobId('weeklydigestnow-42')).toBeNull();
    expect(parseDigestJobId('notify-42')).toBeNull();
  });
});

describe('WeeklyDigestScheduler — сверка расписания', () => {
  const store = (telegramUserId: string) => ({
    telegramUserId,
    campaign_id: 'c',
    business_id: 'b',
    token: 't',
  });

  function scheduler(initial = [] as ReturnType<typeof bullRepeatKey>[]) {
    const queue = fakeRepeatableQueue(initial, JOB_TYPES.SEND_AI_WEEKLY_DIGEST);
    const accounts = [
      { telegramUserId: '1', status: 'approved', features: OPEN },
      { telegramUserId: '2', status: 'approved', features: {} },
    ];
    const access = {
      list: vi.fn(async () => accounts),
      findByLogin: vi.fn(async (id: string) => accounts.filter((a) => a.telegramUserId === id)),
    };
    const stores = { findByTelegramUsers: vi.fn(async (ids: string[]) => ids.map(store)) };
    const s = new WeeklyDigestScheduler(
      queue as never,
      access as never,
      stores as never,
      {
        report: vi.fn(),
      } as never,
    );
    return { s, queue };
  }

  it('повторная сверка не плодит дубль; лишняя задача снимается, чужая — нет', async () => {
    const stale = bullRepeatKey(
      JOB_TYPES.SEND_AI_WEEKLY_DIGEST,
      digestJobId('2'),
      DIGEST_CRON,
      MOSCOW_TIME_ZONE,
    );
    const foreign = bullRepeatKey('other', 'notify-2', '0 9 * * *', MOSCOW_TIME_ZONE);
    const { s, queue } = scheduler([stale, foreign]);

    expect(await s.reconcile()).toEqual({ added: 1, removed: 1 });
    expect(await s.reconcile()).toEqual({ added: 0, removed: 0 });

    const jobs = await s.jobs();
    expect(jobs).toEqual([
      expect.objectContaining({ telegramUserId: '1', cron: DIGEST_CRON, tz: MOSCOW_TIME_ZONE }),
    ]);
    expect(queue.add).toHaveBeenCalledTimes(1);
    const [, payload, options] = queue.add.mock.calls[0];
    // В payload — только продавец и вид запуска: токена нет.
    expect(payload).toEqual({ telegramUserId: '1', scheduled: true });
    expect(options).toMatchObject({
      jobId: 'weeklydigest-1',
      repeat: { cron: '0 10 * * 1', tz: 'Europe/Moscow' },
    });
  });

  it('featuresFor — фичи продавца с открытой сводкой, иначе null', async () => {
    const { s } = scheduler();
    expect(await s.featuresFor('1')).toEqual(OPEN);
    expect(await s.featuresFor('2')).toBeNull();
  });
});

// ── Факты = «Финансы» ─────────────────────────────────────────────────────

const row = (over: Record<string, unknown> = {}) => ({
  orderId: 1,
  shopSku: 'A1',
  offerOrServiceName: 'Часы',
  transactionType: 'Начисление',
  transactionSource: 'Платёж покупателя',
  transactionDate: '16.09.2026 14:05',
  actId: null,
  count: 2,
  transactionSum: 5000,
  paymentStatus: 'Переведён',
  bankOrderId: 'P1',
  bankOrderDate: '20.09.2026',
  bankSum: 5000,
  ...over,
});

const commission = (orderId: number, sum: number, date: string) =>
  row({
    orderId,
    transactionType: 'Удержание',
    transactionSource: 'Оплата услуг Маркета',
    offerOrServiceName: 'Размещение товарных предложений',
    transactionSum: sum,
    transactionDate: date,
    count: null,
    paymentStatus: null,
    bankOrderId: null,
    bankOrderDate: null,
    bankSum: null,
  });

const RESULT: IChatCompletionResult = {
  content: '',
  toolCalls: [],
  finishReason: 'stop',
  usage: {
    promptTokens: 10,
    completionTokens: 5,
    totalTokens: 15,
    cachedTokens: 0,
    reasoningTokens: 0,
    costRub: 0.01,
  },
  model: 'm',
  provider: 'p',
  traceId: 't',
};

let pg: ITestFinanceDb;
let operations: FinanceOperationRepository;
let documents: FinanceDocumentRepository;
let periods: FinancePeriodRepository;
let finance: FinanceService;
let screen: FinanceScreenService;

beforeAll(async () => {
  pg = await createTestFinanceDb();
  operations = new FinanceOperationRepository(pg.db);
  documents = new FinanceDocumentRepository(pg.db);
  periods = new FinancePeriodRepository(pg.db);
  finance = new FinanceService(
    operations,
    periods,
    new FinanceTaxService(new FinanceTaxSettingsRepository(pg.db)),
    new FinanceExpensesService(new FinanceExpenseRepository(pg.db)),
    { findByTelegramUser: async () => null } as never,
    {
      // A1 — закуп 1 500 ₽ (прибыльный), B1 — 4 000 ₽ при продаже за 3 000 ₽ (убыточный).
      findBySkus: async () =>
        new Map([
          ['A1', { price: 1500 }],
          ['B1', { price: 4000 }],
        ]),
    } as never,
    { findForSkus: async () => new Map() } as never,
    { build: vi.fn() } as never,
    { report: vi.fn() } as never,
  );
  screen = new FinanceScreenService(
    operations,
    documents,
    periods,
    new FinanceDiscrepancyRepository(pg.db),
    new FinanceCorrectionRepository(pg.db),
    new FinanceAnomalyRepository(pg.db),
  );
}, 60_000);

afterAll(async () => {
  await pg?.close();
});

async function seed(rows: Record<string, unknown>[], period: IFinancePeriod) {
  const { document } = await documents.registerVersion({
    marketplace: 'ym',
    telegramUserId: SELLER,
    businessId: 'b1',
    reportType: 'united-netting',
    periodFrom: period.from,
    periodTo: period.to,
    buffer: Buffer.from(JSON.stringify(rows)),
    filename: 'netting.zip',
    contentType: 'application/zip',
  });
  const keys = journalKeys(rows);
  const periodKey = financePeriodKey('united-netting', period);
  await operations.upsertMany(
    rows.map((r, i) =>
      nettingRowToOperation(r, keys[i], {
        telegramUserId: SELLER,
        businessId: 'b1',
        documentId: document.id,
        documentVersion: document.version,
        periodKey,
      }),
    ),
  );
  await periods.upsert({
    marketplace: 'ym',
    telegramUserId: SELLER,
    reportType: 'united-netting',
    periodKey,
    periodFrom: period.from,
    periodTo: period.to,
    checkedAt: new Date(),
    status: 'verified',
    lastOutcome: 'imported',
    documentVersion: document.version,
    unknownCount: 0,
    changedCount: 0,
    removedCount: 0,
    discrepancyCount: 0,
    reconcileState: 'checked',
    reconcileNote: null,
    error: null,
  });
}

/** Сентябрь: позапрошлая неделя (09.09) и прошлая (16.09) с убыточным B1. */
async function seedSeptember() {
  await seed(
    [
      row({ transactionDate: '09.09.2026 14:05', bankOrderId: 'P0' }),
      commission(1, -500, '09.09.2026 14:05'),
      row({ orderId: 2 }),
      commission(2, -2000, '16.09.2026 14:05'),
      row({
        orderId: 3,
        shopSku: 'B1',
        count: 1,
        transactionSum: 3000,
        bankOrderId: 'P2',
        bankSum: 3000,
      }),
    ],
    monthPeriod(2026, 9),
  );
}

function digestService(spent = 0) {
  const chatCompletion = vi.fn();
  const usage = { record: vi.fn(), spentRubSince: vi.fn().mockResolvedValue(spent) };
  const config = {
    polzaAiEnabled: true,
    polzaAiModel: 'm',
    polzaAiModelFor: () => 'm',
    aiUserDailyLimitRub: 50,
  };
  const ai = new AiService(
    { chatCompletion } as never,
    usage as never,
    config as never,
    {
      report: vi.fn(),
    } as never,
  );
  const products = {
    findByYmSkus: async () => [{ marketplaceSkus: { ym: 'B1' }, name: 'Часы B1' }],
  };
  return {
    service: new WeeklyDigestService(ai, finance, screen, products as never),
    chatCompletion,
    usage,
  };
}

function factsOf(request: IChatCompletionRequest): any[] {
  const content = request.messages[1].content as string;
  return JSON.parse(content.slice(content.indexOf('\n') + 1));
}

describe('WeeklyDigestService — факты из журнала', { timeout: 60_000 }, () => {
  beforeEach(async () => {
    await pg.reset();
  });

  it('числа сводки = FinanceService.build за ту же неделю до копейки, сдвиг — к позапрошлой', async () => {
    await seedSeptember();
    const { service, chatCompletion, usage } = digestService();
    let totals: any;
    let blocks: any[] = [];
    chatCompletion.mockImplementationOnce(async (request: IChatCompletionRequest) => {
      blocks = factsOf(request);
      totals = blocks.find((b) => b.block === 'digest:totals').data;
      expect(request.tools).toBeUndefined();
      return {
        ...RESULT,
        content: `Выручка ${totals.levels.revenue.current.rub} ₽, чистая ${totals.levels.net.current.rub} ₽.`,
      };
    });

    const result = await service.build({ telegramUserId: SELLER, aiAllowed: true }, MONDAY);

    const pnl = (await finance.build(SELLER, WEEK, MONDAY, { flat: false })).pnl;
    const before = (await finance.build(SELLER, previousWeek(WEEK), MONDAY, { flat: false })).pnl;
    expect(totals.week).toEqual(WEEK);
    expect(totals.levels.revenue.current.kopecks).toBe(pnl.revenueKopecks);
    expect(totals.levels.net.current.kopecks).toBe(pnl.netKopecks);
    expect(totals.levels.cogs.current.kopecks).toBe(pnl.cogs.kopecks);
    expect(totals.levels.marketplaceExpenses.current.kopecks).toBe(pnl.marketplaceKopecks);
    expect(totals.levels.revenue.previous.kopecks).toBe(before.revenueKopecks);
    expect(totals.levels.revenue.change.kopecks).toBe(pnl.revenueKopecks - before.revenueKopecks);
    // Убыточный B1 — в фактах с именем.
    const loss = blocks.find((b) => b.block === 'getSkuEconomics');
    expect(loss.data).toMatchObject({ sku: 'B1', name: 'Часы B1' });

    expect(result.kind).toBe('ready');
    if (result.kind !== 'ready') return;
    expect(result.verification.verified).toBe(true);
    // purpose — свой; в AiUsage нет текста промпта и ответа.
    expect(usage.record).toHaveBeenCalledTimes(1);
    const usageRow = usage.record.mock.calls[0][0];
    expect(usageRow.purpose).toBe('weekly-digest');
    const stored = JSON.stringify(usageRow);
    expect(stored).not.toContain('Выручка');
    expect(stored).not.toContain('Факты');
  });

  it('выдуманное число помечается в сообщении, а не прячется', async () => {
    await seedSeptember();
    const { service, chatCompletion } = digestService();
    chatCompletion.mockResolvedValueOnce({ ...RESULT, content: 'Выручка выросла на 987 654 ₽.' });
    const result = await service.build({ telegramUserId: SELLER, aiAllowed: true }, MONDAY);
    if (result.kind !== 'ready') throw new Error('ожидалась сводка');
    expect(result.verification.unconfirmed).toEqual(['987 654']);
    const text = weeklyDigestMessages(
      result.week,
      result.answer,
      result.verification,
      result.gaps,
    ).join('\n');
    expect(text).toContain('Не подтверждены данными: 987 654');
  });

  it('нет журнала за неделю — модель не зовётся, строк AiUsage нет', async () => {
    const { service, chatCompletion, usage } = digestService();
    const result = await service.build({ telegramUserId: SELLER, aiAllowed: true }, MONDAY);
    expect(result).toEqual({ kind: 'skipped', week: WEEK, reason: DIGEST_NO_JOURNAL_TEXT });
    expect(chatCompletion).not.toHaveBeenCalled();
    expect(usage.record).not.toHaveBeenCalled();
  });

  it('журнал загружен за один месяц недели из двух — тоже пропуск', async () => {
    await seedSeptember();
    const { service, chatCompletion } = digestService();
    // Неделя 28.09–04.10: октября нет — неполная неделя выглядела бы падением.
    const result = await service.build(
      { telegramUserId: SELLER, aiAllowed: true },
      new Date('2026-10-05T07:00:00Z'),
    );
    expect(result).toMatchObject({ kind: 'skipped', reason: DIGEST_NO_JOURNAL_TEXT });
    expect(chatCompletion).not.toHaveBeenCalled();
  });

  it('дневной лимит исчерпан — AiDailyLimitError, до Polza не идёт', async () => {
    await seedSeptember();
    const { service, chatCompletion } = digestService(50);
    await expect(
      service.build({ telegramUserId: SELLER, aiAllowed: true }, MONDAY),
    ).rejects.toBeInstanceOf(AiDailyLimitError);
    expect(chatCompletion).not.toHaveBeenCalled();
  });
});

// ── Процессор: доставка и журнал ──────────────────────────────────────────

describe('WeeklyDigestProcessor — доставка', () => {
  const READY = {
    kind: 'ready' as const,
    week: WEEK,
    answer: 'Выручка 15 000 ₽ <b>',
    verification: { verified: true, unconfirmed: [] },
    gaps: [],
  };

  function processor(opts: {
    features?: Record<string, boolean> | null;
    build?: () => Promise<unknown>;
    admins?: number[];
    chats?: { botId: string; telegramChatId: string; status: string }[];
  }) {
    const sent: { bot: string; chat: string; text: string }[] = [];
    const botOf = (telegramId: number, fail = false) => ({
      telegramId,
      telegraf: {
        telegram: {
          sendMessage: vi.fn(async (chat: string, text: string) => {
            if (fail)
              throw Object.assign(new Error('403: bot was blocked by the user'), { code: 403 });
            sent.push({ bot: String(telegramId), chat, text });
          }),
        },
      },
    });
    const bots = new Map([
      ['10', botOf(10, true)],
      ['20', botOf(20)],
    ]);
    const scheduler = {
      featuresFor: vi.fn(async () => (opts.features === undefined ? OPEN : opts.features)),
      refresh: vi.fn(),
    };
    const digest = { build: vi.fn(opts.build ?? (async () => READY)) };
    const chats = opts.chats ?? [
      { botId: '10', telegramChatId: '1001', status: 'approved' },
      { botId: '20', telegramChatId: '2001', status: 'approved' },
    ];
    const access = { findByLogin: vi.fn(async () => chats) };
    const registry = {
      findByTelegramId: (id: string) => bots.get(String(id)) ?? null,
      first: () => bots.get('20'),
    };
    const actionLog = { record: vi.fn(async () => undefined) };
    const errors = { report: vi.fn() };
    const p = new WeeklyDigestProcessor(
      scheduler as never,
      digest as never,
      access as never,
      registry as never,
      actionLog as never,
      { telegramAdminIds: opts.admins ?? [] } as never,
      errors as never,
    );
    return { p, sent, digest, actionLog, errors, scheduler };
  }

  const job = (data: object) => ({ data }) as never;

  it('403 в одном чате не мешает другому и не будит админов; журнал — счётчики без текста', async () => {
    const { p, sent, actionLog, errors } = processor({});
    expect(await p.handle(job({ telegramUserId: SELLER, scheduled: true }))).toEqual({ sent: 1 });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ bot: '20', chat: '2001' });
    // Ответ модели экранирован — разметку модели Telegram не доверяем.
    expect(sent[0].text).toContain('Выручка 15 000 ₽ &lt;b&gt;');
    expect(errors.report).not.toHaveBeenCalled();
    expect(actionLog.record).toHaveBeenCalledTimes(1);
    const entry = actionLog.record.mock.calls[0][0];
    expect(entry).toMatchObject({
      telegramUserId: SELLER,
      kind: WEEKLY_DIGEST_LOG_KIND,
      action: DIGEST_LOG.sent(1, 2),
    });
    expect(JSON.stringify(entry)).not.toContain('Выручка');
  });

  it('длинная сводка режется по лимиту Telegram', async () => {
    const long = Array.from({ length: 400 }, (_, i) => `Строка ${i} ${'x'.repeat(20)}`).join('\n');
    const { p, sent } = processor({
      build: async () => ({ ...READY, answer: long }),
      chats: [{ botId: '20', telegramChatId: '2001', status: 'approved' }],
    });
    await p.handle(job({ telegramUserId: SELLER, scheduled: true }));
    expect(sent.length).toBeGreaterThan(1);
    for (const message of sent)
      expect(message.text.length).toBeLessThanOrEqual(TELEGRAM_MESSAGE_LIMIT);
  });

  it('нет журнала — сообщения нет, строка журнала «пропущено: нет данных»', async () => {
    const { p, sent, actionLog } = processor({
      build: async () => ({ kind: 'skipped', week: WEEK, reason: DIGEST_NO_JOURNAL_TEXT }),
    });
    expect(await p.handle(job({ telegramUserId: SELLER, scheduled: true }))).toEqual({
      skipped: 'no-journal',
      sent: 0,
    });
    expect(sent).toHaveLength(0);
    expect(actionLog.record.mock.calls[0][0].action).toBe(DIGEST_LOG.noJournal);
  });

  it('лимит ИИ исчерпан — сводка пропущена с причиной в журнале, задача не падает', async () => {
    const { p, sent, actionLog, errors } = processor({
      build: async () => {
        throw new AiDailyLimitError(50, 50);
      },
    });
    expect(await p.handle(job({ telegramUserId: SELLER, scheduled: true }))).toEqual({
      skipped: 'ai-limit',
      sent: 0,
    });
    expect(sent).toHaveLength(0);
    expect(actionLog.record.mock.calls[0][0].action).toBe(DIGEST_LOG.limit);
    expect(errors.report).not.toHaveBeenCalled();
  });

  it('фича закрыта — сервис не зовётся, расписание пересверяется', async () => {
    const { p, digest, scheduler } = processor({ features: null });
    expect(await p.handle(job({ telegramUserId: SELLER, scheduled: true }))).toEqual({
      skipped: 'not-eligible',
      sent: 0,
    });
    expect(digest.build).not.toHaveBeenCalled();
    expect(scheduler.refresh).toHaveBeenCalled();
  });

  it('админ по кнопке — со всеми фичами, в личку первого бота; по расписанию — нет', async () => {
    const admin = processor({ features: null, admins: [777], chats: [] });
    expect(await admin.p.handle(job({ telegramUserId: '777', manual: true }))).toEqual({ sent: 1 });
    expect(admin.sent[0]).toMatchObject({ bot: '20', chat: '777' });
    expect(admin.digest.build).toHaveBeenCalledWith({ telegramUserId: '777', aiAllowed: true });

    const scheduled = processor({ features: null, admins: [777], chats: [] });
    expect(await scheduled.p.handle(job({ telegramUserId: '777', scheduled: true }))).toMatchObject(
      {
        skipped: 'not-eligible',
      },
    );
    expect(scheduled.digest.build).not.toHaveBeenCalled();
  });
});
