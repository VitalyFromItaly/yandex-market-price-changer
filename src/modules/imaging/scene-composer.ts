import type { ICutout } from './background-removal.service';
import type { IPlacement, ISize } from './geometry';
import type { IScenePreset } from './scene-preset';
import type { Sharp } from 'sharp';

import sharp from 'sharp';

import { planPlacement } from './geometry';

/**
 * Сборка карточки: вырезанный товар ставится в фирменную сцену.
 *
 * Слои снизу вверх: фон → тень → отражение → товар. Порядок не косметический:
 * тень должна лежать ПОД отражением, иначе отражение проступает сквозь неё и
 * подиум выглядит стеклянным.
 *
 * Тень и отражение считаются не «для красоты». Исходник снят на плоском
 * студийном свете и на тёмном фоне без них читается как наклейка поверх
 * картинки — объект без контакта с поверхностью мозг опознаёт мгновенно.
 */

const TRANSPARENT = { r: 0, g: 0, b: 0, alpha: 0 };

/** Во сколько сигм размытия расширять холст, чтобы тень не срезало по краю. */
const BLUR_PADDING_SIGMAS = 3;

export interface IComposeOptions {
  format?: 'png' | 'jpeg' | 'webp';
  /** Для jpeg/webp. Для png игнорируется. */
  quality?: number;
}

export interface IComposeResult {
  data: Buffer;
  /**
   * Куда и с каким масштабом встал товар.
   *
   * Возвращается наружу ради `scale`: значение заметно больше единицы означает,
   * что исходник мелкий и карточка вышла мыльной. Вызывающий код иначе считал бы
   * это по своей формуле — и она бы разошлась с настоящей.
   */
  placement: IPlacement;
}

const DEFAULT_FORMAT = 'png';
const DEFAULT_QUALITY = 92;

/**
 * Чёрный силуэт по маске объекта: RGB нулевые, альфа — приглушённая маска.
 *
 * Собирается вручную, а не `joinChannel` поверх созданной заливки: так проще и
 * заодно решает вопрос непрозрачности, которую sharp иначе пришлось бы крутить
 * отдельным композитом.
 */
function blackSilhouette(alpha: Buffer, opacity: number): Buffer {
  const out = Buffer.alloc(alpha.length * 4);

  for (let i = 0; i < alpha.length; i += 1) {
    out[i * 4 + 3] = Math.round(alpha[i] * opacity);
  }

  return out;
}

/**
 * Гасит отражение сверху вниз.
 *
 * Отражение уже перевёрнуто, поэтому строка 0 — это линия контакта, где оно
 * ярче всего, а нижние строки уходят в ноль. Линейное затухание, а не резкий
 * обрез: обрезанное отражение выглядит как вторая, перевёрнутая картинка.
 *
 * Меняет буфер на месте — он всегда свежий, из `toBuffer()`.
 */
export function applyReflectionFade(
  rgba: Buffer,
  width: number,
  height: number,
  opacity: number,
): Buffer {
  for (let y = 0; y < height; y += 1) {
    const factor = (1 - y / height) * opacity;
    const row = y * width * 4;

    for (let x = 0; x < width; x += 1) {
      const at = row + x * 4 + 3;
      rgba[at] = Math.round(rgba[at] * factor);
    }
  }

  return rgba;
}

/**
 * Обрезает слой по границам канвы.
 *
 * sharp требует неотрицательных `left`/`top` и не принимает слой шире фона, а
 * размытая тень легко вылезает за край: её холст расширен на три сигмы во все
 * стороны. Сдвигать слой внутрь нельзя — тень уехала бы из-под товара, — поэтому
 * невидимая часть именно отрезается.
 *
 * @returns null, если от слоя не осталось ничего видимого.
 */
async function clipToCanvas(
  layer: sharp.OverlayOptions,
  canvas: ISize,
): Promise<sharp.OverlayOptions | null> {
  const left = layer.left ?? 0;
  const top = layer.top ?? 0;
  const { width, height } = await sharp(layer.input as Buffer).metadata();

  if (!width || !height) return null;

  const cropLeft = Math.max(0, -left);
  const cropTop = Math.max(0, -top);
  const visibleWidth = Math.min(width - cropLeft, canvas.width - Math.max(0, left));
  const visibleHeight = Math.min(height - cropTop, canvas.height - Math.max(0, top));

  if (visibleWidth <= 0 || visibleHeight <= 0) return null;

  if (cropLeft === 0 && cropTop === 0 && visibleWidth === width && visibleHeight === height) {
    return layer;
  }

  const input = await sharp(layer.input as Buffer)
    .extract({ left: cropLeft, top: cropTop, width: visibleWidth, height: visibleHeight })
    .png()
    .toBuffer();

  return { input, left: Math.max(0, left), top: Math.max(0, top) };
}

