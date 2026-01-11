/**
 * Backtesting Service
 *
 * Provides historical data replay and strategy evaluation capabilities:
 * - Historical data simulation
 * - Performance metrics calculation (Sharpe ratio, max drawdown, etc.)
 * - Strategy comparison with benchmarks
 * - Trade execution simulation
 */

import { EventEmitter } from "events";
import type { TradingState } from "../core/state";
import { createInitialState } from "../core/state";

// ============================================
// Types
// ============================================

export interface HistoricalBar {
  timestamp: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface BacktestConfig {
  /** Start date for backtest */
  startDate: Date;
  /** End date for backtest */
  endDate: Date;
  /** Symbols to backtest */
  symbols: string[];
  /** Initial capital */
  initialCapital: number;
  /** Commission per trade (as percentage, e.g., 0.001 = 0.1%) */
  commission: number;
  /** Slippage assumption (as percentage) */
  slippage: number;
  /** Position sizing method */
  positionSizing: "fixed" | "percent" | "volatility";
  /** Fixed position size or percent of portfolio */
  positionSize: number;
  /** Maximum positions to hold at once */
  maxPositions: number;
  /** Allow short selling */
  allowShorts: boolean;
  /** Benchmark symbol for comparison */
  benchmark?: string;
}

export interface Trade {
  id: string;
  symbol: string;
  action: "buy" | "sell" | "short" | "cover";
  quantity: number;
  price: number;
  timestamp: Date;
  commission: number;
  slippage: number;
  value: number; // Total value including commission
  reason?: string;
}

export interface Position {
  symbol: string;
  quantity: number;
  avgCost: number;
  currentPrice: number;
  marketValue: number;
  unrealizedPnl: number;
  unrealizedPnlPercent: number;
  entryDate: Date;
}

export interface DailySnapshot {
  date: Date;
  cash: number;
  positions: Position[];
  totalValue: number;
  dailyReturn: number;
  cumulativeReturn: number;
  drawdown: number;
}

export interface PerformanceMetrics {
  // Returns
  totalReturn: number;
  annualizedReturn: number;
  cumulativeReturns: number[];

  // Risk metrics
  volatility: number;
  annualizedVolatility: number;
  maxDrawdown: number;
  maxDrawdownDuration: number; // In days
  sharpeRatio: number;
  sortinoRatio: number;
  calmarRatio: number;

  // Trade statistics
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;
  avgWin: number;
  avgLoss: number;
  profitFactor: number;
  avgTradeDuration: number; // In days

  // Benchmark comparison
  alpha: number;
  beta: number;
  correlation: number;
  informationRatio: number;
}

export interface BacktestResult {
  config: BacktestConfig;
  trades: Trade[];
  dailySnapshots: DailySnapshot[];
  metrics: PerformanceMetrics;
  finalPortfolio: {
    cash: number;
    positions: Position[];
    totalValue: number;
  };
  errors: string[];
}

// Strategy function type
export type StrategyFunction = (
  state: TradingState,
  currentBar: Map<string, HistoricalBar>,
  portfolio: { cash: number; positions: Position[] }
) => Promise<{
  action: "buy" | "sell" | "short" | "cover" | "hold";
  symbol: string;
  quantity?: number;
  reason?: string;
}[]>;

// ============================================
// Backtester Class
// ============================================

export class Backtester extends EventEmitter {
  private config: BacktestConfig;
  private historicalData: Map<string, HistoricalBar[]> = new Map();
  private benchmarkData: HistoricalBar[] = [];
  private trades: Trade[] = [];
  private dailySnapshots: DailySnapshot[] = [];
  private currentCash: number;
  private currentPositions: Map<string, Position> = new Map();
  private errors: string[] = [];

  constructor(config: BacktestConfig) {
    super();
    this.config = config;
    this.currentCash = config.initialCapital;
  }

  // ============================================
  // Data Loading
  // ============================================

  /**
   * Load historical data for backtesting
   */
  loadData(symbol: string, bars: HistoricalBar[]): void {
    // Filter to backtest period and sort by date
    const filtered = bars
      .filter((b) => b.timestamp >= this.config.startDate && b.timestamp <= this.config.endDate)
      .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

    this.historicalData.set(symbol.toUpperCase(), filtered);
    this.emit("dataLoaded", { symbol, bars: filtered.length });
  }

