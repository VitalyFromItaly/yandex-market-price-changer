## Промпт

Ты профессиоанльный трейдер и сможешь проанализировать данные и выдать грамотный конфиг для торговли, так выглядит конфиг

----
У меня БД на кликхаусе есть статистика допустим за день по каждой из монете, и торги и т.п.

Хочу чтобы ты сформировал запросы в БД для получения интересующих данных по которым ты сможешь понять в чем проблема и скорректировать конфиг

```json
{
  "name": "optimized",
  "description": "Optimized trading configuration based on historical data analysis",
  "exchange": {
    "testnet": true,
    "defaultLeverage": 10
  },
  "risk": {
    "maxPositionSize": 12,
    "maxLeverage": 10,
    "maxRiskPerTrade": 0.01,
    "maxDailyLoss": 0.05,
    "stopLossPercent": 0.65,
    "takeProfitPercent": 1.95,
    "trailingStopActivation": 0.8,
    "trailingStopDistance": 0.3
  },
  "activeStrategy": "scalping",
  "strategies": {
    "scalping": {
      "timeframe": "5m",
      "symbols": ["BROCCOLIUSDT", "PROSUSDT", "ATHUSDT"],
      "entryThreshold": 0.75,
      "exitThreshold": 0.5,
      "reversalThreshold": 0.9,
      "priceBufferSize": 300,
      "analysisWindowSize": 40,
      "minPriceChangePercent": 0.2,
      "initialStopLossPercent": 0.65,
      "takeProfitPercent": 1.95,
      "minHoldTimeMs": 400000,
      "maxHoldTimeMs": 3600000,
      "useDualTimeframeAnalysis": true
    }
  },
  "general": {
    "logLevel": "info",
    "enableMetrics": true,
    "dataBufferSize": 1000,
    "orderbookBufferSize": 300,
    "scalperMode": true,
    "defaultPositionSizeUsd": 12
  },
  "isActive": true
}
```

так хранится статистика в БД кликхауса
```sql
create table default.trades
(
symbol         String,
direction Enum8('short' = 2, 'neutral' = 3, 'long' = 1),
entry_price    Float64,
exit_price     Float64,
size           Float64,
pnl            Float64,
pnl_percentage Float64,
entry_time     DateTime64(3, 'UTC'),
exit_time      DateTime64(3, 'UTC'),
duration_ms    UInt64,
reason         String,
timestamp      DateTime64(3, 'UTC'),
userId         String default 'default'
)
engine = MergeTree ORDER BY (symbol, timestamp)
TTL toDateTime(timestamp) + toIntervalDay(8)
SETTINGS index_granularity = 8192;


create table default.positions
(
symbol        String,
side Enum8('Sell' = 2, 'Buy' = 1),
size          Float64,
entry_price   Float64,
leverage      Float64,
stop_loss_price Nullable(Float64),
take_profit_price Nullable(Float64),
liquidation_price Nullable(Float64),
unrealized_pnl Nullable(Float64),
unrealized_pnl_percentage Nullable(Float64),
open_time     DateTime64(3, 'UTC'),
last_update   DateTime64(3, 'UTC'),
timestamp     DateTime64(3, 'UTC'),
userId        String                   default 'default',
status Enum8('closed' = 2, 'open' = 1) default 'open',
entry_time_ms UInt64
)
engine = MergeTree ORDER BY (symbol, timestamp)
TTL toDateTime(timestamp) + toIntervalDay(8)
SETTINGS index_granularity = 8192;
```

### данные о ценнах в режиме торговли обновляются сразу как приходит событие с байбита каждые 20мс
```sql
create table default.prices
(
symbol            String,
lastPrice         Float64,
indexPrice        Float64,
markPrice         Float64,
highPrice24h      Float64,
lowPrice24h       Float64,
prevPrice24h      Float64,
volume24h         Float64,
openInterest      Float64,
turnover24h       Float64,
price24hPcnt      Float64,
usdIndexPrice     Float64,
openInterestValue Float64,
bid1Price         Float64,
bid1Size          Float64,
ask1Price         Float64,
ask1Size          Float64,
tickDirection     String,
timestamp         DateTime64(3, 'UTC')
)
engine = MergeTree ORDER BY (symbol, timestamp)
TTL toDateTime(timestamp) + toIntervalHour(12)
SETTINGS index_granularity = 8192;
```

Для оптимизации конфига торговой системы, я подготовил ряд запросов, которые помогут выявить ключевые проблемы и возможности для улучшения:

## 1. Общая статистика по символам

```sql
SELECT
    symbol,
    count() as total_trades,
    sum(pnl) as total_pnl,
    avg(pnl) as avg_pnl,
    sum(if(pnl > 0, 1, 0)) as winning_trades,
    sum(if(pnl < 0, 1, 0)) as losing_trades,
    sum(if(pnl > 0, 1, 0)) / count() as win_rate,
    avg(if(pnl > 0, pnl, 0)) as avg_win,
    avg(if(pnl < 0, pnl, 0)) as avg_loss,
    avg(duration_ms) / 1000 / 60 as avg_duration_minutes
FROM default.trades
WHERE timestamp >= now() - INTERVAL 1 DAY
GROUP BY symbol
ORDER BY total_pnl DESC
```

