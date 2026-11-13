import type { INestApplication } from '@nestjs/common';
import type {
  IAccountingReconcileInput,
  IAccountingReconcileOperation,
  IAccountingReconcileResult,
  TReconcileLine,
} from '../../src/modules/accounting/accounting-reconcile.domain';

import { Global, Module } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { AppConfigService } from '../../src/config/app-config.service';
import { DatabaseModule } from '../../src/database/database.module';
import { AccountingCostHistoryService } from '../../src/modules/accounting/accounting-cost-history.service';
import { AccountingTaxSettingsService } from '../../src/modules/accounting/accounting-tax-settings.service';
import { AccountingCostSettingsService } from '../../src/modules/accounting/accounting-cost-settings.service';
import { AccountingLotCostService } from '../../src/modules/accounting/accounting-lot-cost.service';
import { AccountingManualOperationRepository } from '../../src/database/postgres/repositories/accounting-manual-operation.repository';
import { FinanceActServicesRepository } from '../../src/database/postgres/repositories/finance-act-services.repository';
import { FinanceDocumentRepository } from '../../src/database/postgres/repositories/finance-document.repository';
import { FinanceOperationRepository } from '../../src/database/postgres/repositories/finance-operation.repository';
import { FinanceOzonBalanceRepository } from '../../src/database/postgres/repositories/finance-ozon-balance.repository';
import { FinanceSyncRunRepository } from '../../src/database/postgres/repositories/finance-sync-run.repository';
import { ActionLog } from '../../src/database/schemas/action-log.schema';
import { AdminCredential } from '../../src/database/schemas/admin-credential.schema';
import { CrmCredential } from '../../src/database/schemas/crm-credential.schema';
import { MarketplaceConnection } from '../../src/database/schemas/marketplace-connection.schema';
import { UserAccess } from '../../src/database/schemas/user-access.schema';
import { YandexMarket } from '../../src/database/schemas/yandex-market.schema';
import { ActionLogService } from '../../src/database/services/action-log.service';
import { AdminCredentialService } from '../../src/database/services/admin-credential.service';
import { CrmCredentialService } from '../../src/database/services/crm-credential.service';
import { MarketplaceConnectionService } from '../../src/database/services/marketplace-connection.service';
import { PurchasePriceService } from '../../src/database/services/purchase-price.service';
import { UserAccessService } from '../../src/database/services/user-access.service';
import { YandexMarketService } from '../../src/database/services/yandex-market.service';
import { AccountingManualOperationsService } from '../../src/modules/accounting/accounting-manual-operations.service';
import {
  orderReconcileStateOf,
  reconcileV2,
} from '../../src/modules/accounting/accounting-reconcile.domain';
import {
  AccountingReconcileService,
  parseReconcileMonth,
} from '../../src/modules/accounting/accounting-reconcile.service';
import { AccountingService } from '../../src/modules/accounting/accounting.service';
import { ProductCatalogService } from '../../src/modules/products/product-catalog.service';
import { CrmAccountingController } from '../../src/modules/crm/accounting/crm-accounting.controller';
import {
  INVALID_RECONCILE_MARKETPLACE,
  INVALID_RECONCILE_MONTH,
  RECONCILE_MARKETPLACE_UNAVAILABLE,
} from '../../src/modules/crm/accounting/crm-accounting.domain';
import { FEATURE_DISABLED } from '../../src/modules/crm/crm-features.domain';
import { CrmModule } from '../../src/modules/crm/crm.module';
import { journalKeys, nettingRowToOperation } from '../../src/modules/finance/ym-journal';
import { FEATURE } from '../../src/modules/telegram/bots/shared/features.domain';
import { WbFinanceService } from '../../src/modules/wb/wb-finance.service';
import { inMemoryModel } from '../helpers/in-memory-model';
import { createTestFinanceDb, type ITestFinanceDb } from '../helpers/test-postgres';

/**
 * Сверка v2 «Финучёта» (TASK-226): статьи реестра против акта с отчётом услуг
 * и платёжных поручений, разница — до операций-кандидатов.
 */

const SEPTEMBER = { from: '2026-09-01', to: '2026-09-30' };
const NOW = new Date('2026-11-08T09:00:00Z');

let seq = 0;
const op = (over: Partial<IAccountingReconcileOperation> = {}): IAccountingReconcileOperation => ({
  id: `op-${String(++seq).padStart(3, '0')}`,
  source: 'journal',
  orderId: '1',
  article: 'sales',
  subArticle: null,
  amountKopecks: 0,
  accruedOn: '2026-09-10',
  actDay: null,
  bankOrderId: 'B1',
  bankSumKopecks: 92_000,
  paidOn: '2026-09-20',
  serviceName: null,
  ...over,
});