  /**
   * Load benchmark data
   */
  loadBenchmark(bars: HistoricalBar[]): void {
    this.benchmarkData = bars
      .filter((b) => b.timestamp >= this.config.startDate && b.timestamp <= this.config.endDate)
      .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  }

  // ============================================
  // Main Backtest Execution
  // ============================================

  /**
   * Run backtest with a strategy function
   */
  async run(strategy: StrategyFunction): Promise<BacktestResult> {
    this.reset();

    // Validate data
    if (this.historicalData.size === 0) {
      throw new Error("No historical data loaded. Call loadData() first.");
    }

    // Get all unique dates across symbols
    const allDates = this.getAllTradingDates();
    if (allDates.length === 0) {
      throw new Error("No trading days in the specified date range.");
    }

    this.emit("backtestStart", {
      startDate: this.config.startDate,
      endDate: this.config.endDate,
      tradingDays: allDates.length,
    });

    let previousValue = this.config.initialCapital;
    let peakValue = this.config.initialCapital;
    let maxDrawdown = 0;

    // Iterate through each trading day
    for (let i = 0; i < allDates.length; i++) {
      const date = allDates[i];

      // Get current bars for all symbols
      const currentBars = this.getBarsForDate(date);

      // Update position prices
      this.updatePositionPrices(currentBars);

      // Create trading state for strategy
      const state = this.createStateForDate(date, currentBars);

      // Get portfolio info
      const portfolio = {
        cash: this.currentCash,
        positions: Array.from(this.currentPositions.values()),
      };

      // Execute strategy
      try {
        const signals = await strategy(state, currentBars, portfolio);

        // Process signals
        for (const signal of signals) {
          if (signal.action !== "hold") {
            await this.executeSignal(signal, currentBars, date);
          }
        }
      } catch (error) {
        this.errors.push(`Strategy error on ${date.toISOString()}: ${(error as Error).message}`);
      }

      // Calculate daily snapshot
      const totalValue = this.calculateTotalValue(currentBars);
      const dailyReturn = previousValue > 0 ? (totalValue - previousValue) / previousValue : 0;
      const cumulativeReturn = (totalValue - this.config.initialCapital) / this.config.initialCapital;

      // Update peak and drawdown
      if (totalValue > peakValue) {
        peakValue = totalValue;
      }
      const currentDrawdown = peakValue > 0 ? (peakValue - totalValue) / peakValue : 0;
      if (currentDrawdown > maxDrawdown) {
        maxDrawdown = currentDrawdown;
      }

      // Record snapshot
      this.dailySnapshots.push({
        date,
        cash: this.currentCash,
        positions: Array.from(this.currentPositions.values()).map((p) => ({ ...p })),
        totalValue,
        dailyReturn,
        cumulativeReturn,
        drawdown: currentDrawdown,
      });

      previousValue = totalValue;

      // Emit progress
      if (i % 20 === 0) {
        this.emit("progress", {
          current: i + 1,
          total: allDates.length,
          percent: ((i + 1) / allDates.length) * 100,
        });
      }
    }

    // Calculate final metrics
    const metrics = this.calculateMetrics();

    const result: BacktestResult = {
      config: this.config,
      trades: this.trades,
      dailySnapshots: this.dailySnapshots,
      metrics,
      finalPortfolio: {
        cash: this.currentCash,
        positions: Array.from(this.currentPositions.values()),
        totalValue: this.calculateTotalValue(this.getBarsForDate(allDates[allDates.length - 1])),
      },
      errors: this.errors,
    };

    this.emit("backtestComplete", result);
    return result;
  }

  // ============================================
  // Signal Execution
  // ============================================

