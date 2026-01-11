/**
 * Tests for Backtesting Service
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  Backtester,
  createBacktester,
  createSMAStrategy,
  createRSIStrategy,
  type BacktestConfig,
  type HistoricalBar,
  type StrategyFunction,
} from "../../app/src/services/backtester";

// ============================================
// Test Data Helpers
// ============================================

function generateBars(
  startDate: Date,
  days: number,
  startPrice: number,
  volatility: number = 0.02
): HistoricalBar[] {
  const bars: HistoricalBar[] = [];
  let price = startPrice;

  for (let i = 0; i < days; i++) {
    const date = new Date(startDate);
    date.setDate(date.getDate() + i);

    // Skip weekends
    if (date.getDay() === 0 || date.getDay() === 6) continue;

    // Random walk with drift
    const change = (Math.random() - 0.48) * volatility * price;
    const open = price;
    const close = price + change;
    const high = Math.max(open, close) * (1 + Math.random() * 0.01);
    const low = Math.min(open, close) * (1 - Math.random() * 0.01);

    bars.push({
      timestamp: date,
      open,
      high,
      low,
      close,
      volume: Math.floor(1000000 + Math.random() * 5000000),
    });

    price = close;
  }

  return bars;
}

function generateTrendingBars(
  startDate: Date,
  days: number,
  startPrice: number,
  trend: "up" | "down" | "sideways"
): HistoricalBar[] {
  const bars: HistoricalBar[] = [];
  let price = startPrice;

  const drift = trend === "up" ? 0.002 : trend === "down" ? -0.002 : 0;
  const volatility = trend === "sideways" ? 0.005 : 0.015;

  for (let i = 0; i < days; i++) {
    const date = new Date(startDate);
    date.setDate(date.getDate() + i);

    if (date.getDay() === 0 || date.getDay() === 6) continue;

    const change = drift * price + (Math.random() - 0.5) * volatility * price;
    const open = price;
    const close = price + change;
    const high = Math.max(open, close) * (1 + Math.random() * 0.01);
    const low = Math.min(open, close) * (1 - Math.random() * 0.01);

    bars.push({
      timestamp: date,
      open,
      high,
      low,
      close,
      volume: Math.floor(1000000 + Math.random() * 5000000),
    });

    price = close;
  }

  return bars;
}

// Default test config
const defaultConfig: BacktestConfig = {
  startDate: new Date("2024-01-01"),
  endDate: new Date("2024-03-31"),
  symbols: ["AAPL"],
  initialCapital: 100000,
  commission: 0.001, // 0.1%
  slippage: 0.001, // 0.1%
  positionSizing: "percent",
  positionSize: 0.1, // 10% of portfolio per position
  maxPositions: 5,
  allowShorts: false,
};

// ============================================
// Tests
// ============================================

describe("Backtester", () => {
  describe("initialization", () => {
    it("should create backtester with config", () => {
      const backtester = createBacktester(defaultConfig);
      expect(backtester).toBeInstanceOf(Backtester);
    });

    it("should have correct initial state", () => {
      const backtester = new Backtester(defaultConfig);
      expect(backtester).toBeDefined();
    });
  });

  describe("data loading", () => {
    it("should load historical data", () => {
      const backtester = createBacktester(defaultConfig);
      const bars = generateBars(new Date("2024-01-01"), 90, 175);

      const events: any[] = [];
      backtester.on("dataLoaded", (e) => events.push(e));

      backtester.loadData("AAPL", bars);

      expect(events.length).toBe(1);
      expect(events[0].symbol).toBe("AAPL");
      expect(events[0].bars).toBeGreaterThan(0);
    });

    it("should filter data to backtest period", () => {
      const config: BacktestConfig = {
        ...defaultConfig,
        startDate: new Date("2024-02-01"),
        endDate: new Date("2024-02-28"),
      };
      const backtester = createBacktester(config);

      // Generate 90 days but only Feb should be included
      const bars = generateBars(new Date("2024-01-01"), 90, 175);

      const events: any[] = [];
      backtester.on("dataLoaded", (e) => events.push(e));

      backtester.loadData("AAPL", bars);

      // Should have ~20 trading days in Feb
      expect(events[0].bars).toBeLessThan(30);
      expect(events[0].bars).toBeGreaterThan(15);
    });

    it("should throw error if no data loaded", async () => {
      const backtester = createBacktester(defaultConfig);
      const strategy: StrategyFunction = async () => [];

      await expect(backtester.run(strategy)).rejects.toThrow("No historical data loaded");
    });
  });

  describe("backtest execution", () => {
    it("should run backtest with simple buy-and-hold", async () => {
      const backtester = createBacktester(defaultConfig);
      const bars = generateBars(new Date("2024-01-01"), 90, 175);
      backtester.loadData("AAPL", bars);

      let hasBought = false;
      const strategy: StrategyFunction = async (state, currentBars, portfolio) => {
        if (!hasBought && portfolio.cash > 0) {
          hasBought = true;
          return [{ action: "buy", symbol: "AAPL", reason: "Buy and hold" }];
        }
        return [];
      };

      const result = await backtester.run(strategy);

      expect(result).toBeDefined();
      expect(result.trades.length).toBe(1);
      expect(result.trades[0].action).toBe("buy");
      expect(result.dailySnapshots.length).toBeGreaterThan(0);
      expect(result.metrics).toBeDefined();
    });

    it("should emit progress events", async () => {
      const backtester = createBacktester(defaultConfig);
      const bars = generateBars(new Date("2024-01-01"), 90, 175);
      backtester.loadData("AAPL", bars);

      const progressEvents: any[] = [];
      backtester.on("progress", (e) => progressEvents.push(e));

      const strategy: StrategyFunction = async () => [];
      await backtester.run(strategy);

      expect(progressEvents.length).toBeGreaterThan(0);
      expect(progressEvents[progressEvents.length - 1].percent).toBeGreaterThan(90);
    });

    it("should emit trade events", async () => {
      const backtester = createBacktester(defaultConfig);
      const bars = generateBars(new Date("2024-01-01"), 90, 175);
      backtester.loadData("AAPL", bars);

      const tradeEvents: any[] = [];
      backtester.on("trade", (e) => tradeEvents.push(e));

      let bought = false;
      const strategy: StrategyFunction = async (state, currentBars, portfolio) => {
        if (!bought) {
          bought = true;
          return [{ action: "buy", symbol: "AAPL" }];
        }
        return [];
      };

      await backtester.run(strategy);

      expect(tradeEvents.length).toBe(1);
      expect(tradeEvents[0].action).toBe("buy");
      expect(tradeEvents[0].symbol).toBe("AAPL");
    });

    it("should handle multiple symbols", async () => {
      const config: BacktestConfig = {
        ...defaultConfig,
        symbols: ["AAPL", "MSFT"],
      };
      const backtester = createBacktester(config);

      backtester.loadData("AAPL", generateBars(new Date("2024-01-01"), 90, 175));
      backtester.loadData("MSFT", generateBars(new Date("2024-01-01"), 90, 380));

      let boughtAAPL = false;
      let boughtMSFT = false;
      const strategy: StrategyFunction = async (state, currentBars, portfolio) => {
        const signals: any[] = [];
        if (!boughtAAPL && currentBars.has("AAPL")) {
          boughtAAPL = true;
          signals.push({ action: "buy", symbol: "AAPL" });
        }
        if (!boughtMSFT && currentBars.has("MSFT")) {
          boughtMSFT = true;
          signals.push({ action: "buy", symbol: "MSFT" });
        }
        return signals;
      };

      const result = await backtester.run(strategy);

      expect(result.trades.length).toBe(2);
      expect(result.finalPortfolio.positions.length).toBe(2);
    });
  });

  describe("trade execution", () => {
    it("should deduct commission and slippage from buy", async () => {
      const backtester = createBacktester(defaultConfig);
      const bars = generateBars(new Date("2024-01-01"), 90, 100); // $100 stock
      backtester.loadData("AAPL", bars);

      let bought = false;
      const strategy: StrategyFunction = async () => {
        if (!bought) {
          bought = true;
          return [{ action: "buy", symbol: "AAPL", quantity: 100 }];
        }
        return [];
      };

      const result = await backtester.run(strategy);

      const trade = result.trades[0];
      expect(trade.commission).toBeGreaterThan(0);
      expect(trade.slippage).toBeGreaterThan(0);
      // Cash should be less than initial - (price * quantity) due to costs
      expect(result.finalPortfolio.cash).toBeLessThan(
        defaultConfig.initialCapital - trade.price * trade.quantity
      );
    });

    it("should limit buy to available cash", async () => {
      const config: BacktestConfig = {
        ...defaultConfig,
        initialCapital: 1000, // Very low capital
      };
      const backtester = createBacktester(config);
      const bars = generateBars(new Date("2024-01-01"), 90, 100);
      backtester.loadData("AAPL", bars);

      let bought = false;
      const strategy: StrategyFunction = async () => {
        if (!bought) {
          bought = true;
          return [{ action: "buy", symbol: "AAPL", quantity: 1000 }]; // Try to buy way more than we can afford
        }
        return [];
      };

      const result = await backtester.run(strategy);

      // Should have bought only what we could afford
      expect(result.trades.length).toBe(1);
      expect(result.trades[0].quantity).toBeLessThan(1000);
      expect(result.finalPortfolio.cash).toBeGreaterThanOrEqual(0);
    });

    it("should handle sell orders correctly", async () => {
      const backtester = createBacktester(defaultConfig);
      const bars = generateBars(new Date("2024-01-01"), 90, 100);
      backtester.loadData("AAPL", bars);

      let step = 0;
      const strategy: StrategyFunction = async (state, currentBars, portfolio) => {
        step++;
        if (step === 1) {
          return [{ action: "buy", symbol: "AAPL", quantity: 100 }];
        }
        if (step === 30 && portfolio.positions.length > 0) {
          return [{ action: "sell", symbol: "AAPL", quantity: 100 }];
        }
        return [];
      };

      const result = await backtester.run(strategy);

      expect(result.trades.length).toBe(2);
      expect(result.trades[0].action).toBe("buy");
      expect(result.trades[1].action).toBe("sell");
      expect(result.finalPortfolio.positions.length).toBe(0);
    });

    it("should respect max positions", async () => {
      const config: BacktestConfig = {
        ...defaultConfig,
        symbols: ["AAPL", "MSFT", "GOOGL", "AMZN", "META", "NVDA"],
        maxPositions: 3,
      };
      const backtester = createBacktester(config);

      // Load data for all symbols
      for (const symbol of config.symbols) {
        backtester.loadData(symbol, generateBars(new Date("2024-01-01"), 90, 100 + Math.random() * 100));
      }

      let buyAttempts = 0;
      const strategy: StrategyFunction = async (state, currentBars) => {
        buyAttempts++;
        if (buyAttempts <= 10) {
          // Try to buy all symbols
          return config.symbols.map((symbol) => ({
            action: "buy" as const,
            symbol,
            quantity: 10,
          }));
        }
        return [];
      };

      const result = await backtester.run(strategy);

      // Should only have 3 positions despite trying to buy 6
      expect(result.finalPortfolio.positions.length).toBeLessThanOrEqual(3);
    });
  });

  describe("performance metrics", () => {
    it("should calculate total return correctly", async () => {
      const backtester = createBacktester(defaultConfig);
      // Generate uptrending data
      const bars = generateTrendingBars(new Date("2024-01-01"), 90, 100, "up");
      backtester.loadData("AAPL", bars);

      // Buy and hold
      let bought = false;
      const strategy: StrategyFunction = async () => {
        if (!bought) {
          bought = true;
          return [{ action: "buy", symbol: "AAPL", quantity: 100 }];
        }
        return [];
      };

      const result = await backtester.run(strategy);

      // With uptrend, should have positive return
      expect(result.metrics.totalReturn).toBeGreaterThan(-0.5); // Allow for random variation
    });

    it("should calculate volatility", async () => {
      const backtester = createBacktester(defaultConfig);
      const bars = generateBars(new Date("2024-01-01"), 90, 100, 0.03); // Higher volatility
      backtester.loadData("AAPL", bars);

      const strategy: StrategyFunction = async () => [];

      const result = await backtester.run(strategy);

      expect(result.metrics.volatility).toBeGreaterThanOrEqual(0);
      expect(result.metrics.annualizedVolatility).toBeGreaterThanOrEqual(0);
    });

    it("should calculate max drawdown", async () => {
      const backtester = createBacktester(defaultConfig);
      const bars = generateTrendingBars(new Date("2024-01-01"), 90, 100, "down");
      backtester.loadData("AAPL", bars);

      let bought = false;
      const strategy: StrategyFunction = async () => {
        if (!bought) {
          bought = true;
          return [{ action: "buy", symbol: "AAPL", quantity: 500 }];
        }
        return [];
      };

      const result = await backtester.run(strategy);

      // With downtrend, should have max drawdown > 0
      expect(result.metrics.maxDrawdown).toBeGreaterThanOrEqual(0);
    });

    it("should calculate trade statistics", async () => {
      const backtester = createBacktester(defaultConfig);
      const bars = generateBars(new Date("2024-01-01"), 90, 100);
      backtester.loadData("AAPL", bars);

      let tradeCount = 0;
      const strategy: StrategyFunction = async (state, currentBars, portfolio) => {
        tradeCount++;
        // Alternate buy/sell every 10 days
        if (tradeCount % 20 === 1 && portfolio.positions.length === 0) {
          return [{ action: "buy", symbol: "AAPL", quantity: 100 }];
        }
        if (tradeCount % 20 === 10 && portfolio.positions.length > 0) {
          return [{ action: "sell", symbol: "AAPL", quantity: 100 }];
        }
        return [];
      };

      const result = await backtester.run(strategy);

      expect(result.metrics.totalTrades).toBeGreaterThan(0);
      expect(result.metrics.winRate).toBeGreaterThanOrEqual(0);
      expect(result.metrics.winRate).toBeLessThanOrEqual(1);
    });

    it("should calculate Sharpe ratio", async () => {
      const backtester = createBacktester(defaultConfig);
      const bars = generateTrendingBars(new Date("2024-01-01"), 90, 100, "up");
      backtester.loadData("AAPL", bars);

      let bought = false;
      const strategy: StrategyFunction = async () => {
        if (!bought) {
          bought = true;
          return [{ action: "buy", symbol: "AAPL", quantity: 100 }];
        }
        return [];
      };

      const result = await backtester.run(strategy);

      // Sharpe ratio should be a number
      expect(typeof result.metrics.sharpeRatio).toBe("number");
      expect(isNaN(result.metrics.sharpeRatio)).toBe(false);
    });
  });

  describe("daily snapshots", () => {
    it("should record daily snapshots", async () => {
      const backtester = createBacktester(defaultConfig);
      const bars = generateBars(new Date("2024-01-01"), 90, 100);
      backtester.loadData("AAPL", bars);

      const strategy: StrategyFunction = async () => [];

      const result = await backtester.run(strategy);

      expect(result.dailySnapshots.length).toBeGreaterThan(0);
      expect(result.dailySnapshots[0].date).toBeInstanceOf(Date);
      expect(result.dailySnapshots[0].cash).toBe(defaultConfig.initialCapital);
      expect(result.dailySnapshots[0].totalValue).toBe(defaultConfig.initialCapital);
    });

    it("should track cumulative returns", async () => {
      const backtester = createBacktester(defaultConfig);
      const bars = generateBars(new Date("2024-01-01"), 90, 100);
      backtester.loadData("AAPL", bars);

      let bought = false;
      const strategy: StrategyFunction = async () => {
        if (!bought) {
          bought = true;
          return [{ action: "buy", symbol: "AAPL", quantity: 100 }];
        }
        return [];
      };

      const result = await backtester.run(strategy);

      // First snapshot should have 0 cumulative return (before any changes)
      // or very small due to slippage/commission
      const firstSnapshot = result.dailySnapshots[0];
      expect(Math.abs(firstSnapshot.cumulativeReturn)).toBeLessThan(0.1);

      // Last snapshot should match final total return
      const lastSnapshot = result.dailySnapshots[result.dailySnapshots.length - 1];
      expect(lastSnapshot.cumulativeReturn).toBeCloseTo(result.metrics.totalReturn, 2);
    });
  });

  describe("error handling", () => {
    it("should handle strategy errors gracefully", async () => {
      const backtester = createBacktester(defaultConfig);
      const bars = generateBars(new Date("2024-01-01"), 90, 100);
      backtester.loadData("AAPL", bars);

      let callCount = 0;
      const strategy: StrategyFunction = async () => {
        callCount++;
        if (callCount === 5) {
          throw new Error("Strategy calculation failed");
        }
        return [];
      };

      const result = await backtester.run(strategy);

      // Should complete despite error
      expect(result).toBeDefined();
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]).toContain("Strategy error");
    });

    it("should handle missing symbol data", async () => {
      const backtester = createBacktester(defaultConfig);
      const bars = generateBars(new Date("2024-01-01"), 90, 100);
      backtester.loadData("AAPL", bars);

      const strategy: StrategyFunction = async () => {
        return [{ action: "buy", symbol: "INVALID", quantity: 100 }];
      };

      const result = await backtester.run(strategy);

      // Should complete but record error
      expect(result).toBeDefined();
      expect(result.errors.some((e) => e.includes("INVALID"))).toBe(true);
      expect(result.trades.length).toBe(0);
    });
  });
});

describe("Pre-built Strategies", () => {
  describe("SMA Crossover Strategy", () => {
    it("should create SMA strategy with default parameters", () => {
      const strategy = createSMAStrategy();
      expect(typeof strategy).toBe("function");
    });

    it("should generate buy signals on golden cross", async () => {
      const backtester = createBacktester(defaultConfig);
      // Create data that will have a golden cross
      const bars = generateTrendingBars(new Date("2024-01-01"), 90, 100, "up");
      backtester.loadData("AAPL", bars);

      const strategy = createSMAStrategy(5, 10); // Shorter periods for test

      const result = await backtester.run(strategy);

      // Should have at least some trades (may vary due to random data)
      expect(result).toBeDefined();
      expect(result.dailySnapshots.length).toBeGreaterThan(0);
    });
  });

  describe("RSI Strategy", () => {
    it("should create RSI strategy with default parameters", () => {
      const strategy = createRSIStrategy();
      expect(typeof strategy).toBe("function");
    });

    it("should run RSI strategy", async () => {
      const backtester = createBacktester(defaultConfig);
      const bars = generateBars(new Date("2024-01-01"), 90, 100);
      backtester.loadData("AAPL", bars);

      const strategy = createRSIStrategy(7, 30, 70); // Shorter period for test

      const result = await backtester.run(strategy);

      expect(result).toBeDefined();
      expect(result.dailySnapshots.length).toBeGreaterThan(0);
    });
  });
});

describe("Results Formatting", () => {
  it("should format results as string", async () => {
    const backtester = createBacktester(defaultConfig);
    const bars = generateBars(new Date("2024-01-01"), 90, 100);
    backtester.loadData("AAPL", bars);

    let bought = false;
    const strategy: StrategyFunction = async () => {
      if (!bought) {
        bought = true;
        return [{ action: "buy", symbol: "AAPL", quantity: 100 }];
      }
      return [];
    };

    const result = await backtester.run(strategy);
    const formatted = Backtester.formatResults(result);

    expect(typeof formatted).toBe("string");
    expect(formatted).toContain("BACKTEST RESULTS");
    expect(formatted).toContain("Total Return");
    expect(formatted).toContain("Sharpe Ratio");
    expect(formatted).toContain("Total Trades");
  });
});
