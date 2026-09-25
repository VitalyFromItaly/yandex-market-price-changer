import type { TileKey } from '../dashboard.domain';

import { defineStore } from 'pinia';

import { TILE, TILES } from '../dashboard.domain';

import { usePriceListInfo } from './composables/usePriceListInfo.dashboard';
import { useReportTile } from './composables/useReportTile.dashboard';

type Tile = ReturnType<typeof useReportTile>;

/** Стор главной — тонкий фасад: плитка на отчёт и дата прайса. */
export const useDashboardStore = defineStore('dashboard', () => {
  const tiles = Object.fromEntries(TILES.map((meta) => [meta.key, useReportTile(meta)])) as Record<
    TileKey,
    Tile
  >;
  const priceList = usePriceListInfo();

  /**
   * Запустить открытые плитки — каждую своей задачей, не дожидаясь соседних.
   * Закрытая плитка задачу не ставит: гейт ответил бы 403.
   */
  function load(open: readonly TileKey[], store: string): void {
    for (const key of open) void tiles[key].load(store);
    void priceList.load();
  }

  return {
    tiles,
    priceList,
    load,
    reset() {
      for (const key of Object.values(TILE)) tiles[key].reset();
      priceList.reset();
    },
  };
});
