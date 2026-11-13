import { unzipSync } from 'fflate';

/**
 * Разбор отчёта Маркета в format=JSON: это НЕ JSON, а ZIP-архив с одним
 * JSON-файлом на каждый лист отчёта (ReportFormatType в спеке).
 *
 * fflate — явная зависимость: импорт финансовых отчётов (TASK-111) живёт в
 * проде, а zlib умеет только deflate-поток без ZIP-обёртки — пришлось бы
 * писать разбор central directory руками. adm-zip в node_modules есть только
 * через devDependency onnxruntime-node и в прод-образ не попадает.
 *
 * Лист — имя файла без расширения: так Маркет называет листы и в xlsx.
 *
 * Память (OOM на проде 08–13.11.2026, алерт MemoryPressureError на частом импорте
 * журнала ЯМ: +2,6 ГБ RSS за минуту). Лист распаковывается и разбирается ПО ОДНОМУ:
 * распакованные байты, их строка (кириллица — два байта на символ) и разобранный
 * объект одного листа отпускаются до следующего. Раньше `unzipSync` без фильтра
 * держал распакованными все листы сразу, а под ними — строки и объекты. Освобождённое
 * musl (образ alpine) в ОС почти не возвращает, поэтому пик здесь = RSS надолго.
 * `project` — ужать лист сразу после разбора (оставить только нужные поля), чтобы
 * до конца задачи жили не сырые строки, а их выжимка.
 */
export function unzipReportJson(
  buffer: Uint8Array,
  project: (sheet: string, data: unknown) => unknown = (_sheet, data) => data,
): Map<string, unknown> {
  const names: string[] = [];
  try {
    // Только оглавление: фильтр «нет» — ничего не распаковывается.
    unzipSync(buffer, {
      filter: (file) => {
        if (!file.name.endsWith('/')) names.push(file.name); // каталог внутри архива
        return false;
      },
    });
  } catch (error) {
    throw new Error(`Файл отчёта — не ZIP-архив: ${(error as Error).message}`);
  }

  const decoder = new TextDecoder('utf-8');
  const sheets = new Map<string, unknown>();

  for (const name of names) {
    const sheet = name.replace(/^.*\//, '').replace(/\.json$/i, '');
    const content = unzipSync(buffer, { filter: (file) => file.name === name })[name];
    let data: unknown;
    try {
      data = JSON.parse(decoder.decode(content));
    } catch (error) {
      throw new Error(`Лист «${sheet}» отчёта — не JSON: ${(error as Error).message}`);
    }
    sheets.set(sheet, project(sheet, data));
  }

  return sheets;
}
