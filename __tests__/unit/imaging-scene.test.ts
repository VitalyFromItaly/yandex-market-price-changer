import { describe, it, expect } from 'vitest';

import { toMaskBytes, toModelInput } from '../../src/modules/imaging/model-io';
import { applyReflectionFade } from '../../src/modules/imaging/scene-composer';
import { loadScenePreset, parseScenePreset } from '../../src/modules/imaging/scene-preset';

/**
 * Пресет сцены и арифметика вокруг модели.
 *
 * Ни один из этих тестов не поднимает onnxruntime и не читает веса: ошибка в
 * нормализации не роняет запуск, она молча портит маску, и без проверки на
 * известных числах отличить её от «модель плохая» невозможно.
 */
describe('Пресет сцены', () => {
  it('достраивается значениями по умолчанию из одной строки', () => {
    const preset = parseScenePreset({ template: 'bg.png' }, 'test', '/scenes');

    expect(preset.templatePath).toBe('/scenes/bg.png');
    expect(preset.fit.maxWidth).toBeGreaterThan(0);
    expect(preset.anchor.y).toBeGreaterThan(0);
    expect(preset.shadow.blur).toBeGreaterThan(0);
  });

  it('не молчит про опечатку в имени поля', () => {
    // Иначе «refelction» прошло бы незаметно, а на картинке выглядело бы как
    // «отражение почему-то дефолтное».
    expect(() => parseScenePreset({ template: 'bg.png', refelction: {} }, 'test')).toThrow(/refelction/);
  });

  it('требует фон', () => {
    expect(() => parseScenePreset({}, 'test')).toThrow(/template/);
  });

  it('отвергает доли за пределами 0..1', () => {
    expect(() => parseScenePreset({ template: 'bg.png', anchor: { y: 1.4 } }, 'test')).toThrow(/anchor/);
  });

  it('оставляет абсолютный путь к фону как есть', () => {
    const preset = parseScenePreset({ template: '/tmp/bg.png' }, 'test', '/scenes');

    expect(preset.templatePath).toBe('/tmp/bg.png');
  });

  it('фирменный пресет из репозитория валиден', () => {
    // Пресет — это данные, и опечатка в нём иначе всплыла бы только при запуске
    // CLI на живых фото.
    //
    // Точные числа НЕ пиннуем: они подбираются глазами под конкретный шаблон, и
    // тест, требующий `anchor.y === 0.805`, пришлось бы править при каждой
    // подгонке сцены — то есть он ловил бы не ошибки, а работу.
    const preset = loadScenePreset('all-best-watch-dark');

    expect(preset.templatePath).toMatch(/all-best-watch-dark\.png$/);
    expect(preset.anchor.y).toBeGreaterThan(0.5);
    expect(preset.fit.maxWidth).toBeGreaterThan(0);
  });
});

describe('Вход и выход модели', () => {
  it('раскладывает RGB по планам и нормализует', () => {
    // Два пикселя: белый и чёрный. Ожидание планарное (RRGGBB), не чересстрочное.
    const out = toModelInput(Buffer.from([255, 255, 255, 0, 0, 0]));

    expect([...out]).toEqual([0.5, -0.5, 0.5, -0.5, 0.5, -0.5]);
  });

  it('отвергает буфер, который не RGB', () => {
    expect(() => toModelInput(Buffer.alloc(5))).toThrow(/не кратна 3/);
  });

  it('растягивает выход модели min-max', () => {
    const mask = toMaskBytes(Float32Array.from([0, 5, 10]), 3);

    expect([...mask]).toEqual([0, 128, 255]);
  });

  it('смотрит только на первый канал выхода', () => {
    // У isnet выходов несколько; rembg берёт ort_outs[0][:, 0, :, :]. Если бы
    // растяжка считалась по всему буферу, побочные головы декодера сдвинули бы
    // диапазон и маска поехала бы целиком.
    const mask = toMaskBytes(Float32Array.from([0, 5, 10, 100, 100, 100]), 3);

    expect([...mask]).toEqual([0, 128, 255]);
  });

  it('не выдаёт NaN, когда модель не разделила кадр', () => {
    const mask = toMaskBytes(Float32Array.from([7, 7, 7]), 3);

    expect([...mask]).toEqual([0, 0, 0]);
  });

  it('отвергает слишком короткий выход', () => {
    expect(() => toMaskBytes(Float32Array.from([1, 2]), 3)).toThrow(/короче/);
  });
});

describe('Затухание отражения', () => {
  it('гаснет сверху вниз', () => {
    // Отражение уже перевёрнуто: строка 0 примыкает к линии контакта и должна
    // быть самой заметной.
    const rgba = Buffer.from([0, 0, 0, 200, 0, 0, 0, 200]);

    const faded = applyReflectionFade(rgba, 1, 2, 1);

    expect(faded[3]).toBe(200);
    expect(faded[7]).toBe(100);
  });

  it('приглушается общей непрозрачностью', () => {
    const rgba = Buffer.from([0, 0, 0, 200]);

    expect(applyReflectionFade(rgba, 1, 1, 0.25)[3]).toBe(50);
  });
});
