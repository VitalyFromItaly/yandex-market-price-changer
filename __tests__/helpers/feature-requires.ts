import type {
  IFeatureMeta,
  TFeatureKey,
} from '../../src/modules/telegram/bots/shared/features.domain';

import { FEATURE_META } from '../../src/modules/telegram/bots/shared/features.domain';

/**
 * Временно даёт боевой фиче зависимости — шаг проверки TASK-153 «фича с
 * requires: ['ai']». Под ai в реестре пока никто не зависит, а проверять надо
 * настоящие точки (гейт бота, клавиатуру, гвард CRM), которые читают именно
 * `FEATURE_META`. Возвращает откат — звать в `afterEach`/`finally`.
 */
export function withRequires(key: TFeatureKey, requires: TFeatureKey[]): () => void {
  const meta = FEATURE_META[key] as IFeatureMeta;
  const before = meta.requires;
  meta.requires = requires;
  return () => {
    meta.requires = before;
  };
}