## 2. Анализ эффективности по времени удержания

```sql
SELECT
    symbol,
    multiIf(
        duration_ms < 300000, 'scalping (<5m)',
        duration_ms < 900000, 'short-term (5m-15m)',
        duration_ms < 3600000, 'medium-term (15m-1h)',
        'long-term (>1h)'
    ) as holding_period,
    count() as total_trades,
    sum(pnl) as total_pnl,
    avg(pnl) as avg_pnl,
    sum(if(pnl > 0, 1, 0)) / count() as win_rate
FROM default.trades
WHERE timestamp >= now() - INTERVAL 1 DAY
GROUP BY symbol, holding_period
ORDER BY symbol, holding_period
```

## 3. Статистика по причинам закрытия сделок

```sql
SELECT
    reason,
    count() as total_trades,
    sum(pnl) as total_pnl,
    avg(pnl) as avg_pnl,
    sum(if(pnl > 0, 1, 0)) / count() as win_rate
FROM default.trades
WHERE timestamp >= now() - INTERVAL 1 DAY
GROUP BY reason
ORDER BY total_trades DESC
```

## 4. Анализ по направлениям торговли

```sql
SELECT
    symbol,
    direction,
    count() as total_trades,
    sum(pnl) as total_pnl,
    avg(pnl) as avg_pnl,
    sum(if(pnl > 0, 1, 0)) / count() as win_rate
FROM default.trades
WHERE timestamp >= now() - INTERVAL 1 DAY
GROUP BY symbol, direction
ORDER BY symbol, direction
```

## 5. Анализ позиций по настройкам стоп-лосс и тейк-профит

```sql
SELECT
    symbol,
    side,
    avg(if(stop_loss_price IS NOT NULL, abs(stop_loss_price - entry_price) / entry_price, NULL)) as avg_sl_percent,
    avg(if(take_profit_price IS NOT NULL, abs(take_profit_price - entry_price) / entry_price, NULL)) as avg_tp_percent,
    count() as position_count
FROM default.positions
WHERE timestamp >= now() - INTERVAL 1 DAY
GROUP BY symbol, side
ORDER BY symbol, side
```

## 6. Распределение PnL по часам торговли

```sql
SELECT
    toHour(entry_time) as hour_of_day,
    count() as trade_count,
    sum(pnl) as total_pnl,
    avg(pnl) as avg_pnl,
    sum(if(pnl > 0, 1, 0)) / count() as win_rate
FROM default.trades
WHERE timestamp >= now() - INTERVAL 1 DAY
GROUP BY hour_of_day
ORDER BY hour_of_day
```

## 7. Анализ волатильности и размеров сделок

```sql
SELECT
    symbol,
    avg(highPrice24h - lowPrice24h) / avg(lowPrice24h) as avg_volatility,
    avg(abs(price24hPcnt)) as avg_daily_change,
    max(volume24h) as max_volume
FROM default.prices
WHERE timestamp >= now() - INTERVAL 1 DAY
GROUP BY symbol
ORDER BY avg_volatility DESC
```

## 8. Детальный анализ успешных и неуспешных сделок

```sql
SELECT
    symbol,
    if(pnl > 0, 'profitable', 'losing') as trade_result,
    avg(duration_ms) / 1000 / 60 as avg_duration_minutes,
    avg(abs(pnl_percentage)) as avg_pnl_percentage,
    count() as trade_count
FROM default.trades
WHERE timestamp >= now() - INTERVAL 1 DAY
GROUP BY symbol, trade_result
ORDER BY symbol, trade_result
```

## 9. Анализ эффективности конфигурации трейлинг-стопа

```sql
SELECT
    symbol,
    count(if(reason LIKE '%trailing%', 1, NULL)) as trailing_stop_activations,
    avg(if(reason LIKE '%trailing%', pnl, NULL)) as avg_trailing_stop_pnl,
    sum(if(reason LIKE '%trailing%' AND pnl > 0, 1, 0)) / 
    count(if(reason LIKE '%trailing%', 1, NULL)) as trailing_stop_win_rate
FROM default.trades
WHERE timestamp >= now() - INTERVAL 1 DAY
GROUP BY symbol
HAVING trailing_stop_activations > 0
ORDER BY trailing_stop_win_rate DESC
```

## 10. Анализ динамики спреда и его влияния на результаты

```sql
WITH spreads AS (
    SELECT
        symbol,
        timestamp,
        (ask1Price - bid1Price) / ((ask1Price + bid1Price) / 2) as spread_percentage
    FROM default.prices
    WHERE timestamp >= now() - INTERVAL 1 DAY
)

SELECT
    symbol,
    avg(spread_percentage) as avg_spread,
    max(spread_percentage) as max_spread,
    min(spread_percentage) as min_spread
FROM spreads
GROUP BY symbol
ORDER BY avg_spread DESC
```

`От юзера
поправь только значения которые есть по ключам из базового конфига, у меня нет функционал некоторого который ты указал`