import type {
  IConnectionCard,
  IConnectionCheck,
} from '../../marketplaces/marketplace-connections.domain';

/** Площадка в адресе не из списка — 400, а не 404: такой площадки нет вовсе. */
export const UNKNOWN_MARKETPLACE = 'UNKNOWN_MARKETPLACE';
export const UNKNOWN_MARKETPLACE_TEXT = 'Такой площадки нет.';

/** 404: ключ площадки не записан — проверять нечего. */
export const NOT_CONNECTED = 'NOT_CONNECTED';
export const NOT_CONNECTED_TEXT = 'Площадка ещё не подключена — сначала добавьте ключ.';

export interface ICrmConnectionsView {
  connections: IConnectionCard[];
}

export interface ICrmConnectionCheckView {
  connection: IConnectionCard;
  check: IConnectionCheck;
}
