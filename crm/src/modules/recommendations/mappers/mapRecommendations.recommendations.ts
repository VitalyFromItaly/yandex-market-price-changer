import type { RecommendationsReport, RecommendationsResponse } from '../recommendations.domain';

export function mapRecommendations(response: RecommendationsResponse): RecommendationsReport {
  return {
    heading: `на ${response.takenAt} МСК`,
    count: response.count,
    average: response.average,
    low: response.low,
    other: response.other,
    emptyText: response.emptyText,
    rows: response.rows.map((row, index) => ({ ...row, id: `${row.offerId}:${index}` })),
    file: response.file,
  };
}
