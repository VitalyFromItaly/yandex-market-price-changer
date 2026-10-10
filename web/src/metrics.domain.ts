/**
 * Подписи и форматирование страницы «Метрики». Отдельным модулем, как
 * users.domain.ts: обзор показывает строку той же сводки, и две копии подписей
 * назвали бы одно и то же по-разному на двух экранах.
 */

const KIND_LABEL: Record<string, string> = {
  command: 'Команды',
  menu: 'Кнопки меню',
  callback: 'Inline-кнопки',
  document: 'Файлы',
  text: 'Текст',
  other: 'Прочее',
};

export function kindLabel(kind: string): string {
  return KIND_LABEL[kind] ?? kind;
}

const PROBE_LABEL: Record<string, string> = {
  telegram: 'Зеркало Telegram (getMe)',
  yandex: 'API Маркета',
  redis: 'Redis',
};

export function probeLabel(key: string): string {
  return PROBE_LABEL[key] ?? key;
}

const REFUSED_LABEL: Record<string, string> = {
  access: 'нет доступа',
  feature: 'закрытая функция',
};

export function refusedLabel(key: string): string {
  return REFUSED_LABEL[key] ?? key;
}

/** Расшифровка частых кодов Bot API — чтобы «403» не приходилось гуглить. */
const OUTCOME_LABEL: Record<string, string> = {
  '400': '400 · неверный запрос',
  '403': '403 · бот заблокирован',
  '409': '409 · конфликт webhook/polling',
  '429': '429 · лимит Telegram',
  network: 'нет ответа (сеть/зеркало)',
};

export function outcomeLabel(outcome: string): string {
  return OUTCOME_LABEL[outcome] ?? outcome;
}

export function formatMs(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return '—';
  if (ms < 1000) return `${ms} мс`;
  return `${(ms / 1000).toFixed(1).replace('.', ',')} с`;
}

export function formatCount(n: number): string {
  return n.toLocaleString('ru-RU');
}

/** Доля в процентах с одним знаком; 0 из 0 — прочерк, а не «NaN %». */
export function formatShare(part: number, whole: number): string {
  if (!whole) return '—';
  return `${((part / whole) * 100).toFixed(1).replace('.', ',')} %`;
}

const STAMP = new Intl.DateTimeFormat('ru-RU', {
  timeZone: 'Europe/Moscow',
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});

export function formatStamp(ms: number): string {
  return STAMP.format(new Date(ms));
}
