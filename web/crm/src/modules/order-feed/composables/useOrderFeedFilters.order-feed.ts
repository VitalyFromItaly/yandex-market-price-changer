import type { OrderFeedFilters, OrderStage } from '../order-feed.domain';
import type { LocationQuery } from 'vue-router';

import { computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';

const STAGES = new Set<string>([
  'new',
  'awaiting_assembly',
  'assembled',
  'handed_over',
  'in_transit',
  'delivered',
  'redeemed',
  'cancelled',
  'returning',
  'returned',
  'unknown',
]);

function single(value: LocationQuery[string] | undefined): string | null {
  const first = Array.isArray(value) ? value[0] : value;
  return typeof first === 'string' && first !== '' ? first : null;
}

/**
 * Фильтры из query: `?stage=in_transit&q=casio`; мусор — «все». Площадка — из
 * адреса раздела (/ozon/order-feed, TASK-182), прежний `?mp` не читается.
 */
export function filtersFromQuery(query: LocationQuery): OrderFeedFilters {
  const stage = single(query.stage);
  return {
    stage: stage !== null && STAGES.has(stage) ? (stage as OrderStage) : null,
    product: single(query.q) ?? '',
  };
}

export function filtersQuery(filters: OrderFeedFilters): Record<string, string> {
  const query: Record<string, string> = {};
  if (filters.stage) query.stage = filters.stage;
  if (filters.product.trim()) query.q = filters.product.trim();
  return query;
}

/** Фильтры таблицы ленты — в адресе: ссылку можно переслать, F5 их не теряет. */
export function useOrderFeedFilters() {
  const route = useRoute();
  const router = useRouter();
  const filters = computed(() => filtersFromQuery(route.query));

  function update(patch: Partial<OrderFeedFilters>): void {
    void router.replace({ query: filtersQuery({ ...filters.value, ...patch }) });
  }

  return { filters, update };
}
