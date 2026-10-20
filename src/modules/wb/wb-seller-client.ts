import type { WbClientFactory } from './wb-client.factory';
import type { WbClient } from './wb.client';
import type { MarketplaceConnectionService } from '../../database/services/marketplace-connection.service';

/** У продавца нет токена WB — спрашивать нечего. */
export class WbNotConnectedError extends Error {
  constructor(readonly telegramUserId: string) {
    super(`WB не подключён у продавца ${telegramUserId}`);
    this.name = 'WbNotConnectedError';
  }
}

/**
 * Клиент WB продавца: токен читается на каждый вызов и только через
 * `credentialsOf` (правило TASK-127) — образец `ozonSellerClient`.
 */
export async function wbSellerClient(
  clients: WbClientFactory,
  connections: MarketplaceConnectionService,
  telegramUserId: string,
): Promise<WbClient> {
  const credentials = await connections.credentialsOf(telegramUserId, 'wb');
  if (!credentials?.token) throw new WbNotConnectedError(telegramUserId);
  return clients.forToken(credentials.token);
}