/** Месяц, который сходится: продажа, комиссия и доставка по акту 30.09, одно поручение. */
function balanced(): IAccountingReconcileOperation[] {
  seq = 0;
  return [
    op({ article: 'sales', subArticle: 'sale', amountKopecks: 100_000 }),
    op({
      article: 'commission',
      subArticle: 'commission',
      amountKopecks: -5_000,
      actDay: '2026-09-30',
      serviceName: 'Размещение товарных предложений',
    }),
    op({
      article: 'delivery_to_buyer',
      subArticle: 'delivery',
      amountKopecks: -3_000,
      actDay: '2026-09-30',
      serviceName: 'Доставка покупателю',
    }),
  ];
}

const input = (over: Partial<IAccountingReconcileInput> = {}): IAccountingReconcileInput => ({
  period: SEPTEMBER,
  operations: balanced(),
  acts: [
    { actDay: '2026-09-30', totalKopecks: 8_000, sheets: { placement: 5_000, delivery: 3_000 } },
  ],
  closed: true,
  loaded: { month: true, prev: true, next: true },
  dataAsOf: new Date('2026-11-08T06:00:00Z'),
  now: NOW,
  ...over,
});

const lineOf = (result: IAccountingReconcileResult, line: TReconcileLine) => {
  const found = result.lines.find((l) => l.line === line);
  if (!found) throw new Error(`нет статьи ${line}`);
  return found;
};

