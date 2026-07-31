import type { IBounds, IRefineOptions } from './mask-refine';
import type { Sharp } from 'sharp';

import { InferenceSession, Tensor } from 'onnxruntime-node';
import sharp from 'sharp';

import { alphaBounds, refineCutout } from './mask-refine';
import { MODEL_INPUT_SIZE, toMaskBytes, toModelInput } from './model-io';
import { DEFAULT_MODEL_PATH } from './paths';

/**
 * Вырезание товара с белого фона моделью сегментации.
 *
 * Модель здесь ДИСКРИМИНАТИВНАЯ, а не генеративная: она отвечает «объект или
 * фон» для каждого пикселя и ничего не дорисовывает. Для товарной карточки это
 * принципиально — генеративный «улучшайзер» способен незаметно переписать
 * надписи на циферблате и модель часов, и брак обнаружится уже у покупателя.
 *
 * Арифметика препроцессинга живёт в `model-io.ts` — она чистая и проверяется
 * без весов; здесь остаётся только работа с sharp и сессией onnxruntime.
 */

const MAX_BYTE = 255;
const WHITE = { r: MAX_BYTE, g: MAX_BYTE, b: MAX_BYTE };

export interface ICutout {
  /** RGBA: кайма фона снята, хвосты маски подрезаны. */
  data: Buffer;
  width: number;
  height: number;
  /** Габариты непрозрачной части. `null` — модель не нашла объекта. */
  bounds: IBounds | null;
  /** Маска до доводки, в размер исходника. Нужна только для `--debug`. */
  mask: Buffer;
}

export class BackgroundRemover {
  /**
   * Хранится ПРОМИС сессии, а не готовая сессия: при пакетной обработке `cutout`
   * вызывают подряд, и на готовой сессии каждый вызов до конца загрузки создавал
   * бы свою — по 170 МБ весов на штуку.
   */
  private session: Promise<InferenceSession> | null = null;

  constructor(private readonly modelPath: string = DEFAULT_MODEL_PATH) {}

  private load(): Promise<InferenceSession> {
    this.session ??= InferenceSession.create(this.modelPath).catch((error: Error) => {
      // Сбрасываем, иначе одна неудачная загрузка отравила бы все последующие
      // вызовы одной и той же отвергнутой ссылкой.
      this.session = null;
      throw new Error(
        `Не удалось загрузить модель ${this.modelPath}: ${error.message}. ` +
          'Если файла нет — скачайте его командой `npm run image:fetch-model`.',
      );
    });

    return this.session;
  }

  /**
   * Вырезает объект. На входе файл как есть (jpg/png), на выходе RGBA-сырьё.
   */
  async cutout(input: Buffer, options: IRefineOptions = {}): Promise<ICutout> {
    // `rotate()` без аргументов разворачивает кадр по EXIF. Иначе фото с
    // телефона приезжает лежащим на боку, и виноватой выглядит модель.
    const image = sharp(input).rotate();

    const { data: rgb, info } = await this.toRgb(image).raw().toBuffer({ resolveWithObject: true });
    const { width, height } = info;

    const mask = await this.predictMask(image, width, height);

    const rgba = await sharp(rgb, { raw: { width, height, channels: 3 } })
      .joinChannel(mask, { raw: { width, height, channels: 1 } })
      .raw()
      .toBuffer();

    const data = refineCutout(rgba, options);

    return { data, width, height, mask, bounds: alphaBounds(data, width, height) };
  }

  /**
   * Приводит любой вход к трёхканальному RGB на белом.
   *
   * `flatten`, а не `removeAlpha`: у PNG от поставщика уже может быть альфа, и
   * просто выбросить её значит взять цвет из-под прозрачности. `toColourspace` —
   * ради чёрно-белых сканов: у них один канал, и дальше всё считает не то.
   */
  private toRgb(image: Sharp): Sharp {
    return image.clone().flatten({ background: WHITE }).toColourspace('srgb');
  }

  private async predictMask(image: Sharp, width: number, height: number): Promise<Buffer> {
    const session = await this.load();

    const resized = await this.toRgb(image)
      .resize(MODEL_INPUT_SIZE, MODEL_INPUT_SIZE, { fit: 'fill', kernel: 'lanczos3' })
      .raw()
      .toBuffer();

    const tensor = new Tensor('float32', toModelInput(resized), [
      1,
      3,
      MODEL_INPUT_SIZE,
      MODEL_INPUT_SIZE,
    ]);
    const outputs = await session.run({ [session.inputNames[0]]: tensor });

    // Берём первый выход и его первый канал — так же, как rembg: `ort_outs[0][:, 0, :, :]`.
    // У isnet выходов несколько (побочные головы декодера), полезен нулевой.
    const prediction = outputs[session.outputNames[0]].data as Float32Array;
    const plane = toMaskBytes(prediction, MODEL_INPUT_SIZE * MODEL_INPUT_SIZE);

    // `toColourspace('b-w')` обязателен. sharp по умолчанию отдаёт результат в
    // sRGB, и одноканальная маска на выходе разворачивается в ТРИ канала — при
    // том что на входе объявлен один. Дальше буфер втрое длиннее ожидаемого
    // читается как одноканальный, строки разъезжаются, и маска приходит в
    // полоску с расползающимся веером. Ошибки при этом нет: sharp длину не
    // проверяет, а модель и препроцессинг выглядят виноватыми.
    const mask = await sharp(plane, {
      raw: { width: MODEL_INPUT_SIZE, height: MODEL_INPUT_SIZE, channels: 1 },
    })
      .resize(width, height, { fit: 'fill', kernel: 'lanczos3' })
      .toColourspace('b-w')
      .raw()
      .toBuffer();

    // Явная проверка — чтобы тот же класс ошибки в следующий раз падал, а не
    // портил картинку молча.
    if (mask.length !== width * height) {
      throw new Error(
        `Маска пришла ${mask.length} байт вместо ${width * height} — ожидался один канал.`,
      );
    }

    return mask;
  }
}
