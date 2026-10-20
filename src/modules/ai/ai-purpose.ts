/**
 * Назначения (`purpose`) запросов к Polza — закрытый список.
 *
 * Лист без импортов: его читают и `env.validation.ts` (известные purpose для
 * POLZA_AI_MODELS), и модули-потребители. Константы назначений по-прежнему живут
 * у своих модулей, но типизированы `TAiPurpose` — новое назначение без строки
 * здесь не скомпилируется, а значит не останется без своей модели в env.
 */

export type TAiPurpose = 'feedback-reply' | 'weekly-digest' | 'period-review' | 'analyst' | 'eval';

/** Record, а не массив: компилятор требует описание для каждого нового назначения. */
export const AI_PURPOSES: Record<TAiPurpose, string> = {
  'feedback-reply': 'черновик ответа на отзыв',
  'weekly-digest': 'еженедельная сводка в Telegram',
  'period-review': 'разбор периода',
  analyst: 'чат ИИ-аналитика с инструментами',
  eval: 'контрольный прогон вопросов (scripts/eval-ai-analyst.ts)',
};

/** purpose чата ИИ-аналитика — умолчание `AiAnalystService.ask`. */
export const ANALYST_PURPOSE: TAiPurpose = 'analyst';

export function isAiPurpose(value: string): value is TAiPurpose {
  return Object.hasOwn(AI_PURPOSES, value);
}

export type TAiModelOverrides = { models: Map<TAiPurpose, string> } | { error: string };

/**
 * Разбор `POLZA_AI_MODELS`: `purpose=model` через запятую. Пусто — нет
 * переопределений. Ошибка — текст без имени переменной (его добавляет
 * вызывающий): кривая пара, незнакомый purpose, повтор.
 */
export function parseAiModelOverrides(raw: string | undefined): TAiModelOverrides {
  const models = new Map<TAiPurpose, string>();
  for (const pair of (raw ?? '').split(',')) {
    if (!pair.trim()) continue;
    const eq = pair.indexOf('=');
    const purpose = eq < 0 ? '' : pair.slice(0, eq).trim();
    const model = eq < 0 ? '' : pair.slice(eq + 1).trim();
    if (!purpose || !model) {
      return { error: `пара '${pair.trim()}' не в виде purpose=модель` };
    }
    if (!isAiPurpose(purpose)) {
      return {
        error: `неизвестное назначение '${purpose}' — допустимы: ${Object.keys(AI_PURPOSES).join(', ')}`,
      };
    }
    if (models.has(purpose)) return { error: `назначение '${purpose}' указано дважды` };
    models.set(purpose, model);
  }
  return { models };
}
