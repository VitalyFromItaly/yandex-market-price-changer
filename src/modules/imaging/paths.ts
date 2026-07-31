import { join } from 'node:path';

/**
 * Пути к ресурсам модуля.
 *
 * Собраны в одном месте, потому что подъём `../../..` из `src/modules/imaging`
 * должен одинаково работать и под ts-node (из `src/`), и из собранного `dist/`.
 * Оба каталога лежат на одной глубине от корня репозитория, так что счёт совпадает —
 * ровно тот же приём, что в `main.ts` для статики админки. Разъехавшись по трём
 * файлам, эта арифметика однажды разойдётся и по значению.
 */
const ROOT_DIR = join(__dirname, '..', '..', '..');

export const ASSETS_DIR = join(ROOT_DIR, 'assets');

/** Шаблоны фонов и их пресеты. Отслеживаются гитом. */
export const SCENES_DIR = join(ASSETS_DIR, 'scenes');

/** Веса моделей. В .gitignore — скачиваются `npm run image:fetch-model`. */
export const MODELS_DIR = join(ASSETS_DIR, 'models');

/**
 * Модель вырезания фона по умолчанию.
 *
 * isnet-general-use из rembg: вход 1024×1024 против 320×320 у u2net, и разница
 * видна именно на том, что здесь важнее всего — тонких просветах между звеньями
 * браслета и краях металла.
 */
export const DEFAULT_MODEL_NAME = 'isnet-general-use.onnx';

export const DEFAULT_MODEL_PATH = join(MODELS_DIR, DEFAULT_MODEL_NAME);

/** Откуда качаются веса. Релиз rembg — тот же файл, что использует сам rembg. */
export const MODEL_DOWNLOAD_URL =
  'https://github.com/danielgatis/rembg/releases/download/v0.0.0/isnet-general-use.onnx';

/** MD5 из `rembg/sessions/dis_general_use.py` — проверка, что скачался файл, а не HTML заглушки. */
export const MODEL_MD5 = 'fc16ebd8b0c10d971d3513d564d01e29';