describe('reconcileV2 — правила', () => {
  it('всё, у чего документ есть, сошлось → «сверено», статьи без документа помечены', () => {
    const result = reconcileV2(input());
    expect(result.status).toBe('reconciled');
    expect(result.partial).toBe(true);
    expect(lineOf(result, 'commission')).toMatchObject({
      registryKopecks: -5_000,
      documentKopecks: -5_000,
      differenceKopecks: 0,
      status: 'matched',
    });
    expect(lineOf(result, 'logistics').status).toBe('matched');
    expect(lineOf(result, 'payouts')).toMatchObject({
      registryKopecks: 92_000,
      documentKopecks: 92_000,
      status: 'matched',
    });
    for (const line of ['sales', 'returns', 'compensations', 'accrual_total', 'balance'] as const) {
      expect(lineOf(result, line).status).toBe('no_document');
      expect(lineOf(result, line).documentKopecks).toBeNull();
      expect(lineOf(result, line).reason).toBeTruthy();
    }
    expect(lineOf(result, 'sales').registryKopecks).toBe(100_000);
    expect(lineOf(result, 'accrual_total').registryKopecks).toBe(92_000);
    expect(lineOf(result, 'balance').registryKopecks).toBe(0);
    expect(result.acts).toEqual([
      expect.objectContaining({ actDay: '2026-09-30', registryKopecks: 8_000, status: 'matched' }),
    ]);
    expect(result.reconciledAt).toBe(NOW.toISOString());
    expect(result.dataAsOf).toBe('2026-11-08T06:00:00.000Z');
    expect(orderReconcileStateOf(result, '1')).toBe('reconciled');
  });

  it('внесённое расхождение 150 ₽ — сверка находит операцию', () => {
    const operations = [
      ...balanced(),
      op({
        id: 'op-extra',
        orderId: '2',
        article: 'commission',
        subArticle: 'commission',
        amountKopecks: -15_000,
        actDay: '2026-09-30',
        bankOrderId: null,
        bankSumKopecks: null,
        paidOn: null,
        serviceName: 'Размещение товарных предложений',
      }),
    ];
    const result = reconcileV2(input({ operations }));
    expect(result.status).toBe('discrepancies');
    const commission = lineOf(result, 'commission');
    expect(commission).toMatchObject({ status: 'mismatch', differenceKopecks: -15_000 });
    expect(commission.candidates.items[0]).toMatchObject({
      operationId: 'op-extra',
      reason: 'no_pair',
      matchesDifference: true,
      orderId: '2',
    });
    expect(result.acts[0]).toMatchObject({ status: 'mismatch', differenceKopecks: 15_000 });
    expect(orderReconcileStateOf(result, '2')).toBe('discrepancy');
    expect(orderReconcileStateOf(result, '1')).toBe('reconciled');
  });

  it('дубль строки — кандидат «Дубль»', () => {
    const operations = balanced();
    const copy = { ...operations[1], id: 'op-dup' };
    const result = reconcileV2(input({ operations: [...operations, copy] }));
    const commission = lineOf(result, 'commission');
    expect(commission.status).toBe('mismatch');
    expect(commission.candidates.items.map((c) => [c.operationId, c.reason])).toContainEqual([
      'op-dup',
      'duplicate',
    ]);
  });

  it('строка месяца без акта, а отчёт услуг её знает, — «Другая дата»', () => {
    const operations = [
      ...balanced(),
      op({
        id: 'op-late',
        article: 'commission',
        amountKopecks: -1_500,
        actDay: null,
        bankOrderId: null,
        bankSumKopecks: null,
        paidOn: null,
      }),
    ];
    const acts = [
      { actDay: '2026-09-30', totalKopecks: 9_500, sheets: { placement: 6_500, delivery: 3_000 } },
    ];
    const commission = lineOf(reconcileV2(input({ operations, acts })), 'commission');
    expect(commission).toMatchObject({ status: 'mismatch', differenceKopecks: 1_500 });
    expect(commission.candidates.items[0]).toMatchObject({
      operationId: 'op-late',
      reason: 'other_date',
      matchesDifference: true,
    });
  });

  it('ручная операция входит в сумму статьи с пометкой и без пары в документе; без заказа — уровень магазина', () => {
    const operations = [
      ...balanced(),
      op({
        id: 'manual-1',
        source: 'manual',
        orderId: null,
        article: 'commission',
        amountKopecks: -700,
        bankOrderId: null,
        bankSumKopecks: null,
        paidOn: null,
      }),
    ];
    const result = reconcileV2(input({ operations }));
    const commission = lineOf(result, 'commission');
    expect(commission).toMatchObject({ registryKopecks: -5_700, manualKopecks: -700 });
    expect(commission.candidates.items).toEqual([
      expect.objectContaining({ operationId: 'manual-1', source: 'manual', reason: 'no_pair' }),
    ]);
    expect(result.storeLevel.items.map((r) => r.operationId)).toEqual(['manual-1']);
    expect(result.unmatchedCount).toBe(1);
  });

  it('сводная строка акта без заказа — по частям в статьи и в список уровня магазина', () => {
    const operations = [
      ...balanced(),
      op({
        id: 'summary',
        orderId: null,
        article: 'other_services',
        subArticle: 'act_summary',
        amountKopecks: -4_000,
        actDay: '2026-09-30',
        bankOrderId: null,
        bankSumKopecks: null,
        paidOn: null,
        breakdown: [
          { article: 'subscription', kopecks: -2_500, sheet: 'business_subscription' },
          { article: 'storage', kopecks: -1_500, sheet: 'storage_of_returns' },
        ],
      }),
    ];
    const acts = [
      {
        actDay: '2026-09-30',
        totalKopecks: 12_000,
        sheets: {
          placement: 5_000,
          delivery: 3_000,
          business_subscription: 2_500,
          storage_of_returns: 1_500,
        },
      },
    ];
    const result = reconcileV2(input({ operations, acts }));
    expect(result.status).toBe('reconciled');
    expect(lineOf(result, 'other_services').registryKopecks).toBe(-2_500);
    expect(lineOf(result, 'logistics').registryKopecks).toBe(-4_500);
    expect(result.storeLevel).toMatchObject({ count: 1, totalKopecks: -4_000 });
  });

  it('сумма поручения не сошлась — кандидаты поручения, выплаты «расхождение»', () => {
    const operations = balanced().map((o) => ({ ...o, bankSumKopecks: 91_000 }));
    const result = reconcileV2(input({ operations }));
    expect(result.paymentOrders).toEqual([
      expect.objectContaining({ bankOrderId: 'B1', differenceKopecks: 1_000, status: 'mismatch' }),
    ]);
    expect(lineOf(result, 'payouts').status).toBe('mismatch');
    expect(result.status).toBe('discrepancies');
  });

  it('лист отчёта вне карты — статьи акта «недостаточно данных», итог акта сравнивается', () => {
    const acts = [
      { actDay: '2026-09-30', totalKopecks: 8_000, sheets: { placement: 5_000, mystery: 3_000 } },
    ];
    const result = reconcileV2(input({ acts }));
    expect(lineOf(result, 'commission')).toMatchObject({ status: 'no_document' });
    expect(lineOf(result, 'commission').reason).toContain('mystery');
    expect(result.acts[0]).toMatchObject({ status: 'matched', unknownSheets: ['mystery'] });
  });

  it('открытый месяц или незагруженный сосед — «недостаточно данных» с причиной', () => {
    const open = reconcileV2(input({ closed: false }));
    expect(open.status).toBe('insufficient_data');
    expect(open.notes.join(' ')).toContain('не закончился');
    expect(orderReconcileStateOf(open, '1')).toBe('unknown');

    const noNext = reconcileV2(input({ loaded: { month: true, prev: true, next: false } }));
    expect(noNext.status).toBe('insufficient_data');
    expect(noNext.notes.join(' ')).toContain('соседнего');
  });

  it('ЯМ: у выплат есть документ — правило «ноль документов» ЯМ не задевает', () => {
    const result = reconcileV2(input({ acts: [] }));
    expect(result.marketplace).toBe('ym');
    expect(lineOf(result, 'payouts').status).toBe('matched');
    expect(result.notes).toEqual([]);
  });

  it('месяц ГГГГ-ММ', () => {
    expect(parseReconcileMonth('2026-09')).toEqual(SEPTEMBER);
    expect(parseReconcileMonth('09-2026')).toBeNull();
    expect(parseReconcileMonth('2026-13')).toBeNull();
    expect(parseReconcileMonth(undefined)).toBeNull();
  });
});

