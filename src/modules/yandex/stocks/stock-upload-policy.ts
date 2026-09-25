import { isStockWritable } from './placement';

/**
 * Барьеры загрузки прайса — ОДНО место на оба канала (бот и CRM).
 *
 * Прайс — единственная запись в Маркет, и ошибка тут двигает чужой склад.
 * Пока правила жили в хендлере бота, CRM пришлось бы повторить их второй
 * копией, а две копии одного правила расходятся (довод «один экран, один
 * текст»). Модуль чистый: ни Nest, ни сети — решает по готовым фактам, а
 * добывает их `StockUploadPolicyService`.
 *
 * ПОСЛЕДНИЙ барьер при этом остаётся в `StockSyncService.sync`/
 * `writeInBatches`: он сам выясняет модель и сам читает env. Здесь — ранний
 * слой: чтобы пообещать продавцу ровно то, что будет сделано, до постановки.
 */

/**
 * Ограничения загрузки. Прежний сервис их ПОТЕРЯЛ при миграции: его ужали с
 * 293 строк до 67, и вместе с кодом исчезли лимит размера, список разрешённых
 * расширений и проверка MIME. Скачивался и ставился в очередь любой присланный
 * файл — хоть двухгигабайтное видео.
 */
export const UPLOAD_LIMITS = {
  maxBytes: 10 * 1024 * 1024,
  extensions: ['.xlsx', '.xls'] as const,
  /** Слово в подписи к файлу (бот), включающее режим проверки без записи. */
  dryRunKeyword: 'проверка',
} as const;

export type TUploadFileError = 'extension' | 'size';

/** Расширение и размер — дешёвые проверки, до любого чтения базы и сети. */
export function checkUploadFile(fileName: string, size: number): TUploadFileError | null {
  const dot = fileName.lastIndexOf('.');
  const ext = dot < 0 ? '' : fileName.slice(dot).toLowerCase();
  if (!UPLOAD_LIMITS.extensions.includes(ext as never)) return 'extension';
  if (size > UPLOAD_LIMITS.maxBytes) return 'size';
  return null;
}

/**
 * Повод не отправлять остатки в Partner API.
 *
 * - `placement` — модель магазина не даёт продавцу управлять остатками (FBY)
 *   либо её не удалось определить; какой из двух случаев, различает
 *   `placementType`;
 * - `write-disabled` — запись выключена настройкой среды
 *   (`STOCK_WRITE_ENABLED=false`), то есть решение развёртывания, а не магазина;
 * - `feature-disabled` — администратор выключил продавцу фичу «остатки из
 *   прайса»; действие продавца — написать администратору, а не менять магазин.
 */
export type TWriteSkipReason = 'placement' | 'write-disabled' | 'feature-disabled';

/**
 * Единственное место, где решается, писать ли остатки. Им пользуются и ранний
 * слой (здесь), и последний (`StockSyncService.sync`) — правило одно.
 *
 * Отдельной функцией, а не выражением на месте: порядок поводов значим (среда
 * шире решения по продавцу, оба шире модели — при выключенной записи модель
 * даже не спрашивается), а `no-nested-ternary` в этом проекте запрещён не зря.
 */
export function skipReasonOf(
  writeEnabled: boolean,
  stockWriteAllowed: boolean,
  placementType?: string,
): TWriteSkipReason | undefined {
  if (!writeEnabled) return 'write-disabled';
  if (!stockWriteAllowed) return 'feature-disabled';
  if (!isStockWritable(placementType)) return 'placement';
  return undefined;
}

/** Нужно ли вообще спрашивать Маркет о модели: при запрете выше — незачем. */
export function needsPlacement(writeEnabled: boolean, stockFeatureOn: boolean): boolean {
  return writeEnabled && stockFeatureOn;
}

/**
 * О чём предупредить продавца ДО постановки. Обещать «загружаю остатки», а
 * через минуту прислать «остатки не записаны», значит выглядеть сломанным.
 */
