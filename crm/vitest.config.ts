import vue from '@vitejs/plugin-vue';
import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * Тесты CRM отдельно от корневого vitest.config.ts: там swc-трансформ ради
 * декораторов Nest и include только __tests__/**, здесь — .vue и алиас @.
 * Среда node: сторы и композаблы DOM не требуют, а jsdom ради них не ставим.
 */
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [vue()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.spec.ts'],
  },
});
