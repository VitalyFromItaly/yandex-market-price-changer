
import vue from '@vitejs/plugin-vue';
import autoprefixer from 'autoprefixer';
import { fileURLToPath, URL } from 'node:url';
import tailwindcss from 'tailwindcss';
import { defineConfig } from 'vite';

/**
 * Сборка CRM продавца — второй SPA рядом с админкой web/.
 *
 * base '/crm/': Nest раздаёт crm/dist под префиксом /crm (см. src/main.ts), и
 * без base все ассеты и favicon ссылались бы на корень — то есть на админку.
 *
 * PostCSS задан здесь, а не файлом postcss.config.* — такой файл vite ищет вверх
 * от root, и один неудачно положенный конфиг прогнал бы через Tailwind и сборку
 * web/, у которой Tailwind нет.
 *
 * Внешних доменов в бандле нет намеренно: прод в РФ, CDN оттуда недоступны
 * (довод web/vite.config.ts). Шрифт — @fontsource, иконки — lucide в бандле.
 */
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  base: '/crm/',
  plugins: [vue()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  css: {
    postcss: {
      plugins: [
        tailwindcss({ config: fileURLToPath(new URL('./tailwind.config.ts', import.meta.url)) }),
        autoprefixer(),
      ],
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    assetsDir: 'assets',
  },
  server: {
    // 5173 занят дев-сервером админки — оба можно держать поднятыми.
    port: 5174,
    proxy: {
      '/api': { target: 'http://localhost:3004', changeOrigin: true },
    },
  },
});
