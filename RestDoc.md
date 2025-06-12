1. Создавать новые конфигурации
2. Получать информацию о существующих конфигурациях
3. Обновлять конфигурации
4. Активировать/деактивировать конфигурации
5. Управлять стратегиями
6. Управлять символами

Ниже представлены примеры REST запросов для управления конфигурацией бота в соответствии с приведенной структурой данных.

## Базовая информация

- **Базовый URL**: `http://localhost:3004/api` или ваш домен
- **Аутентификация**: Все запросы требуют HTTP-заголовок `x-api-key` с действительным ключом API
- **Формат данных**: JSON

## 1. Управление конфигурациями

### 1.1. Создание новой конфигурации

```
POST /config
Headers:
  x-api-key: your-api-key
  Content-Type: application/json

Body:
{
  "name": "default",
  "description": "Default trading configuration",
  "exchange": {
    "testnet": true,
    "defaultLeverage": 10
  },
  "risk": {
    "maxPositionSize": 100,
    "maxLeverage": 10,
    "maxRiskPerTrade": 0.01,
    "maxDailyLoss": 0.05,
    "stopLossPercent": 0.5,
    "takeProfitPercent": 1.0,
    "trailingStopActivation": 0.4,
    "trailingStopDistance": 0.2
  },
  "activeStrategy": "scalping",
  "strategies": {
    "scalping": {
      "timeframe": "1m",
      "symbols": ["BROCCOLIUSDT", "ALCHUSDT", "STPTUSDT", "TRUMPUSDT"],
      "entryThreshold": 0.7,
      "exitThreshold": 0.4,
      "reversalThreshold": 0.8,
      "priceBufferSize": 300,
      "analysisWindowSize": 30,
      "minPriceChangePercent": 0.15,
      "initialStopLossPercent": 0.5,
      "takeProfitPercent": 1.0,
      "minHoldTimeMs": 30000,
      "maxHoldTimeMs": 300000,
      "useDualTimeframeAnalysis": true
    }
  },
  "general": {
    "logLevel": "info",
    "enableMetrics": true,
    "dataBufferSize": 1000,
    "orderbookBufferSize": 300,
    "scalperMode": true,
    "defaultPositionSizeUsd": 10
  },
  "isActive": true
}

Response (201 Created):
{
  "success": true,
  "message": "Configuration created successfully",
  "config": {
    "_id": "60d2a32a5f3d2a001cfa45c1",
    "name": "default",
    "description": "Default trading configuration",
    ...
  }
}
```

### 1.2. Получение активной конфигурации

```
GET /config/active
Headers:
  x-api-key: your-api-key

Response (200 OK):
{
  "success": true,
  "config": {
    "_id": "60d2a32a5f3d2a001cfa45c1",
    "name": "default",
    "description": "Default trading configuration",
    "exchange": {
      "testnet": true,
      "defaultLeverage": 10
    },
    "risk": {
      "maxPositionSize": 100,
      "maxLeverage": 10,
      ...
    },
    "activeStrategy": "scalping",
    "strategies": {
      "scalping": {
        "timeframe": "1m",
        "symbols": ["BROCCOLIUSDT", "ALCHUSDT", "STPTUSDT", "TRUMPUSDT"],
        ...
      }
    },
    "general": {
      "logLevel": "info",
      "enableMetrics": true,
      ...
    },
    "isActive": true,
    "createdAt": "2023-06-23T10:15:22.345Z",
    "updatedAt": "2023-06-23T10:15:22.345Z"
  }
}
```

### 1.3. Получение списка всех конфигураций

```
GET /config
Headers:
  x-api-key: your-api-key

Response (200 OK):
{
  "success": true,
  "configs": [
    {
      "_id": "60d2a32a5f3d2a001cfa45c1",
      "name": "default",
      "description": "Default trading configuration",
      "isActive": true,
      "activeStrategy": "scalping",
      "createdAt": "2023-06-23T10:15:22.345Z",
      "updatedAt": "2023-06-23T10:15:22.345Z"
    },
    {
      "_id": "60d2a3405f3d2a001cfa45c2",
      "name": "conservative",
      "description": "Conservative trading strategy",
      "isActive": false,
      "activeStrategy": "trend",
      "createdAt": "2023-06-23T10:16:00.123Z",
      "updatedAt": "2023-06-23T10:16:00.123Z"
    }
  ]
}
```

