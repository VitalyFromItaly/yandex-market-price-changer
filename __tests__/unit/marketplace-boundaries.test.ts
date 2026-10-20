import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';

import { describe, expect, it } from 'vitest';

/**
 * Общие модули ходят к площадкам только через `MarketplaceRegistry` (TASK-162,
 * решение `marketplace_adapter_unification`). Клиент или адаптер площадки,
 * импортированный напрямую, — это экран, который знает, с какой площадкой
 * говорит: новая площадка правила бы его, а не свой адаптер. Компиляция такого
 * не ловит, поэтому исходники читаются как текст.
 */
const ROOT = join(__dirname, '../../src/modules');
const SHARED_MODULES = ['finance', 'crm', 'products'];
/** Скрипты — тоже потребители (TASK-163): `sync-ozon-catalog.ts` ходит через реестр. */
const SCRIPTS = join(__dirname, '../../scripts');

/** Что общим модулям импортировать нельзя: клиенты Ozon/WB и сами адаптеры. */
const FORBIDDEN = [
  /\/ozon\/ozon\.client$/,
  /\/ozon\/ozon-client\.factory$/,
  /\/ozon\/ozon-catalog\.service$/,
  /\/ozon\/ozon-marketplace\.adapter$/,
  /\/wb\/wb\.client$/,
  /\/wb\/wb-client\.factory$/,
  /\/wb\/wb-marketplace\.adapter$/,
  /\/marketplaces\/ym-marketplace\.adapter$/,
  /\/marketplaces\/ym-connection\.adapter$/,
];

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return path.endsWith('.ts') ? [path] : [];
  });
}

function importsOf(source: string): string[] {
  return [...source.matchAll(/from '([^']+)'/g)].map((match) => match[1]);
}

describe('границы площадок', () => {
  it('finance, crm и products не импортируют клиентов и адаптеры площадок мимо реестра', () => {
    const violations = SHARED_MODULES.flatMap((module) =>
      sources(join(ROOT, module)).flatMap((file) =>
        importsOf(readFileSync(file, 'utf8'))
          .filter((spec) => FORBIDDEN.some((pattern) => pattern.test(spec)))
          .map((spec) => `${relative(ROOT, file)} → ${spec}`),
      ),
    );
    expect(violations).toEqual([]);
  });

  it('scripts не импортируют клиентов и адаптеры площадок мимо реестра', () => {
    const violations = sources(SCRIPTS).flatMap((file) =>
      importsOf(readFileSync(file, 'utf8'))
        .filter((spec) => FORBIDDEN.some((pattern) => pattern.test(spec)))
        .map((spec) => `${relative(SCRIPTS, file)} → ${spec}`),
    );
    expect(violations).toEqual([]);
  });

  it('проверка ловит запрещённый импорт (тест не пустой)', () => {
    const spec = '../../ozon/ozon.client';
    expect(FORBIDDEN.some((pattern) => pattern.test(spec))).toBe(true);
    expect(FORBIDDEN.some((pattern) => pattern.test('../../ozon/ozon-connection.service'))).toBe(
      false,
    );
  });
});