  private async executeSignal(
    signal: { action: "buy" | "sell" | "short" | "cover"; symbol: string; quantity?: number; reason?: string },
    currentBars: Map<string, HistoricalBar>,
    date: Date
  ): Promise<void> {
    const bar = currentBars.get(signal.symbol.toUpperCase());
    if (!bar) {
      this.errors.push(`No data for ${signal.symbol} on ${date.toISOString()}`);
      return;
    }

    const price = bar.close;
    const slippageAmount = price * this.config.slippage;
    const executionPrice = signal.action === "buy" || signal.action === "cover"
      ? price + slippageAmount // Worse price for buying
      : price - slippageAmount; // Worse price for selling

    // Calculate quantity
    let quantity = signal.quantity || this.calculatePositionSize(executionPrice);

    // Validate and execute
    switch (signal.action) {
      case "buy":
        await this.executeBuy(signal.symbol, quantity, executionPrice, date, signal.reason);
        break;
      case "sell":
        await this.executeSell(signal.symbol, quantity, executionPrice, date, signal.reason);
        break;
      case "short":
        if (this.config.allowShorts) {
          await this.executeShort(signal.symbol, quantity, executionPrice, date, signal.reason);
        }
        break;
      case "cover":
        if (this.config.allowShorts) {
          await this.executeCover(signal.symbol, quantity, executionPrice, date, signal.reason);
        }
        break;
    }
  }

  private async executeBuy(
    symbol: string,
    quantity: number,
    price: number,
    date: Date,
    reason?: string
  ): Promise<void> {
    // First check if we can afford anything
    const estimatedCostPerShare = price * (1 + this.config.commission + this.config.slippage);
    const maxAffordableQuantity = Math.floor(this.currentCash / estimatedCostPerShare);

    if (maxAffordableQuantity <= 0) {
      this.errors.push(`Insufficient cash for ${symbol} buy on ${date.toISOString()}`);
      return;
    }

    // Limit quantity to what we can afford
    quantity = Math.min(quantity, maxAffordableQuantity);

    // Check max positions
    if (this.currentPositions.size >= this.config.maxPositions && !this.currentPositions.has(symbol)) {
      this.errors.push(`Max positions reached, cannot buy ${symbol}`);
      return;
    }

    // Calculate actual costs with final quantity
    const commission = price * quantity * this.config.commission;
    const slippageCost = price * quantity * this.config.slippage;
    const actualCost = price * quantity + commission;

    // Final safety check
    if (actualCost > this.currentCash) {
      this.errors.push(`Cost exceeds available cash for ${symbol} buy`);
      return;
    }

    this.currentCash -= actualCost;

    // Update or create position
    const existing = this.currentPositions.get(symbol);
    if (existing) {
      const totalQuantity = existing.quantity + quantity;
      const newAvgCost = (existing.avgCost * existing.quantity + price * quantity) / totalQuantity;
      existing.quantity = totalQuantity;
      existing.avgCost = newAvgCost;
    } else {
      this.currentPositions.set(symbol, {
        symbol,
        quantity,
        avgCost: price,
        currentPrice: price,
        marketValue: price * quantity,
        unrealizedPnl: 0,
        unrealizedPnlPercent: 0,
        entryDate: date,
      });
    }

    // Record trade
    this.trades.push({
      id: crypto.randomUUID(),
      symbol,
      action: "buy",
      quantity,
      price,
      timestamp: date,
      commission,
      slippage: slippageCost,
      value: actualCost,
      reason,
    });

    this.emit("trade", { action: "buy", symbol, quantity, price, date });
  }

  private async executeSell(
    symbol: string,
    quantity: number,
    price: number,
    date: Date,
    reason?: string
  ): Promise<void> {
    const position = this.currentPositions.get(symbol);
    if (!position) {
      this.errors.push(`No position to sell for ${symbol}`);
      return;
    }

    // Adjust quantity to available
    quantity = Math.min(quantity, position.quantity);

    const commission = price * quantity * this.config.commission;
    const proceeds = price * quantity - commission;

    this.currentCash += proceeds;

    // Update or remove position
    if (quantity >= position.quantity) {
      this.currentPositions.delete(symbol);
    } else {
      position.quantity -= quantity;
    }

    // Record trade
    this.trades.push({
      id: crypto.randomUUID(),
      symbol,
      action: "sell",
      quantity,
      price,
      timestamp: date,
      commission,
      slippage: price * this.config.slippage * quantity,
      value: proceeds,
      reason,
    });

    this.emit("trade", { action: "sell", symbol, quantity, price, date });
  }

