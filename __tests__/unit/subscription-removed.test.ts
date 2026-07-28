import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * Забор от возвращения системы подписок.
 *
 * Подписка была фикцией: каждому новому пользователю молча выдавалась
 * бесплатная неделя, кнопки тарифов лишь перерисовывали сообщение ценником, не
 * записывая ничего в базу, а проверка стояла ровно в одном обработчике — /start,
 * так что загрузка прайса её обходила. Текст про подписку легко возвращается
 * копипастой из старых сообщений, и заметить это в ревью тяжело.
 *
 * Тот же приём, что в menu-labels.test.ts: инвариант проверяется чтением
 * исходников как текста.
 */
describe('Система подписок удалена (TASK-036)', () => {
  const SRC = resolve(__dirname, '../../src');

  /** Сгенерированный OpenAPI-клиент трогать нельзя, и подписка Яндекс.Плюс там своя. */
  const SKIP = ['modules/yandex/api', 'modules/yandex/api-docs'].map((p) => join(SRC, p));

  function tsFiles(dir: string): string[] {
    if (SKIP.some((skipped) => dir.startsWith(skipped))) return [];
    return readdirSync(dir).flatMap((entry) => {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) return tsFiles(full);
      return full.endsWith('.ts') ? [full] : [];
    });
  }

  /**
   * Комментарии отбрасываем: удалённые сущности продолжают упоминаться в
   * пояснениях «почему это сняли» — например, TryCatch.ts хранит разбор того,
   * как проглоченное исключение ломало проверку подписки. Такие записи ценны,
   * а вот живого кода с ними остаться не должно.
   */
  const files = tsFiles(SRC).map((path) => ({
    path: path.slice(SRC.length + 1),
    code: readFileSync(path, 'utf8')
      .split('\n')
      .filter((line) => {
        const trimmed = line.trimStart();
        return !trimmed.startsWith('//') && !trimmed.startsWith('*') && !trimmed.startsWith('/*');
      })
      .join('\n'),
  }));

  const hitsFor = (pattern: RegExp) =>
    files.filter((f) => pattern.test(f.code)).map((f) => f.path);

  it.each([
    'SubscriptionService',
    'SubscriptionSchema',
    'ISubscriptionSchema',
    'createSubscriptionPlansMenu',
    'checkUserSubscription',
    'TelegramUserService',
  ])('в src не осталось упоминаний %s', (symbol) => {
    expect(hitsFor(new RegExp(symbol))).toEqual([]);
  });

  it.each(['plan_day', 'plan_week', 'plan_month', 'plan_year', 'plan_cancel'])(
    'callback_data тарифа %s не отправляется и не обрабатывается',
    (data) => {
      expect(hitsFor(new RegExp(data))).toEqual([]);
    },
  );

  it('слово «Подписка» не показывается пользователю', () => {
    expect(hitsFor(/подписк/i)).toEqual([]);
  });

  it('файлы схемы и сервиса подписок удалены', () => {
    const paths = files.map((f) => f.path);
    expect(paths).not.toContain('database/schemas/subscription.schema.ts');
    expect(paths).not.toContain('database/services/subscription.service.ts');
    expect(paths).not.toContain(
      'modules/telegram/bots/shared/services/telegram-user.service.ts',
    );
  });
});