// ─── Ozon и WB (TASK-227) ──────────────────────────────────────────────────

/** Месяц Ozon: продажа 1000 ₽, комиссия −50, доставка −30; ни поручений, ни актов. */
function ozonMonth(): IAccountingReconcileOperation[] {
  return balanced().map((o) => ({
    ...o,
    actDay: null,
    bankOrderId: null,
    bankSumKopecks: null,
    paidOn: '2026-09-25',
  }));
}

const ozonInput = (over: Partial<IAccountingReconcileInput> = {}) =>
  input({
    marketplace: 'ozon',
    operations: ozonMonth(),
    acts: [],
    // Ozon должен 100 ₽ на 1.09, начислил 920, выплатил 500 → 520 на конец.
    balance: {
      openingKopecks: 10_000,
      accruedKopecks: 92_000,
      paymentsKopecks: 50_000,
      closingKopecks: 52_000,
    },
    ...over,
  });

describe('reconcileV2 — Ozon по сальдо месяца', () => {
  it('начисления и остаток сходятся с сальдо — «сверено», выплаты без документа', () => {
    const result = reconcileV2(ozonInput());
    expect(result.marketplace).toBe('ozon');
    expect(result.status).toBe('reconciled');
    expect(result.partial).toBe(true);
    expect(lineOf(result, 'accrual_total')).toMatchObject({
      document: 'ozon_balance',
      registryKopecks: 92_000,
      documentKopecks: 92_000,
      status: 'matched',
    });
    expect(lineOf(result, 'balance')).toMatchObject({
      document: 'ozon_balance',
      registryKopecks: 52_000,
      documentKopecks: 52_000,
      status: 'matched',
    });
    // FIFO-выплата сверялась бы сама с собой — честно без документа.
    const payouts = lineOf(result, 'payouts');
    expect(payouts).toMatchObject({
      document: null,
      status: 'no_document',
      registryKopecks: 92_000,
    });
    expect(payouts.reason).toContain('сверять с собой');
    // Актов у Ozon нет — статьи акта по дню начисления, без документа.
    expect(lineOf(result, 'commission')).toMatchObject({
      document: null,
      basis: 'accrued_in_month',
      status: 'no_document',
    });
    expect(lineOf(result, 'commission').reason).toContain('Ozon');
    expect(result.acts).toEqual([]);
    expect(result.paymentOrders).toEqual([]);
    // Соседи нужны только строкам поручений и актов ЯМ.
    const noNext = reconcileV2(ozonInput({ loaded: { month: true, prev: false, next: false } }));
    expect(noNext.status).toBe('reconciled');
  });

  it('лишнее хранение 1,50 ₽ — расхождение начислений и остатка, найдена операция', () => {
    const operations = [
      ...ozonMonth(),
      op({
        orderId: '7',
        article: 'storage',
        amountKopecks: -150,
        actDay: null,
        bankOrderId: null,
      }),
    ];
    const result = reconcileV2(ozonInput({ operations }));
    expect(result.status).toBe('discrepancies');
    const total = lineOf(result, 'accrual_total');
    expect(total).toMatchObject({ differenceKopecks: -150, status: 'mismatch' });
    expect(total.candidates.items[0]).toMatchObject({ orderId: '7', matchesDifference: true });
    expect(lineOf(result, 'balance')).toMatchObject({
      differenceKopecks: -150,
      status: 'mismatch',
    });
    expect(result.discrepantOrderIds).toEqual(['7']);
    expect(orderReconcileStateOf(result, '7')).toBe('discrepancy');
  });

  it('сальдо не загружено — документа нет ни у одной статьи → «недостаточно данных»', () => {
    const result = reconcileV2(ozonInput({ balance: null }));
    expect(result.status).toBe('insufficient_data');
    expect(lineOf(result, 'accrual_total').reason).toContain('не загружено');
    expect(lineOf(result, 'balance')).toMatchObject({
      status: 'no_document',
      documentKopecks: null,
    });
    expect(result.notes.join(' ')).toContain('У Ozon нет документа для сверки');
  });

  it('Ozon не отдал начисления — у итога нет документа, остаток сверяется', () => {
    const result = reconcileV2(
      ozonInput({
        balance: {
          openingKopecks: 10_000,
          accruedKopecks: null,
          paymentsKopecks: 50_000,
          closingKopecks: 52_000,
        },
      }),
    );
    expect(lineOf(result, 'accrual_total').reason).toContain('не отдал начисления');
    expect(lineOf(result, 'balance').status).toBe('matched');
    expect(result.status).toBe('reconciled');
  });

  it('открытый месяц Ozon — «недостаточно данных», «документы Ozon»', () => {
    const result = reconcileV2(ozonInput({ closed: false, balance: null }));
    expect(result.status).toBe('insufficient_data');
    expect(result.notes[0]).toBe('Месяц ещё не закончился — документы Ozon за него не готовы');
  });
});

