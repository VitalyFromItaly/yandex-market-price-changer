import * as Joi from 'joi';
import { readFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';

import { SCENES_DIR } from './paths';

/**
 * Описание сцены: фон плюс числа, по которым в него ставится товар.
 *
 * Пресетом, а не константами в коде, потому что фон — расходник. Второй шаблон
 * (другой формат кадра, подиум выше, логотип крупнее) не должен означать правку
 * композитора; он должен означать второй JSON рядом с картинкой.
 *
 * Все доли — от размера канвы, чтобы пресет пережил замену шаблона на тот же
 * кадр в другом разрешении.
 */
export interface IScenePreset {
  /** Имя пресета — по нему он и запрашивается. */
  name: string;
  /** Абсолютный путь к картинке фона. */
  templatePath: string;
  /** Бокс, за который товар не выходит. Доли канвы. */
  fit: {
    maxWidth: number;
    maxHeight: number;
  };
  /** Точка опоры: x — центр по горизонтали, y — линия контакта с подиумом. */
  anchor: {
    x: number;
    y: number;
  };
  /** Тень на поверхности подиума. `opacity: 0` выключает. */
  shadow: {
    opacity: number;
    /** Радиус размытия, px. */
    blur: number;
    /** Высота тени как доля высоты товара — тень лежит, а не стоит. */
    squash: number;
    /** Сдвиг вниз от линии контакта, px. */
    offsetY: number;
    /** Насколько тень шире товара. Доля ширины. */
    spread: number;
  };
  /** Отражение в полированной поверхности. `opacity: 0` выключает. */
  reflection: {
    opacity: number;
    blur: number;
    /** Доля высоты товара, на которой отражение угасает до нуля. */
    fade: number;
    /**
     * Потолок высоты отражения, доля высоты канвы.
     *
     * Не роскошь: `fade` считается от товара, а глубина подиума от него не
     * зависит. Высокие часы на ремешке иначе дают отражение, которое съезжает
     * с подиума и висит на фоне — отражение без отражающей поверхности.
     */
    maxHeight: number;
    /** Зазор между товаром и его отражением, px. */
    gap: number;
  };
  /** Приведение товара к освещению сцены. */
  grade: {
    brightness: number;
    saturation: number;
  };
}

const fraction = Joi.number().min(0).max(1);

const schema = Joi.object({
  template: Joi.string().required().messages({
    'any.required':
      'template обязателен: имя файла фона рядом с пресетом, например all-best-watch-dark.png',
  }),

  fit: Joi.object({
    maxWidth: fraction.greater(0).default(0.62),
    maxHeight: fraction.greater(0).default(0.42),
  }).default(),

  anchor: Joi.object({
    x: fraction.default(0.5),
    y: fraction.default(0.78),
  }).default(),

  shadow: Joi.object({
    opacity: fraction.default(0.55),
    blur: Joi.number().min(0.3).default(18),
    squash: fraction.greater(0).default(0.22),
    offsetY: Joi.number().default(6),
    spread: Joi.number().min(0).default(0.06),
  }).default(),

  reflection: Joi.object({
    opacity: fraction.default(0.18),
    blur: Joi.number().min(0.3).default(2),
    fade: Joi.number().greater(0).default(0.45),
    maxHeight: fraction.greater(0).default(0.1),
    gap: Joi.number().default(2),
  }).default(),

  grade: Joi.object({
    brightness: Joi.number().greater(0).default(0.92),
    saturation: Joi.number().min(0).default(0.95),
  }).default(),
}).required();

/**
 * Проверяет и достраивает пресет.
 *
 * Значения по умолчанию проставляет Joi, поэтому минимальный пресет — это одна
 * строка `template`. Неизвестные ключи запрещены: опечатка в `refelction` иначе
 * прошла бы молча, а на картинке выглядела бы как «отражение почему-то дефолтное».
 */
export function parseScenePreset(raw: unknown, name: string, dir = SCENES_DIR): IScenePreset {
  const { value, error } = schema.validate(raw, { abortEarly: false, convert: true });

  if (error) {
    const details = error.details.map((d) => d.message).join('; ');
    throw new Error(`Пресет сцены «${name}» некорректен: ${details}`);
  }

  const template = value.template as string;

  return {
    name,
    templatePath: isAbsolute(template) ? template : join(dir, template),
    fit: value.fit,
    anchor: value.anchor,
    shadow: value.shadow,
    reflection: value.reflection,
    grade: value.grade,
  };
}

/**
 * Читает пресет `<dir>/<name>.json`.
 */
export function loadScenePreset(name: string, dir = SCENES_DIR): IScenePreset {
  const file = join(dir, `${name}.json`);

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    throw new Error(`Не удалось прочитать пресет сцены ${file}: ${(error as Error).message}`);
  }

  return parseScenePreset(raw, name, dir);
}
