import { GetKlineParamsV5 } from 'bybit-api/lib/types/request/v5-market.js';
import type { Dayjs } from 'dayjs';
import { KlineIntervalV3 } from 'bybit-api/lib/types/shared.js';


declare const PORT: number;
declare const BYBIT_KEY: string;
declare const BYBIT_SECRET: string;
declare const BYBIT_TESTNET: boolean;

// Конфигурация
interface Config {
  apiKey: string;
  apiSecret: string;
  symbol: string;
  category: GetKlineParamsV5['category'];
  timeframe: KlineIntervalV3;
  startDate: Dayjs;
  endDate: Dayjs;
}

// Типы данных
interface Candle {
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  timestamp: number;
}

interface AnalysisResult {
  signal: 'LONG' | 'SHORT' | 'NEUTRAL';
  confidence: number;
  indicators: {
    rsi: number;
    macd: { MACD: number; signal: number; histogram: number };
    ema20: number;
    ema50: number;
    bb: { upper: number; middle: number; lower: number };
  };
  priceData: Candle[];
  fundamentals?: {
    fundingRate: number;
    openInterest: number;
  };
}

interface SubscribeConfig {
  pump_threshold: number; // Порог для пампов (%)
  dump_threshold: number; // Порог для дампов (%)
  threshold_delta: number;
  volume_threshold: number, // Минимальный объём для учёта пампа/дампа
  oi_threshold: number,       // Минимальный рост OI (%), если он доступен
}
