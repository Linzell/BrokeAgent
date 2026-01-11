import { marketDataTool, type HistoricalBar } from "./market-data";

// ============================================
// Technical Analysis Types
// ============================================

export interface TechnicalIndicators {
  symbol: string;
  price: number;
  timestamp: Date;

  // Moving Averages
  sma20: number | null;
  sma50: number | null;
  sma200: number | null;
  ema12: number | null;
  ema26: number | null;

  // Momentum
  rsi14: number | null;
  macd: {
    value: number;
    signal: number;
    histogram: number;
  } | null;
  stochastic: {
    k: number;
    d: number;
  } | null;

  // Volatility
  bollingerBands: {
    upper: number;
    middle: number;
    lower: number;
    bandwidth: number;
  } | null;
  atr14: number | null;

  // Volume
  volumeSma20: number | null;
  volumeRatio: number | null; // Current volume / average volume

  // Price levels
  high52Week: number | null;
  low52Week: number | null;
  distanceFrom52High: number | null; // Percentage
  distanceFrom52Low: number | null;
}

export interface TechnicalSignal {
  indicator: string;
  signal: "buy" | "sell" | "neutral";
  strength: number; // 0-1
  value: number;
  description: string;
}

export interface TechnicalAnalysis {
  symbol: string;
  indicators: TechnicalIndicators;
  signals: TechnicalSignal[];
  trend: "bullish" | "bearish" | "neutral";
  trendStrength: number; // 0-100
  supportLevels: number[];
  resistanceLevels: number[];
  recommendation: string;
}

// ============================================
// Technical Analysis Tool
// ============================================

export class TechnicalAnalysisTool {
  /**
   * Run full technical analysis on a symbol
   */
  async analyze(symbol: string): Promise<TechnicalAnalysis> {
    // Fetch historical data (need enough for 200-day SMA)
    const bars = await marketDataTool.getHistorical(symbol, "1d", "1y");

    if (bars.length < 20) {
      throw new Error(`Insufficient data for ${symbol}: only ${bars.length} bars`);
    }

    const closes = bars.map((b) => b.close);
    const highs = bars.map((b) => b.high);
    const lows = bars.map((b) => b.low);
    const volumes = bars.map((b) => b.volume);
    const currentPrice = closes[closes.length - 1];
    const currentVolume = volumes[volumes.length - 1];

    // Calculate all indicators
    const indicators: TechnicalIndicators = {
      symbol: symbol.toUpperCase(),
      price: currentPrice,
      timestamp: bars[bars.length - 1].timestamp,

      // Moving Averages
      sma20: this.sma(closes, 20),
      sma50: closes.length >= 50 ? this.sma(closes, 50) : null,
      sma200: closes.length >= 200 ? this.sma(closes, 200) : null,
      ema12: this.ema(closes, 12),
      ema26: closes.length >= 26 ? this.ema(closes, 26) : null,

      // Momentum
      rsi14: this.rsi(closes, 14),
      macd: this.macd(closes),
      stochastic: this.stochastic(closes, highs, lows, 14),

      // Volatility
      bollingerBands: this.bollingerBands(closes, 20, 2),
      atr14: this.atr(highs, lows, closes, 14),

      // Volume
      volumeSma20: this.sma(volumes, 20),
      volumeRatio: this.sma(volumes, 20)
        ? currentVolume / this.sma(volumes, 20)!
        : null,

      // Price levels
      high52Week: Math.max(...highs.slice(-252)),
      low52Week: Math.min(...lows.slice(-252)),
      distanceFrom52High: null,
      distanceFrom52Low: null,
    };

    // Calculate distances from 52-week levels
    if (indicators.high52Week) {
      indicators.distanceFrom52High =
        ((currentPrice - indicators.high52Week) / indicators.high52Week) * 100;
    }
    if (indicators.low52Week) {
      indicators.distanceFrom52Low =
        ((currentPrice - indicators.low52Week) / indicators.low52Week) * 100;
    }

    // Generate signals
    const signals = this.generateSignals(indicators, currentPrice);

    // Determine overall trend
    const { trend, trendStrength } = this.determineTrend(indicators, signals);

    // Find support/resistance levels
    const supportLevels = this.findSupportLevels(lows, currentPrice);
    const resistanceLevels = this.findResistanceLevels(highs, currentPrice);

    // Generate recommendation
    const recommendation = this.generateRecommendation(
      trend,
      trendStrength,
      signals,
      indicators
    );

    return {
      symbol: symbol.toUpperCase(),
      indicators,
      signals,
      trend,
      trendStrength,
      supportLevels,
      resistanceLevels,
      recommendation,
    };
  }

  // ============================================
  // Moving Averages
  // ============================================

  private sma(data: number[], period: number): number | null {
    if (data.length < period) return null;
    const slice = data.slice(-period);
    return slice.reduce((a, b) => a + b, 0) / period;
  }

