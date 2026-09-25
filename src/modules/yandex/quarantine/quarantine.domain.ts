/**
 * Карантин цен — типы, разбор ответа Partner API и кодек inline-кнопок.
 *
 * Модуль чистый: без Nest, telegraf и Mongo (паттерн `report-buttons.ts`).
 * Формат callback_data нужен трём сторонам — кнопке, обработчику нажатия и
 * `features.domain.ts` (гейт), — и чистота здесь обязательна, иначе юнит-тест
 * реестра фич поднимал бы половину приложения.
 */

/** Типы карантина из спеки (PriceQuarantineVerdictType). */
export type TQuarantineVerdictType = 'PRICE_CHANGE' | 'LOW_PRICE' | 'LOW_PRICE_PROMO';

/**
 * Причина карантина с уже разобранными параметрами.
 *
 * Цены живут в `params[]` ответа под именами CURRENT_PRICE/LAST_VALID_PRICE/
 * MIN_PRICE — поля `currentPrice`/`lastValidPrice` самого товара спека
 * объявляет deprecated («вместо него используйте значение из verdicts →
 * params»), поэтому читаем ТОЛЬКО параметры.
 */
export interface IQuarantineVerdict {
  /** Сырой код: на боевом набор бывает шире спеки (прецедент IFbySupplyRequest). */
  type: string;
  /** Цена, из-за которой товар попал в карантин. */
  currentPrice?: number;
  /** Последняя цена до карантина (только PRICE_CHANGE). */
  lastValidPrice?: number;
  /** Порог попадания в карантин (LOW_PRICE и LOW_PRICE_PROMO). */
  minPrice?: number;
}

/** Товар в карантине в терминах экрана. */
export interface IQuarantineOffer {
  offerId: string;
  verdicts: IQuarantineVerdict[];
}

/** Сырой товар карантина из ответа Partner API. */
export type TRawQuarantineOffer = {
  offerId?: string;
  verdicts?: Array<{
    type?: string;
    params?: Array<{ name?: string; value?: string }>;
  }>;
};

/** Разбор одного товара, либо null без артикула — показывать нечего. */
export function parseQuarantineOffer(raw: TRawQuarantineOffer): IQuarantineOffer | null {
  const offerId = raw?.offerId;
  if (!offerId) return null;

  const verdicts = (raw.verdicts ?? []).map((verdict): IQuarantineVerdict => {
    const params = new Map<string, string>();
    for (const param of verdict?.params ?? []) {
      if (param?.name && param.value !== undefined) params.set(param.name, param.value);
    }
    return {
      type: verdict?.type ?? 'UNKNOWN',
      currentPrice: paramNumber(params, 'CURRENT_PRICE'),
      lastValidPrice: paramNumber(params, 'LAST_VALID_PRICE'),
      minPrice: paramNumber(params, 'MIN_PRICE'),
    };
  });

  return { offerId, verdicts };
}

/** Значение параметра числом, либо undefined: битую цену лучше не печатать. */
function paramNumber(params: Map<string, string>, name: string): number | undefined {
  const value = params.get(name);
  if (value === undefined) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/**
 * Подтверждение упало ПОСЛЕ хотя бы одного успешного батча: первые `confirmed`
 * из `requested` уже вернулись на витрину. «Ничего не вышло» здесь было бы
 * неправдой — продавец пошёл бы подтверждать уже подтверждённое вслепую.
 */
export class QuarantinePartialConfirmError extends Error {
  constructor(
    public readonly confirmed: number,
    public readonly requested: number,
    public readonly cause: unknown,
  ) {
    super(`Карантин: подтверждено ${confirmed} из ${requested}, дальше — сбой`);
    this.name = 'QuarantinePartialConfirmError';
  }
}

// --- кодек inline-кнопок ------------------------------------------------------
//
// `offerId` (ShopSku) — строка до 255 символов и в 64 байта callback_data не
// лезет, поэтому кнопка несёт ИНДЕКС в списке, сохранённом при отрисовке
// экрана (`UserAccess.quarantineOfferIds`). Обработчик перечитывает список и
// мапит индекс обратно; протухший список — «откройте карантин заново».

export const PQ_CB_PATTERN = /^pq:(ok:\d+|all)$/;

/** Кнопка «подтвердить один товар» — индекс в сохранённом списке. */
export function pqConfirmCallback(index: number): string {
  return `pq:ok:${index}`;
}

/** Кнопка «подтвердить все товары экрана». */
export const PQ_CB_ALL = 'pq:all';

export type TPqCallback = { action: 'ok'; index: number } | { action: 'all' };

export function parsePqCallback(data: string | undefined): TPqCallback | null {
  const match = PQ_CB_PATTERN.exec(data ?? '');
  if (!match) return null;
  if (match[1] === 'all') return { action: 'all' };
  return { action: 'ok', index: Number(match[1].slice('ok:'.length)) };
}
