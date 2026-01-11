import { BaseAgent, type AgentConfig, type AgentResult } from "../base";
import type { TradingState } from "../../core/state";

// ============================================
// Portfolio Manager Agent
// ============================================

/**
 * PortfolioManager synthesizes all analysis inputs (technical, fundamental, sentiment)
 * to make final buy/sell/hold decisions with confidence scores and reasoning.
 */

const DEFAULT_CONFIG: AgentConfig = {
  id: "portfolio-manager-default",
  type: "portfolio_manager",
  name: "Portfolio Manager",
  description:
    "Makes final trading decisions by synthesizing technical, fundamental, and sentiment analysis",
  systemPrompt: `You are a Portfolio Manager responsible for making trading decisions.
Your job is to:
1. Synthesize inputs from technical, fundamental, and sentiment analysis
2. Apply investment strategy rules
3. Generate actionable buy/sell/hold decisions
4. Provide confidence scores and reasoning for each decision`,
};

// Strategy parameters
const STRATEGY = {
  // Minimum scores to trigger action (0-100)
  minBuyScore: 60,
  minSellScore: 40, // Below this = sell signal
  
  // Confidence thresholds
  minConfidence: 0.4, // Minimum confidence to act
  highConfidence: 0.7,
  
  // Weight distribution for final score
  weights: {
    technical: 0.35,
    fundamental: 0.35,
    sentiment: 0.30,
  },
  
  // Time horizons based on analysis agreement
  timeHorizons: {
    allAgree: "position" as const,      // Long-term (all signals align)
    mostAgree: "swing" as const,        // Medium-term (2 of 3 agree)
    mixedSignals: "day" as const,       // Short-term (conflicting signals)
  },
};

export interface TradingDecision {
  symbol: string;
  action: "buy" | "sell" | "hold" | "short" | "cover";
  quantity?: number;
  targetPrice?: number;
  stopLoss?: number;
  takeProfit?: number;
  confidence: number;
  reasoning: string;
  timeHorizon: "day" | "swing" | "position";
  priority: "high" | "medium" | "low";
  scores: {
    technical: number;
    fundamental: number;
    sentiment: number;
    combined: number;
  };
}

export class PortfolioManager extends BaseAgent {
  constructor(config: Partial<AgentConfig> = {}) {
    super({ ...DEFAULT_CONFIG, ...config });
  }

  async execute(state: TradingState): Promise<AgentResult> {
    this.log("Starting portfolio decision making");

    const symbols = state.request.symbols || [];
    const primarySymbol = symbols[0];

    if (!primarySymbol) {
      this.log("No symbol provided for decision");
      return this.command("orchestrator", {
        errors: this.addError(state, "No symbol provided for portfolio decision"),
      });
    }

    try {
      // Check if we have enough analysis data
      const hasAnalysis = state.technical || state.fundamental || state.sentiment;
      
      if (!hasAnalysis) {
        this.log("Insufficient analysis data for decision");
        return this.command("orchestrator", {
          errors: this.addError(
            state,
            "Insufficient analysis data - need at least one of: technical, fundamental, sentiment"
          ),
        });
      }

      // Generate decision
      const decision = this.generateDecision(state, primarySymbol);

      this.log(
        `Decision for ${primarySymbol}: ${decision.action.toUpperCase()} ` +
          `(confidence: ${(decision.confidence * 100).toFixed(0)}%)`
      );

      // Generate summary message
      const summary = this.generateSummary(decision);

      // Store significant decisions in memory
      await this.storeDecision(decision);

      return this.command("orchestrator", {
        decisions: [decision],
        messages: this.addMessage(state, "assistant", summary),
      });
    } catch (error) {
      this.logError("Portfolio decision failed", error);
      return this.command("orchestrator", {
        errors: this.addError(
          state,
          `Portfolio decision failed: ${(error as Error).message}`
        ),
      });
    }
  }