describe('reconcileV2 — WB без независимого документа', () => {
  /** Строки отчёта реализации: «сумма поручения» — Σ тех же строк (wbPayoutByReport). */
  const wbMonth = () => [
    ...balanced().map((o) => ({ ...o, actDay: null, bankOrderId: 'R1', bankSumKopecks: 92_000 })),
    // Справочная реклама из файла «Продвижение» (TASK-209) — не деньги, мимо статей.
    op({ article: 'promotion_report', amountKopecks: -99_900, bankOrderId: null, paidOn: null }),
  ];

  it('все статьи без документа, поручения не «сверено», итог — «недостаточно данных»', () => {
    const result = reconcileV2(
      input({
        marketplace: 'wb',
        operations: wbMonth(),
        acts: [],
        loaded: { month: true, prev: false, next: false },
      }),
    );
    expect(result.marketplace).toBe('wb');
    expect(result.lines.every((l) => l.status === 'no_document')).toBe(true);
    expect(result.lines.every((l) => l.document === null)).toBe(true);
    expect(result.paymentOrders).toEqual([]);
    const payouts = lineOf(result, 'payouts');
    expect(payouts.registryKopecks).toBe(92_000);
    expect(payouts.reason).toContain('тех же строк');
    expect(lineOf(result, 'accrual_total').registryKopecks).toBe(92_000);
    expect(result.status).toBe('insufficient_data');
    expect(result.notes).toEqual([
      'У WB нет документа для сверки — суммы реестра показаны без проверки',
    ]);
    expect(orderReconcileStateOf(result, '1')).toBe('unknown');
  });
});

// ─── Postgres + HTTP ────────────────────────────────────────────────────────

const SELLER_ID = '222';
const INITIAL = 'tg_rules_2026';
const PERIOD_KEY = 'united-netting:2026-09-01:2026-09-30';

const netting = (over: Record<string, unknown>) => ({
  orderId: 1,
  shopSku: 'A1',
  offerOrServiceName: 'Товар',
  transactionType: 'Начисление',
  transactionSource: 'Платёж покупателя',
  transactionDate: '10.09.2026 12:00',
  actId: null,
  actDate: null,
  count: 1,
  transactionSum: 1000,
  paymentStatus: 'Переведён',
  bankOrderId: 'B1',
  bankOrderDate: '20.09.2026',
  bankSum: 920,
  ...over,
});

/**
 * Сентябрь Ozon: те же три строки, что у ЯМ, но без поручений и актов, плюс
 * сальдо месяца. Строки — из фабрики ЯМ с площадкой Ozon: сверке важны статья,
 * сумма и даты, а не разбор Ozon (его покрывает finance-ozon-import).
 */
async function seedOzon(pg: ITestFinanceDb, closingKopecks = 92_000) {
  const documents = new FinanceDocumentRepository(pg.db);
  const { document } = await documents.registerVersion({
    marketplace: 'ozon',
    telegramUserId: SELLER_ID,
    businessId: 'client-1',
    reportType: 'ozon-transaction-list',
    periodFrom: SEPTEMBER.from,
    periodTo: SEPTEMBER.to,
    buffer: Buffer.from('ozon'),
    filename: 'ozon.json',
    contentType: 'application/json',
  });
  await documents.markImported(SELLER_ID, document.id, 3);
  const rows = [
    netting({ bankOrderId: null, bankOrderDate: null, bankSum: null }),
    netting({
      offerOrServiceName: 'Размещение',
      transactionSum: -50,
      bankOrderId: null,
      bankOrderDate: null,
      bankSum: null,
    }),
    netting({
      offerOrServiceName: 'Доставка покупателю',
      transactionSum: -30,
      bankOrderId: null,
      bankOrderDate: null,
      bankSum: null,
    }),
  ];
  const keys = journalKeys(rows);
  await new FinanceOperationRepository(pg.db).upsertMany(
    rows.map((r, i) => ({
      ...nettingRowToOperation(r, keys[i], {
        telegramUserId: SELLER_ID,
        businessId: 'client-1',
        documentId: document.id,
        documentVersion: document.version,
        periodKey: 'ozon-transaction-list:2026-09-01:2026-09-30',
      }),
      marketplace: 'ozon' as const,
    })),
  );
  await new FinanceOzonBalanceRepository(pg.db).upsert(
    SELLER_ID,
    SEPTEMBER,
    { openingKopecks: 0, accruedKopecks: 92_000, paymentsKopecks: 0, closingKopecks },
    NOW,
  );
}