  private async executeShort(
    symbol: string,
    quantity: number,
    price: number,
    date: Date,
    reason?: string
  ): Promise<void> {
    // For simplicity, treat shorts as negative positions
    const commission = price * quantity * this.config.commission;
    const proceeds = price * quantity - commission;

    this.currentCash += proceeds;

    const existing = this.currentPositions.get(symbol);
    if (existing && existing.quantity < 0) {
      // Add to short position
      const totalQuantity = existing.quantity - quantity;
      existing.quantity = totalQuantity;
      existing.avgCost = price;
    } else {
      this.currentPositions.set(symbol, {
        symbol,
        quantity: -quantity,
        avgCost: price,
        currentPrice: price,
        marketValue: -price * quantity,
        unrealizedPnl: 0,
        unrealizedPnlPercent: 0,
        entryDate: date,
      });
    }

    this.trades.push({
      id: crypto.randomUUID(),
      symbol,
      action: "short",
      quantity,
      price,
      timestamp: date,
      commission,
      slippage: price * this.config.slippage * quantity,
      value: proceeds,
      reason,
    });

    this.emit("trade", { action: "short", symbol, quantity, price, date });
  }

  private async executeCover(
    symbol: string,
    quantity: number,
    price: number,
    date: Date,
    reason?: string
  ): Promise<void> {
    const position = this.currentPositions.get(symbol);
    if (!position || position.quantity >= 0) {
      this.errors.push(`No short position to cover for ${symbol}`);
      return;
    }

    quantity = Math.min(quantity, Math.abs(position.quantity));
    const commission = price * quantity * this.config.commission;
    const cost = price * quantity + commission;

    this.currentCash -= cost;

    if (quantity >= Math.abs(position.quantity)) {
      this.currentPositions.delete(symbol);
    } else {
      position.quantity += quantity;
    }

    this.trades.push({
      id: crypto.randomUUID(),
      symbol,
      action: "cover",
      quantity,
      price,
      timestamp: date,
      commission,
      slippage: price * this.config.slippage * quantity,
      value: cost,
      reason,
    });

    this.emit("trade", { action: "cover", symbol, quantity, price, date });
  }

  // ============================================
  // Position & Portfolio Helpers
  // ============================================

  private calculatePositionSize(price: number): number {
    switch (this.config.positionSizing) {
      case "fixed":
        return Math.floor(this.config.positionSize);
      case "percent":
        const portfolioValue = this.calculateTotalValue(new Map());
        const targetValue = portfolioValue * this.config.positionSize;
        return Math.floor(targetValue / price);
      case "volatility":
        // Simplified: use fixed for now
        return Math.floor(this.config.positionSize);
      default:
        return 100;
    }
  }

  private updatePositionPrices(currentBars: Map<string, HistoricalBar>): void {
    for (const [symbol, position] of this.currentPositions) {
      const bar = currentBars.get(symbol);
      if (bar) {
        position.currentPrice = bar.close;
        position.marketValue = bar.close * position.quantity;
        position.unrealizedPnl = (bar.close - position.avgCost) * position.quantity;
        position.unrealizedPnlPercent =
          position.avgCost > 0 ? (bar.close - position.avgCost) / position.avgCost : 0;
      }
    }
  }

  private calculateTotalValue(currentBars: Map<string, HistoricalBar>): number {
    let positionValue = 0;
    for (const [symbol, position] of this.currentPositions) {
      const bar = currentBars.get(symbol);
      const price = bar?.close || position.currentPrice;
      positionValue += price * position.quantity;
    }
    return this.currentCash + positionValue;
  }

  // ============================================
  // Data Helpers
  // ============================================

  private getAllTradingDates(): Date[] {
    const datesSet = new Set<number>();

    for (const bars of this.historicalData.values()) {
      for (const bar of bars) {
        datesSet.add(bar.timestamp.getTime());
      }
    }

    return Array.from(datesSet)
      .sort((a, b) => a - b)
      .map((t) => new Date(t));
  }

  private getBarsForDate(date: Date): Map<string, HistoricalBar> {
    const bars = new Map<string, HistoricalBar>();
    const dateTime = date.getTime();

    for (const [symbol, data] of this.historicalData) {
      const bar = data.find((b) => b.timestamp.getTime() === dateTime);
      if (bar) {
        bars.set(symbol, bar);
      }
    }

    return bars;
  }

