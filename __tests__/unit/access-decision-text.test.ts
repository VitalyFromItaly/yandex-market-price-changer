import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

import {
  ACCESS_GRANTED_TEXT,
  ACCESS_REVOKED_TEXT,
  accessRejectedText,
} from '../../src/modules/telegram/bots/price-changer-bot/access-decision.text';
import { REJECTION_COOLDOWN_MS } from '../../src/modules/telegram/bots/shared/access.domain';

const SRC = join(process.cwd(), 'src');

const read = (file: string) =>
  readFileSync(join(SRC, file), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

/**
 * Что бот пишет продавцу о решении по доступу.
 *
 * Входов теперь три — карточка заявки, раздел «👥 Пользователи» и тумблер в
 * веб-панели, — и все три обязаны говорить одно и то же. Тест читает исходники
 * как текст, потому что расхождение копий не ловится ни компилятором, ни ревью:
 * ровно так уже разъехались экраны справки и настроек.
 */
describe('Решение по доступу объясняется одинаково отовсюду', () => {
  it('тексты не продублированы литералами в обработчиках и в панели', () => {
    const consumers = [
      'modules/telegram/bots/price-changer-bot/handlers/admin-approval.handler.ts',
      'modules/telegram/bots/price-changer-bot/handlers/admin-users.handler.ts',
      'modules/access/access-notifier.service.ts',
    ];

    for (const file of consumers) {
      const code = read(file);
      expect(code).not.toContain('Доступ открыт!');
      expect(code).not.toContain('Заявка отклонена');
      expect(code).not.toContain('Доступ к боту закрыт администратором');
    }
  });

  it('все три входа берут тексты из общего модуля', () => {
    expect(read('modules/telegram/bots/price-changer-bot/handlers/admin-approval.handler.ts')).toContain(
      'ACCESS_GRANTED_TEXT',
    );
    expect(read('modules/telegram/bots/price-changer-bot/handlers/admin-users.handler.ts')).toContain(
      'ACCESS_REVOKED_TEXT',
    );
    const notifier = read('modules/access/access-notifier.service.ts');
    expect(notifier).toContain('ACCESS_GRANTED_TEXT');
    expect(notifier).toContain('ACCESS_REVOKED_TEXT');
  });

  it('отзыв доступа и отказ по заявке — РАЗНЫЕ тексты', () => {
    // У продавца, уже работавшего с ботом, никакой заявки на рассмотрении нет:
    // «Заявка отклонена» он прочитал бы как ответ на то, чего не отправлял.
    expect(ACCESS_REVOKED_TEXT).not.toContain('Заявка');
    expect(accessRejectedText(new Date())).toContain('Заявка отклонена');
  });

  it('часы до повторной попытки считаются от rejectedAt, а не написаны числом', () => {
    const now = new Date('2026-08-01T12:00:00Z');
    const justNow = new Date(now.getTime() - 1000);
    const almostOver = new Date(now.getTime() - REJECTION_COOLDOWN_MS + 60_000);

    expect(accessRejectedText(justNow, now)).toContain('24 ч');
    expect(accessRejectedText(almostOver, now)).toContain('1 ч');
  });

  it('сообщение об открытии доступа зовёт в меню, а не в настройки', () => {
    // Меню приезжает вместе с этим сообщением reply-клавиатурой; отправлять
    // человека куда-то ещё значило бы добавить шаг на ровном месте.
    expect(ACCESS_GRANTED_TEXT).toContain('меню');
  });
});
