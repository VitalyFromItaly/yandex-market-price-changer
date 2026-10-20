import type { HelpResponse } from '../help.domain';

import { describe, expect, it } from 'vitest';

import { mapHelp, telegramUrl } from './mapHelp.help';

const RESPONSE: HelpResponse = {
  title: 'Справка',
  sections: [
    {
      title: 'Обновление остатков',
      blocks: [
        { kind: 'text', spans: ['Добавьте подпись ', { code: 'проверка' }, ':\nбот сверит'] },
        {
          kind: 'list',
          ordered: true,
          items: [['Откройте кабинет'], ['Значок → ', { bold: 'Настройки' }]],
        },
        { kind: 'list', items: [['🚚 Уехало клиенту — …']] },
        { kind: 'lines', items: [[{ code: '/start' }, ' — начать сначала']] },
      ],
    },
  ],
  supportContact: '@Vitality45',
};

describe('mapHelp', () => {
  it('три формы куска — один вид для шаблона', () => {
    const blocks = mapHelp(RESPONSE).sections[0]?.blocks ?? [];
    expect(blocks[0]).toEqual({
      kind: 'text',
      spans: [
        { kind: 'text', text: 'Добавьте подпись ' },
        { kind: 'code', text: 'проверка' },
        { kind: 'text', text: ':\nбот сверит' },
      ],
    });
    expect(blocks[1]).toMatchObject({ kind: 'list', ordered: true });
    expect(blocks[2]).toMatchObject({ kind: 'list', ordered: false });
    expect(blocks[3]).toMatchObject({ kind: 'lines' });
  });

  it('контакт поддержки — ссылкой на Telegram', () => {
    expect(mapHelp(RESPONSE)).toMatchObject({
      supportContact: '@Vitality45',
      supportUrl: 'https://t.me/Vitality45',
    });
  });

  it('не ник — без ссылки', () => {
    expect(telegramUrl('support@example.com')).toBeNull();
    expect(telegramUrl('@a b')).toBeNull();
  });
});
