/**
 * Разбор времени рассылки.
 *
 * Пользователи пишут время как придётся: «9», «9:00», «09.00», «21-30».
 * Отказывать на каждом отклонении — верный способ, чтобы рассылку не включил
 * никто; принимать что угодно — способ получить задачу на 90:00. Поэтому
 * распространённые записи нормализуются, а всё остальное отвергается
 * с внятным текстом.
 *
 * Результат ВСЕГДА трактуется как Europe/Moscow — см. ReportSchedule.
 */

export const DEFAULT_SCHEDULE_TIME = '09:00';

export interface IScheduleTime {
  hours: number;
  minutes: number;
  /** Нормализованный вид «ЧЧ:ММ». */
  value: string;
}

export interface IParseResult {
  ok: boolean;
  time?: IScheduleTime;
  error?: string;
}

export function parseScheduleTime(input: string): IParseResult {
  const raw = (input ?? '').trim();
  if (!raw) {
    return { ok: false, error: 'Укажите время в формате ЧЧ:ММ, например 09:00.' };
  }

  // Разделителем может быть двоеточие, точка, дефис или пробел; голое число
  // означает целый час.
  const match = raw.match(/^(\d{1,2})(?:\s*[:.\-\s]\s*(\d{1,2}))?$/);
  if (!match) {
    return {
      ok: false,
      error: `Не понял время «${raw}». Нужен формат ЧЧ:ММ, например 09:00 или 21:30.`,
    };
  }

  const hours = Number(match[1]);
  const minutes = match[2] === undefined ? 0 : Number(match[2]);

  if (hours > 23) {
    return { ok: false, error: `Часы должны быть от 0 до 23, а получили ${hours}.` };
  }
  if (minutes > 59) {
    return { ok: false, error: `Минуты должны быть от 0 до 59, а получили ${minutes}.` };
  }

  return {
    ok: true,
    time: { hours, minutes, value: `${pad(hours)}:${pad(minutes)}` },
  };
}

/** Строка «ЧЧ:ММ» → cron-выражение Bull. */
export function toCron(time: string): string {
  const parsed = parseScheduleTime(time);
  if (!parsed.ok) throw new Error(`Некорректное время расписания: ${time}`);
  // Порядок полей: минуты часы день месяц день_недели.
  return `${parsed.time.minutes} ${parsed.time.hours} * * *`;
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}
