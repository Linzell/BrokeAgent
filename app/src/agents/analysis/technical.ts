import { BaseAgent, type AgentConfig, type AgentResult } from "../base";
import type { TradingState } from "../../core/state";
import {
  technicalAnalysisTool,
  type TechnicalAnalysis,
} from "../../tools/technical";

// ============================================
// Technical Analyst Agent
// ============================================

const DEFAULT_CONFIG: AgentConfig = {
  id: "technical-analyst-default",
  type: "technical_analyst",
  name: "Technical Analyst",
  description:
    "Analyzes price charts and technical indicators to identify trends and trading signals",
  systemPrompt: `You are a Technical Analyst specializing in chart analysis.
Your job is to:
1. Calculate and interpret technical indicators (RSI, MACD, Moving Averages, Bollinger Bands)
2. Identify trend direction and strength
3. Find support and resistance levels
4. Generate actionable trading signals`,
};

export class TechnicalAnalyst extends BaseAgent {
  constructor(config: Partial<AgentConfig> = {}) {
    super({ ...DEFAULT_CONFIG, ...config });
  }

  async execute(state: TradingState): Promise<AgentResult> {
    this.log("Starting technical analysis");

    const symbols = state.request.symbols || [];

    if (symbols.length === 0) {
      this.log("No symbols provided");
      return this.command("orchestrator", {
        errors: this.addError(state, "No symbols provided for technical analysis"),
      });
    }

    try {
      // Analyze first symbol (primary focus)
      // In the future, could analyze multiple symbols
      const primarySymbol = symbols[0];
      const analysis = await technicalAnalysisTool.analyze(primarySymbol);

      this.log(
        `Analysis complete for ${primarySymbol}: ${analysis.trend} (${analysis.trendStrength}%)`
      );

      // Transform to state format
      const technical = this.transformToState(analysis);

      // Generate summary message
      const summary = this.generateSummary(analysis);

      // Store significant findings in memory
      await this.storeSignificantFindings(analysis);

      return this.command("orchestrator", {
        technical,
        messages: this.addMessage(state, "assistant", summary),
      });
    } catch (error) {
      this.logError("Technical analysis failed", error);
      return this.command("orchestrator", {
        errors: this.addError(
          state,
          `Technical analysis failed: ${(error as Error).message}`
        ),
      });
    }
  }

  private transformToState(analysis: TechnicalAnalysis): TradingState["technical"] {
    return {
      symbol: analysis.symbol,
      trend: analysis.trend,
      trendStrength: analysis.trendStrength,
      signals: analysis.signals.map((s) => ({
        indicator: s.indicator,
        signal: s.signal,
        value: s.value,
        description: s.description,
      })),
      supportLevels: analysis.supportLevels,
      resistanceLevels: analysis.resistanceLevels,
      recommendation: analysis.recommendation,
    };
  }

  private generateSummary(analysis: TechnicalAnalysis): string {
    const lines = ["## Technical Analysis\n"];

    // Header
    const trendEmoji =
      analysis.trend === "bullish"
        ? "📈"
        : analysis.trend === "bearish"
          ? "📉"
          : "➡️";
    lines.push(
      `${trendEmoji} **${analysis.symbol}**: ${analysis.trend.toUpperCase()} (${analysis.trendStrength}% strength)\n`
    );

    // Current price and indicators
    const ind = analysis.indicators;
    lines.push("### Key Indicators");
    lines.push(`- **Price**: $${ind.price.toFixed(2)}`);

    if (ind.rsi14) {
      const rsiStatus =
        ind.rsi14 > 70 ? "overbought" : ind.rsi14 < 30 ? "oversold" : "neutral";
      lines.push(`- **RSI(14)**: ${ind.rsi14.toFixed(1)} (${rsiStatus})`);
    }

    if (ind.macd) {
      const macdStatus = ind.macd.histogram > 0 ? "bullish" : "bearish";
      lines.push(`- **MACD**: ${macdStatus} (histogram: ${ind.macd.histogram.toFixed(3)})`);
    }

    if (ind.sma20 && ind.sma50) {
      const maStatus = ind.sma20 > ind.sma50 ? "bullish" : "bearish";
      lines.push(`- **MA Cross**: SMA20 ${maStatus === "bullish" ? ">" : "<"} SMA50 (${maStatus})`);
    }

    // Support/Resistance
    if (analysis.supportLevels.length > 0 || analysis.resistanceLevels.length > 0) {
      lines.push("\n### Price Levels");
      if (analysis.supportLevels.length > 0) {
        lines.push(
          `- **Support**: ${analysis.supportLevels.map((s) => `$${s.toFixed(2)}`).join(", ")}`
        );
      }
      if (analysis.resistanceLevels.length > 0) {
        lines.push(
          `- **Resistance**: ${analysis.resistanceLevels.map((r) => `$${r.toFixed(2)}`).join(", ")}`
        );
      }
    }

    // Signals summary
    const buySignals = analysis.signals.filter((s) => s.signal === "buy");
    const sellSignals = analysis.signals.filter((s) => s.signal === "sell");

    lines.push("\n### Signal Summary");
    lines.push(`- Buy signals: ${buySignals.length}`);
    lines.push(`- Sell signals: ${sellSignals.length}`);

    // Recommendation
    lines.push("\n### Recommendation");
    lines.push(analysis.recommendation);

    return lines.join("\n");
  }

  private async storeSignificantFindings(analysis: TechnicalAnalysis): Promise<void> {
    // Store strong trend signals
    if (analysis.trendStrength > 70 || analysis.trendStrength < 30) {
      const direction =
        analysis.trend === "bullish" ? "strongly bullish" : "strongly bearish";
      await this.storeMemory(
        `${analysis.symbol} showing ${direction} technical setup on ${new Date().toISOString().split("T")[0]}. ` +
          `Trend strength: ${analysis.trendStrength}%. ${analysis.recommendation}`,
        "episodic",
        0.7,
        {
          symbol: analysis.symbol,
          trend: analysis.trend,
          trendStrength: analysis.trendStrength,
        }
      );
    }

    // Store extreme RSI readings
    const rsi = analysis.indicators.rsi14;
    if (rsi && (rsi < 25 || rsi > 75)) {
      const condition = rsi < 25 ? "extremely oversold" : "extremely overbought";
      await this.storeMemory(
        `${analysis.symbol} RSI at ${rsi.toFixed(1)} - ${condition}. Potential reversal setup.`,
        "episodic",
        0.6,
        { symbol: analysis.symbol, rsi }
      );
    }
  }
}
