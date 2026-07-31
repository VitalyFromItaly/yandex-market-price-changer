import { describe, it, expect } from 'vitest';

import { planPlacement } from '../../src/modules/imaging/geometry';

/**
 * Постановка товара в сцену.
 *
 * «Часы висят над подиумом» и «часы утонули в подиуме» — это ошибка в трёх
 * числах, которая не падает и не компилируется в ошибку. Ловится только так.
 */
describe('Постановка товара на подиум', () => {
  const CANVAS = { width: 1000, height: 1500 };
  const FIT = { maxWidth: 0.62, maxHeight: 0.42 };
  const ANCHOR = { x: 0.5, y: 0.78 };

  it('вписывает широкий объект по ширине и сохраняет пропорции', () => {
    const placement = planPlacement({ width: 1000, height: 500 }, CANVAS, FIT, ANCHOR);

    expect(placement.width).toBe(620);
    expect(placement.height).toBe(310);
    expect(placement.width / placement.height).toBeCloseTo(2, 5);
  });

  it('вписывает высокий объект по высоте', () => {
    const placement = planPlacement({ width: 500, height: 1000 }, CANVAS, FIT, ANCHOR);

    expect(placement.height).toBe(630);
    expect(placement.width).toBe(315);
  });

  it('ставит на одну линию контакта объекты разных пропорций', () => {
    // Часы на браслете и часы на ремешке имеют разную высоту. Общее у них —
    // точка касания подиума; при выравнивании по центру одни повисли бы в
    // воздухе, другие ушли бы в поверхность.
    const wide = planPlacement({ width: 1000, height: 500 }, CANVAS, FIT, ANCHOR);
    const tall = planPlacement({ width: 500, height: 1000 }, CANVAS, FIT, ANCHOR);

    expect(wide.contactY).toBe(tall.contactY);
    expect(wide.contactY).toBe(Math.round(CANVAS.height * ANCHOR.y));
  });

  it('центрирует по горизонтали', () => {
    const placement = planPlacement({ width: 1000, height: 500 }, CANVAS, FIT, ANCHOR);

    expect(placement.left + placement.width / 2).toBeCloseTo(CANVAS.width * ANCHOR.x, 0);
  });

  it('сообщает масштаб, чтобы было видно растянутый исходник', () => {
    const placement = planPlacement({ width: 100, height: 50 }, CANVAS, FIT, ANCHOR);

    expect(placement.scale).toBeCloseTo(6.2, 5);
  });

  it('не выпускает объект за канву', () => {
    // sharp на композите за границей падает с сообщением про размеры слоя, из
    // которого про пресет не понять ничего.
    const placement = planPlacement({ width: 10, height: 100 }, { width: 100, height: 100 }, { maxWidth: 0.62, maxHeight: 0.9 }, { x: 0.5, y: 0.1 });

    expect(placement.top).toBe(0);
    expect(placement.left).toBeGreaterThanOrEqual(0);
    expect(placement.left + placement.width).toBeLessThanOrEqual(100);
  });

  it('отвергает пустой объект', () => {
    expect(() => planPlacement({ width: 0, height: 10 }, CANVAS, FIT, ANCHOR)).toThrow(/Пустой объект/);
  });
});
