/**
 * Кластеры складов Маркета: территория, к которой относится склад FBY.
 *
 * Отчёт stocks-on-warehouses отдаёт остатки построчно по складам, но продавец
 * думает территориями («что лежит в Москве, что в Самаре»), а не площадками
 * («Софьино» и «Томилино» — это одна Москва). API Маркета понятия «кластер» не
 * отдаёт вовсе — привязка выводится из НАЗВАНИЯ склада, поэтому здесь реестр
 * маркеров, а не запрос.
 *
 * Модуль-ЛИСТ без единого импорта — приём brands.ts: его тянет fby-message
 * (свёртка при выводе), а завести здесь импорт из fby-stock-report значило бы
 * привязать чистую географию к формату CSV. Поэтому groupByCluster обобщён по
 * T: что лежит по складам — числа, итоги, что угодно — реестру безразлично.
 */

/** Ключ кластера — стабильный ASCII-слаг, как TBrandKey. */
export type TFbyClusterKey =
  | 'moscow'
  | 'spb'
  | 'rostov'
  | 'samara'
  | 'ekb'
  | 'novosibirsk'
  | 'kazan';

interface IFbyCluster {
  /** Название территории для строки сводки: «Москва», «Самара». */
  title: string;
  /** Подстроки для поиска по названию склада в нижнем регистре. */
  markers: readonly string[];
}

/**
 * Реестр кластеров.
 *
 * `Record<TFbyClusterKey, IFbyCluster>`, а не массив-литерал — приём
 * DRAFT_FIELD_SET: Record обязывает компилятор потребовать каждый член
 * объединения. Порядок ключей — порядок матчинга и порядок строк в сводке.
 *
 * Маркеры — известные площадки Маркета; список НЕ обязан быть полным: склад,
 * не совпавший ни с одним кластером, показывается собственным именем (см.
 * groupByCluster), а не теряется и не требует правки кода. «домодедово»
 * намеренно ловит и «Домодедово возвратный» — возвратный склад стоит в
 * Подмосковье и считается в Москве.
 */
const CLUSTER_SET: Record<TFbyClusterKey, IFbyCluster> = {
  moscow: {
    title: 'Москва',
    // Единственный кластер со множеством складов-посёлков — потому и маркеров
    // много: в названиях стоят сами площадки, слова «Москва» там может не быть.
    markers: [
      'софьино',
      'томилино',
      'внуково',
      'котельники',
      'домодедово',
      'подольск',
      'белые столбы',
      'чехов',
      'дмитров',
      'москва',
    ],
  },
  spb: {
    title: 'СПб',
    markers: ['санкт-петербург', 'петербург', 'спб', 'шушары'],
  },
  rostov: {
    title: 'Ростов',
    markers: ['ростов', 'аксай'],
  },
  samara: {
    title: 'Самара',
    markers: ['самара', 'новосемейкино', 'тольятти'],
  },
  ekb: {
    title: 'Екатеринбург',
    markers: ['екатеринбург', 'косулино', 'арамиль'],
  },
  novosibirsk: {
    title: 'Новосибирск',
    markers: ['новосибирск', 'толмачёво', 'толмачево'],
  },
  kazan: {
    title: 'Казань',
    markers: ['казань', 'зеленодольск'],
  },
};

/** Порядок = порядок матчинга и порядок строк в сводке. */
export const FBY_CLUSTER_KEYS = Object.keys(CLUSTER_SET) as TFbyClusterKey[];

/** Название кластера для строки сводки. */
export function clusterTitle(key: TFbyClusterKey): string {
  return CLUSTER_SET[key].title;
}

/** Кластер склада по названию — или null, если склад реестру незнаком. */
export function clusterOf(warehouse: string): TFbyClusterKey | null {
  const haystack = String(warehouse ?? '').toLowerCase();

  for (const key of FBY_CLUSTER_KEYS) {
    if (CLUSTER_SET[key].markers.some((marker) => haystack.includes(marker))) return key;
  }

  return null;
}

/**
 * Группа складов одной территории. Для склада вне реестра `key` — null, а
 * `title` — имя самого склада: незнакомая территория видна в сводке сама по
 * себе (данные Маркета — экранировать при выводе!), а не прячется в
 * обезличенные «прочие».
 */
export interface IFbyClusterGroup<T> {
  key: TFbyClusterKey | null;
  title: string;
  warehouses: { name: string; value: T }[];
}

/**
 * Свёртка «склад → значение» в группы по кластерам.
 *
 * Порядок: кластеры реестра в порядке объявления, затем группы-одиночки
 * несовпавших складов по алфавиту имён. Пустые группы не возвращаются.
 * Суммирование значений — дело вызывающего: реестр не знает, что лежит по
 * складам.
 */
export function groupByCluster<T>(byWarehouse: Readonly<Record<string, T>>): IFbyClusterGroup<T>[] {
  const clustered = new Map<TFbyClusterKey, { name: string; value: T }[]>();
  const strays: IFbyClusterGroup<T>[] = [];

  for (const [name, value] of Object.entries(byWarehouse)) {
    const key = clusterOf(name);
    if (key === null) {
      strays.push({ key: null, title: name, warehouses: [{ name, value }] });
      continue;
    }
    const list = clustered.get(key) ?? [];
    list.push({ name, value });
    clustered.set(key, list);
  }

  const groups: IFbyClusterGroup<T>[] = [];
  for (const key of FBY_CLUSTER_KEYS) {
    const warehouses = clustered.get(key);
    if (warehouses) groups.push({ key, title: clusterTitle(key), warehouses });
  }

  strays.sort((a, b) => a.title.localeCompare(b.title));
  return [...groups, ...strays];
}
