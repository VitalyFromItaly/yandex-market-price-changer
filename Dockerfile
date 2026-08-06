# --- этап сборки -------------------------------------------------------------
# Здесь нужны devDependencies: nest build (@nestjs/cli) и typescript живут в них.
FROM node:22.12.0-alpine AS builder
WORKDIR /app

# onnxruntime-node в postinstall докачивает CUDA EP с nuget.org — сотни мегабайт
# ради модуля карточек товаров, который в образ вообще не собирается
# (см. exclude в tsconfig.build.json). Именно на этой докачке 05-08-2026 упал
# деплой с ENOSPC. Домен вдобавок внешний и с московского хоста недоступен
# ничуть не лучше api.telegram.org. Флаг — штатный, из script/install.js пакета.
ENV ONNXRUNTIME_NODE_INSTALL=skip

COPY package*.json ./
RUN npm ci

COPY tsconfig.json tsconfig.build.json nest-cli.json ./
COPY src ./src
# Админ-панель собирается тем же `npm run build` (nest build && vite build).
COPY web ./web

RUN npm run build

# --- этап запуска ------------------------------------------------------------
# В образ попадают только прод-зависимости и скомпилированный dist —
# ts-node в рантайме больше не участвует.
FROM node:22.12.0-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production

COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=builder /app/dist ./dist
# Собранная панель; main.ts раздаёт её из ../web/dist относительно dist/.
COPY --from=builder /app/web/dist ./web/dist

# Каталог для временных файлов загрузок; в compose поверх монтируется том.
RUN mkdir -p static/temp

EXPOSE 3000

CMD ["node", "--enable-source-maps", "dist/main.js"]
