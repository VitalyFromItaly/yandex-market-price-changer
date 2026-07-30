import type { IStoreRef } from '../../../yandex/yandex-api.client';

/**
 * Выбор магазина, когда токен открывает доступ к нескольким.
 *
 * Пользователю показываются только НАЗВАНИЯ. Сырые campaignId и businessId —
 * технический шум: продавцу они ни о чём не говорят, а перепутать их легко
 * (документация Яндекса отдельно предупреждает не путать campaignId с
 * идентификатором магазина). Идентификаторы живут в callback_data и в базе.
 */

/** Префиксы callback_data. Дальше идёт идентификатор. */
export const PICK_BUSINESS_PREFIX = 'store_pick_business:';
export const PICK_STORE_PREFIX = 'store_pick:';

export interface IBusinessGroup {
  businessId: string;
  businessName: string;
  stores: IStoreRef[];
}

/** Группировка по кабинету — порядок сохраняется как пришёл из API. */
export function groupByBusiness(stores: readonly IStoreRef[]): IBusinessGroup[] {
  const groups = new Map<string, IBusinessGroup>();

  for (const store of stores) {
    const existing = groups.get(store.businessId);
    if (existing) {
      existing.stores.push(store);
      continue;
    }
    groups.set(store.businessId, {
      businessId: store.businessId,
      businessName: store.businessName,
      stores: [store],
    });
  }

  return [...groups.values()];
}

export type TPickStep =
  /** Один магазин — выбирать нечего, подключаем сразу. */
  | { kind: 'single'; store: IStoreRef }
  /** Несколько кабинетов — сначала кабинет. */
  | { kind: 'business'; groups: IBusinessGroup[] }
  /** Кабинет один, магазинов несколько — сразу магазин, лишний шаг не нужен. */
  | { kind: 'store'; stores: IStoreRef[] }
  /** Токен не дал ни одного магазина. */
  | { kind: 'none' };

/**
 * Что спросить у пользователя. Лишнего шага быть не должно: выбор кабинета,
 * когда он один, — это вопрос без вариантов.
 */
export function decidePick(stores: readonly IStoreRef[]): TPickStep {
  if (!stores.length) return { kind: 'none' };
  if (stores.length === 1) return { kind: 'single', store: stores[0] };

  const groups = groupByBusiness(stores);
  if (groups.length > 1) return { kind: 'business', groups };

  return { kind: 'store', stores: [...stores] };
}

/**
 * Подписи кнопок в пределах одного списка обязаны различаться, иначе выбор
 * превращается в лотерею: два магазина с одинаковым доменом выглядели бы как
 * одна и та же кнопка. Дубли нумеруем.
 */
export function uniqueLabels(labels: readonly string[]): string[] {
  const seen = new Map<string, number>();

  return labels.map((label) => {
    const n = (seen.get(label) ?? 0) + 1;
    seen.set(label, n);
    return n === 1 ? label : `${label} (${n})`;
  });
}
