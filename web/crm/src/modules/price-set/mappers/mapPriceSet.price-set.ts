import type {
  MarkupRow,
  PlanErrors,
  PriceSetApplyResult,
  PriceSetMarketplace,
  PriceSetMarkups,
  PriceSetPlan,
  PriceSetTarget,
  PriceSetWrite,
  TargetStatus,
} from '../price-set.domain';

import {
  MARKETPLACE_LABEL,
  MARKUP_EXAMPLE_PURCHASE,
  MARKUP_MAX,
  MARKUP_MIN,
  PRICE_FILE_EXTENSIONS,
  PRICE_FILE_MAX_BYTES,
  PRICE_SET_ERROR,
} from '../price-set.domain';

import { ApiError } from '@/shared/http';
import { formatRub } from '@/shared/utils';

const NO_ERRORS: PlanErrors = { file: null, form: null, runningJobId: null };

const SKIP_TEXT: Record<NonNullable<PriceSetWrite['skipReason']>, string> = {
  'write-disabled': 'запись цен выключена на сервере — это была проверка',
  'no-access': 'у токена нет права «Цены и скидки»',
};

/** «250» / «250,5» → 250; вне 1…10 000 или не число — `null`. */
export function parseMarkupText(text: string): number | null {
  const normalized = text.trim().replace(',', '.');
  if (!/^\d+(\.\d+)?$/.test(normalized)) return null;
  const value = Number(normalized);
  return value >= MARKUP_MIN && value <= MARKUP_MAX ? value : null;
}

/**
 * Подсказка под полем: «1000 ₽ → 2500 ₽». Это пример смысла процента, а не
 * расчёт плана — цены считает сервер.
 */
export function markupExample(percent: number | null): string {
  const shown = percent ?? 250;
  return `${formatRub(MARKUP_EXAMPLE_PURCHASE)} → ${formatRub(Math.round((MARKUP_EXAMPLE_PURCHASE * shown) / 100))}`;
}

/** Ошибка строки формы: отмечена, а процент не разобрался. */
export function markupRowError(row: MarkupRow): string | null {
  if (!row.on || parseMarkupText(row.text) !== null) return null;
  return `Процент от закупа — число от ${MARKUP_MIN} до ${MARKUP_MAX.toLocaleString('ru-RU')}.`;
}

/** `{ ym: 250, wb: 300 }` — только отмеченные строки с верным процентом. */
export function markupsOf(rows: readonly MarkupRow[]): PriceSetMarkups {
  const markups: PriceSetMarkups = {};
  for (const row of rows) {
    const percent = row.on ? parseMarkupText(row.text) : null;
    if (percent !== null) markups[row.marketplace] = percent;
  }
  return markups;
}

/** Проверка до отправки — те же правила, что на сервере; сервер всё равно проверит сам. */
export function localFileError(file: { name: string; size: number }): string | null {
  const name = file.name.toLowerCase();
  if (!PRICE_FILE_EXTENSIONS.some((ext) => name.endsWith(ext))) {
    return `Нужен файл .xlsx, .xls или .csv. Выбран «${file.name}».`;
  }
  if (file.size > PRICE_FILE_MAX_BYTES) return 'Файл больше 10 МБ. Выберите файл меньшего размера.';
  return null;
}

function runningJobIdOf(caught: ApiError, code: string): string | null {
  const jobId = caught.code === code ? caught.details?.jobId : null;
  return typeof jobId === 'string' ? jobId : null;
}

/** Ошибка постановки плана: файл — под полем; 409 несёт jobId идущего плана. */
export function mapPlanError(caught: unknown): PlanErrors {
  if (!(caught instanceof ApiError)) {
    return { ...NO_ERRORS, form: 'Не удалось отправить файл. Попробуйте ещё раз.' };
  }
  if (caught.code === PRICE_SET_ERROR.INVALID_FILE) return { ...NO_ERRORS, file: caught.message };
  return {
    ...NO_ERRORS,
    form: caught.message,
    runningJobId: runningJobIdOf(caught, PRICE_SET_ERROR.PLAN_RUNNING),
  };
}

