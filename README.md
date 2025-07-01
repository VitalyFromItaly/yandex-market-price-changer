# 🤖 Yandex Market Price Changer Bot

Telegram-бот для автоматического управления ценами и товарами на Yandex Market через API.

## 🚀 Основные возможности

- 📋 **Загрузка файлов** - Excel/CSV файлы через Telegram
- 💰 **Управление ценами** - автоматическое обновление цен с коэффициентами
- 📦 **Создание товаров** - новые карточки товаров

- 📊 **Сравнение данных** - анализ различий между файлом и Yandex Market
- 🗑️ **Автоочистка** - удаление временных файлов после обработки

## 🏗️ Архитектура

```
src/
├── modules/
│   ├── telegram/          # Telegram бот и обработчики
│   ├── yandex/           # Yandex Market API интеграция
│   └── parser/           # Парсинг Excel/CSV файлов
├── services/             # Общие сервисы (файлы, обработка данных)
├── database/             # MongoDB модели и подключение
└── middleware/           # Express middleware
```

## ⚙️ Установка и запуск

1. **Клонирование и установка зависимостей:**
```bash
git clone <repository>
cd yandex-market-price-changer
npm install
```

2. **Настройка переменных окружения:**
```bash
cp .env.example .env
# Заполните необходимые API ключи
```

3. **Запуск:**
```bash
npm run dev     # Разработка
npm start       # Продакшн
```

## 🔧 Конфигурация

### Обязательные переменные:
- `TELEGRAM_BOT_TOKEN` - токен Telegram бота
- `MONGODB_URI` - строка подключения к MongoDB
- `YANDEX_MARKET_BASE_URL` - базовый URL Yandex Market API



## 📱 Использование

1. **Запустите бота** в Telegram
2. **Настройте API** Yandex Market в профиле
3. **Загрузите Excel/CSV** файл с товарами
4. **Выберите действие** - обновить цены или создать новые товары
5. **Получите отчет** о результатах обработки

## 📚 Документация модулей

- [`/src/modules/telegram/`](./src/modules/telegram/README.md) - Telegram бот и обработчики
- [`/src/modules/yandex/`](./src/modules/yandex/README.md) - Yandex Market API
- [`/src/modules/parser/`](./src/modules/parser/README.md) - Парсинг файлов


## 🏢 Workflow

1. **Загрузка** → Пользователь загружает Excel/CSV файл
2. **Парсинг** → Система извлекает данные о товарах
3. **Сравнение** → Сопоставление с данными Yandex Market

4. **Обработка** → Обновление цен или создание карточек
5. **Очистка** → Автоматическое удаление временных файлов

## 📊 Технологии

- **Backend:** Node.js, TypeScript, Express
- **Database:** MongoDB
- **APIs:** Telegram Bot API, Yandex Market API
- **File Processing:** ExcelJS для парсинга Excel файлов


## 🔒 Безопасность

- Валидация всех входящих файлов
- Ограничения размера файлов (10MB)
- Автоматическое удаление временных данных
- Защищенное хранение API ключей

## 📈 Мониторинг

- Подробное логирование всех операций
- Отчеты об ошибках и успешных операциях
- Статистика обработки файлов

## 🤝 Разработка

- TypeScript для типобезопасности
- ESLint для качества кода
- Модульная архитектура
- Comprehensive error handling

---

**Версия:** 1.0.0 | **License:** MIT
