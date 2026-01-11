import { BaseAgent, type AgentConfig, type AgentResult } from "../base";
import type { TradingState } from "../../core/state";
import {
  fundamentalsTool,
  type FundamentalAnalysis,
} from "../../tools/fundamentals";

// ============================================
// Fundamental Analyst Agent
// ============================================

const DEFAULT_CONFIG: AgentConfig = {
  id: "fundamental-analyst-default",
  type: "fundamental_analyst",
  name: "Fundamental Analyst",
  description:
    "Analyzes company financials, valuation metrics, and business quality to determine intrinsic value",
  systemPrompt: `You are a Fundamental Analyst specializing in company valuation.
Your job is to:
1. Analyze financial statements and key ratios
2. Assess company quality (profitability, growth, financial health)
3. Determine valuation (undervalued, fair, or overvalued)
4. Provide investment recommendations based on fundamentals`,
};

export class FundamentalAnalyst extends BaseAgent {
  constructor(config: Partial<AgentConfig> = {}) {
    super({ ...DEFAULT_CONFIG, ...config });
  }

  async execute(state: TradingState): Promise<AgentResult> {
    this.log("Starting fundamental analysis");

    const symbols = state.request.symbols || [];

    if (symbols.length === 0) {
      this.log("No symbols provided");
      return this.command("orchestrator", {
        errors: this.addError(state, "No symbols provided for fundamental analysis"),
      });
    }

    try {
      // Analyze first symbol (primary focus)
      const primarySymbol = symbols[0];
      const analysis = await fundamentalsTool.analyze(primarySymbol);

      this.log(
        `Analysis complete for ${primarySymbol}: ${analysis.overallRating} ` +
          `(valuation: ${analysis.valuation.rating}, quality: ${analysis.quality.rating})`
      );

      // Transform to state format
      const fundamental = this.transformToState(analysis);

      // Generate summary message
      const summary = this.generateSummary(analysis);

      // Store significant findings in memory
      await this.storeSignificantFindings(analysis);

      return this.command("orchestrator", {
        fundamental,
        messages: this.addMessage(state, "assistant", summary),
      });
    } catch (error) {
      this.logError("Fundamental analysis failed", error);
      return this.command("orchestrator", {
        errors: this.addError(
          state,
          `Fundamental analysis failed: ${(error as Error).message}`
        ),
      });
    }
  }

  private transformToState(analysis: FundamentalAnalysis): TradingState["fundamental"] {
    const metrics = analysis.metrics;

    // Calculate fair value estimate if we have enough data
    let fairValue: number | undefined;
    let upside: number | undefined;

    if (metrics.targetMean !== null && metrics.high52Week !== null) {
      fairValue = metrics.targetMean;
      // Rough upside estimate based on analyst targets
      upside = ((metrics.targetMean - metrics.high52Week) / metrics.high52Week) * 100;
    }

    return {
      symbol: analysis.symbol,
      valuation: {
        peRatio: metrics.peRatio,
        pbRatio: metrics.pbRatio,
        psRatio: metrics.psRatio,
        evToEbitda: metrics.evToEbitda,
        fairValue,
        upside,
      },
      rating: analysis.overallRating,
      reasoning: analysis.summary,
    };
  }

