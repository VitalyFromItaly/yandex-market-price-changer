import { DrizzleQueryError } from 'drizzle-orm';

import { PolzaApiError, PolzaInsufficientFundsError } from '../ai/polza.errors';
import { telegramErrorInfo } from '../metrics/metrics.domain';
import { OzonApiError } from '../ozon/ozon.errors';
import { WbApiError } from '../wb/wb.errors';
import { ReportGenerationError } from '../yandex/report-generation.error';
import { YandexApiError } from '../yandex/yandex-api.errors';

/**
 * На чьей стороне сбой — первая строка, которую админ читает в алерте.
 *
 * Зачем. 13-11-2026 алерт «Отчёт об остатках FBY не сгенерировался» выглядел как
 * наша поломка, и понадобилась диагностика на проде, чтобы увидеть: отчёт
 * роняет сам Маркет. Класс ошибки и код ответа отвечают на этот вопрос сразу.
 *
 * - `external` — площадка или Telegram: 5xx, лимит, нет ответа, провал отчёта.
 * - `seller` — продавец/пользователь: его ключ отклонён, он заблокировал бота.
 * - `ours` — наш код, база или наш запрос, который площадка не приняла (прочие 4xx:
 *   запрос составили мы). Ключ и баланс Polza — тоже наши.
 * - `unknown` — сетевой сбой без класса площадки или не-Error.
 */
export type TFaultSide = 'external' | 'seller' | 'ours' | 'unknown';

export interface IFault {
  side: TFaultSide;
  /** Кто именно: «Яндекс Маркет», «Telegram»… Только у `external`. */
  party?: string;
  reason?: string;
}

type TParty = 'yandex' | 'ozon' | 'wb' | 'polza' | 'telegram';

const PARTY_NAME: Record<TParty, string> = {
  yandex: 'Яндекс Маркет',
  ozon: 'Ozon',
  wb: 'Wildberries',
  polza: 'Polza.ai',
  telegram: 'Telegram',
};

/** Коды Node без ответа сервера: чья сеть — по ним не понять. */
const NETWORK_CODES = new Set([
  'ECONNRESET',
  'ETIMEDOUT',
  'ENOTFOUND',
  'ECONNREFUSED',
  'EAI_AGAIN',
  'EPIPE',
]);

function partyOf(error: unknown): TParty | undefined {
  if (error instanceof YandexApiError) return 'yandex';
  if (error instanceof OzonApiError) return 'ozon';
  if (error instanceof WbApiError) return 'wb';
  if (error instanceof PolzaApiError) return 'polza';
  return undefined;
}

/** Ответ площадки по коду. У Polza ключ и баланс наши — 401/403/402 там «наша». */
function apiFault(party: TParty, status: number, error: unknown): IFault {
  const name = PARTY_NAME[party];
  if (!status) return { side: 'external', party: name, reason: 'нет ответа (сеть)' };
  if (status >= 500) return { side: 'external', party: name, reason: `ошибка сервера ${status}` };
  if (status === 420 || status === 429)
    return { side: 'external', party: name, reason: 'лимит запросов' };
  if (error instanceof PolzaInsufficientFundsError)
    return { side: 'ours', reason: 'кончились деньги на Polza' };
  if (status === 401 || status === 403) {
    return party === 'polza'
      ? { side: 'ours', reason: `Polza отклонила наш ключ (${status})` }
      : { side: 'seller', reason: `${name} отклонил ключ или доступ продавца (${status})` };
  }
  return { side: 'ours', reason: `${name} не принял наш запрос (${status})` };
}

export function faultOf(error: unknown): IFault {
  if (error instanceof ReportGenerationError) {
    const party = PARTY_NAME.yandex;
    if (error.info?.status === 'FAILED') {
      const sub = error.info.subStatus ? `: ${error.info.subStatus}` : '';
      return { side: 'external', party, reason: `провалил отчёт сам${sub}` };
    }
    return { side: 'external', party, reason: 'не собрал отчёт за наш потолок ожидания' };
  }

  const party = partyOf(error);
  if (party) return apiFault(party, (error as { status: number }).status, error);

  const { code } = telegramErrorInfo(error);
  if (code !== undefined) {
    if (code >= 500)
      return { side: 'external', party: PARTY_NAME.telegram, reason: `ошибка сервера ${code}` };
    if (code === 403)
      return { side: 'seller', reason: 'пользователь заблокировал бота или удалил чат' };
    if (code === 429) return { side: 'ours', reason: 'шлём в Telegram слишком часто' };
    return { side: 'ours', reason: `Telegram не принял наш запрос (${code})` };
  }

  if (error instanceof DrizzleQueryError) return { side: 'ours', reason: 'база данных (Postgres)' };
  if (!(error instanceof Error)) return { side: 'unknown' };
  if (/^Mongo|^Mongoose/.test(error.name)) return { side: 'ours', reason: 'база данных (Mongo)' };

  const nodeCode = (error as { code?: unknown }).code;
  if (typeof nodeCode === 'string' && NETWORK_CODES.has(nodeCode)) {
    return { side: 'unknown', reason: `сеть (${nodeCode})` };
  }
  return { side: 'ours', reason: 'ошибка в коде' };
}

const SIDE_LABEL: Record<TFaultSide, string> = {
  external: '🌐',
  seller: '🔑 продавец',
  ours: '🛠 наша',
  unknown: '❔ не определена',
};

/** Строка алерта без разметки — экранирует вызывающий. */
export function faultLine(fault: IFault): string {
  const who =
    fault.side === 'external' ? `${SIDE_LABEL.external} ${fault.party}` : SIDE_LABEL[fault.side];
  return `Сторона: ${who}${fault.reason ? ` — ${fault.reason}` : ''}`;
}