### 1.4. Получение конкретной конфигурации

```
GET /config/default
Headers:
  x-api-key: your-api-key

Response (200 OK):
{
  "success": true,
  "config": {
    "_id": "60d2a32a5f3d2a001cfa45c1",
    "name": "default",
    "description": "Default trading configuration",
    ...
    // Полная конфигурация как в 1.2
  }
}
```

### 1.5. Обновление конфигурации

```
PUT /config/default
Headers:
  x-api-key: your-api-key
  Content-Type: application/json

Body:
{
  "risk": {
    "maxPositionSize": 150,
    "maxRiskPerTrade": 0.02
  },
  "general": {
    "dataBufferSize": 1500
  }
}

Response (200 OK):
{
  "success": true,
  "message": "Configuration updated successfully",
  "config": {
    "_id": "60d2a32a5f3d2a001cfa45c1",
    "name": "default",
    ...
    // Обновленная конфигурация
  }
}
```

### 1.6. Активация конфигурации

```
PUT /config/conservative/activate
Headers:
  x-api-key: your-api-key

Response (200 OK):
{
  "success": true,
  "message": "Configuration 'conservative' activated successfully"
}
```

## 2. Управление стратегиями

### 2.1. Обновление стратегии

```
PUT /config/default/strategy/scalping
Headers:
  x-api-key: your-api-key
  Content-Type: application/json

Body:
{
  "timeframe": "5m",
  "entryThreshold": 0.8,
  "exitThreshold": 0.5,
  "minPriceChangePercent": 0.2
}

Response (200 OK):
{
  "success": true,
  "message": "Strategy 'scalping' updated successfully in configuration 'default'"
}
```

### 2.2. Обновление списка символов в стратегии

```
PUT /config/default/strategy/scalping/symbols
Headers:
  x-api-key: your-api-key
  Content-Type: application/json

Body:
{
  "symbols": ["BTCUSDT", "ETHUSDT", "SOLUSDT", "DOGEUSDT"]
}

Response (200 OK):
{
  "success": true,
  "message": "Symbols updated successfully in strategy 'scalping'",
  "symbols": ["BTCUSDT", "ETHUSDT", "SOLUSDT", "DOGEUSDT"]
}
```

### 2.3. Добавление новой стратегии

```
POST /config/default/strategy
Headers:
  x-api-key: your-api-key
  Content-Type: application/json

Body:
{
  "name": "trend",
  "timeframe": "1h",
  "symbols": ["BTCUSDT", "ETHUSDT"],
  "entryThreshold": 0.6,
  "exitThreshold": 0.3,
  "reversalThreshold": 0.7,
  "priceBufferSize": 100,
  "analysisWindowSize": 24,
  "minPriceChangePercent": 0.5,
  "initialStopLossPercent": 1.0,
  "takeProfitPercent": 2.0,
  "minHoldTimeMs": 3600000,
  "maxHoldTimeMs": 86400000,
  "useDualTimeframeAnalysis": false
}

Response (201 Created):
{
  "success": true,
  "message": "Strategy 'trend' added successfully to configuration 'default'"
}
```

## 3. Управление символами

### 3.1. Получение всех символов

```
GET /symbols
Headers:
  x-api-key: your-api-key

Response (200 OK):
{
  "success": true,
  "symbols": [
    {
      "_id": "60d2a3e05f3d2a001cfa45d1",
      "symbol": "BTCUSDT",
      "minSize": 0.001,
      "pricePrecision": 2,
      "quantityPrecision": 3,
      "maxLeverage": 20,
      "description": "Bitcoin",
      "isActive": true
    },
    {
      "_id": "60d2a3e05f3d2a001cfa45d2",
      "symbol": "ETHUSDT",
      "minSize": 0.01,
      "pricePrecision": 2,
      "quantityPrecision": 3,
      "maxLeverage": 25,
      "description": "Ethereum",
      "isActive": true
    },
    ...
  ]
}
```