  private generateDecision(state: TradingState, symbol: string): TradingDecision {
    // Calculate individual scores (0-100 scale)
    const technicalScore = this.calculateTechnicalScore(state.technical);
    const fundamentalScore = this.calculateFundamentalScore(state.fundamental);
    const sentimentScore = this.calculateSentimentScore(state.sentiment);

    // Calculate weighted combined score
    const { weights } = STRATEGY;
    let totalWeight = 0;
    let weightedScore = 0;

    if (technicalScore !== null) {
      weightedScore += technicalScore * weights.technical;
      totalWeight += weights.technical;
    }
    if (fundamentalScore !== null) {
      weightedScore += fundamentalScore * weights.fundamental;
      totalWeight += weights.fundamental;
    }
    if (sentimentScore !== null) {
      weightedScore += sentimentScore * weights.sentiment;
      totalWeight += weights.sentiment;
    }

    const combinedScore = totalWeight > 0 ? weightedScore / totalWeight : 50;

    // Determine action
    const action = this.determineAction(combinedScore);

    // Calculate confidence based on agreement and data availability
    const confidence = this.calculateConfidence(
      technicalScore,
      fundamentalScore,
      sentimentScore,
      action
    );

    // Determine time horizon based on signal agreement
    const timeHorizon = this.determineTimeHorizon(
      technicalScore,
      fundamentalScore,
      sentimentScore
    );

    // Calculate priority
    const priority = this.calculatePriority(combinedScore, confidence);

    // Generate reasoning
    const reasoning = this.generateReasoning(
      state,
      action,
      { technical: technicalScore, fundamental: fundamentalScore, sentiment: sentimentScore },
      combinedScore
    );

    // Calculate price targets if buying
    const priceTargets = this.calculatePriceTargets(state, action);

    return {
      symbol,
      action,
      confidence,
      reasoning,
      timeHorizon,
      priority,
      scores: {
        technical: technicalScore ?? 50,
        fundamental: fundamentalScore ?? 50,
        sentiment: sentimentScore ?? 50,
        combined: combinedScore,
      },
      ...priceTargets,
    };
  }

  private calculateTechnicalScore(technical: TradingState["technical"]): number | null {
    if (!technical) return null;

    // Convert trend + strength to 0-100 score
    let baseScore = 50;

    if (technical.trend === "bullish") {
      baseScore = 50 + (technical.trendStrength / 2);
    } else if (technical.trend === "bearish") {
      baseScore = 50 - (technical.trendStrength / 2);
    }

    // Adjust based on signals
    const buySignals = technical.signals.filter((s) => s.signal === "buy").length;
    const sellSignals = technical.signals.filter((s) => s.signal === "sell").length;
    const signalBonus = (buySignals - sellSignals) * 5;

    return Math.max(0, Math.min(100, baseScore + signalBonus));
  }

  private calculateFundamentalScore(fundamental: TradingState["fundamental"]): number | null {
    if (!fundamental) return null;

    // Convert rating to score
    const ratingScores: Record<string, number> = {
      strong_buy: 90,
      buy: 70,
      hold: 50,
      sell: 30,
      strong_sell: 10,
    };

    let score = ratingScores[fundamental.rating] || 50;

    // Adjust based on valuation metrics
    if (fundamental.valuation.upside !== undefined) {
      if (fundamental.valuation.upside > 20) score += 10;
      else if (fundamental.valuation.upside < -20) score -= 10;
    }

    return Math.max(0, Math.min(100, score));
  }

  private calculateSentimentScore(sentiment: TradingState["sentiment"]): number | null {
    if (!sentiment) return null;

    // Convert -1 to 1 score to 0-100
    const baseScore = (sentiment.overallScore + 1) * 50;

    // Weight by confidence
    const adjustedScore = baseScore * sentiment.confidence + 50 * (1 - sentiment.confidence);

    return Math.max(0, Math.min(100, adjustedScore));
  }

  private determineAction(score: number): TradingDecision["action"] {
    if (score >= STRATEGY.minBuyScore) {
      return "buy";
    } else if (score <= STRATEGY.minSellScore) {
      return "sell";
    }
    return "hold";
  }

