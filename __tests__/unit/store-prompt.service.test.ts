import { describe, it, expect, vi } from 'vitest';

import { MENU } from '../../src/modules/telegram/bots/price-changer-bot/menu.constants';
import { PriceChangerKeyboard } from '../../src/modules/telegram/bots/price-changer-bot/price-changer.keyboard';
import { StorePromptService } from '../../src/modules/telegram/bots/shared/services/store-prompt.service';

/**
 * Ответ «нужен магазин» обязан не только сказать текст, но и СБРОСИТЬ залипшее
 * полное меню на сокращённое. Reply-клавиатура персистентна, и без нового
 * reply_markup продавец (особенно администратор, минующий гейт) продолжал бы
 * видеть кнопки отчётов, которые ведут в тупик.
 *
 * Клавиатура чистая, config — тривиальный мок, поэтому проверяем прямым `new`.
 */
describe('StorePromptService.replyNeedsStore', () => {
  function build(isAdmin: boolean) {
    const service = new StorePromptService(new PriceChangerKeyboard(), {
      isAdmin: () => isAdmin,
    } as never);
    const ctx = { from: { id: 222 }, reply: vi.fn(async () => undefined) };
    return { service, ctx };
  }

  const keyboardOf = (ctx: { reply: ReturnType<typeof vi.fn> }): string[] => {
    const options = ctx.reply.mock.calls[0][1] as { reply_markup?: { keyboard?: string[][] } };
    return (options?.reply_markup?.keyboard ?? []).flat();
  };

  it('шлёт текст «заполните настройки» и сокращённую клавиатуру без отчётов', async () => {
    const { service, ctx } = build(false);
    await service.replyNeedsStore(ctx as never);

    expect(String(ctx.reply.mock.calls[0][0])).toContain('заполните настройки');
    const buttons = keyboardOf(ctx);
    expect(buttons).toContain(MENU.SETTINGS);
    expect(buttons).toContain(MENU.HELP);
    expect(buttons).not.toContain(MENU.PROFIT);
    expect(buttons).not.toContain(MENU.SHIPPED_TODAY);
    // Не-админ ряда «Пользователи» не получает.
    expect(buttons).not.toContain(MENU.USERS);
  });

  it('администратору оставляет кнопку «Пользователи», но не отчёты', async () => {
    const { service, ctx } = build(true);
    await service.replyNeedsStore(ctx as never);

    const buttons = keyboardOf(ctx);
    expect(buttons).toContain(MENU.USERS);
    expect(buttons).not.toContain(MENU.PROFIT);
  });
});