### 3.2. Получение информации о конкретном символе

```
GET /symbols/BTCUSDT
Headers:
  x-api-key: your-api-key

Response (200 OK):
{
  "success": true,
  "symbol": {
    "_id": "60d2a3e05f3d2a001cfa45d1",
    "symbol": "BTCUSDT",
    "minSize": 0.001,
    "pricePrecision": 2,
    "quantityPrecision": 3,
    "maxLeverage": 20,
    "description": "Bitcoin",
    "isActive": true
  }
}
```

### 3.3. Добавление нового символа

```
POST /symbols
Headers:
  x-api-key: your-api-key
  Content-Type: application/json

Body:
{
  "symbol": "DOGEUSDT",
  "minSize": 100,
  "pricePrecision": 5,
  "quantityPrecision": 0,
  "maxLeverage": 20,
  "description": "Dogecoin"
}

Response (201 Created):
{
  "success": true,
  "message": "Symbol 'DOGEUSDT' added successfully",
  "symbol": {
    "_id": "60d2a4305f3d2a001cfa45d5",
    "symbol": "DOGEUSDT",
    "minSize": 100,
    "pricePrecision": 5,
    "quantityPrecision": 0,
    "maxLeverage": 20,
    "description": "Dogecoin",
    "isActive": true
  }
}
```

### 3.4. Обновление символа

```
PUT /symbols/BTCUSDT
Headers:
  x-api-key: your-api-key
  Content-Type: application/json

Body:
{
  "maxLeverage": 25,
  "description": "Bitcoin (Updated)"
}

Response (200 OK):
{
  "success": true,
  "message": "Symbol 'BTCUSDT' updated successfully",
  "symbol": {
    "_id": "60d2a3e05f3d2a001cfa45d1",
    "symbol": "BTCUSDT",
    "minSize": 0.001,
    "pricePrecision": 2,
    "quantityPrecision": 3,
    "maxLeverage": 25,
    "description": "Bitcoin (Updated)",
    "isActive": true
  }
}
```

## 4. Управление ботом

### 4.1. Запуск бота с активной конфигурацией

```
POST /bot/start
Headers:
  x-api-key: your-api-key

Response (200 OK):
{
  "success": true,
  "message": "Bot started successfully"
}
```

### 4.2. Запуск бота с конкретной конфигурацией

```
POST /bot/start
Headers:
  x-api-key: your-api-key
  Content-Type: application/json

Body:
{
  "configName": "conservative"
}

Response (200 OK):
{
  "success": true,
  "message": "Bot started successfully with configuration 'conservative'"
}
```

### 4.3. Остановка бота

```
POST /bot/stop
Headers:
  x-api-key: your-api-key

Response (200 OK):
{
  "success": true,
  "message": "Bot stopped successfully"
}
```

### 4.4. Получение статуса бота

```
GET /bot/status
Headers:
  x-api-key: your-api-key

Response (200 OK):
{
  "success": true,
  "isRunning": true,
  "positions": [
    {
      "symbol": "BTCUSDT",
      "side": "Buy",
      "size": 0.01,
      "entryPrice": 30000,
      "stopLoss": 29000,
      "takeProfit": 32000
    }
  ]
}
```

### 4.5. Обновление настроек бота

```
PUT /bot/settings
Headers:
  x-api-key: your-api-key
  Content-Type: application/json

Body:
{
  "maxOpenPositions": 5,
  "basePositionSize": 20,
  "safeTradeMode": true,
  "infiniteMoneyMode": false
}

Response (200 OK):
{
  "success": true,
  "message": "Bot settings updated successfully",
  "settings": {
    "maxOpenPositions": 5,
    "basePositionSize": 20,
    "safeTradeMode": true,
    "infiniteMoneyMode": false
  }
}
```

