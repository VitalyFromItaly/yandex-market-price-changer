# --- этап сборки -------------------------------------------------------------
# Здесь нужны devDependencies: nest build (@nestjs/cli) и typescript живут в них.
FROM node:22.12.0-alpine AS builder
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY tsconfig.json tsconfig.build.json nest-cli.json ./
COPY src ./src

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

# Каталог для временных файлов загрузок; в compose поверх монтируется том.
RUN mkdir -p static/temp

EXPOSE 3000

CMD ["node", "--enable-source-maps", "dist/main.js"]
