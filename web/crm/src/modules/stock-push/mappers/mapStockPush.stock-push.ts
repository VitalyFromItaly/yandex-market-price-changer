import type {
  StockPushApplyResult,
  StockPushTarget,
  StockPushWrite,
  TargetStatus,
} from '../stock-push.domain';

import { PUSH_RUNNING } from '../stock-push.domain';

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

/** Ошибка постановки записи: 409 несёт jobId идущей задачи — её и опрашиваем. */
export function mapApplyError(caught: unknown): { message: string; runningJobId: string | null } {
  if (!(caught instanceof ApiError)) {
    return { message: 'Не удалось начать запись. Попробуйте ещё раз.', runningJobId: null };
  }
  const jobId = caught.code === PUSH_RUNNING ? caught.details?.jobId : null;
  return { message: caught.message, runningJobId: typeof jobId === 'string' ? jobId : null };
}
