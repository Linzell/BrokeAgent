import { BaseAgent, type AgentConfig, type AgentResult } from "../base";
import type { TradingState } from "../../core/state";
import { marketDataTool, type MarketDataResult } from "../../tools/market-data";

// ============================================
// Market Data Agent
// ============================================

const DEFAULT_CONFIG: AgentConfig = {
  id: "market-data-agent-default",
  type: "market_data_agent",
  name: "Market Data Agent",
  description: "Fetches real-time and historical market data for analysis",
  systemPrompt: `You are a Market Data Agent responsible for fetching and organizing market data.
Your job is to:
1. Fetch real-time quotes for requested symbols
2. Identify price trends and significant changes
3. Provide context on volume and market conditions`,
};

export class MarketDataAgent extends BaseAgent {
  constructor(config: Partial<AgentConfig> = {}) {
    super({ ...DEFAULT_CONFIG, ...config });
  }

  async execute(state: TradingState): Promise<AgentResult> {
    this.log("Starting market data fetch");

    const symbols = state.request.symbols || [];

    if (symbols.length === 0) {
      this.log("No symbols provided, returning");
      return this.command("orchestrator", {
        errors: this.addError(state, "No symbols provided for market data fetch"),
      });
    }

    try {
      // Fetch quotes
      const quotes = await marketDataTool.getQuotes(symbols);
      this.log(`Fetched ${quotes.length} quotes`);

      // Transform to state format
      const marketData = quotes.map((q) => ({
        symbol: q.symbol,
        price: q.price,
        change: q.change,
        changePercent: q.changePercent,
        volume: q.volume,
        high: q.high,
        low: q.low,
        open: q.open,
        previousClose: q.previousClose,
        marketCap: q.marketCap,
      }));

      // Generate summary message
      const summary = this.generateSummary(quotes);

      // Store important observations in memory
      await this.storeSignificantMovers(quotes);

      return this.command("orchestrator", {
        marketData,
        messages: this.addMessage(state, "assistant", summary),
      });
    } catch (error) {
      this.logError("Failed to fetch market data", error);
      return this.command("orchestrator", {
        errors: this.addError(state, `Market data fetch failed: ${(error as Error).message}`),
      });
    }
  }

  private generateSummary(quotes: MarketDataResult[]): string {
    if (quotes.length === 0) {
      return "No market data available for requested symbols.";
    }

    const lines = ["## Market Data Summary\n"];

    for (const q of quotes) {
      const direction = q.change >= 0 ? "+" : "";
      const emoji = q.changePercent > 2 ? "📈" : q.changePercent < -2 ? "📉" : "➡️";

      lines.push(
        `${emoji} **${q.symbol}**: $${q.price.toFixed(2)} (${direction}${q.changePercent.toFixed(2)}%)`
      );
    }

    // Add notable observations
    const bigMovers = quotes.filter((q) => Math.abs(q.changePercent) > 3);
    if (bigMovers.length > 0) {
      lines.push("\n### Notable Moves:");
      for (const q of bigMovers) {
        lines.push(`- ${q.symbol}: ${q.changePercent > 0 ? "up" : "down"} ${Math.abs(q.changePercent).toFixed(1)}%`);
      }
    }

    return lines.join("\n");
  }

  private async storeSignificantMovers(quotes: MarketDataResult[]): Promise<void> {
    const significantMovers = quotes.filter((q) => Math.abs(q.changePercent) > 5);

    for (const q of significantMovers) {
      const direction = q.changePercent > 0 ? "surged" : "dropped";
      await this.storeMemory(
        `${q.symbol} ${direction} ${Math.abs(q.changePercent).toFixed(1)}% to $${q.price.toFixed(2)} on ${new Date().toISOString().split("T")[0]}`,
        "episodic",
        0.7,
        { symbol: q.symbol, changePercent: q.changePercent, price: q.price }
      );
    }
  }
}