async function seed(pg: ITestFinanceDb, extraCommissionRub = 0) {
  const documents = new FinanceDocumentRepository(pg.db);
  const months = [
    ['2026-08-01', '2026-08-31'],
    ['2026-09-01', '2026-09-30'],
    ['2026-10-01', '2026-10-31'],
  ];
  let september: { id: string; version: number } | null = null;
  for (const [periodFrom, periodTo] of months) {
    const { document } = await documents.registerVersion({
      marketplace: 'ym',
      telegramUserId: SELLER_ID,
      businessId: 'b1',
      reportType: 'united-netting',
      periodFrom,
      periodTo,
      buffer: Buffer.from(periodFrom),
      filename: 'netting.zip',
      contentType: 'application/zip',
    });
    await documents.markImported(SELLER_ID, document.id, 3);
    if (periodFrom === '2026-09-01') september = document;
  }
  const rows = [
    netting({}),
    netting({
      transactionType: 'Удержание',
      transactionSource: 'Оплата услуг Маркета',
      offerOrServiceName: 'Размещение товарных предложений',
      actId: 'A1',
      actDate: '30.09.2026',
      transactionSum: -50,
    }),
    netting({
      transactionType: 'Удержание',
      transactionSource: 'Оплата услуг Маркета',
      offerOrServiceName: 'Доставка покупателю',
      actId: 'A1',
      actDate: '30.09.2026',
      transactionSum: -30,
    }),
    ...(extraCommissionRub
      ? [
          netting({
            orderId: 2,
            transactionType: 'Удержание',
            transactionSource: 'Оплата услуг Маркета',
            offerOrServiceName: 'Размещение товарных предложений',
            actId: 'A1',
            actDate: '30.09.2026',
            transactionSum: -extraCommissionRub,
            bankOrderId: null,
            bankOrderDate: null,
            bankSum: null,
          }),
        ]
      : []),
  ];
  const keys = journalKeys(rows);
  const doc = september as unknown as { id: string; version: number };
  await new FinanceOperationRepository(pg.db).upsertMany(
    rows.map((r, i) =>
      nettingRowToOperation(r, keys[i], {
        telegramUserId: SELLER_ID,
        businessId: 'b1',
        documentId: doc.id,
        documentVersion: doc.version,
        periodKey: PERIOD_KEY,
      }),
    ),
  );
  await new FinanceActServicesRepository(pg.db).upsertMany(
    SELLER_ID,
    [{ actDay: '2026-09-30', totalKopecks: 8_000, sheets: { placement: 5_000, delivery: 3_000 } }],
    NOW,
  );
}

const serviceOf = (pg: ITestFinanceDb) =>
  new AccountingReconcileService(
    new FinanceOperationRepository(pg.db),
    new FinanceActServicesRepository(pg.db),
    new FinanceOzonBalanceRepository(pg.db),
    new FinanceDocumentRepository(pg.db),
    new FinanceSyncRunRepository(pg.db),
    new AccountingManualOperationsService(new AccountingManualOperationRepository(pg.db)),
  );