### 4.6. Закрытие всех позиций

```
POST /bot/positions/close-all
Headers:
  x-api-key: your-api-key
  Content-Type: application/json

Body:
{
  "reason": "manual_exit"
}

Response (200 OK):
{
  "success": true,
  "message": "All positions closed successfully",
  "result": [
    {
      "symbol": "BTCUSDT",
      "closed": true,
      "profit": 100.5
    },
    {
      "symbol": "ETHUSDT",
      "closed": true,
      "profit": -20.3
    }
  ]
}
```

### 4.7. Закрытие конкретной позиции

```
POST /bot/positions/close/BTCUSDT
Headers:
  x-api-key: your-api-key
  Content-Type: application/json

Body:
{
  "reason": "manual_exit"
}

Response (200 OK):
{
  "success": true,
  "message": "Position for BTCUSDT closed successfully",
  "result": {
    "symbol": "BTCUSDT",
    "closed": true,
    "profit": 100.5
  }
}
```

Эти примеры запросов охватывают основной функционал для управления конфигурацией и работой вашего торгового бота через REST API.


-------------

Давайте разработаем REST API для регистрации пользователей и получения токенов для создания ботов. Вот основные эндпоинты, которые нам понадобятся:

1. Регистрация пользователя
2. Аутентификация пользователя и получение токена
3. Обновление/регенерация токена
4. Получение информации о пользователе

Описание REST API:

### 1. Регистрация пользователя

**Запрос:**
```
POST /api/auth/register
```

**Тело запроса:**
```json
{
  "username": "user123",
  "email": "user@example.com",
  "password": "securepassword123"
}
```

**Успешный ответ (200):**
```json
{
  "success": true,
  "message": "User registered successfully",
  "user": {
    "id": "60f7b0b9a9f7b2001c8d8e1a",
    "username": "user123",
    "email": "user@example.com",
    "apiToken": "a1b2c3d4e5f6g7h8i9j0..." // API токен для доступа к торговым ботам
  }
}
```

**Ответ с ошибкой (400):**
```json
{
  "success": false,
  "message": "Username already exists",
  "error": "DUPLICATE_USERNAME"
}
```

### 2. Аутентификация пользователя

**Запрос:**
```
POST /api/auth/login
```

**Тело запроса:**
```json
{
  "email": "user@example.com",
  "password": "securepassword123"
}
```

**Успешный ответ (200):**
```json
{
  "success": true,
  "message": "Authentication successful",
  "user": {
    "id": "60f7b0b9a9f7b2001c8d8e1a",
    "username": "user123",
    "email": "user@example.com"
  },
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...", // JWT для авторизации в веб-интерфейсе
  "apiToken": "a1b2c3d4e5f6g7h8i9j0..." // API токен для доступа к торговым ботам
}
```

**Ответ с ошибкой (401):**
```json
{
  "success": false,
  "message": "Invalid email or password",
  "error": "INVALID_CREDENTIALS"
}
```

### 3. Генерация нового API токена

**Запрос:**
```
POST /api/auth/generate-token
```

**Требуется аутентификация:** Bearer JWT токен в заголовке Authorization

**Успешный ответ (200):**
```json
{
  "success": true,
  "message": "New API token generated successfully",
  "apiToken": "n3w4p1t0k3n..." // Новый API токен для доступа к ботам
}
```

**Ответ с ошибкой (401):**
```json
{
  "success": false,
  "message": "Not authenticated",
  "error": "AUTHENTICATION_REQUIRED"
}
```

### 4. Получение информации о пользователе

**Запрос:**
```
GET /api/auth/profile
```

**Требуется аутентификация:** Bearer JWT токен в заголовке Authorization

**Успешный ответ (200):**
```json
{
  "success": true,
  "user": {
    "id": "60f7b0b9a9f7b2001c8d8e1a",
    "username": "user123",
    "email": "user@example.com",
    "createdAt": "2023-07-20T12:00:00Z",
    "lastLogin": "2023-07-21T08:30:00Z",
    "hasApiToken": true // Флаг наличия API токена без раскрытия самого токена
  }
}
```