  private generateSummary(analysis: FundamentalAnalysis): string {
    const lines = ["## Fundamental Analysis\n"];

    // Rating header
    const ratingEmoji = {
      strong_buy: "🟢🟢",
      buy: "🟢",
      hold: "🟡",
      sell: "🔴",
      strong_sell: "🔴🔴",
    }[analysis.overallRating];

    lines.push(
      `${ratingEmoji} **${analysis.symbol}**: ${analysis.overallRating.replace("_", " ").toUpperCase()}\n`
    );

    // Company profile
    if (analysis.profile) {
      lines.push("### Company Profile");
      lines.push(`- **Name**: ${analysis.profile.name}`);
      lines.push(`- **Industry**: ${analysis.profile.industry}`);
      lines.push(
        `- **Market Cap**: $${(analysis.profile.marketCap / 1000).toFixed(1)}B`
      );
    }

    // Valuation
    lines.push("\n### Valuation Assessment");
    lines.push(
      `**${analysis.valuation.rating.toUpperCase()}** (Score: ${analysis.valuation.score}/100)`
    );
    for (const reason of analysis.valuation.reasoning.slice(0, 3)) {
      lines.push(`- ${reason}`);
    }

    // Quality
    lines.push("\n### Quality Assessment");
    lines.push(
      `**${analysis.quality.rating.toUpperCase()}** (Score: ${analysis.quality.score}/100)`
    );
    for (const reason of analysis.quality.reasoning.slice(0, 3)) {
      lines.push(`- ${reason}`);
    }

    // Key Metrics
    const metrics = analysis.metrics;
    lines.push("\n### Key Metrics");

    if (metrics.peRatio !== null) {
      lines.push(`- **P/E Ratio**: ${metrics.peRatio.toFixed(1)}`);
    }
    if (metrics.pbRatio !== null) {
      lines.push(`- **P/B Ratio**: ${metrics.pbRatio.toFixed(2)}`);
    }
    if (metrics.roe !== null) {
      lines.push(`- **ROE**: ${metrics.roe.toFixed(1)}%`);
    }
    if (metrics.netMargin !== null) {
      lines.push(`- **Net Margin**: ${metrics.netMargin.toFixed(1)}%`);
    }
    if (metrics.debtToEquity !== null) {
      lines.push(`- **Debt/Equity**: ${metrics.debtToEquity.toFixed(2)}`);
    }
    if (metrics.revenueGrowth !== null) {
      lines.push(`- **Revenue Growth**: ${metrics.revenueGrowth.toFixed(1)}%`);
    }
    if (metrics.dividendYield !== null && metrics.dividendYield > 0) {
      lines.push(`- **Dividend Yield**: ${metrics.dividendYield.toFixed(2)}%`);
    }

    // Analyst Recommendations
    if (analysis.recommendations.length > 0) {
      const latest = analysis.recommendations[0];
      const total =
        latest.strongBuy + latest.buy + latest.hold + latest.sell + latest.strongSell;

      if (total > 0) {
        lines.push("\n### Analyst Recommendations");
        lines.push(`- Strong Buy: ${latest.strongBuy}`);
        lines.push(`- Buy: ${latest.buy}`);
        lines.push(`- Hold: ${latest.hold}`);
        lines.push(`- Sell: ${latest.sell}`);
        lines.push(`- Strong Sell: ${latest.strongSell}`);
      }
    }

    // Price Targets
    if (metrics.targetMean !== null) {
      lines.push("\n### Price Targets");
      if (metrics.targetHigh !== null) {
        lines.push(`- High: $${metrics.targetHigh.toFixed(2)}`);
      }
      lines.push(`- Mean: $${metrics.targetMean.toFixed(2)}`);
      if (metrics.targetLow !== null) {
        lines.push(`- Low: $${metrics.targetLow.toFixed(2)}`);
      }
    }

    // Summary
    lines.push("\n### Summary");
    lines.push(analysis.summary);

    return lines.join("\n");
  }

  private async storeSignificantFindings(analysis: FundamentalAnalysis): Promise<void> {
    // Store strong buy/sell ratings
    if (
      analysis.overallRating === "strong_buy" ||
      analysis.overallRating === "strong_sell"
    ) {
      const direction =
        analysis.overallRating === "strong_buy" ? "strong fundamental buy" : "strong fundamental sell";

      await this.storeMemory(
        `${analysis.symbol} rated as ${direction} on ${new Date().toISOString().split("T")[0]}. ` +
          `Valuation: ${analysis.valuation.rating} (${analysis.valuation.score}/100), ` +
          `Quality: ${analysis.quality.rating} (${analysis.quality.score}/100). ` +
          analysis.summary,
        "episodic",
        0.8,
        {
          symbol: analysis.symbol,
          rating: analysis.overallRating,
          valuationScore: analysis.valuation.score,
          qualityScore: analysis.quality.score,
        }
      );
    }

    // Store significant undervaluation
    if (analysis.valuation.rating === "undervalued" && analysis.valuation.score > 70) {
      await this.storeMemory(
        `${analysis.symbol} significantly undervalued (score: ${analysis.valuation.score}/100). ` +
          analysis.valuation.reasoning.join(". "),
        "episodic",
        0.7,
        {
          symbol: analysis.symbol,
          valuationRating: analysis.valuation.rating,
          score: analysis.valuation.score,
        }
      );
    }

    // Store excellent quality companies
    if (analysis.quality.rating === "excellent") {
      const metrics = analysis.metrics;
      await this.storeMemory(
        `${analysis.symbol} shows excellent business quality. ` +
          `ROE: ${metrics.roe?.toFixed(1) || "N/A"}%, ` +
          `Net Margin: ${metrics.netMargin?.toFixed(1) || "N/A"}%, ` +
          `Revenue Growth: ${metrics.revenueGrowth?.toFixed(1) || "N/A"}%`,
        "episodic",
        0.6,
        {
          symbol: analysis.symbol,
          qualityRating: analysis.quality.rating,
        }
      );
    }
  }
}
