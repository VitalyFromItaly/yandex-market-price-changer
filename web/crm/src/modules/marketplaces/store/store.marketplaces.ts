import { defineStore } from 'pinia';

import { useConnectionCards } from './composables/useConnectionCards.marketplaces';
import { useConnections } from './composables/useConnections.marketplaces';

/** Стор площадок — фасад над списком подключений (сайдбар, «Обзор») и карточками «Подключений». */
export const useMarketplacesStore = defineStore('marketplaces', () => {
  const connections = useConnections();
  const cards = useConnectionCards({ onChanged: connections.refresh });
  return {
    ...connections,
    cards: cards.cards,
    cardsLoading: cards.isLoading,
    hasCards: cards.hasCards,
    cardsError: cards.error,
    checking: cards.checking,
    loadCards: cards.load,
    checkConnection: cards.check,
    replaceYmToken: cards.replaceYmToken,
    connectOzon: cards.connectOzon,
    connectWb: cards.connectWb,
    reset() {
      connections.reset();
      cards.reset();
    },
  };
});