**Ответ с ошибкой (401):**
```json
{
  "success": false,
  "message": "Not authenticated",
  "error": "AUTHENTICATION_REQUIRED"
}
```

### Реализация контроллера

В контексте нашего проекта, мы можем создать файл `AuthController.ts` примерно следующего содержания:

```typescript
import { Request, Response } from 'express';
import { User } from '../models/User';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import crypto from 'crypto';

export class AuthController {
  
  // Регистрация нового пользователя
  register = async (req: Request, res: Response) => {
    try {
      const { username, email, password } = req.body;
      
      // Проверка, существует ли уже пользователь с таким email/username
      const existingUser = await User.findOne({ 
        $or: [{ email }, { username }] 
      });
      
      if (existingUser) {
        if (existingUser.email === email) {
          return res.status(400).json({
            success: false,
            message: 'Email already registered',
            error: 'DUPLICATE_EMAIL'
          });
        } else {
          return res.status(400).json({
            success: false,
            message: 'Username already exists',
            error: 'DUPLICATE_USERNAME'
          });
        }
      }
      
      // Хеширование пароля
      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash(password, salt);
      
      // Генерация API токена
      const apiToken = crypto.randomBytes(32).toString('hex');
      
      // Создание нового пользователя
      const newUser = new User({
        username,
        email,
        password: hashedPassword,
        apiToken
      });
      
      await newUser.save();
      
      // Создаем JWT для пользователя
      const token = jwt.sign(
        { id: newUser._id },
        process.env.JWT_SECRET || 'default_secret',
        { expiresIn: '1d' }
      );
      
      res.status(201).json({
        success: true,
        message: 'User registered successfully',
        user: {
          id: newUser._id,
          username: newUser.username,
          email: newUser.email,
          apiToken: newUser.apiToken
        },
        token
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Error registering user',
        error: error.message
      });
    }
  }
  
  // Аутентификация пользователя
  login = async (req: Request, res: Response) => {
    try {
      const { email, password } = req.body;
      
      // Поиск пользователя по email
      const user = await User.findOne({ email });
      
      if (!user) {
        return res.status(401).json({
          success: false,
          message: 'Invalid email or password',
          error: 'INVALID_CREDENTIALS'
        });
      }
      
      // Проверка пароля
      const isPasswordValid = await bcrypt.compare(password, user.password);
      
      if (!isPasswordValid) {
        return res.status(401).json({
          success: false,
          message: 'Invalid email or password',
          error: 'INVALID_CREDENTIALS'
        });
      }
      
      // Создаем JWT для пользователя
      const token = jwt.sign(
        { id: user._id },
        process.env.JWT_SECRET || 'default_secret',
        { expiresIn: '1d' }
      );
      
      // Обновляем время последнего входа
      user.lastLogin = new Date();
      await user.save();
      
      res.json({
        success: true,
        message: 'Authentication successful',
        user: {
          id: user._id,
          username: user.username,
          email: user.email
        },
        token,
        apiToken: user.apiToken
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Authentication error',
        error: error.message
      });
    }
  }
  
  // Генерация нового API токена
  generateToken = async (req: Request, res: Response) => {
    try {
      const userId = req.userId; // Из middleware авторизации
      
      // Генерация нового токена
      const newApiToken = crypto.randomBytes(32).toString('hex');
      
      // Обновление токена пользователя
      await User.findByIdAndUpdate(userId, { apiToken: newApiToken });
      
      res.json({
        success: true,
        message: 'New API token generated successfully',
        apiToken: newApiToken
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Error generating API token',
        error: error.message
      });
    }
  }
  
  // Получение профиля пользователя
  getProfile = async (req: Request, res: Response) => {
    try {
      const userId = req.userId; // Из middleware авторизации
      
      const user = await User.findById(userId);
      
      if (!user) {
        return res.status(404).json({
          success: false,
          message: 'User not found',
          error: 'USER_NOT_FOUND'
        });
      }
      
      res.json({
        success: true,
        user: {
          id: user._id,
          username: user.username,
          email: user.email,
          createdAt: user.createdAt,
          lastLogin: user.lastLogin,
          hasApiToken: !!user.apiToken
        }
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Error fetching user profile',
        error: error.message
      });
    }
  }
}
```