  private createStateForDate(date: Date, currentBars: Map<string, HistoricalBar>): TradingState {
    const marketData = Array.from(currentBars.entries()).map(([symbol, bar]) => ({
      symbol,
      price: bar.close,
      change: bar.close - bar.open,
      changePercent: ((bar.close - bar.open) / bar.open) * 100,
      volume: bar.volume,
      high: bar.high,
      low: bar.low,
      open: bar.open,
      previousClose: bar.open, // Approximation
    }));

    return {
      ...createInitialState({ type: "trade", symbols: this.config.symbols }),
      marketData,
      portfolio: {
        cash: this.currentCash,
        totalValue: this.calculateTotalValue(currentBars),
        positions: Array.from(this.currentPositions.values()),
      },
    };
  }

  // ============================================
  // Metrics Calculation
  // ============================================

  private calculateMetrics(): PerformanceMetrics {
    const returns = this.dailySnapshots.map((s) => s.dailyReturn);
    const cumulativeReturns = this.dailySnapshots.map((s) => s.cumulativeReturn);

    // Total return
    const totalReturn =
      this.dailySnapshots.length > 0
        ? this.dailySnapshots[this.dailySnapshots.length - 1].cumulativeReturn
        : 0;

    // Annualized return (assuming 252 trading days)
    const tradingDays = this.dailySnapshots.length;
    const annualizedReturn = tradingDays > 0
      ? Math.pow(1 + totalReturn, 252 / tradingDays) - 1
      : 0;

    // Volatility
    const avgReturn = returns.reduce((a, b) => a + b, 0) / returns.length || 0;
    const squaredDiffs = returns.map((r) => Math.pow(r - avgReturn, 2));
    const volatility = Math.sqrt(squaredDiffs.reduce((a, b) => a + b, 0) / returns.length) || 0;
    const annualizedVolatility = volatility * Math.sqrt(252);

    // Max drawdown
    const maxDrawdown = Math.max(...this.dailySnapshots.map((s) => s.drawdown), 0);

    // Max drawdown duration
    let maxDrawdownDuration = 0;
    let currentDrawdownDuration = 0;
    for (const snapshot of this.dailySnapshots) {
      if (snapshot.drawdown > 0) {
        currentDrawdownDuration++;
        maxDrawdownDuration = Math.max(maxDrawdownDuration, currentDrawdownDuration);
      } else {
        currentDrawdownDuration = 0;
      }
    }

    // Sharpe ratio (assuming 0% risk-free rate)
    const sharpeRatio = annualizedVolatility > 0 ? annualizedReturn / annualizedVolatility : 0;

    // Sortino ratio (downside deviation)
    const negativeReturns = returns.filter((r) => r < 0);
    const downsideDeviation =
      negativeReturns.length > 0
        ? Math.sqrt(negativeReturns.map((r) => r * r).reduce((a, b) => a + b, 0) / negativeReturns.length) *
          Math.sqrt(252)
        : 0;
    const sortinoRatio = downsideDeviation > 0 ? annualizedReturn / downsideDeviation : 0;

    // Calmar ratio
    const calmarRatio = maxDrawdown > 0 ? annualizedReturn / maxDrawdown : 0;

    // Trade statistics
    const closedTrades = this.getClosedTrades();
    const winningTrades = closedTrades.filter((t) => t.pnl > 0);
    const losingTrades = closedTrades.filter((t) => t.pnl <= 0);

    const totalWins = winningTrades.reduce((sum, t) => sum + t.pnl, 0);
    const totalLosses = Math.abs(losingTrades.reduce((sum, t) => sum + t.pnl, 0));

    // Calculate average trade duration
    const tradeDurations = closedTrades.map((t) => t.duration);
    const avgTradeDuration =
      tradeDurations.length > 0
        ? tradeDurations.reduce((a, b) => a + b, 0) / tradeDurations.length
        : 0;

    // Benchmark comparison (simplified)
    const alpha = totalReturn; // Would subtract benchmark return
    const beta = 1; // Would calculate with benchmark
    const correlation = 0; // Would calculate with benchmark
    const informationRatio = 0; // Would calculate with benchmark

    return {
      totalReturn,
      annualizedReturn,
      cumulativeReturns,
      volatility,
      annualizedVolatility,
      maxDrawdown,
      maxDrawdownDuration,
      sharpeRatio,
      sortinoRatio,
      calmarRatio,
      totalTrades: this.trades.length,
      winningTrades: winningTrades.length,
      losingTrades: losingTrades.length,
      winRate: closedTrades.length > 0 ? winningTrades.length / closedTrades.length : 0,
      avgWin: winningTrades.length > 0 ? totalWins / winningTrades.length : 0,
      avgLoss: losingTrades.length > 0 ? totalLosses / losingTrades.length : 0,
      profitFactor: totalLosses > 0 ? totalWins / totalLosses : totalWins > 0 ? Infinity : 0,
      avgTradeDuration,
      alpha,
      beta,
      correlation,
      informationRatio,
    };
  }

