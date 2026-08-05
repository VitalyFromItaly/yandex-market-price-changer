import { describe, it, expect } from 'vitest';

import {
  FBY_CLUSTER_KEYS,
  clusterOf,
  clusterTitle,
  groupByCluster,
} from '../../src/modules/yandex/fby/fby-clusters';

/**
 * Реестр кластеров складов Маркета. Имена складов — как в боевой колонке
 * WAREHOUSE отчёта stocks-on-warehouses («Софьино», «Домодедово возвратный»).
 * Ключевое свойство: незнакомый склад НЕ теряется — он становится
 * группой-одиночкой со своим именем, поэтому новая площадка Яндекса видна в
 * сводке без правки реестра.
 */
describe('clusterOf', () => {
  it('относит известные площадки к своим территориям', () => {
    expect(clusterOf('Софьино')).toBe('moscow');
    expect(clusterOf('Томилино')).toBe('moscow');
    expect(clusterOf('Екатеринбург')).toBe('ekb');
    expect(clusterOf('Самара')).toBe('samara');
    expect(clusterOf('Ростов-на-Дону-1')).toBe('rostov');
  });

  it('возвратный склад считается в своей территории («Домодедово возвратный» → Москва)', () => {
    expect(clusterOf('Домодедово возвратный')).toBe('moscow');
  });

  it('регистр не важен', () => {
    expect(clusterOf('СОФЬИНО')).toBe('moscow');
    expect(clusterOf('екатеринбург')).toBe('ekb');
  });

  it('незнакомый склад — null, а не ближайший кластер', () => {
    expect(clusterOf('Хабаровск')).toBeNull();
    expect(clusterOf('')).toBeNull();
  });
});

describe('FBY_CLUSTER_KEYS', () => {
  it('порядок реестра — это порядок матчинга и вывода', () => {
    expect(FBY_CLUSTER_KEYS).toEqual([
      'moscow',
      'spb',
      'rostov',
      'samara',
      'ekb',
      'novosibirsk',
      'kazan',
    ]);
  });

  it('у каждого кластера есть название', () => {
    for (const key of FBY_CLUSTER_KEYS) expect(clusterTitle(key)).toBeTruthy();
  });
});

describe('groupByCluster', () => {
  it('склады одной территории складываются в одну группу, значения сохраняются', () => {
    const groups = groupByCluster({ Софьино: 2, Томилино: 1, Екатеринбург: 3 });

    const moscow = groups.find((g) => g.key === 'moscow');
    expect(moscow?.title).toBe('Москва');
    expect(moscow?.warehouses).toEqual([
      { name: 'Софьино', value: 2 },
      { name: 'Томилино', value: 1 },
    ]);

    const ekb = groups.find((g) => g.key === 'ekb');
    expect(ekb?.warehouses).toEqual([{ name: 'Екатеринбург', value: 3 }]);
  });

  it('кластеры идут в порядке реестра, пустые группы не возвращаются', () => {
    const groups = groupByCluster({ Екатеринбург: 1, Софьино: 1 });
    expect(groups.map((g) => g.key)).toEqual(['moscow', 'ekb']);
  });

  it('незнакомые склады — группы-одиночки со своим именем, после кластеров, по алфавиту', () => {
    const groups = groupByCluster({ Хабаровск: 4, Софьино: 1, Абакан: 5 });

    expect(groups.map((g) => g.title)).toEqual(['Москва', 'Абакан', 'Хабаровск']);
    const stray = groups.find((g) => g.title === 'Хабаровск');
    expect(stray?.key).toBeNull();
    expect(stray?.warehouses).toEqual([{ name: 'Хабаровск', value: 4 }]);
  });

  it('пустой вход — пустой список групп', () => {
    expect(groupByCluster({})).toEqual([]);
  });
});
