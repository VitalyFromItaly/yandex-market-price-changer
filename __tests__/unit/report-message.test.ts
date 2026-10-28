import { describe, expect, it } from 'vitest';

import { OzonApiError, OzonAuthError } from '../../src/modules/ozon/ozon.errors';
import { WbIncompleteResponseError } from '../../src/modules/wb/wb.errors';
import { YandexRateLimitError } from '../../src/modules/yandex/yandex-api.errors';
import { reportErrorMessage } from '../../src/modules/yandex/reports/report-message';

/**
 * Текст сбоя для продавца: свой у каждой площадки. До правки любая ошибка не
 * Яндекса читалась «Не удалось собрать отчёт» — и в алерте «Передачи остатков»
 * было не понять, что упало у Ozon/WB.
 */
describe('reportErrorMessage', () => {
  it('ЯМ, Ozon и WB — свой текст площадки, без внутренностей', () => {
    expect(reportErrorMessage(new YandexRateLimitError('420', 420, {}))).toContain('лимит');
    expect(reportErrorMessage(new OzonApiError('Request failed with status code 404', 404))).toBe(
      'Ozon сейчас не отвечает. Попробуйте позже.',
    );
    expect(reportErrorMessage(new OzonAuthError('Invalid Api-Key', 401))).toMatch(
      /^Ozon не принял ключ/,
    );
    expect(reportErrorMessage(new WbIncompleteResponseError('x', 'отчёт реализации'))).toContain(
      'отчёт реализации',
    );
  });

  it('прочее — общий текст', () => {
    expect(reportErrorMessage(new Error('boom'))).toBe(
      'Не удалось собрать отчёт. Попробуйте позже.',
    );
    expect(reportErrorMessage(null)).toBe('Не удалось собрать отчёт. Попробуйте позже.');
    expect(reportErrorMessage({ userMessage: '' })).toBe(
      'Не удалось собрать отчёт. Попробуйте позже.',
    );
  });
});