  private getClosedTrades(): Array<{ pnl: number; duration: number }> {
    const closed: Array<{ pnl: number; duration: number }> = [];

    // Match buys with sells
    const tradesBySymbol = new Map<string, Trade[]>();
    for (const trade of this.trades) {
      if (!tradesBySymbol.has(trade.symbol)) {
        tradesBySymbol.set(trade.symbol, []);
      }
      tradesBySymbol.get(trade.symbol)!.push(trade);
    }

    for (const trades of tradesBySymbol.values()) {
      const buys: Trade[] = [];
      for (const trade of trades) {
        if (trade.action === "buy" || trade.action === "short") {
          buys.push(trade);
        } else if (buys.length > 0) {
          const entry = buys.shift()!;
          const pnl =
            trade.action === "sell"
              ? (trade.price - entry.price) * Math.min(trade.quantity, entry.quantity) -
                trade.commission -
                entry.commission
              : (entry.price - trade.price) * Math.min(trade.quantity, entry.quantity) -
                trade.commission -
                entry.commission;
          const duration =
            (trade.timestamp.getTime() - entry.timestamp.getTime()) / (1000 * 60 * 60 * 24);
          closed.push({ pnl, duration });
        }
      }
    }

    return closed;
  }

  // ============================================
  // Utilities
  // ============================================

  private reset(): void {
    this.trades = [];
    this.dailySnapshots = [];
    this.currentCash = this.config.initialCapital;
    this.currentPositions.clear();
    this.errors = [];
  }