/** Ошибка постановки записи: 409 несёт jobId идущей записи — её итог и показываем. */
export function mapApplyError(caught: unknown): { message: string; runningJobId: string | null } {
  if (!(caught instanceof ApiError)) {
    return { message: 'Не удалось начать запись. Попробуйте ещё раз.', runningJobId: null };
  }
  return {
    message: caught.message,
    runningJobId: runningJobIdOf(caught, PRICE_SET_ERROR.PRICE_SET_RUNNING),
  };
}

/** «+12,5%» / «−40%»; без текущей цены — «нет цены». */
export function deltaText(deltaPct: number | null): string {
  if (deltaPct === null) return 'нет цены';
  const abs = Math.abs(deltaPct).toLocaleString('ru-RU', { maximumFractionDigits: 1 });
  if (deltaPct > 0) return `+${abs}%`;
  return deltaPct < 0 ? `−${abs}%` : '0%';
}

export function priceText(value: number | null): string {
  return value === null ? '—' : formatRub(value);
}

/** Статус карточки по решениям сервера и снятым строкам. */
export function targetStatus(target: PriceSetTarget, count: number): TargetStatus {
  if (target.blockedBy === 'no-write-method')
    return { label: 'Только просмотр', variant: 'default' };
  if (target.blockedBy) return { label: 'Не пишется', variant: 'danger' };
  if (target.updates.length === 0) return { label: 'Совпадает', variant: 'ok' };
  if (!target.willWrite) return { label: 'Только просмотр', variant: 'default' };
  return count > 0
    ? { label: `Запишем ${count}`, variant: 'warn' }
    : { label: 'Всё снято', variant: 'default' };
}

/** Рискованные строки сняты по умолчанию — продавец ставит их галочкой сам. */
export function defaultExcluded(plan: PriceSetPlan): Set<string> {
  return new Set(
    plan.targets.flatMap((target) =>
      target.updates.filter((row) => row.risky).map((row) => row.key),
    ),
  );
}

/** Строк площадки уйдёт в запись: изменения цели без снятых продавцом. */
export function targetCount(target: PriceSetTarget, excluded: ReadonlySet<string>): number {
  if (!target.willWrite) return 0;
  return target.updates.filter((row) => !excluded.has(row.key)).length;
}

/** Итог записи по площадке — одной строкой. */
export function writeLine(write: PriceSetWrite): string {
  const label = MARKETPLACE_LABEL[write.marketplace];
  if (write.skipReason) return `${label}: не записано — ${SKIP_TEXT[write.skipReason]}.`;
  let line = `${label}: записано ${write.written} из ${write.requested}`;
  if (write.skipped.length) {
    line += `; не отправлено: ${write.skipped.length} (${write.skipped[0]?.reason ?? 'причина не указана'})`;
  }
  if (write.errors.length) {
    line += `; отказ площадки: ${write.errors[0]?.message ?? 'ошибка площадки'}`;
  }
  return `${line}.`;
}

export function applyLines(result: PriceSetApplyResult): string[] {
  return result.writes.length
    ? result.writes.map(writeLine)
    : ['Записывать было нечего — все строки сняты или площадки закрыты.'];
}

/** Подтверждение записи: сколько и куда уйдёт. */
export function confirmText(
  parts: readonly { marketplace: PriceSetMarketplace; count: number }[],
): string {
  const count = parts.reduce((sum, part) => sum + part.count, 0);
  const where = parts.map((part) => `${MARKETPLACE_LABEL[part.marketplace]} — ${part.count}`);
  return (
    `Будет записано ${count} цен: ${where.join(', ')}. Это изменит цены в вашем кабинете — ` +
    'покупатели увидят их сразу. Перед записью план пересчитается: если цены изменились, ' +
    'ничего не запишется.'
  );
}
