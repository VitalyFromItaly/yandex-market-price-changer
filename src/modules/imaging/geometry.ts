/**
 * Геометрия постановки объекта в сцену — чистая арифметика, без пикселей.
 *
 * Вынесено отдельно от рисования по одной причине: «часы висят над подиумом» и
 * «часы утонули в подиуме» — это ошибки в трёх числах, и проверять их удобнее
 * тестом на синтетических размерах, чем разглядыванием готовой картинки.
 */

export interface ISize {
  width: number;
  height: number;
}

/** Доли канвы, за которые объект не должен выходить. */
export interface IFitBox {
  maxWidth: number;
  maxHeight: number;
}

/** Точка опоры в долях канвы: x — центр по горизонтали, y — линия контакта. */
export interface IAnchor {
  x: number;
  y: number;
}

export interface IPlacement extends ISize {
  left: number;
  top: number;
  /** Во сколько раз объект пришлось масштабировать. >1 означает растяжение. */
  scale: number;
  /**
   * Y линии, на которой объект «стоит». По ней строятся тень и отражение,
   * поэтому это отдельное поле, а не `top + height`, посчитанный на месте
   * в двух разных функциях чуть по-разному.
   */
  contactY: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Вписывает объект в допустимый бокс и сажает его нижней гранью на линию контакта.
 *
 * Опора — НИЗ объекта, а не его центр. Часы на браслете и часы на ремешке имеют
 * разные пропорции: при выравнивании по центру одни повисли бы над подиумом,
 * другие ушли бы в него. Общее у них — точка касания поверхности.
 *
 * Пропорции сохраняются: масштаб один на обе оси.
 */
export function planPlacement(
  object: ISize,
  canvas: ISize,
  fit: IFitBox,
  anchor: IAnchor,
): IPlacement {
  if (object.width <= 0 || object.height <= 0) {
    throw new Error(`Пустой объект: ${object.width}×${object.height}.`);
  }

  const boxWidth = canvas.width * fit.maxWidth;
  const boxHeight = canvas.height * fit.maxHeight;
  const scale = Math.min(boxWidth / object.width, boxHeight / object.height);

  const width = Math.max(1, Math.round(object.width * scale));
  const height = Math.max(1, Math.round(object.height * scale));

  // Клампим, чтобы объект не вылез за канву: sharp на композите за границей
  // падает, а причина падения выглядит как «Image to composite must have same
  // dimensions or smaller» и о пресете не говорит ничего.
  const left = clamp(
    Math.round(canvas.width * anchor.x - width / 2),
    0,
    Math.max(0, canvas.width - width),
  );
  const top = clamp(
    Math.round(canvas.height * anchor.y - height),
    0,
    Math.max(0, canvas.height - height),
  );

  return { left, top, width, height, scale, contactY: top + height };
}