Для использования этого API в веб-приложении, клиент бы:
1. Зарегистрировал пользователя через `/api/auth/register`
2. Входил в систему через `/api/auth/login`
3. Получал и хранил JWT и API токен
4. Использовал JWT для авторизации в веб-интерфейсе
5. Использовал API токен для настройки и управления торговыми ботами

А для использования API в программе бота:
1. Получал API токен из конфигурации или от пользователя
2. Передавал токен в заголовке `Authorization: Bearer {apiToken}` при каждом запросе к API ботов

Это разделение позволяет иметь раздельные токены для интерфейса и для API ботов, что повышает безопасность.
# REST API для регистрации пользователей и получения токенов

Вот описание REST API для регистрации пользователей и получения токенов для создания и управления ботами:

## 1. Регистрация пользователя

**Endpoint:** `POST /api/auth/register`

**Request:**
```json
{
  "username": "trader123",
  "email": "trader@example.com",
  "password": "securepassword"
}
```

**Response (201 Created):**
```json
{
  "success": true,
  "message": "User registered successfully",
  "user": {
    "id": "64f3a2e7b8901234567890ab",
    "username": "trader123",
    "email": "trader@example.com"
  },
  "apiToken": "a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6"
}
```

## 2. Аутентификация и получение токена

**Endpoint:** `POST /api/auth/login`

**Request:**
```json
{
  "email": "trader@example.com",
  "password": "securepassword"
}
```

**Response (200 OK):**
```json
{
  "success": true,
  "message": "Login successful",
  "user": {
    "id": "64f3a2e7b8901234567890ab",
    "username": "trader123",
    "email": "trader@example.com"
  },
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "apiToken": "a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6"
}
```

## 3. Обновление API токена

**Endpoint:** `POST /api/auth/regenerate-token`

**Headers:**
```
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

**Response (200 OK):**
```json
{
  "success": true,
  "message": "API token regenerated successfully",
  "apiToken": "n3w4p1t0k3n5t6r7i8n9g0..."
}
```

## 4. Получение информации о текущем пользователе

**Endpoint:** `GET /api/auth/me`

**Headers:**
```
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

**Response (200 OK):**
```json
{
  "success": true,
  "user": {
    "id": "64f3a2e7b8901234567890ab",
    "username": "trader123",
    "email": "trader@example.com",
    "createdAt": "2023-09-02T15:30:47.123Z",
    "hasApiToken": true
  }
}
```

## Реализация AuthController

