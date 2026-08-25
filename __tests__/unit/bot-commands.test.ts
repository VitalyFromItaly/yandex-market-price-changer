import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  FULL_COMMANDS,
  GUEST_COMMANDS,
  commandsFor,
  scopeForStatus,
} from '../../src/modules/telegram/bots/price-changer-bot/bot-commands';

/**
 * Список команд в «синей кнопке Меню» — тоже интерфейс, и он тоже обязан не
 * предлагать закрытого.
 *
 * Дефект, ради которого появился второй список: `setMyCommands` ставил полный
 * набор ГЛОБАЛЬНО, поэтому человек без доступа видел /menu, /settings,
 * /profile, /help — и на каждую получал «Сначала нужно подать заявку на
 * доступ». Теперь умолчание гостевое, полный ставится персонально по чату.
 *
 * Второй инвариант, который до сих пор жил только в комментарии: команда,
 * которую бот рекламирует, но не обрабатывает, молча не работает — так уже
 * случилось с /files и /cleanup.
 */
describe('Списки команд бота', () => {
  const HANDLERS = resolve(
    __dirname,
    '../../src/modules/telegram/bots/price-changer-bot/handlers',
  );

  const source = (file: string) =>
    readFileSync(resolve(HANDLERS, file), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');

  it('гостю доступен ровно /start — единственное, что пропускает гейт', () => {
    expect(GUEST_COMMANDS.map((c) => c.command)).toEqual(['start']);
  });

  it('каждая команда полного списка действительно зарегистрирована', () => {
    // Регистрация живёт в двух файлах: /start — в start.handler, остальные
    // четыре — в slash-commands.handler.
    const registered = source('slash-commands.handler.ts') + source('start.handler.ts');

    for (const { command } of FULL_COMMANDS) {
      const declared =
        registered.includes(`bot.command('${command}'`) ||
        (command === 'start' && registered.includes('bot.start('));
      expect(declared, `команда /${command} нигде не обрабатывается`).toBe(true);
    }
  });

  it('/users в общий список не попадает: раздел администратора не светится', () => {
    expect(FULL_COMMANDS.map((c) => c.command)).not.toContain('users');
    // И /health — он тоже только для админов и намеренно не рекламируется.
    expect(FULL_COMMANDS.map((c) => c.command)).not.toContain('health');
  });

  it('scopeForStatus открывает полный список только одобренному', () => {
    expect(scopeForStatus('approved')).toBe('full');
    for (const status of ['new', 'pending', 'rejected', undefined]) {
      expect(scopeForStatus(status)).toBe('guest');
    }
  });

  it('commandsFor отдаёт копию — список нельзя испортить вызывающему', () => {
    const first = commandsFor('full');
    first.pop();
    expect(commandsFor('full')).toHaveLength(FULL_COMMANDS.length);
  });

  it('умолчание бота ставится ГОСТЕВОЕ', () => {
    // Умолчание достаётся тому, кому персональный список не ставили, то есть
    // человеку без доступа. Полный там — это и был исходный дефект.
    const setup = source('slash-commands.handler.ts');
    expect(setup).toContain("setMyCommands(commandsFor('guest'))");
    expect(setup).not.toContain("commandsFor('full')");
  });
});
