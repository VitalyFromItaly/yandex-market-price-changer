import { isMenuLabel, isStartCommand } from './access.domain';

/**
 * Чистая логика журнала действий: без telegraf, без Mongo, без Nest.
 *
 * Здесь же живёт маскировка секретов — единственное место, где решается, что
 * именно уедет в базу. Вынесено сюда ровно потому, что ошибка в этом решении
 * не даёт ни ошибки компиляции, ни падения: журнал просто начинает копить
 * чужие токены, и заметить это можно только заглянув в коллекцию.
 */

/** Что за действие совершил пользователь. */
export type TActionKind =
  | 'command' // слэш-команда
  | 'menu' // кнопка reply-клавиатуры
  | 'callback' // inline-кнопка
  | 'document' // прислан файл
  | 'text' // свободный текст
  | 'other'; // всё остальное: фото, стикер, сервисное сообщение

/** Сколько символов действия хранить. Сообщение телеграма бывает до 4096. */
export const MAX_ACTION_LENGTH = 200;

/** Чем заменяется вырезанный секрет. */
export const SECRET_PLACEHOLDER = '«скрыто»';

/**
 * Токен Яндекс.Маркета: длинная непрозрачная строка без пробелов.
 *
 * Порог в 20 символов выбран так, чтобы под него не попадала обычная речь:
 * русские слова такой длины единичны, а команды и подписи кнопок короче.
 */
const OPAQUE_SECRET = /^[A-Za-z0-9_\-.:+/=]{20,}$/;

/**
 * `токен: ACMA...` — формат подсказки визарда и экрана изменения настроек.
 *
 * Без `\b` перед подписью, и это не небрежность: `\b` в JavaScript — граница
 * ASCII-слова, а перед кириллической «т» её нет вовсе. С `\b` выражение молча
 * не находило русскую подпись, то есть маскировался ровно тот случай, который
 * бот сам и просит прислать.
 */
const LABELLED_SECRET = /(токен|token|api[_-]?key)\s*:\s*\S+/gi;

/** Идентификаторы кампании и бизнеса: 5–15 цифр подряд. */
const NUMERIC_ID = /\b\d{5,15}\b/g;

/**
 * Убирает из текста то, что не должно оседать в журнале.
 *
 * Три категории, и все три реальные, а не гипотетические:
 *
 * 1. Токен Партнёрского API. Во время регистрации продавец присылает его
 *    ОБЫЧНЫМ СООБЩЕНИЕМ — то есть без маскировки журнал стал бы второй копией
 *    чужих доступов, причём в коллекции, которую завели ради удобства чтения.
 * 2. `campaign_id` / `business_id`. Их и продавцу-то не показывают (они не
 *    вводятся руками и не выводятся ни на одном экране), так что и здесь им
 *    делать нечего.
 * 3. Те же значения с подписью — `токен: …`: экран изменения настроек просит
 *    присылать именно в таком виде.
 */
export function maskSecrets(text: string): string {
  const trimmed = text.trim();
  if (OPAQUE_SECRET.test(trimmed)) return SECRET_PLACEHOLDER;

  return trimmed
    .replace(LABELLED_SECRET, (_match, label: string) => `${label}: ${SECRET_PLACEHOLDER}`)
    .replace(NUMERIC_ID, SECRET_PLACEHOLDER);
}

/** Обрезает длинный текст, честно помечая обрезку. */
export function truncate(text: string, limit = MAX_ACTION_LENGTH): string {
  return text.length <= limit ? text : `${text.slice(0, limit)}…`;
}

/** Апдейт в том виде, в каком его читает журнал. */
export interface IActionSource {
  text?: string;
  callbackData?: string;
  documentName?: string;
}

export interface IActionDescription {
  kind: TActionKind;
  action: string;
}

/**
 * Классификация действия и его человекочитаемое описание.
 *
 * Классы намеренно другие, чем у classifyUpdate из access.domain: тот отвечает
 * на вопрос «пускать ли», и `/start` для него отдельный вид, потому что
 * доступен всегда. Здесь вопрос другой — «что человек сделал», и `/start` в нём
 * ничем не выделяется среди команд. Свести их в один список значило бы, что
 * изменение правил доступа молча меняет разметку журнала.
 */
export function describeAction(input: IActionSource): IActionDescription {
  if (input.callbackData !== undefined) {
    return { kind: 'callback', action: truncate(input.callbackData) };
  }

  if (input.documentName !== undefined) {
    return { kind: 'document', action: truncate(input.documentName) };
  }

  const text = input.text;
  if (text === undefined) return { kind: 'other', action: '—' };

  if (isStartCommand(text) || text.startsWith('/')) {
    // Команда может нести аргумент (deep-link у /start), а он произвольный.
    return { kind: 'command', action: truncate(maskSecrets(text)) };
  }

  if (isMenuLabel(text)) return { kind: 'menu', action: truncate(text) };

  return { kind: 'text', action: truncate(maskSecrets(text)) };
}

/** Имя и фамилия одной строкой; пусто, если не заданы. */
export function fullName(firstName?: string, lastName?: string): string | undefined {
  const name = [firstName, lastName].filter(Boolean).join(' ').trim();
  return name || undefined;
}