describe('AccountingReconcileService на Postgres', { timeout: 60_000 }, () => {
  let pg: ITestFinanceDb;

  beforeAll(async () => {
    pg = await createTestFinanceDb();
  }, 60_000);

  afterAll(async () => {
    await pg?.close();
  });

  beforeEach(async () => {
    await pg.reset();
  });

  it('журнал ЯМ, акт и поручение сходятся — «сверено»', async () => {
    await seed(pg);
    const result = await serviceOf(pg).reconcile(SELLER_ID, SEPTEMBER, NOW);
    expect(result.status).toBe('reconciled');
    expect(lineOf(result, 'commission')).toMatchObject({
      registryKopecks: -5_000,
      status: 'matched',
    });
    expect(lineOf(result, 'payouts')).toMatchObject({ documentKopecks: 92_000, status: 'matched' });
  });

  it('лишняя комиссия 150 ₽ — расхождение и найденная операция', async () => {
    await seed(pg, 150);
    const result = await serviceOf(pg).reconcile(SELLER_ID, SEPTEMBER, NOW);
    expect(result.status).toBe('discrepancies');
    const commission = lineOf(result, 'commission');
    expect(commission.differenceKopecks).toBe(-15_000);
    expect(commission.candidates.items[0]).toMatchObject({
      orderId: '2',
      amountKopecks: -15_000,
      matchesDifference: true,
    });
  });

  it('ручная операция ЯМ месяца — в сумме статьи; Ozon — нет', async () => {
    await seed(pg);
    const manual = new AccountingManualOperationsService(
      new AccountingManualOperationRepository(pg.db),
    );
    const actor = { author: SELLER_ID, impersonatedBy: null };
    const form = {
      article: 'commission',
      amount: '-7',
      accruedOn: '2026-09-15',
      source: 'Письмо поддержки',
    };
    await manual.create(
      SELLER_ID,
      { ...form, marketplace: 'ym', clientKey: '11111111-1111-4111-8111-111111111111' },
      actor,
    );
    await manual.create(
      SELLER_ID,
      { ...form, marketplace: 'ozon', clientKey: '22222222-2222-4222-8222-222222222222' },
      actor,
    );
    const commission = lineOf(
      await serviceOf(pg).reconcile(SELLER_ID, SEPTEMBER, NOW),
      'commission',
    );
    expect(commission).toMatchObject({ registryKopecks: -5_700, manualKopecks: -700 });
  });

  it('Ozon: журнал и сальдо месяца из базы — «сверено»; ЯМ строк Ozon не видит', async () => {
    await seedOzon(pg);
    const result = await serviceOf(pg).reconcile(SELLER_ID, SEPTEMBER, NOW, 'ozon');
    expect(result.status).toBe('reconciled');
    expect(lineOf(result, 'accrual_total')).toMatchObject({
      registryKopecks: 92_000,
      documentKopecks: 92_000,
      status: 'matched',
    });
    expect(lineOf(result, 'balance').status).toBe('matched');

    const ym = await serviceOf(pg).reconcile(SELLER_ID, SEPTEMBER, NOW);
    expect(lineOf(ym, 'accrual_total').registryKopecks).toBe(0);
    expect(ym.notes).toContain('Журнал операций за месяц не загружен');
  });

  it('Ozon: исходящее сальдо не сходится — расхождение остатка; WB без журнала — нет данных', async () => {
    await seedOzon(pg, 91_000);
    const result = await serviceOf(pg).reconcile(SELLER_ID, SEPTEMBER, NOW, 'ozon');
    expect(result.status).toBe('discrepancies');
    expect(lineOf(result, 'balance')).toMatchObject({
      differenceKopecks: 1_000,
      status: 'mismatch',
    });

    const wb = await serviceOf(pg).reconcile(SELLER_ID, SEPTEMBER, NOW, 'wb');
    expect(wb.status).toBe('insufficient_data');
    expect(wb.notes).toContain('Журнал операций за месяц не загружен');
  });
});