  private ema(data: number[], period: number): number | null {
    if (data.length < period) return null;

    const multiplier = 2 / (period + 1);
    let ema = this.sma(data.slice(0, period), period)!;

    for (let i = period; i < data.length; i++) {
      ema = (data[i] - ema) * multiplier + ema;
    }

    return ema;
  }

  // ============================================
  // Momentum Indicators
  // ============================================

  private rsi(closes: number[], period: number = 14): number | null {
    if (closes.length < period + 1) return null;

    const changes: number[] = [];
    for (let i = 1; i < closes.length; i++) {
      changes.push(closes[i] - closes[i - 1]);
    }

    const gains = changes.map((c) => (c > 0 ? c : 0));
    const losses = changes.map((c) => (c < 0 ? -c : 0));

    // Initial averages
    let avgGain = gains.slice(0, period).reduce((a, b) => a + b, 0) / period;
    let avgLoss = losses.slice(0, period).reduce((a, b) => a + b, 0) / period;

    // Smoothed averages
    for (let i = period; i < changes.length; i++) {
      avgGain = (avgGain * (period - 1) + gains[i]) / period;
      avgLoss = (avgLoss * (period - 1) + losses[i]) / period;
    }

    if (avgLoss === 0) return 100;
    const rs = avgGain / avgLoss;
    return 100 - 100 / (1 + rs);
  }

  private macd(
    closes: number[]
  ): { value: number; signal: number; histogram: number } | null {
    const ema12 = this.ema(closes, 12);
    const ema26 = this.ema(closes, 26);

    if (!ema12 || !ema26) return null;

    const macdLine = ema12 - ema26;

    // Calculate signal line (9-day EMA of MACD)
    // Simplified: we'd need full MACD history for accurate signal
    const macdHistory: number[] = [];
    for (let i = 26; i <= closes.length; i++) {
      const e12 = this.ema(closes.slice(0, i), 12);
      const e26 = this.ema(closes.slice(0, i), 26);
      if (e12 && e26) macdHistory.push(e12 - e26);
    }

    const signal = this.ema(macdHistory, 9) || macdLine;
    const histogram = macdLine - signal;

    return { value: macdLine, signal, histogram };
  }

  private stochastic(
    closes: number[],
    highs: number[],
    lows: number[],
    period: number = 14
  ): { k: number; d: number } | null {
    if (closes.length < period) return null;

    const recentCloses = closes.slice(-period);
    const recentHighs = highs.slice(-period);
    const recentLows = lows.slice(-period);

    const highestHigh = Math.max(...recentHighs);
    const lowestLow = Math.min(...recentLows);
    const currentClose = closes[closes.length - 1];

    if (highestHigh === lowestLow) return { k: 50, d: 50 };

    const k = ((currentClose - lowestLow) / (highestHigh - lowestLow)) * 100;

    // %D is 3-period SMA of %K (simplified)
    const d = k; // Would need K history for accurate D

    return { k, d };
  }

  // ============================================
  // Volatility Indicators
  // ============================================

  private bollingerBands(
    closes: number[],
    period: number = 20,
    stdDev: number = 2
  ): { upper: number; middle: number; lower: number; bandwidth: number } | null {
    if (closes.length < period) return null;

    const slice = closes.slice(-period);
    const middle = slice.reduce((a, b) => a + b, 0) / period;

    const squaredDiffs = slice.map((c) => Math.pow(c - middle, 2));
    const variance = squaredDiffs.reduce((a, b) => a + b, 0) / period;
    const std = Math.sqrt(variance);

    const upper = middle + stdDev * std;
    const lower = middle - stdDev * std;
    const bandwidth = ((upper - lower) / middle) * 100;

    return { upper, middle, lower, bandwidth };
  }

  private atr(
    highs: number[],
    lows: number[],
    closes: number[],
    period: number = 14
  ): number | null {
    if (closes.length < period + 1) return null;

    const trueRanges: number[] = [];

    for (let i = 1; i < closes.length; i++) {
      const high = highs[i];
      const low = lows[i];
      const prevClose = closes[i - 1];

      const tr = Math.max(
        high - low,
        Math.abs(high - prevClose),
        Math.abs(low - prevClose)
      );
      trueRanges.push(tr);
    }

    // Simple average for ATR
    const recentTR = trueRanges.slice(-period);
    return recentTR.reduce((a, b) => a + b, 0) / period;
  }

  // ============================================
  // Signal Generation
  // ============================================