  private calculateConfidence(
    technical: number | null,
    fundamental: number | null,
    sentiment: number | null,
    action: string
  ): number {
    const scores = [technical, fundamental, sentiment].filter((s) => s !== null) as number[];

    if (scores.length === 0) return 0.1;

    // Base confidence on data availability
    let confidence = scores.length / 3;

    // Adjust based on agreement
    const avgScore = scores.reduce((a, b) => a + b, 0) / scores.length;
    const variance = scores.reduce((sum, s) => sum + Math.pow(s - avgScore, 2), 0) / scores.length;
    const stdDev = Math.sqrt(variance);

    // High agreement (low std dev) = higher confidence
    const agreementBonus = Math.max(0, 0.3 - (stdDev / 100));
    confidence += agreementBonus;

    // Strong signals = higher confidence
    if (action === "buy" && avgScore > 70) confidence += 0.1;
    if (action === "sell" && avgScore < 30) confidence += 0.1;

    return Math.max(0.1, Math.min(1, confidence));
  }

  private determineTimeHorizon(
    technical: number | null,
    fundamental: number | null,
    sentiment: number | null
  ): TradingDecision["timeHorizon"] {
    const scores = [technical, fundamental, sentiment].filter((s) => s !== null) as number[];

    if (scores.length < 2) return "day";

    // Check if all agree on direction
    const allBullish = scores.every((s) => s > 55);
    const allBearish = scores.every((s) => s < 45);

    if (allBullish || allBearish) {
      return STRATEGY.timeHorizons.allAgree;
    }

    // Check if most agree
    const bullishCount = scores.filter((s) => s > 55).length;
    const bearishCount = scores.filter((s) => s < 45).length;

    if (bullishCount >= 2 || bearishCount >= 2) {
      return STRATEGY.timeHorizons.mostAgree;
    }

    return STRATEGY.timeHorizons.mixedSignals;
  }

  private calculatePriority(score: number, confidence: number): TradingDecision["priority"] {
    // High priority: Strong signal + high confidence
    if ((score > 75 || score < 25) && confidence > STRATEGY.highConfidence) {
      return "high";
    }

    // Medium priority: Moderate signal or confidence
    if ((score > 65 || score < 35) && confidence > STRATEGY.minConfidence) {
      return "medium";
    }

    return "low";
  }

  private generateReasoning(
    state: TradingState,
    action: string,
    scores: { technical: number | null; fundamental: number | null; sentiment: number | null },
    combinedScore: number
  ): string {
    const parts: string[] = [];

    // Overall recommendation
    parts.push(
      `Combined analysis score: ${combinedScore.toFixed(0)}/100 suggests ${action.toUpperCase()}.`
    );

    // Technical reasoning
    if (state.technical) {
      const tech = state.technical;
      parts.push(
        `Technical: ${tech.trend} trend (${tech.trendStrength}% strength), ` +
          `${tech.signals.filter((s) => s.signal === "buy").length} buy signals, ` +
          `${tech.signals.filter((s) => s.signal === "sell").length} sell signals.`
      );
    }

    // Fundamental reasoning
    if (state.fundamental) {
      const fund = state.fundamental;
      parts.push(
        `Fundamental: ${fund.rating.replace("_", " ")} rating. ` +
          (fund.valuation.peRatio ? `P/E: ${fund.valuation.peRatio.toFixed(1)}. ` : "") +
          (fund.valuation.upside ? `Analyst upside: ${fund.valuation.upside.toFixed(1)}%.` : "")
      );
    }

    // Sentiment reasoning
    if (state.sentiment) {
      const sent = state.sentiment;
      parts.push(
        `Sentiment: ${sent.sentiment.replace("_", " ")} ` +
          `(score: ${(sent.overallScore * 100).toFixed(0)}%, confidence: ${(sent.confidence * 100).toFixed(0)}%).`
      );
      if (sent.keyDrivers.length > 0) {
        parts.push(`Key driver: ${sent.keyDrivers[0]}.`);
      }
    }

    return parts.join(" ");
  }

