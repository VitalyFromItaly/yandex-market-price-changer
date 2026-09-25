/**
 * «Помощь» CRM — справка `/help` бота слово в слово (решение
 * crm_help_verbatim). Сервер отдаёт её СТРУКТУРОЙ из той же модели, из
 * которой бот рендерит HTML (`help.model.ts`), так что текст второй раз
 * нигде не написан. Разметку добавляет канал.
 */

/** Кусок строки в ответе: текст, жирное или моноширинное. */
export type HelpSpanResponse = string | { bold: string } | { code: string };

export type HelpBlockResponse =
  | { kind: 'text'; spans: HelpSpanResponse[] }
  | { kind: 'lines'; items: HelpSpanResponse[][] }
  | { kind: 'list'; ordered?: boolean; items: HelpSpanResponse[][] };

/** Ответ GET /help. */
export interface HelpResponse {
  title: string;
  sections: { title: string; blocks: HelpBlockResponse[] }[];
  supportContact: string;
}

/** Кусок строки для шаблона: один вид вместо трёх форм ответа. */
export interface HelpSpan {
  kind: 'text' | 'bold' | 'code';
  text: string;
}

export type HelpBlock =
  | { kind: 'text'; spans: HelpSpan[] }
  | { kind: 'lines'; items: HelpSpan[][] }
  | { kind: 'list'; ordered: boolean; items: HelpSpan[][] };

export interface HelpSection {
  title: string;
  blocks: HelpBlock[];
}

export interface Help {
  sections: HelpSection[];
  /** Ник с `@`, как в боте. */
  supportContact: string;
  /** Ссылка на чат в Telegram; `null`, если ник не похож на ник. */
  supportUrl: string | null;
}