```typescript
import { Request, Response } from 'express';
import { User } from '../models/User';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import crypto from 'crypto';

export class AuthController {
  // Регистрация нового пользователя
  register = async (req: Request, res: Response) => {
    try {
      const { username, email, password } = req.body;
      
      // Проверка наличия обязательных полей
      if (!username || !email || !password) {
        return res.status(400).json({
          success: false,
          message: 'Username, email and password are required',
          error: 'MISSING_FIELDS'
        });
      }
      
      // Проверка существования пользователя
      const existingUser = await User.findOne({ 
        $or: [{ email }, { username }] 
      });
      
      if (existingUser) {
        return res.status(400).json({
          success: false,
          message: existingUser.email === email 
            ? 'Email already registered' 
            : 'Username already exists',
          error: 'USER_EXISTS'
        });
      }
      
      // Хеширование пароля
      const hashedPassword = await bcrypt.hash(password, 10);
      
      // Создание нового пользователя
      const user = new User({
        username,
        email,
        password: hashedPassword
      });
      
      // Генерация API токена
      const apiToken = user.generateToken();
      
      await user.save();
      
      res.status(201).json({
        success: true,
        message: 'User registered successfully',
        user: {
          id: user._id,
          username: user.username,
          email: user.email
        },
        apiToken: apiToken
      });
    } catch (error) {
      console.error('Registration error:', error);
      res.status(500).json({
        success: false,
        message: 'Registration failed',
        error: error.message
      });
    }
  }
  
  // Аутентификация пользователя
  login = async (req: Request, res: Response) => {
    try {
      const { email, password } = req.body;
      
      // Поиск пользователя
      const user = await User.findOne({ email });
      
      if (!user) {
        return res.status(401).json({
          success: false,
          message: 'Invalid credentials',
          error: 'INVALID_CREDENTIALS'
        });
      }
      
      // Проверка пароля
      const isPasswordValid = await bcrypt.compare(password, user.password);
      
      if (!isPasswordValid) {
        return res.status(401).json({
          success: false,
          message: 'Invalid credentials',
          error: 'INVALID_CREDENTIALS'
        });
      }
      
      // Генерация JWT
      const token = jwt.sign(
        { id: user._id },
        process.env.JWT_SECRET || 'tradingbot_secret',
        { expiresIn: '1d' }
      );
      
      // Проверка наличия API токена, если нет - создаем
      if (!user.apiToken) {
        user.generateToken();
        await user.save();
      }
      
      res.json({
        success: true,
        message: 'Login successful',
        user: {
          id: user._id,
          username: user.username,
          email: user.email
        },
        token,
        apiToken: user.apiToken
      });
    } catch (error) {
      console.error('Login error:', error);
      res.status(500).json({
        success: false,
        message: 'Login failed',
        error: error.message
      });
    }
  }
  
  // Обновление API токена
  regenerateToken = async (req: Request, res: Response) => {
    try {
      const userId = req.userId; // Получаем из middleware
      
      const user = await User.findById(userId);
      if (!user) {
        return res.status(404).json({
          success: false,
          message: 'User not found',
          error: 'USER_NOT_FOUND'
        });
      }
      
      // Генерация нового API токена
      const newToken = user.generateToken();
      await user.save();
      
      res.json({
        success: true,
        message: 'API token regenerated successfully',
        apiToken: newToken
      });
    } catch (error) {
      console.error('Token regeneration error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to regenerate token',
        error: error.message
      });
    }
  }
  
  // Получение профиля текущего пользователя
  getProfile = async (req: Request, res: Response) => {
    try {
      const userId = req.userId; // Получаем из middleware
      
      const user = await User.findById(userId);
      if (!user) {
        return res.status(404).json({
          success: false,
          message: 'User not found',
          error: 'USER_NOT_FOUND'
        });
      }
      
      res.json({
        success: true,
        user: {
          id: user._id,
          username: user.username,
          email: user.email,
          createdAt: user.createdAt,
          hasApiToken: !!user.apiToken
        }
      });
    } catch (error) {
      console.error('Get profile error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to get user profile',
        error: error.message
      });
    }
  }
}
```

## Настройка маршрутов

```typescript
import express from 'express';
import { AuthController } from '../controllers/AuthController';
import { authMiddleware } from '../middleware/auth.middleware';

const router = express.Router();
const authController = new AuthController();

// Публичные маршруты
router.post('/register', authController.register);
router.post('/login', authController.login);

// Защищенные маршруты (требуют JWT токен)
router.post('/regenerate-token', authMiddleware, authController.regenerateToken);
router.get('/me', authMiddleware, authController.getProfile);

export default router;
```

## Использование API токена для доступа к ботам

После получения API токена, клиент должен включать его в заголовок `Authorization` при каждом запросе к API ботов:

```
Authorization: Bearer a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6
```

API токен предоставляет доступ к следующим операциям:
- Создание и настройка конфигураций бота
- Запуск и остановка ботов
- Получение информации о торговых позициях
- Управление ботом (закрытие позиций и т.д.)

Этот API токен отличается от JWT токена, который используется для аутентификации в веб-интерфейсе. Разделение токенов повышает безопасность системы.