/** Товар в натуральную величину, обрезанный по своим краям и приведённый к свету сцены. */
async function buildSprite(
  cutout: ICutout,
  placement: IPlacement,
  preset: IScenePreset,
): Promise<Buffer> {
  const { bounds } = cutout;
  if (!bounds) {
    throw new Error('Пустое вырезание: модель не нашла объекта на фото.');
  }

  return sharp(cutout.data, { raw: { width: cutout.width, height: cutout.height, channels: 4 } })
    .extract(bounds)
    .resize(placement.width, placement.height, { fit: 'fill', kernel: 'lanczos3' })
    .modulate({ brightness: preset.grade.brightness, saturation: preset.grade.saturation })
    .png()
    .toBuffer();
}

async function buildShadow(
  sprite: Buffer,
  placement: IPlacement,
  preset: IScenePreset,
): Promise<sharp.OverlayOptions> {
  const { shadow } = preset;

  const alpha = await sharp(sprite).extractChannel('alpha').raw().toBuffer();
  const silhouette = blackSilhouette(alpha, shadow.opacity);

  // Тень ЛЕЖИТ на подиуме, а не стоит за товаром: по вертикали она сплющена.
  // Без этого получается не контактная тень, а вторая пара часов позади.
  const width = Math.max(1, Math.round(placement.width * (1 + shadow.spread)));
  const height = Math.max(1, Math.round(placement.height * shadow.squash));
  const pad = Math.ceil(shadow.blur * BLUR_PADDING_SIGMAS);

  const input = await sharp(silhouette, {
    raw: { width: placement.width, height: placement.height, channels: 4 },
  })
    .resize(width, height, { fit: 'fill' })
    // Расширяем холст ДО размытия: sharp размывает в пределах картинки, и без
    // запаса мягкая тень упирается в собственный край ровной линией.
    .extend({ top: pad, bottom: pad, left: pad, right: pad, background: TRANSPARENT })
    .blur(shadow.blur)
    .png()
    .toBuffer();

  const centerX = placement.left + placement.width / 2;
  const centerY = placement.contactY + shadow.offsetY;

  return {
    input,
    left: Math.round(centerX - (width + pad * 2) / 2),
    top: Math.round(centerY - (height + pad * 2) / 2),
  };
}

async function buildReflection(
  sprite: Buffer,
  placement: IPlacement,
  preset: IScenePreset,
  canvasHeight: number,
): Promise<sharp.OverlayOptions | null> {
  const { reflection } = preset;

  const top = placement.contactY + reflection.gap;
  const available = canvasHeight - top;
  if (available <= 0) return null;

  const height = Math.min(
    Math.max(1, Math.round(placement.height * reflection.fade)),
    Math.round(canvasHeight * reflection.maxHeight),
    available,
    placement.height,
  );
  if (height < 1) return null;

  // Флип, потом верхние строки: у перевёрнутого спрайта сверху оказывается низ
  // товара — ровно то, что и должно примыкать к линии контакта.
  const { data, info } = await sharp(sprite)
    .flip()
    .extract({ left: 0, top: 0, width: placement.width, height })
    .raw()
    .toBuffer({ resolveWithObject: true });

  const faded = applyReflectionFade(data, info.width, info.height, reflection.opacity);

  const input = await sharp(faded, { raw: { width: info.width, height: info.height, channels: 4 } })
    .blur(reflection.blur)
    .png()
    .toBuffer();

  return { input, left: placement.left, top };
}

function encode(
  image: Sharp,
  format: NonNullable<IComposeOptions['format']>,
  quality: number,
): Sharp {
  if (format === 'jpeg') {
    // Фон карточки тёмный, а jpeg на тёмных градиентах полосит. `mozjpeg` даёт
    // заметно чище при том же весе — за это его тут и включают.
    return image.jpeg({ quality, mozjpeg: true });
  }

  if (format === 'webp') {
    return image.webp({ quality });
  }

  return image.png({ compressionLevel: 9 });
}

/**
 * Собирает готовую карточку.
 */
export async function composeScene(
  cutout: ICutout,
  preset: IScenePreset,
  options: IComposeOptions = {},
): Promise<IComposeResult> {
  if (!cutout.bounds) {
    throw new Error('Пустое вырезание: модель не нашла объекта на фото.');
  }

  const template = sharp(preset.templatePath);
  const { width, height } = await template.metadata();

  if (!width || !height) {
    throw new Error(`Не удалось прочитать размеры фона ${preset.templatePath}.`);
  }

  const canvas = { width, height };
  const placement = planPlacement(cutout.bounds, canvas, preset.fit, preset.anchor);

  const sprite = await buildSprite(cutout, placement, preset);

  const layers: sharp.OverlayOptions[] = [];

  const push = async (layer: sharp.OverlayOptions | null): Promise<void> => {
    const clipped = layer ? await clipToCanvas(layer, canvas) : null;
    if (clipped) layers.push(clipped);
  };

  if (preset.shadow.opacity > 0) {
    await push(await buildShadow(sprite, placement, preset));
  }

  if (preset.reflection.opacity > 0) {
    await push(await buildReflection(sprite, placement, preset, height));
  }

  layers.push({ input: sprite, left: placement.left, top: placement.top });

  const format = options.format ?? DEFAULT_FORMAT;
  const quality = options.quality ?? DEFAULT_QUALITY;

  const encoded = encode(template.composite(layers), format, quality);

  return { data: await encoded.toBuffer(), placement };
}