  private generateSignals(
    indicators: TechnicalIndicators,
    currentPrice: number
  ): TechnicalSignal[] {
    const signals: TechnicalSignal[] = [];

    // RSI signals
    if (indicators.rsi14 !== null) {
      if (indicators.rsi14 < 30) {
        signals.push({
          indicator: "RSI",
          signal: "buy",
          strength: (30 - indicators.rsi14) / 30,
          value: indicators.rsi14,
          description: `RSI is oversold at ${indicators.rsi14.toFixed(1)}`,
        });
      } else if (indicators.rsi14 > 70) {
        signals.push({
          indicator: "RSI",
          signal: "sell",
          strength: (indicators.rsi14 - 70) / 30,
          value: indicators.rsi14,
          description: `RSI is overbought at ${indicators.rsi14.toFixed(1)}`,
        });
      } else {
        signals.push({
          indicator: "RSI",
          signal: "neutral",
          strength: 0.5,
          value: indicators.rsi14,
          description: `RSI is neutral at ${indicators.rsi14.toFixed(1)}`,
        });
      }
    }

    // MACD signals
    if (indicators.macd) {
      const { histogram } = indicators.macd;
      if (histogram > 0) {
        signals.push({
          indicator: "MACD",
          signal: "buy",
          strength: Math.min(Math.abs(histogram) / 2, 1),
          value: histogram,
          description: `MACD histogram positive (${histogram.toFixed(3)})`,
        });
      } else {
        signals.push({
          indicator: "MACD",
          signal: "sell",
          strength: Math.min(Math.abs(histogram) / 2, 1),
          value: histogram,
          description: `MACD histogram negative (${histogram.toFixed(3)})`,
        });
      }
    }

    // Moving Average signals
    if (indicators.sma20 && indicators.sma50) {
      if (indicators.sma20 > indicators.sma50) {
        signals.push({
          indicator: "MA Cross",
          signal: "buy",
          strength: 0.7,
          value: indicators.sma20 - indicators.sma50,
          description: "SMA20 above SMA50 (bullish cross)",
        });
      } else {
        signals.push({
          indicator: "MA Cross",
          signal: "sell",
          strength: 0.7,
          value: indicators.sma20 - indicators.sma50,
          description: "SMA20 below SMA50 (bearish cross)",
        });
      }
    }

    // Price vs SMA200 (long-term trend)
    if (indicators.sma200) {
      if (currentPrice > indicators.sma200) {
        signals.push({
          indicator: "SMA200",
          signal: "buy",
          strength: 0.6,
          value: ((currentPrice - indicators.sma200) / indicators.sma200) * 100,
          description: `Price above 200-day MA (${((currentPrice / indicators.sma200 - 1) * 100).toFixed(1)}%)`,
        });
      } else {
        signals.push({
          indicator: "SMA200",
          signal: "sell",
          strength: 0.6,
          value: ((currentPrice - indicators.sma200) / indicators.sma200) * 100,
          description: `Price below 200-day MA (${((currentPrice / indicators.sma200 - 1) * 100).toFixed(1)}%)`,
        });
      }
    }

    // Bollinger Bands signals
    if (indicators.bollingerBands) {
      const { upper, lower, middle } = indicators.bollingerBands;
      if (currentPrice <= lower) {
        signals.push({
          indicator: "Bollinger",
          signal: "buy",
          strength: 0.8,
          value: currentPrice,
          description: "Price at lower Bollinger Band (potential bounce)",
        });
      } else if (currentPrice >= upper) {
        signals.push({
          indicator: "Bollinger",
          signal: "sell",
          strength: 0.8,
          value: currentPrice,
          description: "Price at upper Bollinger Band (potential reversal)",
        });
      }
    }

    // Volume signals
    if (indicators.volumeRatio !== null) {
      if (indicators.volumeRatio > 2) {
        signals.push({
          indicator: "Volume",
          signal: "neutral", // Volume alone doesn't indicate direction
          strength: Math.min(indicators.volumeRatio / 3, 1),
          value: indicators.volumeRatio,
          description: `Unusually high volume (${indicators.volumeRatio.toFixed(1)}x average)`,
        });
      }
    }

    return signals;
  }

  // ============================================
  // Trend Analysis
  // ============================================

