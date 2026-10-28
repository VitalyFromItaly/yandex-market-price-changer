import type {
  PurchaseCoverage,
  PushMarketplaceOption,
  StockPushApplyResult,
  StockPushMarketplace,
  StockPushPlan,
  StockPushTarget,
  StockPushWrite,
  TargetStatus,
} from '../price-list.domain';

import { PUSH_RUNNING } from '../price-list.domain';

import { ApiError } from '@/shared/http';

const SKIP_TEXT: Record<NonNullable<StockPushWrite['skipReason']>, string> = {
  placement: 'модель магазина или склад площадки не даёт писать остатки',
  'write-disabled': 'запись остатков выключена на сервере',
  'feature-disabled': 'запись закрыта администратором',
};

export function targetStatus(target: StockPushTarget): TargetStatus {
  if (target.blockedBy === 'no-write-method')
    return { label: 'Только просмотр', variant: 'default' };
  if (
    target.blockedBy === 'placement' ||
    target.blockedBy === 'no-warehouse' ||
    target.blockedBy === 'several-warehouses'
  )
    return { label: 'Не пишется', variant: 'default' };
  if (target.blockedBy) return { label: 'Запись остановлена', variant: 'danger' };
  if (target.updates.length === 0) return { label: 'Совпадает', variant: 'ok' };
  // Запись этой площадки закрыта фичей (у ЯМ блока для этого нет — решает фича).
  if (!target.willWrite) return { label: 'Только просмотр', variant: 'default' };
  return { label: `Запишем ${target.updates.length}`, variant: 'warn' };
}

/** «12 → 9» с разницей: продавец проверяет глазами именно её. */
export function deltaText(from: number, to: number): string {
  const diff = to - from;
  return diff > 0 ? `+${diff}` : String(diff);
}

/** Итог записи по магазину или площадке — одной строкой. */
export function writeLine(write: StockPushWrite): string {
  if (write.skipReason) return `«${write.name}»: не записано — ${SKIP_TEXT[write.skipReason]}.`;
  let line = `«${write.name}»: записано ${write.written} из ${write.requested}`;
  const skipped = write.skipped ?? [];
  if (skipped.length) {
    line += `; не отправлено: ${skipped.length} (${skipped[0]?.reason ?? 'причина не указана'})`;
  }
  if (write.errors.length) {
    line += `; отвергнуто батчей: ${write.errors.length} (${write.errors[0]?.message ?? 'ошибка площадки'})`;
  }
  return `${line}.`;
}

export function applyLines(result: StockPushApplyResult): string[] {
  return result.writes.length
    ? result.writes.map(writeLine)
    : ['Записывать было нечего — план изменился или все площадки заблокированы.'];
}

/**
 * Площадки плана в порядке целей — строки выбора «куда записать». Можно ли
 * писать, решил сервер (`willWrite` цели); фронт только сводит цели площадки.
 */
export function marketplaceOptions(plan: StockPushPlan): PushMarketplaceOption[] {
  const byMarketplace = new Map<StockPushMarketplace, PushMarketplaceOption>();
  for (const target of plan.targets) {
    const option = byMarketplace.get(target.marketplace) ?? {
      marketplace: target.marketplace,
      label: target.marketplaceLabel,
      writable: false,
      count: 0,
      targets: [],
    };
    option.targets.push(target);
    if (target.willWrite) {
      option.writable = true;
      option.count += target.updates.length;
    }
    byMarketplace.set(target.marketplace, option);
  }
  return [...byMarketplace.values()];
}

/** Подпись строки выбора: сколько запишем или почему галочку не поставить. */
export function optionNote(option: PushMarketplaceOption): string {
  if (option.writable) return `запишем ${option.count} поз.`;
  if (option.targets.some((target) => target.blockedBy !== null)) return 'не пишется — см. ниже';
  if (option.targets.every((target) => target.updates.length === 0)) return 'совпадает с планом';
  return 'только просмотр — запись открывает администратор';
}

/** Подтверждение записи: что и куда уйдёт. */
export function confirmText(options: readonly PushMarketplaceOption[]): string {
  const count = options.reduce((sum, option) => sum + option.count, 0);
  const where = options
    .flatMap((option) => option.targets.filter((target) => target.willWrite))
    .map((target) =>
      target.marketplace === 'ym'
        ? `${target.marketplaceLabel} «${target.name}»`
        : `«${target.name}»`,
    );
  return (
    `Будет записано ${count} позиций: ${where.join(', ')}. ` +
    'Это изменит остатки в вашем кабинете. Перед записью план пересчитается: если числа ' +
    'изменились, ничего не запишется.'
  );
}

const COVERAGE_LABEL: Record<'ozon' | 'wb', string> = { ozon: 'Ozon', wb: 'Wildberries' };

/**
 * Закуп по площадкам: он один на товар, и Ozon/WB видят его через привязку
 * карточки. Только открытые продавцу площадки; `null` — сказать нечего.
 */
export function coverageText(
  coverage: PurchaseCoverage | null,
  open: readonly ('ozon' | 'wb')[],
): string | null {
  if (coverage === null || coverage.products === 0 || open.length === 0) return null;
  const parts = open.map(
    (marketplace) =>
      `${COVERAGE_LABEL[marketplace]} — ${coverage[marketplace]} из ${coverage.products}`,
  );
  const unlinked = open.some((marketplace) => coverage[marketplace] < coverage.products);
  return (
    `Закуп из файла действует для всех площадок по привязке карточек: ${parts.join(', ')} ` +
    `товаров привязано.${unlinked ? ' Непривязанные — в «Товары», вкладка привязки.' : ''}`
  );
}

/** Ошибка постановки записи: 409 несёт jobId идущей задачи — её и опрашиваем. */
export function mapApplyError(caught: unknown): { message: string; runningJobId: string | null } {
  if (!(caught instanceof ApiError)) {
    return { message: 'Не удалось начать запись. Попробуйте ещё раз.', runningJobId: null };
  }
  const jobId = caught.code === PUSH_RUNNING ? caught.details?.jobId : null;
  return { message: caught.message, runningJobId: typeof jobId === 'string' ? jobId : null };
}
