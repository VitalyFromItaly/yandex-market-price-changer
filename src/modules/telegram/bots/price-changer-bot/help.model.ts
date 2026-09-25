import { b, code, esc } from '../../formatting/telegram-format';

/**
 * Справка как СТРУКТУРА, а не строка с разметкой.
 *
 * Справку показывают два канала: бот (HTML Telegram) и CRM (Vue). Держать в
 * CRM вторую копию текста — ровно та беда, ради которой появился `help.text.ts`:
 * две копии расходятся молча. Поэтому содержание живёт здесь данными, бот
 * рендерит из них HTML (`renderHelpBlocks`), CRM получает их JSON-ом и рисует
 * своей разметкой. Различаются каналы только разметкой.
 *
 * Модуль — лист: ни Nest, ни telegraf, чтобы его мог взять кто угодно.
 */

/**
 * Кусок строки. Перенос `\n` живёт ВНУТРИ куска, а не между строками: в
 * инструкции по токену жирный фрагмент переносится на следующую строку
 * (`<b>не сможет обновлять\nостатки</b>`), и модель «массив строк» его бы
 * разрезала. В вебе обычный `white-space` сам сворачивает такой `\n` в пробел —
 * ручные переносы бота рассчитаны на ширину Telegram, а не браузера.
 */
export type THelpSpan = string | { bold: string } | { code: string };

/**
 * Абзац справки.
 *
 * - `text` — сплошной текст: бот печатает переносы как есть, веб их сворачивает;
 * - `lines` — строки, каждая сама по себе (список команд): веб не склеивает их;
 * - `list` — маркированный (`•`) или нумерованный список.
 */
export type THelpBlock =
  | { kind: 'text'; spans: THelpSpan[] }
  | { kind: 'lines'; items: THelpSpan[][] }
  | { kind: 'list'; ordered?: boolean; items: THelpSpan[][] };

export interface IHelpSection {
  title: string;
  blocks: THelpBlock[];
}

/** Справка целиком — то, что отдаёт `helpModel()` и получает CRM. */
export interface IHelpModel {
  title: string;
  sections: IHelpSection[];
  /** Ник поддержки с `@`. Отдаётся моделью, чтобы константу читал только help.text.ts. */
  supportContact: string;
}

function renderSpan(span: THelpSpan): string {
  if (typeof span === 'string') return esc(span);
  if ('bold' in span) return b(span.bold);
  return code(span.code);
}

function renderSpans(spans: readonly THelpSpan[]): string {
  return spans.map(renderSpan).join('');
}

function renderBlock(block: THelpBlock): string {
  switch (block.kind) {
    case 'text':
      return renderSpans(block.spans);
    case 'lines':
      return block.items.map(renderSpans).join('\n');
    case 'list':
      return block.items
        .map((item, index) => `${block.ordered ? `${index + 1}.` : '•'} ${renderSpans(item)}`)
        .join('\n');
  }
}

/** Абзацы в HTML Telegram, через пустую строку. */
export function renderHelpBlocks(blocks: readonly THelpBlock[]): string {
  return blocks.map(renderBlock).join('\n\n');
}

/** Справка в HTML Telegram — ровно то, что бот отвечает на `/help`. */
export function renderHelp(model: IHelpModel): string {
  const sections = model.sections.map(
    (section) => `${b(section.title)}\n${renderHelpBlocks(section.blocks)}`,
  );
  return [`❓ ${b(model.title)}`, ...sections, `💬 Поддержка: ${esc(model.supportContact)}`].join(
    '\n\n',
  );
}