  /**
   * Get summary statistics as a formatted string
   */
  static formatResults(result: BacktestResult): string {
    const m = result.metrics;
    const lines: string[] = [];

    lines.push("=".repeat(50));
    lines.push("BACKTEST RESULTS");
    lines.push("=".repeat(50));

    lines.push("\n--- Performance ---");
    lines.push(`Total Return: ${(m.totalReturn * 100).toFixed(2)}%`);
    lines.push(`Annualized Return: ${(m.annualizedReturn * 100).toFixed(2)}%`);
    lines.push(`Volatility (Ann.): ${(m.annualizedVolatility * 100).toFixed(2)}%`);
    lines.push(`Max Drawdown: ${(m.maxDrawdown * 100).toFixed(2)}%`);
    lines.push(`Max DD Duration: ${m.maxDrawdownDuration} days`);

    lines.push("\n--- Risk-Adjusted ---");
    lines.push(`Sharpe Ratio: ${m.sharpeRatio.toFixed(2)}`);
    lines.push(`Sortino Ratio: ${m.sortinoRatio.toFixed(2)}`);
    lines.push(`Calmar Ratio: ${m.calmarRatio.toFixed(2)}`);

    lines.push("\n--- Trade Statistics ---");
    lines.push(`Total Trades: ${m.totalTrades}`);
    lines.push(`Win Rate: ${(m.winRate * 100).toFixed(1)}%`);
    lines.push(`Profit Factor: ${m.profitFactor.toFixed(2)}`);
    lines.push(`Avg Win: $${m.avgWin.toFixed(2)}`);
    lines.push(`Avg Loss: $${m.avgLoss.toFixed(2)}`);
    lines.push(`Avg Trade Duration: ${m.avgTradeDuration.toFixed(1)} days`);

    lines.push("\n--- Final Portfolio ---");
    lines.push(`Cash: $${result.finalPortfolio.cash.toFixed(2)}`);
    lines.push(`Total Value: $${result.finalPortfolio.totalValue.toFixed(2)}`);
    lines.push(`Open Positions: ${result.finalPortfolio.positions.length}`);

    if (result.errors.length > 0) {
      lines.push("\n--- Errors ---");
      lines.push(`${result.errors.length} errors occurred during backtest`);
    }

    lines.push("=".repeat(50));

    return lines.join("\n");
  }
}

// ============================================
// Pre-built Strategies
// ============================================

/**
 * Simple moving average crossover strategy
 */
export function createSMAStrategy(
  shortPeriod: number = 20,
  longPeriod: number = 50
): StrategyFunction {
  const priceHistory = new Map<string, number[]>();

  return async (state, currentBars, portfolio) => {
    const signals: ReturnType<StrategyFunction> extends Promise<infer T> ? T : never = [];

    for (const [symbol, bar] of currentBars) {
      // Update price history
      if (!priceHistory.has(symbol)) {
        priceHistory.set(symbol, []);
      }
      const history = priceHistory.get(symbol)!;
      history.push(bar.close);

      // Keep only what we need
      if (history.length > longPeriod + 1) {
        history.shift();
      }

      // Need enough data
      if (history.length < longPeriod) continue;

      // Calculate SMAs
      const shortSMA = history.slice(-shortPeriod).reduce((a, b) => a + b, 0) / shortPeriod;
      const longSMA = history.slice(-longPeriod).reduce((a, b) => a + b, 0) / longPeriod;
      const prevShortSMA =
        history.slice(-shortPeriod - 1, -1).reduce((a, b) => a + b, 0) / shortPeriod;
      const prevLongSMA =
        history.slice(-longPeriod - 1, -1).reduce((a, b) => a + b, 0) / longPeriod;

      // Check for crossover
      const hasPosition = portfolio.positions.some((p) => p.symbol === symbol && p.quantity > 0);

      if (shortSMA > longSMA && prevShortSMA <= prevLongSMA && !hasPosition) {
        // Golden cross - buy signal
        signals.push({
          action: "buy",
          symbol,
          reason: `SMA${shortPeriod} crossed above SMA${longPeriod}`,
        });
      } else if (shortSMA < longSMA && prevShortSMA >= prevLongSMA && hasPosition) {
        // Death cross - sell signal
        const position = portfolio.positions.find((p) => p.symbol === symbol);
        signals.push({
          action: "sell",
          symbol,
          quantity: position?.quantity,
          reason: `SMA${shortPeriod} crossed below SMA${longPeriod}`,
        });
      }
    }

    return signals;
  };
}

/**
 * RSI mean reversion strategy
 */
export function createRSIStrategy(
  period: number = 14,
  oversold: number = 30,
  overbought: number = 70
): StrategyFunction {
  const priceHistory = new Map<string, number[]>();

  return async (state, currentBars, portfolio) => {
    const signals: ReturnType<StrategyFunction> extends Promise<infer T> ? T : never = [];

    for (const [symbol, bar] of currentBars) {
      // Update price history
      if (!priceHistory.has(symbol)) {
        priceHistory.set(symbol, []);
      }
      const history = priceHistory.get(symbol)!;
      history.push(bar.close);

      if (history.length > period + 2) {
        history.shift();
      }

      if (history.length < period + 1) continue;

      // Calculate RSI
      const changes: number[] = [];
      for (let i = 1; i < history.length; i++) {
        changes.push(history[i] - history[i - 1]);
      }

      const gains = changes.map((c) => (c > 0 ? c : 0));
      const losses = changes.map((c) => (c < 0 ? -c : 0));

      const avgGain = gains.slice(-period).reduce((a, b) => a + b, 0) / period;
      const avgLoss = losses.slice(-period).reduce((a, b) => a + b, 0) / period;

      const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
      const rsi = 100 - 100 / (1 + rs);

      const hasPosition = portfolio.positions.some((p) => p.symbol === symbol && p.quantity > 0);

      if (rsi < oversold && !hasPosition) {
        signals.push({
          action: "buy",
          symbol,
          reason: `RSI oversold at ${rsi.toFixed(1)}`,
        });
      } else if (rsi > overbought && hasPosition) {
        const position = portfolio.positions.find((p) => p.symbol === symbol);
        signals.push({
          action: "sell",
          symbol,
          quantity: position?.quantity,
          reason: `RSI overbought at ${rsi.toFixed(1)}`,
        });
      }
    }

    return signals;
  };
}

// Export singleton-like factory
export function createBacktester(config: BacktestConfig): Backtester {
  return new Backtester(config);
}