describe('CRM «Финучёт» — сверка по HTTP', { timeout: 60_000 }, () => {
  let pg: ITestFinanceDb;
  let app: INestApplication;
  let base: string;
  let token: string;

  beforeAll(async () => {
    pg = await createTestFinanceDb();
  }, 60_000);

  afterAll(async () => {
    await pg?.close();
  });

  afterEach(async () => {
    await app?.close();
  });

  async function boot(features: Record<string, boolean>, available: string[] = ['ym']) {
    await pg.reset();
    const access = inMemoryModel([
      { telegramUserId: SELLER_ID, botId: '999', status: 'approved', username: 'Vasya', features },
    ]);
    const stores = inMemoryModel([
      { telegramUserId: SELLER_ID, campaign_id: '1', business_id: '2', token: 'SECRET' },
    ]);
    const crm = inMemoryModel();
    crm.uniqueBy('telegramUserId');
    const admin = inMemoryModel();
    admin.uniqueBy('key');

    @Global()
    @Module({
      providers: [
        ActionLogService,
        AdminCredentialService,
        CrmCredentialService,
        UserAccessService,
        YandexMarketService,
        MarketplaceConnectionService,
        { provide: getModelToken(MarketplaceConnection.name), useValue: inMemoryModel() },
        { provide: getModelToken(ActionLog.name), useValue: inMemoryModel() },
        { provide: getModelToken(AdminCredential.name), useValue: admin },
        { provide: getModelToken(CrmCredential.name), useValue: crm },
        { provide: getModelToken(UserAccess.name), useValue: access },
        { provide: getModelToken(YandexMarket.name), useValue: stores },
        { provide: PurchasePriceService, useValue: {} },
        {
          provide: AppConfigService,
          useValue: { isAdmin: () => false, crmInitialPassword: INITIAL },
        },
      ],
      exports: [
        ActionLogService,
        AdminCredentialService,
        CrmCredentialService,
        UserAccessService,
        YandexMarketService,
        MarketplaceConnectionService,
        PurchasePriceService,
        AppConfigService,
      ],
    })
    class FakeDatabaseModule {}

    @Module({
      imports: [CrmModule],
      controllers: [CrmAccountingController],
      providers: [
        { provide: AccountingReconcileService, useValue: serviceOf(pg) },
        { provide: AccountingManualOperationsService, useValue: {} },
        { provide: AccountingCostHistoryService, useValue: {} },
        { provide: AccountingTaxSettingsService, useValue: {} },
        { provide: AccountingCostSettingsService, useValue: {} },
        { provide: AccountingLotCostService, useValue: {} },
        { provide: ProductCatalogService, useValue: {} },
        {
          provide: AccountingService,
          useValue: { status: () => ({ ready: false }), marketplacesOf: async () => available },
        },
        { provide: WbFinanceService, useValue: {} },
      ],
    })
    class AccountingTestModule {}

    const moduleRef = await Test.createTestingModule({ imports: [AccountingTestModule] })
      .overrideModule(DatabaseModule)
      .useModule(FakeDatabaseModule)
      .compile();
    await moduleRef.get(AdminCredentialService).ensure();

    app = moduleRef.createNestApplication({ logger: false });
    app.setGlobalPrefix('api');
    await app.listen(0);
    base = (await app.getUrl()).replace('[::1]', 'localhost');

    const login = await fetch(`${base}/api/crm/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ login: 'vasya', password: INITIAL }),
    });
    const first = ((await login.json()) as { token: string }).token;
    const change = await fetch(`${base}/api/crm/auth/password`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${first}` },
      body: JSON.stringify({ current: INITIAL, next: 'my-own-password' }),
    });
    token = ((await change.json()) as { token: string }).token;
  }

  const get = (query: string) =>
    fetch(`${base}/api/crm/ym/accounting/reconcile${query}`, {
      headers: { authorization: `Bearer ${token}` },
    });

  it('только зонтик, без fin_accounting_reconcile — 403 FEATURE_DISABLED', async () => {
    await boot({ [FEATURE.FIN_ACCOUNTING]: true });
    const response = await get('?month=2026-09');
    expect(response.status).toBe(403);
    expect(((await response.json()) as { code: string }).code).toBe(FEATURE_DISABLED);
  });

  it('зонтик и подфича — сверка месяца; кривой месяц — 400', async () => {
    await boot({ [FEATURE.FIN_ACCOUNTING]: true, [FEATURE.FIN_ACCOUNTING_RECONCILE]: true });
    await seed(pg);
    const response = await get('?month=2026-09');
    expect(response.status).toBe(200);
    const body = (await response.json()) as IAccountingReconcileResult;
    expect(body.status).toBe('reconciled');
    expect(JSON.stringify(body)).not.toContain('SECRET');

    const bad = await get('?month=09-2026');
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { code: string }).code).toBe(INVALID_RECONCILE_MONTH);
  });

  it('площадка: выбор Ozon, варианты для экрана; закрытая — 403, мусор — 400', async () => {
    await boot({ [FEATURE.FIN_ACCOUNTING]: true, [FEATURE.FIN_ACCOUNTING_RECONCILE]: true }, [
      'ym',
      'ozon',
    ]);
    await seedOzon(pg);
    const ozon = await get('?month=2026-09&marketplace=ozon');
    expect(ozon.status).toBe(200);
    const body = (await ozon.json()) as IAccountingReconcileResult & {
      marketplaceOptions: { marketplace: string; label: string }[];
    };
    expect(body.marketplace).toBe('ozon');
    expect(body.status).toBe('reconciled');
    expect(body.marketplaceOptions.map((o) => o.marketplace)).toEqual(['ym', 'ozon']);

    // Без площадки — первая доступная (ЯМ).
    const auto = (await (await get('?month=2026-09')).json()) as IAccountingReconcileResult;
    expect(auto.marketplace).toBe('ym');

    const closed = await get('?month=2026-09&marketplace=wb');
    expect(closed.status).toBe(403);
    expect(((await closed.json()) as { code: string }).code).toBe(
      RECONCILE_MARKETPLACE_UNAVAILABLE,
    );
    const junk = await get('?month=2026-09&marketplace=avito');
    expect(junk.status).toBe(400);
    expect(((await junk.json()) as { code: string }).code).toBe(INVALID_RECONCILE_MARKETPLACE);
  });
});
