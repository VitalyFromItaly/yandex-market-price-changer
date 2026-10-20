import type { FbyClusterRow, FbyReport, FbyResponse, FbyStock } from '../fby.domain';

type Stock = NonNullable<FbyResponse['stock']>;

/**
 * Кластер строкой, склады — под ним. Склад вне реестра кластеров приходит
 * группой из одного себя (заголовок = имя склада) — повторять его строкой ниже
 * незачем.
 */
function clusterRows(stock: Stock): FbyClusterRow[] {
  return stock.clusters.flatMap((cluster, index) => {
    const head = { id: `c${index}`, title: cluster.title, nested: false, totals: cluster.totals };
    const single = cluster.warehouses.length === 1 && cluster.warehouses[0]?.name === cluster.title;
    if (single) return [head];
    return [
      head,
      ...cluster.warehouses.map((warehouse, inner) => ({
        id: `c${index}:${inner}`,
        title: warehouse.name || 'склад без названия',
        nested: true,
        totals: warehouse.totals,
      })),
    ];
  });
}

function toStock(response: FbyResponse, stock: Stock): FbyStock {
  return {
    totals: stock.totals,
    columns: response.stockTypes.filter(
      ({ type }) => type === 'AVAILABLE' || stock.totals[type] > 0,
    ),
    rows: clusterRows(stock),
    problems: stock.problems,
  };
}

export function mapFby(response: FbyResponse): FbyReport {
  return {
    heading: `на ${response.takenAt} МСК`,
    stockHeading: response.stockTakenAt
      ? `Остатки — из отчёта Маркета на ${response.stockTakenAt} МСК`
      : null,
    stockHint: response.stockHint,
    stockProblem: response.stockProblem,
    stockTypes: response.stockTypes,
    stock: response.stock ? toStock(response, response.stock) : null,
    requests: response.requests,
    requestsProblem: response.requestsProblem,
    supplies: response.supplies,
    inTransit: response.inTransit,
    returning: response.returning,
    file: response.file,
  };
}
