import type { IConnectionCheck } from './marketplace-connections.domain';
import type { TStoredConnectionMarketplace } from '../../database/schemas/marketplace-connection.schema';
import type { MarketplaceConnectionService } from '../../database/services/marketplace-connection.service';

/**
 * «Проверить связь» у площадки из `MarketplaceConnection` (Ozon, WB): креды из
 * базы → вопрос площадке → запись итога. Одна функция на обе площадки, чтобы
 * правило записи не разошлось копиями в адаптерах.
 *
 * Недоступность о ключе ничего не говорит — статус подключения не трогаем:
 * записанная, она превратила бы рабочее подключение в «не подключено» до
 * следующей проверки (довод самопроверки). null — не подключено.
 */
export async function checkStoredConnection(
  connections: MarketplaceConnectionService,
  telegramUserId: string,
  marketplace: TStoredConnectionMarketplace,
  verify: (credentials: Record<string, string>) => Promise<IConnectionCheck>,
): Promise<IConnectionCheck | null> {
  const credentials = await connections.credentialsOf(telegramUserId, marketplace);
  if (!credentials) return null;

  const check = await verify(credentials);
  if (check.status !== 'unavailable') {
    await connections.markChecked(telegramUserId, marketplace, {
      status: check.status,
      checkError: check.status === 'ok' ? undefined : check.message,
    });
  }
  return check;
}
