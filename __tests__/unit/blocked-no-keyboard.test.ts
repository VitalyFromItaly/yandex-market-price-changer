import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

/**
 * У пользователя без доступа не должно остаться ни одной кнопки бота — и ни
 * одной ссылки на личный профиль владельца.
 *
 * Reply-клавиатура в Telegram ПЕРСИСТЕНТНА: она живёт на экране, пока её явным
 * образом не снять. Гейт доступа это делает, но он один: /start он пропускает
 * всегда, а сообщения «доступ закрыт» шлют не через него вовсе. Поэтому у
 * продавца, которому доступ закрыли, до первого нажатия оставалось полное меню
 * отчётов — мёртвых кнопок, каждая из которых отвечает «подайте заявку».
 *
 * Проверяется чтением исходников как текста — приём menu-labels.test.ts и
 * screens-single-source.test.ts. Через telegraf-мок это стоило бы пяти
 * отдельных сборок DI, а разъезжается оно молча: забытый аргумент не ломает ни
 * компиляцию, ни один сценарий.
 */
describe('Отказные ветки снимают клавиатуру', () => {
  const SRC = resolve(__dirname, '../../src');
  /**
   * Комментарии отбрасываем — приём subscription-removed.test.ts: те же фразы
   * цитируются в пояснениях «почему так сделано», и маркер попадал бы в них.
   */
  const read = (file: string) =>
    readFileSync(resolve(SRC, file), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');

  /** Окно после маркера: отправка и её опции всегда рядом. */
  const WINDOW = 400;

  const CASES: Array<{ file: string; marker: string; what: string }> = [
    {
      file: 'modules/telegram/bots/price-changer-bot/handlers/access-gate.handler.ts',
      marker: 'private async block(',
      what: 'блокировка апдейта гейтом',
    },
    {
      file: 'modules/telegram/bots/price-changer-bot/handlers/start.handler.ts',
      marker: 'ctx.reply(PENDING_TEXT',
      what: '/start при статусе pending',
    },
    {
      file: 'modules/telegram/bots/price-changer-bot/handlers/start.handler.ts',
      marker: 'rejectedText(hours)',
      what: '/start при отказе',
    },
    {
      file: 'modules/telegram/bots/price-changer-bot/handlers/start.handler.ts',
      marker: 'ctx.reply(intro',
      what: 'приглашение в визард',
    },
    {
      file: 'modules/telegram/bots/price-changer-bot/handlers/admin-approval.handler.ts',
      marker: 'accessRejectedText(access.rejectedAt)',
      what: 'отказ по заявке из карточки администратора',
    },
    {
      file: 'modules/telegram/bots/price-changer-bot/handlers/admin-users.handler.ts',
      marker: 'ACCESS_REVOKED_TEXT',
      what: 'отзыв доступа из раздела «Пользователи»',
    },
    {
      file: 'modules/access/access-notifier.service.ts',
      marker: 'ACCESS_REVOKED_TEXT',
      what: 'отзыв доступа тумблером в веб-панели',
    },
    {
      file: 'modules/telegram/bots/price-changer-bot/handlers/api-settings.handler.ts',
      marker: 'Заявка уже отправлена администратору',
      what: 'повторная заявка',
    },
    {
      file: 'modules/telegram/bots/price-changer-bot/handlers/api-settings.handler.ts',
      marker: 'Не удалось отправить заявку администратору',
      what: 'недоставленная заявка',
    },
    {
      file: 'modules/telegram/bots/price-changer-bot/handlers/api-settings.handler.ts',
      marker: 'Заявка отправлена администратору',
      what: 'заявка ушла',
    },
  ];

  it.each(CASES)('$what снимает reply-клавиатуру', ({ file, marker }) => {
    const source = read(file);

    // Маркер может встретиться и в импорте — засчитываем ЛЮБОЕ вхождение,
    // рядом с которым стоит снятие клавиатуры.
    const positions: number[] = [];
    for (let at = source.indexOf(marker); at !== -1; at = source.indexOf(marker, at + 1)) {
      positions.push(at);
    }

    expect(positions.length, `маркер «${marker}» пропал из ${file}`).toBeGreaterThan(0);
    expect(positions.some((at) => source.slice(at, at + WINDOW).includes('removeKeyboard'))).toBe(
      true,
    );
  });
});

/**
 * Личный ник владельца бота печатается ровно в справке, куда неодобренный не
 * попадает: гейт разбирает `/help` и «❓ Помощь» как command/menu, а `canPass`
 * их закрывает. Раньше он же стоял в сообщении о недоставленной заявке —
 * единственном экране про поддержку, который видит человек БЕЗ доступа.
 */
describe('Контакт поддержки не достаётся неодобренному', () => {
  const SRC = resolve(__dirname, '../../src');

  function tsFiles(dir: string): string[] {
    return readdirSync(dir).flatMap((entry) => {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) return tsFiles(full);
      return full.endsWith('.ts') ? [full] : [];
    });
  }

  it('SUPPORT_CONTACT используется только справкой', () => {
    const users = tsFiles(SRC)
      .filter((file) => {
        const code = readFileSync(file, 'utf8')
          .replace(/\/\*[\s\S]*?\*\//g, '')
          .replace(/^\s*\/\/.*$/gm, '');
        return code.includes('SUPPORT_CONTACT');
      })
      .map((file) => relative(SRC, file).replace(/\\/g, '/'));

    expect(users.sort()).toEqual([
      'modules/telegram/bots/price-changer-bot/help.text.ts',
      'modules/telegram/bots/price-changer-bot/menu.constants.ts',
    ]);
  });
});
