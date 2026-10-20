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
 */
export function unzipReportJson(buffer: Uint8Array): Map<string, unknown> {
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(buffer);
  } catch (error) {
    throw new Error(`Файл отчёта — не ZIP-архив: ${(error as Error).message}`);
  }

  const decoder = new TextDecoder('utf-8');
  const sheets = new Map<string, unknown>();

  for (const [name, content] of Object.entries(entries)) {
    if (name.endsWith('/')) continue; // каталог внутри архива
    const sheet = name.replace(/^.*\//, '').replace(/\.json$/i, '');
    try {
      sheets.set(sheet, JSON.parse(decoder.decode(content)));
    } catch (error) {
      throw new Error(`Лист «${sheet}» отчёта — не JSON: ${(error as Error).message}`);
    }
  }

  return sheets;
}
