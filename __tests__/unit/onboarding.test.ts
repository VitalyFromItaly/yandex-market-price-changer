import { describe, it, expect } from 'vitest';
import {
  ONBOARDING_STEPS,
  ONBOARDING_TOTAL,
  nextStep,
  parseLabelledValue,
  stepNumber,
  stepPrompt,
  stepHelp,
  stepTitle,
  validateStep,
} from '../../src/modules/telegram/bots/price-changer-bot/onboarding';
import { ONBOARDING_CALLBACKS } from '../../src/modules/telegram/bots/shared/access.domain';

/**
 * Визард — это состояние, выведенное из черновика. Проверяется без telegraf и
 * без базы: шаг определяется тем, что уже собрано, а не формой присланной строки.
 */
describe('Порядок шагов', () => {
  it('три шага, токен первым', () => {
    expect(ONBOARDING_STEPS).toEqual(['token', 'campaign_id', 'business_id']);
    expect(ONBOARDING_TOTAL).toBe(3);
  });

  it('текущий шаг — первое незаполненное поле', () => {
    expect(nextStep(undefined)).toBe('token');
    expect(nextStep({})).toBe('token');
    expect(nextStep({ token: 'x' })).toBe('campaign_id');
    expect(nextStep({ token: 'x', campaign_id: '1' })).toBe('business_id');
    expect(nextStep({ token: 'x', campaign_id: '1', business_id: '2' })).toBeNull();
  });

  it('пропуск в середине черновика не сдвигает шаг вперёд', () => {
    // Черновик может оказаться дырявым — например, значение подписали явно.
    expect(nextStep({ business_id: '2' })).toBe('token');
    expect(nextStep({ token: 'x', business_id: '2' })).toBe('campaign_id');
  });

  it('номера шагов совпадают с тем, что видит пользователь', () => {
    for (const step of ONBOARDING_STEPS) {
      expect(stepPrompt(step)).toContain(`Шаг ${stepNumber(step)} из ${ONBOARDING_TOTAL}`);
    }
  });
});

describe('Подсказки', () => {
  it('инструкция требует доступ С ПРАВОМ ЗАПИСИ, а не read-only', () => {
    // Тест раньше закреплял ОБРАТНОЕ — read-only, с доводом «бот ничего не
    // меняет». Довод перестал быть верным: обновление остатков (TASK-035) —
    // это PUT, и с read-only токеном он вернёт 403, а продавцу придётся
    // выпускать токен заново, уже пройдя онбординг.
    const help = stepHelp('token');
    expect(help).toContain('Обработка заказов и учёт товаров');
    // И предупреждение, чтобы не выбрали доступ только на чтение.
    expect(help).toContain('Просмотр информации о заказах');
    expect(help).toContain('не сможет обновлять');
  });

  it('на каждый шаг есть развёрнутая инструкция', () => {
    for (const step of ['token', 'campaign_id', 'business_id'] as const) {
      expect(stepHelp(step).length).toBeGreaterThan(100);
    }
  });

  it('инструкция по Campaign ID предупреждает не путать с id магазина', () => {
    // Документация Яндекса выделяет это отдельным предупреждением: с
    // идентификатором магазина запросы к API работать не будут.
    expect(stepHelp('campaign_id')).toContain('идентификатором магазина');
  });

  it('каждый шаг спрашивает ровно одно значение', () => {
    const prompt = stepPrompt('token');
    expect(prompt).not.toContain('Campaign ID');
    expect(prompt).not.toContain('Business ID');
    expect(stepPrompt('campaign_id')).not.toContain('Business ID');
  });

  it('у каждого шага есть человеческое название для сообщения об ошибке', () => {
    for (const step of ONBOARDING_STEPS) {
      expect(stepTitle(step).length).toBeGreaterThan(0);
    }
  });
});

describe('Валидация по шагам', () => {
  it('токен: длина и допустимые символы', () => {
    expect(validateStep('token', 'ACMA:bhD15nJMV71y4UZPbAFO:e0035103').ok).toBe(true);
    expect(validateStep('token', 'коротк').ok).toBe(false);
    expect(validateStep('token', 'ACMA bhD15nJMV71y4UZPbAFO').ok).toBe(false);
    expect(validateStep('token', 'ACMA:bhD15nJMV71y4UZ\nPbAFO').ok).toBe(false);
  });

  it.each(['campaign_id', 'business_id'] as const)('%s: число из 5–15 цифр', (field) => {
    expect(validateStep(field, '12345').ok).toBe(true);
    expect(validateStep(field, '123456789012345').ok).toBe(true);
    expect(validateStep(field, '1234').ok).toBe(false);
    expect(validateStep(field, '1234567890123456').ok).toBe(false);
    expect(validateStep(field, '12a45').ok).toBe(false);
  });

  it('ошибка называет КОНКРЕТНОЕ поле, а не «не удалось определить тип»', () => {
    // Именно это сообщение и было симптомом отсутствия состояния.
    const result = validateStep('campaign_id', 'abc');
    expect(result.ok).toBe(false);
    expect(result.error).toContain('Campaign ID');
    expect(result.error).not.toContain('определить тип');
  });

  it('обрамляющие пробелы не считаются ошибкой — их приносит копипаста', () => {
    expect(validateStep('campaign_id', '  12345  ').ok).toBe(true);
  });
});

describe('Явно подписанное значение', () => {
  it.each([
    ['token: ACMA:xxx', 'token', 'ACMA:xxx'],
    ['campaign_id: 12345', 'campaign_id', '12345'],
    ['Business_ID : 67890', 'business_id', '67890'],
  ])('%s разбирается', (text, field, value) => {
    expect(parseLabelledValue(text)).toEqual({ field, value });
  });

  it('неподписанный текст остаётся значением текущего шага', () => {
    expect(parseLabelledValue('12345')).toBeNull();
    expect(parseLabelledValue('ACMA:bhD15nJMV71y4UZPbAFO')).toBeNull();
    expect(parseLabelledValue('привет: как дела')).toBeNull();
  });
});

describe('Прерывание визарда', () => {
  it('кнопка сброса проходит гейт для неодобренного пользователя', () => {
    // Иначе прервать визард было бы нечем: все остальные кнопки закрыты.
    expect(ONBOARDING_CALLBACKS).toContain('onboarding_restart');
  });
});
