import type { OzonClientFactory } from './ozon-client.factory';
import type { OzonSellerClient } from './ozon.client';
import type { MarketplaceConnectionService } from '../../database/services/marketplace-connection.service';

/** У продавца нет ключа Ozon — спрашивать нечего. */
export class OzonNotConnectedError extends Error {
  constructor(readonly telegramUserId: string) {
    super(`Ozon не подключён у продавца ${telegramUserId}`);
    this.name = 'OzonNotConnectedError';
  }
}

/**
 * Клиент Ozon продавца: ключ читается на каждый вызов и только через
 * `credentialsOf` (правило TASK-127). Общий для каталога и заказов.
 */
export async function ozonSellerClient(
  clients: OzonClientFactory,
  connections: MarketplaceConnectionService,
  telegramUserId: string,
): Promise<OzonSellerClient> {
  const credentials = await connections.credentialsOf(telegramUserId, 'ozon');
  if (!credentials?.clientId || !credentials.apiKey) {
    throw new OzonNotConnectedError(telegramUserId);
  }
  return clients.forCredentials({ clientId: credentials.clientId, apiKey: credentials.apiKey });
}
