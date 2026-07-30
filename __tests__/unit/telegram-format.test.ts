import { describe, it, expect } from 'vitest';
import {
  esc,
  b,
  code,
  html,
  raw,
  htmlOptions,
  splitMessage,
  TELEGRAM_PARSE_MODE,
  TELEGRAM_MESSAGE_LIMIT,
} from '../../src/modules/telegram/formatting/telegram-format';

describe('telegram-format', () => {
  describe('esc', () => {
    it('экранирует три опасных для HTML-режима символа', () => {
      expect(esc('a & b < c > d')).toBe('a &amp; b &lt; c &gt; d');
    });

    it('амперсанд экранируется первым, иначе получилось бы двойное экранирование', () => {
      // Если бы < заменялся раньше &, то '<' -> '&lt;' -> '&amp;lt;'
      expect(esc('<')).toBe('&lt;');
      expect(esc('&lt;')).toBe('&amp;lt;');
    });

    it('НЕ трогает символы, которые ломали MarkdownV2 — в этом и был смысл выбора HTML', () => {
      const troublesome = '_*[]()~`>#+-=|{}.!';
      // Экранируется только '>', остальные проходят как есть.
      expect(esc(troublesome)).toBe('_*[]()~`&gt;#+-=|{}.!');
    });

    it('название товара со спецсимволами не ломает разметку', () => {
      const name = 'Часы <Casio> G-Shock & Co. (модель 1.5)';
      const message = `Товар: ${b(name)}`;
      expect(message).toBe('Товар: <b>Часы &lt;Casio&gt; G-Shock &amp; Co. (модель 1.5)</b>');
      // Ни одного неэкранированного < или > вне собственных тегов разметки
      expect(message.replace(/<\/?b>/g, '')).not.toMatch(/[<>]/);
    });

    it('null и undefined превращаются в пустую строку, а не в "null"', () => {
      expect(esc(null)).toBe('');
      expect(esc(undefined)).toBe('');
    });

    it('числа приводятся к строке', () => {
      expect(esc(1500.5)).toBe('1500.5');
    });
  });

  describe('b / code / html', () => {
    it('b и code экранируют содержимое', () => {
      expect(b('a<b')).toBe('<b>a&lt;b</b>');
      expect(code('x>y')).toBe('<code>x&gt;y</code>');
    });

    it('html-тег экранирует ВСЕ подстановки, оставляя статику как есть', () => {
      const evil = '<script>alert(1)</script>';
      expect(html`Привет, ${evil}!`).toBe('Привет, &lt;script&gt;alert(1)&lt;/script&gt;!');
    });

    it('raw отключает экранирование для готовой разметки', () => {
      expect(html`Итого: ${raw(b('100 ₽'))}`).toBe('Итого: <b>100 ₽</b>');
    });

    it('подстановка разметки БЕЗ raw экранируется — защита от случайной вставки', () => {
      expect(html`${'<b>жирный</b>'}`).toBe('&lt;b&gt;жирный&lt;/b&gt;');
    });
  });

  describe('htmlOptions', () => {
    it('режим разметки — HTML, а не legacy Markdown (из-за которого падали 400)', () => {
      expect(TELEGRAM_PARSE_MODE).toBe('HTML');
      expect(htmlOptions().parse_mode).toBe('HTML');
    });

    it('сохраняет reply_markup клавиатуры', () => {
      const keyboard = { reply_markup: { keyboard: [['кнопка']] } };
      const opts = htmlOptions(keyboard);
      expect(opts.parse_mode).toBe('HTML');
      expect(opts.reply_markup).toEqual({ keyboard: [['кнопка']] });
    });
  });

  describe('splitMessage', () => {
    it('короткое сообщение не режется', () => {
      expect(splitMessage('короткое')).toEqual(['короткое']);
    });

    it('режет по границе строк, не превышая лимит', () => {
      const line = 'x'.repeat(100);
      const text = Array.from({ length: 60 }, () => line).join('\n');
      const chunks = splitMessage(text, 1000);
      expect(chunks.length).toBeGreaterThan(1);
      for (const c of chunks) expect(c.length).toBeLessThanOrEqual(1000);
    });

    it('не теряет и не дублирует строки', () => {
      const lines = Array.from({ length: 200 }, (_, i) => `строка ${i}`);
      const chunks = splitMessage(lines.join('\n'), 300);
      expect(chunks.join('\n').split('\n')).toEqual(lines);
    });

    it('строку длиннее лимита режет жёстко, а не роняет', () => {
      const chunks = splitMessage('y'.repeat(250), 100);
      expect(chunks).toHaveLength(3);
      expect(chunks.join('')).toBe('y'.repeat(250));
    });

    it('лимит по умолчанию соответствует ограничению Telegram', () => {
      expect(TELEGRAM_MESSAGE_LIMIT).toBe(4096);
    });
  });
});
