/**
 * Заполненность карточек товаров — типы, разбор ответа offer-cards и русские
 * подписи статусов/рекомендаций.
 *
 * Чистый модуль (паттерн `recommendations.domain.ts`). Статусы и рекомендации
 * хранятся сырыми строками: на боевом набор бывает шире спеки (прецедент
 * IFbySupplyRequest), подпись маппится при показе с fallback на код.
 */

/** Одна рекомендация Маркета по карточке. */
export interface ICardRecommendation {
  type: string;
  /** Только у PICTURE_COUNT/VIDEO_COUNT/MAIN/ADDITIONAL/DISTINCTIVE, 0–100. */
  percent?: number;
  /** Сколько баллов рейтинга даст выполнение, 1–100. */
  remainingRatingPoints?: number;
}

/** Карточка в терминах экрана. */
export interface IOfferCard {
  offerId: string;
  cardStatus: string;
  /** Рейтинг заполненности, 0–100 %. Может отсутствовать (UPDATING). */
  contentRating?: number;
  /** Средний рейтинг карточек этой категории у всех продавцов. */
  averageContentRating?: number;
  recommendations: ICardRecommendation[];
  /** Ошибки блокируют показ на витрине, предупреждения — нет. */
  errorsCount: number;
  warningsCount: number;
}

/** Сырая карточка из ответа Partner API. */
export type TRawOfferCard = {
  offerId?: string;
  cardStatus?: string;
  contentRating?: number;
  averageContentRating?: number;
  recommendations?: Array<{ type?: string; percent?: number; remainingRatingPoints?: number }>;
  errors?: unknown[];
  warnings?: unknown[];
};

/** Разбор одной карточки, либо null без артикула — показывать нечего. */
export function parseOfferCard(raw: TRawOfferCard): IOfferCard | null {
  const offerId = raw?.offerId;
  if (!offerId) return null;

  return {
    offerId,
    cardStatus: raw.cardStatus ?? 'UNKNOWN',
    contentRating: numberOrUndefined(raw.contentRating),
    averageContentRating: numberOrUndefined(raw.averageContentRating),
    recommendations: (raw.recommendations ?? [])
      .filter((rec): rec is { type: string } & typeof rec => !!rec?.type)
      .map((rec) => ({
        type: rec.type,
        percent: numberOrUndefined(rec.percent),
        remainingRatingPoints: numberOrUndefined(rec.remainingRatingPoints),
      })),
    errorsCount: Array.isArray(raw.errors) ? raw.errors.length : 0,
    warningsCount: Array.isArray(raw.warnings) ? raw.warnings.length : 0,
  };
}

/**
 * Подписи статусов карточки — 9 значений спеки. Порядок в STATUS_ORDER —
 * порядок показа: сначала то, где нужно действие продавца.
 */
export const CARD_STATUS_LABEL: Readonly<Record<string, string>> = {
  NO_CARD_NEED_CONTENT: 'нет карточки — нужен контент',
  NO_CARD_ERRORS: 'нет карточки — ошибки',
  HAS_CARD_CAN_UPDATE_ERRORS: 'правки не приняты',
  NO_CARD_ADD_TO_CAMPAIGN: 'добавьте товар в магазин',
  HAS_CARD_CAN_UPDATE: 'можно дополнить',
  NO_CARD_PROCESSING: 'нет карточки — на проверке',
  HAS_CARD_CAN_UPDATE_PROCESSING: 'правки на проверке',
  NO_CARD_MARKET_WILL_CREATE: 'создаст Маркет',
  HAS_CARD_CAN_NOT_UPDATE: 'карточка Маркета',
};

/** Статусы, требующие действия продавца, — они печатаются первыми. */
export const ACTIONABLE_STATUSES: readonly string[] = [
  'NO_CARD_NEED_CONTENT',
  'NO_CARD_ERRORS',
  'HAS_CARD_CAN_UPDATE_ERRORS',
  'NO_CARD_ADD_TO_CAMPAIGN',
];

export function cardStatusLabel(code: string): string {
  return CARD_STATUS_LABEL[code] ?? code;
}

/** Подписи рекомендаций — 17 значений спеки (включая устаревшие). */
export const CARD_RECOMMENDATION_LABEL: Readonly<Record<string, string>> = {
  RECOGNIZED_VENDOR: 'укажите производителя как пишет он сам',
  PICTURE_COUNT: 'добавьте изображения',
  FIRST_PICTURE_SIZE: 'замените первое изображение более крупным',
  TITLE_LENGTH: 'доработайте название (тип + бренд + модель)',
  DESCRIPTION_LENGTH: 'добавьте описание',
  AVERAGE_PICTURE_SIZE: 'замените изображения на более качественные',
  FIRST_VIDEO_LENGTH: 'добавьте видео рекомендуемой длины',
  FIRST_VIDEO_SIZE: 'замените первое видео на более качественное',
  AVERAGE_VIDEO_SIZE: 'замените видео на более качественные',
  VIDEO_COUNT: 'добавьте хотя бы одно видео',
  MAIN: 'заполните ключевые характеристики',
  ADDITIONAL: 'заполните дополнительные характеристики',
  DISTINCTIVE: 'заполните различающие характеристики',
  HAS_VIDEO: 'добавьте видео',
  FILTERABLE: 'заполните характеристики для фильтров',
  HAS_DESCRIPTION: 'добавьте описание',
  HAS_BARCODE: 'укажите штрихкод',
};

/** Подпись рекомендации с процентом заполненности, когда он есть. */
export function recommendationLabel(rec: ICardRecommendation): string {
  const base = CARD_RECOMMENDATION_LABEL[rec.type] ?? rec.type;
  if (rec.percent !== undefined) return `${base} (заполнено ${rec.percent}%)`;
  return base;
}

/** Сводка по каталогу карточек. */
export interface ICardsSummary {
  totalCards: number;
  /** Счётчики по статусам — только ненулевые, в порядке важности. */
  byStatus: Array<{ status: string; count: number }>;
  /** Средний рейтинг по карточкам, где он есть; null — нет ни одного. */
  averageRating: number | null;
  /** Средний категорийный ориентир (averageContentRating), null — нет данных. */
  averageBenchmark: number | null;
  /** Худшие карточки по рейтингу, по возрастанию. */
  worst: IOfferCard[];
}

export function summarizeCards(cards: readonly IOfferCard[], worstLimit = 10): ICardsSummary {
  const counts = new Map<string, number>();
  for (const card of cards) {
    counts.set(card.cardStatus, (counts.get(card.cardStatus) ?? 0) + 1);
  }

  // Сначала статусы, требующие действия, затем остальные по убыванию счёта.
  const actionable = ACTIONABLE_STATUSES.filter((status) => counts.has(status)).map((status) => ({
    status,
    count: counts.get(status),
  }));
  const rest = [...counts.entries()]
    .filter(([status]) => !ACTIONABLE_STATUSES.includes(status))
    .sort((a, b) => b[1] - a[1])
    .map(([status, count]) => ({ status, count }));

  const rated = cards.filter((card) => card.contentRating !== undefined);
  const benchmarked = cards.filter((card) => card.averageContentRating !== undefined);

  const worst = rated
    .slice()
    .sort((a, b) => a.contentRating - b.contentRating)
    .slice(0, worstLimit);

  return {
    totalCards: cards.length,
    byStatus: [...actionable, ...rest],
    averageRating: rated.length ? Math.round(mean(rated.map((c) => c.contentRating))) : null,
    averageBenchmark: benchmarked.length
      ? Math.round(mean(benchmarked.map((c) => c.averageContentRating)))
      : null,
    worst,
  };
}

function mean(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
