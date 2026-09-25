import type { TFeatureKey } from '../telegram/bots/shared/features.domain';

import { SetMetadata } from '@nestjs/common';

export const ALLOW_PENDING_PASSWORD_CHANGE = 'crm:allowPendingPasswordChange';

/**
 * Маршрут доступен и тому, кто ещё не сменил стартовый пароль.
 *
 * Разрешение, а не запрет: новый маршрут CRM по умолчанию ЗАКРЫТ до смены
 * пароля, и забыть пометку — значит закрыть лишнее, а не открыть чужой магазин.
 */
export const AllowPendingPasswordChange = () => SetMetadata(ALLOW_PENDING_PASSWORD_CHANGE, true);

export const REQUIRE_FEATURE = 'crm:requireFeature';

/**
 * Маршрут закрыт, пока у продавца не открыты ВСЕ эти фичи — тот же реестр и
 * то же правило, что у `featureGate` бота (`isFeatureOpen`): закрытая в панели
 * фича закрывается в обоих каналах. FBY-only фичи дополнительно требуют модели
 * FBY у активного магазина — отдельной пометки для этого не нужно.
 *
 * Проверяет `CrmJwtGuard`, а не отдельный гвард: второй гвард можно забыть в
 * `@UseGuards`, и пометка молча ничего бы не закрыла.
 */
export const RequireFeature = (...keys: TFeatureKey[]) => SetMetadata(REQUIRE_FEATURE, keys);
