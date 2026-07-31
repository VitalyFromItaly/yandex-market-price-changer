import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, extname, join } from 'node:path';

import sharp from 'sharp';

import { BackgroundRemover } from '../src/modules/imaging/background-removal.service';
import { DEFAULT_MODEL_PATH, SCENES_DIR } from '../src/modules/imaging/paths';
import { composeScene } from '../src/modules/imaging/scene-composer';
import { loadScenePreset } from '../src/modules/imaging/scene-preset';

import type { IComposeOptions } from '../src/modules/imaging/scene-composer';

/**
 * Сборка карточек товара: фото часов на белом фоне → фирменная тёмная сцена.
 *
 * Запуск:
 *   npx ts-node scripts/compose-product-image.ts --in=photos/ --out=cards/
 *   npx ts-node scripts/compose-product-image.ts --in=g-shock.jpg --out=cards/ --debug
 *
 * Аргументы:
 *   --in       файл или каталог с исходниками (обязателен)
 *   --out      каталог для результата (обязателен)
 *   --scene    имя пресета из каталога сцен (по умолчанию all-best-watch-dark)
 *   --scenes-dir  где искать пресеты (по умолчанию assets/scenes)
 *   --format   png (по умолчанию) | jpeg | webp
 *   --quality  качество для jpeg/webp, по умолчанию 92
 *   --model    путь к .onnx, если нужен не тот, что по умолчанию
 *   --debug    дополнительно сохранить маску и вырезанный объект в <out>/debug
 *   --alpha-floor  ниже какого покрытия пиксель считать фоном (по умолчанию 0.04)
 *
 * Про --alpha-floor. Там, где модель не уверена, остаётся полупрозрачный
 * лоскут белого фона — на тёмной сцене он выглядит светлым призраком (чаще
 * всего в просветах браслета). Порог 0.2–0.3 такие лоскуты срезает; платой
 * идёт чуть более резкий край, потому что срезается и начало мягкой границы.
 * Смотреть на это удобно в паре с --debug.
 *
 * Каталог обходится НЕ рекурсивно и по одному файлу за раз: модель занимает
 * около 170 МБ, и параллельная обработка упирается не в процессор, а в память.
 */

const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.tif', '.tiff']);

/** Выше этого растяжения исходник виден как мыло — предупреждаем, но делаем. */
const UPSCALE_WARNING = 1.5;

interface IArgs {
  in: string;
  out: string;
  scene: string;
  scenesDir: string;
  format: IComposeOptions['format'];
  quality: number;
  model: string;
  debug: boolean;
  alphaFloor?: number;
}

function parseArgs(argv: string[]): IArgs {
  const value = (name: string): string | undefined => argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];

  const input = value('in');
  const output = value('out');

  if (!input) throw new Error('Нужен --in=<файл или каталог с фото>');
  if (!output) throw new Error('Нужен --out=<каталог для карточек>');

  const format = (value('format') ?? 'png') as IComposeOptions['format'];
  if (!['png', 'jpeg', 'webp'].includes(format)) {
    throw new Error(`Неизвестный формат «${format}»: допустимы png, jpeg, webp.`);
  }

  const alphaFloor = value('alpha-floor') === undefined ? undefined : Number(value('alpha-floor'));
  if (alphaFloor !== undefined && !(alphaFloor >= 0 && alphaFloor < 1)) {
    throw new Error(`--alpha-floor должен быть в [0, 1), получено «${value('alpha-floor')}».`);
  }

  return {
    in: input,
    out: output,
    alphaFloor,
    scene: value('scene') ?? 'all-best-watch-dark',
    scenesDir: value('scenes-dir') ?? SCENES_DIR,
    format,
    quality: Number(value('quality') ?? 92),
    model: value('model') ?? DEFAULT_MODEL_PATH,
    debug: argv.includes('--debug'),
  };
}

function collectSources(target: string): string[] {
  if (!existsSync(target)) {
    throw new Error(`Не найдено: ${target}`);
  }

  if (!statSync(target).isDirectory()) {
    return [target];
  }

  return readdirSync(target)
    .filter((name) => IMAGE_EXTENSIONS.has(extname(name).toLowerCase()))
    .sort()
    .map((name) => join(target, name));
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  const preset = loadScenePreset(args.scene, args.scenesDir);
  if (!existsSync(preset.templatePath)) {
    throw new Error(`Фон сцены не найден: ${preset.templatePath}`);
  }

  // Проверяем модель ДО обхода файлов. Иначе на каталоге в тысячу карточек одна
  // и та же ошибка загрузки повторится тысячу раз — по разу на файл.
  if (!existsSync(args.model)) {
    throw new Error(`Модель не найдена: ${args.model}\nСкачайте её командой: npm run image:fetch-model`);
  }

  const sources = collectSources(args.in);
  if (sources.length === 0) {
    throw new Error(`В каталоге ${args.in} нет картинок.`);
  }

  mkdirSync(args.out, { recursive: true });
  const debugDir = join(args.out, 'debug');
  if (args.debug) mkdirSync(debugDir, { recursive: true });

  const remover = new BackgroundRemover(args.model);
  const extension = args.format === 'jpeg' ? '.jpg' : `.${args.format}`;

  let failed = 0;

  for (const source of sources) {
    const name = basename(source, extname(source));
    const started = Date.now();

    try {
      const cutout = await remover.cutout(readFileSync(source), { floor: args.alphaFloor });

      if (!cutout.bounds) {
        throw new Error('модель не нашла объекта — проверьте, что фон действительно светлый');
      }

      if (args.debug) {
        await sharp(cutout.mask, { raw: { width: cutout.width, height: cutout.height, channels: 1 } })
          .png()
          .toFile(join(debugDir, `${name}.mask.png`));

        await sharp(cutout.data, { raw: { width: cutout.width, height: cutout.height, channels: 4 } })
          .png()
          .toFile(join(debugDir, `${name}.cutout.png`));
      }

      const card = await composeScene(cutout, preset, { format: args.format, quality: args.quality });
      const target = join(args.out, `${name}${extension}`);
      writeFileSync(target, card.data);

      const seconds = ((Date.now() - started) / 1000).toFixed(1);
      console.log(`✓ ${name} → ${target} (${seconds} с)`);

      if (card.placement.scale > UPSCALE_WARNING) {
        const times = card.placement.scale.toFixed(1);
        console.log(`  ! объект растянут в ${times} раза — исходник мелкий, возможна потеря резкости`);
      }
    } catch (error) {
      failed += 1;
      console.error(`✗ ${name}: ${(error as Error).message}`);
    }
  }

  console.log(`\nГотово: ${sources.length - failed} из ${sources.length}.`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((error: Error) => {
  console.error(error.message);
  process.exit(1);
});