export type TUploadWarning = 'stock-feature-off' | 'fby' | 'placement-unknown' | 'prices-off';

/**
 * Что обещать продавцу. Состояния не слиты в одну фразу: «проверка» — просьба
 * продавца, «только цены» — наш отказ писать остатки, «без цен» — решение
 * админа. Перестать их различать значит перестать различать «я так попросил»
 * и «мне отказали».
 */
export type TUploadProgress = 'prices-only' | 'check' | 'stocks-no-prices' | 'stocks';

export interface IUploadFacts {
  /** Фича «закуп из прайса» (админ уже учтён вызывающим). */
  savePrices: boolean;
  /** Фича «остатки из прайса» (админ уже учтён вызывающим). */
  stockFeatureOn: boolean;
  /** `STOCK_WRITE_ENABLED`. */
  writeEnabled: boolean;
  /** Модель магазина; `undefined` — не спрашивали или не определилась. */
  placementType: string | undefined;
  dryRun: boolean;
}

export type TUploadDecision =
  | { accepted: false }
  | {
      accepted: true;
      /** Писать ли закуп в нашу Mongo. */
      savePurchasePrices: boolean;
      /** Фича остатков — едет в джобу как `stockWriteAllowed`. */
      stockWriteAllowed: boolean;
      /** Остатки точно не будут записаны (env, фича или модель). */
      stocksReadOnly: boolean;
      placementType: string | undefined;
      warning: TUploadWarning | null;
      progress: TUploadProgress;
    };

/** Админ закрыл обе половины — файл даже не скачивается. */
export function bothHalvesOff(savePrices: boolean, stockFeatureOn: boolean): boolean {
  return !savePrices && !stockFeatureOn;
}

/**
 * Решение по файлу. Порядок: env → фича → модель; неопределившаяся модель —
 * запрет (`isStockWritable(undefined) === false`).
 */
export function decideUpload(facts: IUploadFacts): TUploadDecision {
  const { savePrices, stockFeatureOn, writeEnabled, placementType, dryRun } = facts;
  if (bothHalvesOff(savePrices, stockFeatureOn)) return { accepted: false };

  const skipReason = skipReasonOf(writeEnabled, stockFeatureOn, placementType);
  const stocksReadOnly = skipReason !== undefined;

  // Редкий угол: остатки писать нельзя, а цены выключены — файлу просто нечего
  // сделать, и молча разобрать его значило бы соврать. «Проверку» при этом
  // пропускаем: сверка с каталогом ничего не пишет и остаётся полезной.
  if (stocksReadOnly && !savePrices && !dryRun) return { accepted: false };

  return {
    accepted: true,
    savePurchasePrices: savePrices,
    stockWriteAllowed: stockFeatureOn,
    stocksReadOnly,
    placementType,
    warning: warningOf(facts, skipReason, stocksReadOnly),
    progress: progressOf(dryRun, stocksReadOnly, savePrices),
  };
}

/**
 * Тексты про «цены сохранятся» показываются только когда это правда
 * (savePrices). Выключенная средой запись — решение развёртывания, а не
 * продавца: предупреждать его не о чем (довод `skipAdvice`).
 */
function warningOf(
  facts: IUploadFacts,
  skipReason: TWriteSkipReason | undefined,
  stocksReadOnly: boolean,
): TUploadWarning | null {
  if (!facts.stockFeatureOn) return 'stock-feature-off';
  if (skipReason === 'placement' && facts.savePrices) {
    return facts.placementType ? 'fby' : 'placement-unknown';
  }
  if (!stocksReadOnly && !facts.savePrices) return 'prices-off';
  return null;
}

function progressOf(
  dryRun: boolean,
  stocksReadOnly: boolean,
  savePrices: boolean,
): TUploadProgress {
  if (stocksReadOnly && savePrices) return 'prices-only';
  if (dryRun || stocksReadOnly) return 'check';
  if (!savePrices) return 'stocks-no-prices';
  return 'stocks';
}