  private calculatePriceTargets(
    state: TradingState,
    action: string
  ): { targetPrice?: number; stopLoss?: number; takeProfit?: number } {
    if (action === "hold") return {};

    const result: { targetPrice?: number; stopLoss?: number; takeProfit?: number } = {};

    // Use market data for current price
    const marketData = state.marketData?.[0];
    if (!marketData) return result;

    const currentPrice = marketData.price;

    // Use technical support/resistance for targets
    if (state.technical) {
      const { supportLevels, resistanceLevels } = state.technical;

      if (action === "buy") {
        // Target: nearest resistance
        if (resistanceLevels.length > 0) {
          result.targetPrice = resistanceLevels[0];
          result.takeProfit = resistanceLevels[0];
        }
        // Stop: nearest support
        if (supportLevels.length > 0) {
          result.stopLoss = supportLevels[0];
        } else {
          // Default 5% stop loss
          result.stopLoss = currentPrice * 0.95;
        }
      } else if (action === "sell") {
        // For sell, reverse the logic
        if (supportLevels.length > 0) {
          result.targetPrice = supportLevels[0];
        }
      }
    }

    // Use analyst targets if available
    if (state.fundamental?.valuation.fairValue) {
      result.targetPrice = state.fundamental.valuation.fairValue;
    }

    return result;
  }

  private generateSummary(decision: TradingDecision): string {
    const lines = ["## Portfolio Decision\n"];

    // Decision header
    const actionEmoji = {
      buy: "🟢",
      sell: "🔴",
      hold: "🟡",
      short: "🔻",
      cover: "🔺",
    }[decision.action];

    lines.push(
      `${actionEmoji} **${decision.symbol}**: ${decision.action.toUpperCase()}`
    );
    lines.push(
      `- Confidence: ${(decision.confidence * 100).toFixed(0)}%`
    );
    lines.push(
      `- Priority: ${decision.priority.toUpperCase()}`
    );
    lines.push(
      `- Time Horizon: ${decision.timeHorizon}`
    );

    // Scores breakdown
    lines.push("\n### Analysis Scores (0-100)");
    lines.push(`- Technical: ${decision.scores.technical.toFixed(0)}`);
    lines.push(`- Fundamental: ${decision.scores.fundamental.toFixed(0)}`);
    lines.push(`- Sentiment: ${decision.scores.sentiment.toFixed(0)}`);
    lines.push(`- **Combined**: ${decision.scores.combined.toFixed(0)}`);

    // Price targets
    if (decision.targetPrice || decision.stopLoss || decision.takeProfit) {
      lines.push("\n### Price Targets");
      if (decision.targetPrice) {
        lines.push(`- Target: $${decision.targetPrice.toFixed(2)}`);
      }
      if (decision.stopLoss) {
        lines.push(`- Stop Loss: $${decision.stopLoss.toFixed(2)}`);
      }
      if (decision.takeProfit) {
        lines.push(`- Take Profit: $${decision.takeProfit.toFixed(2)}`);
      }
    }

    // Reasoning
    lines.push("\n### Reasoning");
    lines.push(decision.reasoning);

    return lines.join("\n");
  }

  private async storeDecision(decision: TradingDecision): Promise<void> {
    // Store high-confidence decisions in memory
    if (decision.confidence > 0.6 && decision.action !== "hold") {
      await this.storeMemory(
        `${decision.action.toUpperCase()} decision for ${decision.symbol} on ${new Date().toISOString().split("T")[0]}. ` +
          `Confidence: ${(decision.confidence * 100).toFixed(0)}%, ` +
          `Combined score: ${decision.scores.combined.toFixed(0)}. ` +
          `${decision.reasoning}`,
        "episodic",
        0.8,
        {
          symbol: decision.symbol,
          action: decision.action,
          confidence: decision.confidence,
          scores: decision.scores,
        }
      );
    }
  }
}
