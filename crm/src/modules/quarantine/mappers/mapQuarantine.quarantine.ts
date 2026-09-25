import type {
  QuarantineConfirmResponse,
  QuarantineConfirmResult,
  QuarantineOfferResponse,
  QuarantineRow,
  QuarantineView,
  QuarantineViewResponse,
} from '../quarantine.domain';

/** Первая известная цена среди причин; ни одной — null, не 0. */
function firstKnown(values: Array<number | null>): number | null {
  return values.find((value) => value !== null) ?? null;
}

export function mapQuarantineRow(offer: QuarantineOfferResponse): QuarantineRow {
  return {
    offerId: offer.offerId,
    reasons: offer.verdicts.map((verdict) => verdict.title),
    currentPrice: firstKnown(offer.verdicts.map((verdict) => verdict.currentPrice)),
    lastValidPrice: firstKnown(offer.verdicts.map((verdict) => verdict.lastValidPrice)),
    minPrice: firstKnown(offer.verdicts.map((verdict) => verdict.minPrice)),
  };
}

export function mapQuarantineView(response: QuarantineViewResponse): QuarantineView {
  return {
    explainer: response.explainer,
    note: response.note,
    rows: response.offers.map(mapQuarantineRow),
  };
}

export function mapConfirmResult(response: QuarantineConfirmResponse): QuarantineConfirmResult {
  return { confirmed: response.confirmed, stale: response.stale };
}

/** Итог подтверждения для тоста: сколько вернулось и сколько уже было снято. */
export function confirmSummary(result: QuarantineConfirmResult): string {
  const parts = [`Товаров вернётся на витрину: ${result.confirmed}.`];
  if (result.stale > 0) parts.push(`Уже не в карантине: ${result.stale}.`);
  return parts.join(' ');
}
