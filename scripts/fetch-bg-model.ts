import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';

import { DEFAULT_MODEL_PATH, MODELS_DIR, MODEL_DOWNLOAD_URL, MODEL_MD5 } from '../src/modules/imaging/paths';

/**
 * Разовое скачивание весов модели вырезания фона (~170 МБ).
 *
 * Отдельным шагом, а не автоматически при первом запуске: 170 МБ по сети — это
 * то, о чём человек должен знать заранее, а не обнаруживать в виде «скрипт
 * почему-то висит».
 *
 * ВАЖНО для будущего переезда в бота: в проде качать нельзя. Прод стоит на
 * российском хостинге, где внешние домены недоступны так же, как
 * `api.telegram.org` (ровно поэтому в проекте есть TELEGRAM_API_URL). Файл
 * должен попадать в образ через COPY на этапе сборки.
 *
 * Запуск:
 *   npm run image:fetch-model [-- --force]
 */

function md5(file: string): string {
  return createHash('md5').update(readFileSync(file)).digest('hex');
}

async function main(): Promise<void> {
  const force = process.argv.includes('--force');

  if (existsSync(DEFAULT_MODEL_PATH) && !force) {
    const actual = md5(DEFAULT_MODEL_PATH);

    if (actual === MODEL_MD5) {
      console.log(`Модель уже на месте: ${DEFAULT_MODEL_PATH}`);
      return;
    }

    console.log(`Контрольная сумма не совпала (${actual}), качаем заново.`);
  }

  mkdirSync(MODELS_DIR, { recursive: true });

  console.log(`Качаю ${basename(DEFAULT_MODEL_PATH)} (~170 МБ)…`);
  const response = await fetch(MODEL_DOWNLOAD_URL);

  if (!response.ok) {
    throw new Error(`${MODEL_DOWNLOAD_URL} ответил ${response.status} ${response.statusText}`);
  }

  // Пишем во временный файл и переименовываем: оборванная закачка иначе
  // осталась бы под правильным именем, и следующий запуск нашёл бы «модель»,
  // на которой onnxruntime падает с невнятной ошибкой формата.
  const temporary = `${DEFAULT_MODEL_PATH}.part`;
  writeFileSync(temporary, Buffer.from(await response.arrayBuffer()));

  const actual = md5(temporary);
  if (actual !== MODEL_MD5) {
    throw new Error(`Контрольная сумма не совпала: ожидалась ${MODEL_MD5}, получена ${actual}.`);
  }

  renameSync(temporary, DEFAULT_MODEL_PATH);
  console.log(`Готово: ${DEFAULT_MODEL_PATH}`);
}

main().catch((error: Error) => {
  console.error(`Не удалось скачать модель: ${error.message}`);
  process.exit(1);
});
