import typescriptEslint from "@typescript-eslint/eslint-plugin";
import _import from "eslint-plugin-import";
import { fixupPluginRules } from "@eslint/compat";
import globals from "globals";
import tsParser from "@typescript-eslint/parser";
import path from "node:path";
import { fileURLToPath } from "node:url";
import js from "@eslint/js";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const compat = new FlatCompat({
  baseDirectory: __dirname,
  recommendedConfig: js.configs.recommended,
  allConfig: js.configs.all
});

export default [
  {
    ignores: [
      "eslint.config.js",
      "**/node_modules",
      "**/dist",
      // Сгенерированный клиент Partner API: правится командой npm run api,
      // ручные правки затираются при следующей генерации.
      "src/modules/yandex/api/**",
      "src/modules/yandex/api-docs/**",
      // Файлы вне tsconfig.include (там только src). Типизированные правила
      // на них падают с «parserOptions.project: файл не найден в проекте», а
      // расширять include ради линта значит тянуть тесты в сборку.
      "vitest.config.ts",
      "scripts/**",
      // Админ-панель: свой тулчейн (vite), свой tsconfig не нужен —
      // тянуть .vue и DOM-типы в сборку бэкенда ради линта незачем.
      "web/**",
      "__tests__/**",
      "**/rust-wasm-libs",
      "**/typedocs",
      "**/reports",
      "**/tmp",
      "**/jest.config.ts"
    ]
  },
  ...compat.extends(
    "eslint:recommended",
    "plugin:@typescript-eslint/recommended",
    "prettier"
  ),
  {
    plugins: {
      "@typescript-eslint": typescriptEslint,
      import: fixupPluginRules(_import)
    },

    languageOptions: {
      globals: {
        ...globals.browser
      },

      parser: tsParser,
      ecmaVersion: "latest",
      sourceType: "module",

      parserOptions: {
        project: true
      }
    },

    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          varsIgnorePattern: "^_",
          argsIgnorePattern: "^_",
          ignoreRestSiblings: true
        }
      ],

      // max-len НЕ включаем: длину строки держит prettier, и конфигурация
      // "prettier" в extends отключает такие правила намеренно. Здесь оно было
      // включено обратно со значением 120, а prettier форматирует по 80 — в
      // результате два инструмента требовали разного, и линт был красным на
      // коде, который сам же prettier и отформатировал.

      // ВЫКЛЮЧЕНО ОСОЗНАННО. Правилу нужен strictNullChecks, а он в проекте
      // выключен намеренно (tsconfig). Без него правило не анализирует код, а
      // выдаёт по одной ошибке «This rule requires the strictNullChecks
      // compiler option» НА КАЖДЫЙ файл — 252 штуки, за которыми не видно
      // настоящих находок. Включать вместе с strictNullChecks, не раньше.
      "@typescript-eslint/no-unnecessary-condition": "off",
      "@typescript-eslint/no-floating-promises": "error",
      "no-shadow": "off",
      "@typescript-eslint/no-shadow": "error",
      "require-await": "off",
      // Предупреждение: async без await бывает осознанным — метод реализует
      // асинхронный интерфейс (клавиатуры telegraf) или готовится стать
      // асинхронным. Ошибкой это заставляло бы писать бессмысленные await.
      "@typescript-eslint/require-await": "warn",
      "no-nested-ternary": "error",
      "max-params": ["error", 10],
      "@typescript-eslint/consistent-type-imports": "error",

      "@typescript-eslint/no-unused-expressions": [
        "error",
        { allowShortCircuit: true, allowTernary: true, allowTaggedTemplates: true }
      ],

      "import/newline-after-import": [
        "error",
        {
          count: 1
        }
      ],

      "import/order": [
        "error",
        {
          groups: ["type", ["builtin", "external"], "parent", "sibling", "index"],

          alphabetize: {
            order: "asc"
          },

          "newlines-between": "always"
        }
      ],

      "@typescript-eslint/no-non-null-assertion": "error",

      // Предупреждение, а не ошибка: в проекте намеренно живёт код, помеченный
      // @deprecated и оставленный как справочный материал (обработчики цен,
      // TryCatch). Ошибка на него означала бы красный линт при каждом запуске.
      "@typescript-eslint/no-deprecated": "warn",

      // Предупреждение: tsconfig проекта намеренно нестрогий (noImplicitAny
      // выключен), и `any` встречается в чужих типах telegraf и mongoose.
      // Запрещать его ошибкой, не включив strict, — требование не по адресу.
      "@typescript-eslint/no-explicit-any": "warn"
    }
  },
  {
    files: ["**/*.ts", "**/*.tsx"]
  },
  {
    /*
     * Код, помеченный @deprecated или осиротевший после миграции. Правила
     * СНИЖЕНЫ до предупреждений, а не выключены: находки видно, но красным
     * линт от них не становится.
     *
     * Почему не исправить. Этот код нельзя ни развивать, ни удалять — так
     * записано в CLAUDE.md и в задачах: изменение цен отключено, но обработчики
     * оставлены справочным материалом, а TryCatch — как памятник тому, к чему
     * приводит глотание исключений. Причёсывать мёртвый код значит вносить в
     * него правки, которые никто не проверит: он не выполняется и не покрыт
     * тестами. Когда его решат оживить, предупреждения окажутся ровно тем
     * списком, с которого начинать.
     */
    files: [
      "src/services/yandex-market-api.service.ts",
      "src/modules/yandex/handlers/price.changer.handler.ts",
      "src/modules/telegram/bots/price-changer-bot/handlers/file-upload.handler.ts",
      "src/modules/telegram/services/file-data-processor.service.ts",
      "src/shared/decorators/**",
      "src/transport/http/**",
      "src/database/schemas/user.schema.ts"
    ],
    rules: {
      "@typescript-eslint/no-unused-vars": "warn",
      "@typescript-eslint/no-shadow": "warn",
      "@typescript-eslint/no-non-null-assertion": "warn",
      "@typescript-eslint/no-unsafe-function-type": "warn",
      "@typescript-eslint/no-require-imports": "warn",
      "no-nested-ternary": "warn"
    }
  }
];
