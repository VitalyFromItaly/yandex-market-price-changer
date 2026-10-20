import type { TurnStatus } from '@/shared/composables/useTurn';
import type { OpenedArticle } from '@/shared/finance-operations';

/** «ИИ-аналитик» (TASK-148) — типы ответа сервера и модели экрана. */

export const AI_ANALYST_ROUTE_NAME = 'ym-ai-analyst';

/** Потолок вопроса — тот же, что проверяет сервер (`MAX_MESSAGE_CHARS`). */
export const MAX_QUESTION_CHARS = 4000;
/** Сколько реплик уходит серверу; он режет историю и сам, это лишь не слать лишнего. */
export const HISTORY_SENT = 20;

export const SUGGESTED_QUESTIONS: readonly string[] = [
  'Где я заработал больше в прошлом месяце?',
  'Где выгоднее продавать Casio F-91W?',
  'Почему рентабельность на WB ниже?',
];

export interface AnalystSourceResponse {
  source: string;
  label: string;
  period: { from: string; to: string } | null;
  operationIds: string[];
  operationCount: number;
  documentIds: string[];
}

export interface AnalystAnswerResponse {
  answer: string;
  verification: { verified: boolean; unconfirmed: string[] };
  sources: AnalystSourceResponse[];
  gaps: string[];
  rounds: number;
}

// Механика хода — общая (`@/shared/composables/useTurn`), статус — оттуда же.
export type { TurnStatus };

export interface TurnResponse {
  status: TurnStatus;
  answer?: AnalystAnswerResponse;
  message?: string;
}

/** Реплика истории — то, что уходит серверу. */
export interface HistoryMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface SourceLink {
  key: string;
  label: string;
  periodLabel: string | null;
  /** Ссылка в «Финансы» с периодом; null — периода нет. */
  financeQuery: { from: string; to: string } | null;
  /** Раскрытие до операций; null — операций нет. */
  operations: OpenedArticle | null;
  documentIds: string[];
}

export interface AnswerModel {
  text: string;
  /** «Не подтверждены данными: …» — null, если все числа нашлись. */
  unverified: string | null;
  sources: SourceLink[];
  gaps: string[];
}

/** Оценка ответа продавцом (TASK-170); повторная заменяет прежнюю. */
export type AnswerRating = 'up' | 'down';

export interface ChatMessage {
  id: number;
  role: 'user' | 'assistant';
  content: string;
  /** Только у ответа аналитика. */
  answer?: AnswerModel;
  /** id хода на сервере — по нему ставится оценка. */
  turnId?: string;
  rating?: AnswerRating | null;
}

// ── Вкладки и разбор периода (TASK-150) ────────────────────────────────────

export type AiAnalystTabKey = 'chat' | 'review';

export interface AiAnalystTabMeta {
  key: AiAnalystTabKey;
  label: string;
  /** Фича, без которой вкладки нет: закрытая вела бы в 403. */
  feature: string;
}

/** Порядок — порядок вкладок; первая открытая живёт по адресу раздела без параметра. */
export const AI_ANALYST_TABS: readonly AiAnalystTabMeta[] = [
  { key: 'chat', label: 'Чат', feature: 'ai_analyst' },
  { key: 'review', label: 'Разбор периода', feature: 'ai_period_review' },
];

export interface ReviewRecommendationResponse {
  id: string;
  kind: string;
  sku: string;
  name: string | null;
  avgPriceKopecks: number;
  minPriceKopecks: number;
  netKopecks: number;
  units: number;
  schemes: string[];
  text: string;
  source: AnalystSourceResponse;
}

export interface PeriodReviewResponse {
  month: string;
  previousMonth: string;
  /** null — модель не звали: журнала за месяц нет, причина — в gaps. */
  answer: string | null;
  verification: { verified: boolean; unconfirmed: string[] };
  recommendations: ReviewRecommendationResponse[];
  sources: AnalystSourceResponse[];
  gaps: string[];
}

export interface ReviewTurnResponse {
  status: TurnStatus;
  answer?: PeriodReviewResponse;
  message?: string;
}

export interface RecommendationCard {
  /** «R1» — по этой метке на неё ссылается текст разбора. */
  id: string;
  title: string;
  text: string;
  schemes: string;
  source: SourceLink;
}

export interface PeriodReviewModel {
  title: string;
  /** Текст, плашка, ссылки и пробелы — как у ответа чата; null — модель не звали. */
  answer: AnswerModel | null;
  recommendations: RecommendationCard[];
  /** Пробелы, когда разбора нет: без текста им негде жить. */
  gaps: string[];
}
