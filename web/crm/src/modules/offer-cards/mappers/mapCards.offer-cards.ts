import type { CardsReport, CardsResponse } from '../offer-cards.domain';

export function mapCards(response: CardsResponse): CardsReport {
  return {
    heading: `на ${response.takenAt} МСК`,
    totalCards: response.summary.totalCards,
    byStatus: response.summary.byStatus,
    averageRating: response.summary.averageRating,
    averageBenchmark: response.summary.averageBenchmark,
    emptyText: response.emptyText,
    rows: response.rows.map((row, index) => ({ ...row, id: `${row.offerId}:${index}` })),
    file: response.file,
  };
}
