/**
 * Единая точка форматирования исходящих сообщений Telegram.
 *
 * Почему это вообще понадобилось. Раньше режим разметки задавался в трёх местах
 * независимо, и в двух из них был legacy `parse_mode: 'Markdown'`, где жирный
 * текст — это `*text*`. При этом тексты писались с `**text**` (синтаксис
 * GitHub-Markdown). Telegram отвечал на такое `400 Can't find end of Bold
 * entity`, то есть сообщение НЕ ДОХОДИЛО вообще, а джоба уходила в retry и
 * умирала. Отчёт о завершении обработки пользователь не видел никогда.
 * Вдобавок десятки `ctx.reply` слали `**text**` вообще без parse_mode —
 * там пользователь видел буквальные звёздочки.
 *
 * Почему HTML, а не MarkdownV2. В MarkdownV2 экранировать нужно 18 символов
 * (`_*[]()~`>#+-=|{}.!`), и пропуск любого из них — это снова 400. Названия
 * товаров, имена пользователей и тексты ошибок полны точек, дефисов и скобок.
 * В HTML-режиме Telegram требует экранировать ровно три символа: & < >.
 * Для бота, который шлёт отчёты с названиями товаров и суммами, это
 * принципиально надёжнее.
 */

/** Режим разметки. Задаётся ЗДЕСЬ и больше нигде. */
export const TELEGRAM_PARSE_MODE = 'HTML' as const;

/**
 * Экранирует данные, попадающие в сообщение из внешних источников:
 * имена пользователей Telegram, названия товаров из Маркета, тексты ошибок.
 * Любая такая подстановка обязана проходить через esc(), иначе символ `<`
 * в названии товара сломает разметку всего сообщения.
 */
export function esc(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** Жирный. Содержимое экранируется. */
export function b(value: unknown): string {
  return `<b>${esc(value)}</b>`;
}

/** Моноширинный (id, токены). Содержимое экранируется. */
export function code(value: unknown): string {
  return `<code>${esc(value)}</code>`;
}

/** Курсив. Содержимое экранируется. */
export function i(value: unknown): string {
  return `<i>${esc(value)}</i>`;
}

/**
 * Шаблонный тег: автоматически экранирует ВСЕ подстановки, оставляя
 * статические части как есть. Позволяет писать разметку прямо в шаблоне,
 * не боясь данных:
 *
 *   html`Товар ${name} — ${price} ₽`
 *
 * Если подстановка уже является готовой разметкой (результат b() или code()),
 * оберните её в raw(), чтобы отключить экранирование.
 */
export function html(strings: TemplateStringsArray, ...values: unknown[]): string {
  return strings.reduce((acc, part, idx) => {
    if (idx === 0) return part;
    const v = values[idx - 1];
    const rendered = v instanceof Raw ? v.value : esc(v);
    return acc + rendered + part;
  }, '');
}

class Raw {
  constructor(public readonly value: string) {}
}

/** Помечает строку как готовую разметку — html`` не будет её экранировать. */
export function raw(value: string): Raw {
  return new Raw(value);
}

/**
 * Опции отправки. Использовать во ВСЕХ вызовах ctx.reply / editMessageText,
 * чтобы parse_mode не появлялся в коде поштучно.
 */
export function htmlOptions<T extends object>(extra?: T) {
  return { parse_mode: TELEGRAM_PARSE_MODE, ...(extra ?? {}) } as {
    parse_mode: typeof TELEGRAM_PARSE_MODE;
  } & T;
}

/**
 * Лимит длины сообщения у Telegram — 4096 символов. Более длинный текст
 * приводит к 400, поэтому длинные отчёты нужно резать.
 * Режем по границе строки, чтобы не разорвать HTML-тег пополам.
 */
export const TELEGRAM_MESSAGE_LIMIT = 4096;

export function splitMessage(text: string, limit = TELEGRAM_MESSAGE_LIMIT): string[] {
  if (text.length <= limit) return [text];

  const chunks: string[] = [];
  let current = '';

  for (const line of text.split('\n')) {
    // Отдельная строка длиннее лимита — режем жёстко, вариантов нет.
    if (line.length > limit) {
      if (current) {
        chunks.push(current);
        current = '';
      }
      for (let i = 0; i < line.length; i += limit) {
        chunks.push(line.slice(i, i + limit));
      }
      continue;
    }

    if (current.length + line.length + 1 > limit) {
      chunks.push(current);
      current = line;
    } else {
      current = current ? `${current}\n${line}` : line;
    }
  }

  if (current) chunks.push(current);
  return chunks;
}