  private determineTrend(
    indicators: TechnicalIndicators,
    signals: TechnicalSignal[]
  ): { trend: "bullish" | "bearish" | "neutral"; trendStrength: number } {
    let bullishScore = 0;
    let bearishScore = 0;
    let totalWeight = 0;

    // Score from signals
    for (const signal of signals) {
      const weight = signal.strength;
      totalWeight += weight;

      if (signal.signal === "buy") {
        bullishScore += weight;
      } else if (signal.signal === "sell") {
        bearishScore += weight;
      } else {
        bullishScore += weight * 0.5;
        bearishScore += weight * 0.5;
      }
    }

    // Additional trend factors
    if (indicators.sma20 && indicators.sma50 && indicators.sma200) {
      // All MAs aligned bullish
      if (indicators.sma20 > indicators.sma50 && indicators.sma50 > indicators.sma200) {
        bullishScore += 1;
        totalWeight += 1;
      }
      // All MAs aligned bearish
      if (indicators.sma20 < indicators.sma50 && indicators.sma50 < indicators.sma200) {
        bearishScore += 1;
        totalWeight += 1;
      }
    }

    if (totalWeight === 0) {
      return { trend: "neutral", trendStrength: 50 };
    }

    const bullishRatio = bullishScore / totalWeight;
    const bearishRatio = bearishScore / totalWeight;

    let trend: "bullish" | "bearish" | "neutral";
    let trendStrength: number;

    if (bullishRatio > bearishRatio + 0.1) {
      trend = "bullish";
      trendStrength = Math.round(50 + bullishRatio * 50);
    } else if (bearishRatio > bullishRatio + 0.1) {
      trend = "bearish";
      trendStrength = Math.round(50 - bearishRatio * 50);
    } else {
      trend = "neutral";
      trendStrength = 50;
    }

    return { trend, trendStrength: Math.max(0, Math.min(100, trendStrength)) };
  }

  // ============================================
  // Support & Resistance
  // ============================================

  private findSupportLevels(lows: number[], currentPrice: number): number[] {
    const supports: number[] = [];
    const recentLows = lows.slice(-60); // Last 60 days

    // Find local minimums
    for (let i = 2; i < recentLows.length - 2; i++) {
      if (
        recentLows[i] < recentLows[i - 1] &&
        recentLows[i] < recentLows[i - 2] &&
        recentLows[i] < recentLows[i + 1] &&
        recentLows[i] < recentLows[i + 2] &&
        recentLows[i] < currentPrice
      ) {
        supports.push(recentLows[i]);
      }
    }

    // Dedupe similar levels and sort
    return this.dedupeAndSort(supports, currentPrice, "below").slice(0, 3);
  }

  private findResistanceLevels(highs: number[], currentPrice: number): number[] {
    const resistances: number[] = [];
    const recentHighs = highs.slice(-60);

    // Find local maximums
    for (let i = 2; i < recentHighs.length - 2; i++) {
      if (
        recentHighs[i] > recentHighs[i - 1] &&
        recentHighs[i] > recentHighs[i - 2] &&
        recentHighs[i] > recentHighs[i + 1] &&
        recentHighs[i] > recentHighs[i + 2] &&
        recentHighs[i] > currentPrice
      ) {
        resistances.push(recentHighs[i]);
      }
    }

    return this.dedupeAndSort(resistances, currentPrice, "above").slice(0, 3);
  }

  private dedupeAndSort(
    levels: number[],
    currentPrice: number,
    direction: "above" | "below"
  ): number[] {
    // Round to reduce noise
    const rounded = levels.map((l) => Math.round(l * 100) / 100);

    // Remove duplicates within 1% of each other
    const unique: number[] = [];
    for (const level of rounded.sort((a, b) => a - b)) {
      if (!unique.some((u) => Math.abs(u - level) / level < 0.01)) {
        unique.push(level);
      }
    }

    // Sort by distance from current price
    return unique.sort((a, b) => {
      const distA = Math.abs(a - currentPrice);
      const distB = Math.abs(b - currentPrice);
      return distA - distB;
    });
  }

  // ============================================
  // Recommendation
  // ============================================

  private generateRecommendation(
    trend: string,
    trendStrength: number,
    signals: TechnicalSignal[],
    indicators: TechnicalIndicators
  ): string {
    const lines: string[] = [];

    // Overall trend
    if (trend === "bullish") {
      lines.push(
        `Technical outlook is BULLISH with ${trendStrength}% strength.`
      );
    } else if (trend === "bearish") {
      lines.push(
        `Technical outlook is BEARISH with ${100 - trendStrength}% strength.`
      );
    } else {
      lines.push(`Technical outlook is NEUTRAL - mixed signals.`);
    }

    // Key signals
    const buySignals = signals.filter((s) => s.signal === "buy" && s.strength > 0.5);
    const sellSignals = signals.filter((s) => s.signal === "sell" && s.strength > 0.5);

    if (buySignals.length > 0) {
      lines.push(
        `Bullish signals: ${buySignals.map((s) => s.indicator).join(", ")}.`
      );
    }
    if (sellSignals.length > 0) {
      lines.push(
        `Bearish signals: ${sellSignals.map((s) => s.indicator).join(", ")}.`
      );
    }

    // Risk note
    if (indicators.atr14 && indicators.price) {
      const atrPercent = (indicators.atr14 / indicators.price) * 100;
      if (atrPercent > 3) {
        lines.push(
          `High volatility (ATR ${atrPercent.toFixed(1)}%) - use wider stops.`
        );
      }
    }

    return lines.join(" ");
  }
}

// Export singleton
export const technicalAnalysisTool = new TechnicalAnalysisTool();
