/**
 * Попиксельная доводка вырезанного объекта.
 *
 * Модель сегментации даёт маску, но не даёт ЦВЕТ объекта на границе. А граница —
 * это ровно то место, где композит на тёмный фон разваливается: краевой пиксель
 * исходника не принадлежит ни часам, ни фону, он их СМЕСЬ. На белом фоне смесь
 * незаметна, на чёрном она превращается в светлый ореол по контуру и в белые
 * «сопли» в просветах между звеньями браслета.
 *
 * Обычно с этим борются на глаз — подрезают маску на пиксель-другой и размывают.
 * Здесь этого не нужно: фон исходника ИЗВЕСТЕН (белый студийный), а значит смесь
 * разбирается точно. Наблюдаемый цвет — это
 *
 *     C = F·α + BG·(1 − α),
 *
 * где F — искомый цвет объекта, BG — фон, α — покрытие из маски. Отсюда
 *
 *     F = (C − BG·(1 − α)) / α.
 *
 * Это стандартный unpremultiply относительно известного фона, а не эвристика:
 * ореол не маскируется, а вычитается.
 *
 * Модуль намеренно не знает ни про sharp, ни про onnxruntime — на входе и выходе
 * обычный RGBA-буфер. Поэтому он проверяется юнит-тестом на десятке пикселей,
 * без модели весом 170 МБ.
 */

/** Белый студийный фон — то, на чём снимают товар поставщики. */
export const WHITE_BACKGROUND: readonly [number, number, number] = [255, 255, 255];

/**
 * Ниже этого покрытия пиксель считается фоном.
 *
 * Нужен не только ради чистоты: при α → 0 деление в формуле выше усиливает шум
 * маски до произвольного цвета. Такие пиксели почти прозрачны, но при наложении
 * тени и отражения их мусор становится видимым.
 */
const DEFAULT_FLOOR = 0.04;

/** Выше этого покрытия пиксель считается полностью непрозрачным. */
const DEFAULT_CEIL = 0.96;

export interface IRefineOptions {
  /** Порог, ниже которого пиксель обнуляется. Доля, 0..1. */
  floor?: number;
  /** Порог, выше которого пиксель становится полностью непрозрачным. Доля, 0..1. */
  ceil?: number;
  /** Цвет фона исходника. По умолчанию белый. */
  background?: readonly [number, number, number];
}

export interface IBounds {
  left: number;
  top: number;
  width: number;
  height: number;
}

const CHANNELS = 4;
const MAX_BYTE = 255;

function clampByte(value: number): number {
  return Math.round(Math.min(MAX_BYTE, Math.max(0, value)));
}

/**
 * Восстанавливает цвет объекта в одном канале, снимая примесь фона.
 */
function unmix(observed: number, background: number, alpha: number): number {
  return clampByte((observed - background * (1 - alpha)) / alpha);
}

/**
 * Снимает кайму фона и подрезает хвосты маски.
 *
 * На входе RGBA, где альфа — это маска модели, а RGB — исходные (смешанные с
 * фоном) цвета. На выходе RGBA, пригодный для наложения на любой фон.
 *
 * Порядок операций важен: цвет восстанавливается по ИСХОДНОЙ альфе модели —
 * это физика смешивания, — и только потом альфа растягивается в 0..1. Сделать
 * наоборот значило бы подставить в формулу покрытие, которого в кадре не было.
 */
export function refineCutout(rgba: Buffer, options: IRefineOptions = {}): Buffer {
  const floor = options.floor ?? DEFAULT_FLOOR;
  const ceil = options.ceil ?? DEFAULT_CEIL;
  const [bgR, bgG, bgB] = options.background ?? WHITE_BACKGROUND;

  if (rgba.length % CHANNELS !== 0) {
    throw new Error(`Ожидался RGBA-буфер: длина ${rgba.length} не кратна 4.`);
  }
  if (!(floor < ceil)) {
    throw new Error(
      `Пороги маски заданы неверно: floor (${floor}) должен быть меньше ceil (${ceil}).`,
    );
  }

  const out = Buffer.allocUnsafe(rgba.length);
  const span = ceil - floor;

  for (let i = 0; i < rgba.length; i += CHANNELS) {
    const alpha = rgba[i + 3] / MAX_BYTE;

    if (alpha <= floor) {
      // Цвет тоже обнуляем, а не оставляем как есть: прозрачные пиксели с белым
      // RGB всплывают при масштабировании — интерполяция подмешивает их в край.
      out[i] = 0;
      out[i + 1] = 0;
      out[i + 2] = 0;
      out[i + 3] = 0;
      continue;
    }

    out[i] = unmix(rgba[i], bgR, alpha);
    out[i + 1] = unmix(rgba[i + 1], bgG, alpha);
    out[i + 2] = unmix(rgba[i + 2], bgB, alpha);
    out[i + 3] = alpha >= ceil ? MAX_BYTE : clampByte(((alpha - floor) / span) * MAX_BYTE);
  }

  return out;
}

/**
 * Прямоугольник, за который объект не выходит.
 *
 * Считается по непрозрачным пикселям, а не по размеру файла: у исходников от
 * поставщика поля произвольные, и вписывать в подиум нужно сами часы, иначе
 * одинаково заданный масштаб даст на соседних карточках часы разного размера.
 *
 * @returns null, если непрозрачных пикселей нет вовсе (вырезание провалилось).
 */
export function alphaBounds(
  rgba: Buffer,
  width: number,
  height: number,
  threshold = 8,
): IBounds | null {
  let left = width;
  let top = height;
  let right = -1;
  let bottom = -1;

  for (let y = 0; y < height; y += 1) {
    const row = y * width * CHANNELS;

    for (let x = 0; x < width; x += 1) {
      if (rgba[row + x * CHANNELS + 3] < threshold) continue;

      if (x < left) left = x;
      if (x > right) right = x;
      if (y < top) top = y;
      bottom = y;
    }
  }

  if (right < 0) return null;

  return { left, top, width: right - left + 1, height: bottom - top + 1 };
}
