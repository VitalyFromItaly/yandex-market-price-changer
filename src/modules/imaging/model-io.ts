/**
 * Преобразования между картинкой и тензорами модели сегментации.
 *
 * Константы сверены с исходниками rembg (`rembg/sessions/base.py` и
 * `rembg/sessions/dis_general_use.py`), а не взяты по памяти: ошибка в mean/std
 * или в растяжке выхода не роняет запуск — она молча портит маску, и выглядит
 * это как «модель почему-то плохая».
 *
 * Модуль намеренно ничего не импортирует: он проверяется тестом, не поднимая ни
 * onnxruntime, ни весов на 170 МБ.
 */

/** Вход isnet-general-use. Кадр ужимается в квадрат без сохранения пропорций — так делает rembg. */
export const MODEL_INPUT_SIZE = 1024;

/** mean/std из `DisSession.predict`: normalize(img, (0.5,0.5,0.5), (1.0,1.0,1.0), (1024,1024)). */
const INPUT_MEAN = 0.5;
const INPUT_STD = 1.0;

const MAX_BYTE = 255;

/**
 * RGB → нормализованный планарный float32 (CHW), как ждёт модель.
 */
export function toModelInput(rgb: Buffer): Float32Array {
  if (rgb.length % 3 !== 0) {
    throw new Error(`Ожидался RGB-буфер: длина ${rgb.length} не кратна 3.`);
  }

  const pixels = rgb.length / 3;
  const out = new Float32Array(pixels * 3);

  // rembg делит на максимум ПО КАДРУ, а не на 255. На белом фоне это одно и то
  // же (максимум и есть 255), но арифметика повторяется ровно его: на кадре без
  // чистого белого деление на 255 дало бы другой вход и другую маску, а разница
  // не была бы видна до сравнения результатов бок о бок.
  let max = 0;
  for (let i = 0; i < rgb.length; i += 1) {
    if (rgb[i] > max) max = rgb[i];
  }
  const scale = max > 0 ? max : 1e-6;

  const green = pixels;
  const blue = pixels * 2;

  for (let p = 0; p < pixels; p += 1) {
    const at = p * 3;
    out[p] = (rgb[at] / scale - INPUT_MEAN) / INPUT_STD;
    out[green + p] = (rgb[at + 1] / scale - INPUT_MEAN) / INPUT_STD;
    out[blue + p] = (rgb[at + 2] / scale - INPUT_MEAN) / INPUT_STD;
  }

  return out;
}

/**
 * Выход модели → 8-битная маска.
 *
 * Выход не откалиброван: это произвольный диапазон, поэтому rembg растягивает
 * его min-max по кадру. Без растяжки маска на одних фото выходит полупрозрачной
 * целиком, на других — пересвеченной.
 */
export function toMaskBytes(prediction: Float32Array, size: number): Buffer {
  if (prediction.length < size) {
    throw new Error(`Выход модели короче ожидаемого: ${prediction.length} < ${size}.`);
  }

  let min = Infinity;
  let max = -Infinity;

  for (let i = 0; i < size; i += 1) {
    const value = prediction[i];
    if (value < min) min = value;
    if (value > max) max = value;
  }

  const out = Buffer.allocUnsafe(size);
  const span = max - min;

  // Однородный выход означает, что модель не разделила кадр. Растягивать нечего,
  // а деление на ноль дало бы NaN, который в Buffer записался бы нулём молча.
  if (span <= 0) {
    out.fill(0);
    return out;
  }

  for (let i = 0; i < size; i += 1) {
    out[i] = Math.round(((prediction[i] - min) / span) * MAX_BYTE);
  }

  return out;
}
