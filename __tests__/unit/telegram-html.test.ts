import { describe, it, expect } from 'vitest';

import { toPlainText, toSafeHtml } from '../../src/shared/telegram-html';

/**
 * Разбор разметки сообщений. Модуль общий для бэкенда и админ-панели, причём
 * его вывод панель отрисовывает через v-html — то есть ошибка здесь это не
 * «некрасиво», а исполняемый чужой код в браузере администратора.
 */
describe('toPlainText', () => {
  it('убирает разметку, оставляя текст', () => {
    expect(toPlainText('🎫 <b>API-токен</b> нужен доступ')).toBe('🎫 API-токен нужен доступ');
  });

  it('от ссылки оставляет её подпись', () => {
    expect(toPlainText('<a href="https://t.me/artonik1">@artonik1</a> (Тема)')).toBe(
      '@artonik1 (Тема)',
    );
  });

  it('разворачивает экранированные символы', () => {
    // esc() экранирует данные пользователя при сборке сообщения; в журнале
    // нужно то, что человек увидел на экране.
    expect(toPlainText('магазин &quot;Тема&quot; &lt;тест&gt;')).toBe('магазин "Тема" <тест>');
  });

  it('&amp;lt; не схлопывается в «<»', () => {
    // Порядок замен значим: заменив &amp; первым, получим «<».
    expect(toPlainText('&amp;lt;')).toBe('&lt;');
  });

  it('переносы строк сохраняются', () => {
    expect(toPlainText('Продажи: 100 ₽\nЗакуп: 70 ₽')).toBe('Продажи: 100 ₽\nЗакуп: 70 ₽');
  });
});

describe('toSafeHtml', () => {
  it('возвращает разрешённые теги', () => {
    expect(toSafeHtml('<b>Прибыль</b> за месяц')).toBe('<b>Прибыль</b> за месяц');
    expect(toSafeHtml('<i>курсив</i> и <code>код</code>')).toBe('<i>курсив</i> и <code>код</code>');
  });

  it('оставляет ссылку кликабельной и безопасной', () => {
    const html = toSafeHtml('<a href="https://t.me/artonik1">@artonik1</a>');
    expect(html).toContain('href="https://t.me/artonik1"');
    // Без noopener открытая вкладка получает доступ к window.opener.
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain('</a>');
  });

  it.each([
    '<script>alert(1)</script>',
    '<img src=x onerror="alert(1)">',
    '<iframe src="https://evil.example"></iframe>',
    '<div onclick="alert(1)">текст</div>',
  ])('обезвреживает %s', (input) => {
    const html = toSafeHtml(input);
    // Проверяется отсутствие живого тега, а не подстроки «onerror»: она
    // остаётся в выводе как ТЕКСТ (`&lt;div onclick=&quot;…`) и безвредна
    // ровно потому, что символы экранированы. Ни одного `<` здесь быть не
    // должно — в этих строках нет ни одного разрешённого тега.
    expect(html).not.toContain('<');
  });

  it('ссылку с javascript: не делает ссылкой', () => {
    const html = toSafeHtml('<a href="javascript:alert(1)">клик</a>');
    expect(html).not.toContain('<a href');
    // И не выбрасывает молча: факт наличия ссылки в сообщении виден.
    expect(html).toContain('клик');
    // Закрывающий тег тоже остаётся текстом: живой </a> без открытого — мусор.
    expect(html).not.toContain('</a>');
  });

  it('сущности из сообщения не экранируются повторно', () => {
    // Строка из журнала УЖЕ html: данные пользователя экранированы esc() при
    // сборке. Экранировав `&` ещё раз, получим `&amp;quot;` — и администратор
    // увидит буквальное «&quot;» вместо кавычки.
    expect(toSafeHtml('Магазин &quot;Тема&quot; и 10 &amp; 4%')).toBe(
      'Магазин &quot;Тема&quot; и 10 &amp; 4%',
    );
  });

  it('незакрытый тег после обрезки не ломает разметку', () => {
    // Исходящие обрезаются по длине, и обрезать может ровно посередине тега.
    const html = toSafeHtml('Отчёт <b');
    expect(html).not.toContain('<b');
    expect(html).toContain('Отчёт');
  });

  it('текст без разметки проходит нетронутым', () => {
    expect(toSafeHtml('Продажи: 2456985 ₽')).toBe('Продажи: 2456985 ₽');
  });

  it('одиночные и парные теги закрываются корректно', () => {
    expect(toSafeHtml('строка<br>вторая')).toBe('строка<br>вторая');
  });
});
