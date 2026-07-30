import { defineConfig } from 'vitest/config';
import swc from 'unplugin-swc';

/**
 * Vitest по умолчанию транспилирует через esbuild, который НЕ поддерживает
 * emitDecoratorMetadata. А DI в NestJS держится именно на этих метаданных:
 * без них `constructor(private config: ConfigService)` получает undefined,
 * и тест падает с «Cannot read properties of undefined (reading 'get')» —
 * при том что в рантайме через tsc всё работает.
 *
 * Поэтому транспиляция отдана swc с включёнными decorator-метаданными.
 * Без этого любой тест, поднимающий модуль Nest, будет нерабочим — а они
 * понадобятся дальше (BotRegistry, онбординг, отчёты).
 */
export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: ['__tests__/**/*.{test,spec}.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      // Сгенерированный OpenAPI-клиент не наш код и исключён из tsconfig.
      exclude: ['src/modules/yandex/api/**'],
    },
  },
  plugins: [
    swc.vite({
      module: { type: 'es6' },
      jsc: {
        target: 'es2022',
        parser: { syntax: 'typescript', decorators: true },
        transform: { legacyDecorator: true, decoratorMetadata: true },
      },
    }),
  ],
});
