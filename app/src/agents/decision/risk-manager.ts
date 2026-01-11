import { BaseAgent, type AgentConfig, type AgentResult } from "../base";
import type { TradingState } from "../../core/state";
import type { TradingDecision } from "./portfolio-manager";

// ============================================
// Risk Manager Agent
// ============================================

/**
 * RiskManager assesses and limits portfolio risk by:
 * - Calculating position sizing
 * - Enforcing exposure limits
 * - Recommending stop-loss levels
 * - Analyzing risk/reward ratios
 */

const DEFAULT_CONFIG: AgentConfig = {
  id: "risk-manager-default",
  type: "risk_manager",
  name: "Risk Manager",
  description:
    "Assesses portfolio risk, calculates position sizes, and enforces risk limits",
  systemPrompt: `You are a Risk Manager responsible for protecting the portfolio.
Your job is to:
1. Calculate appropriate position sizes based on risk tolerance
2. Enforce portfolio exposure limits
3. Recommend stop-loss and take-profit levels
4. Analyze risk/reward ratios
5. Prevent excessive concentration or correlation`,
};

// Risk management rules
export const RISK_RULES = {
  // Position sizing
  maxPositionSize: 0.10,        // 10% of portfolio per position
  minPositionSize: 0.01,        // 1% minimum to be meaningful
  
  // Exposure limits
  maxSectorExposure: 0.30,      // 30% in any sector
  maxSingleStockExposure: 0.15, // 15% in any single stock
  maxCashDeploy: 0.25,          // Only deploy 25% of cash per trade
  
  // Loss limits
  maxDailyLoss: 0.02,           // 2% daily loss limit
  maxPositionLoss: 0.05,        // 5% max loss per position
  
  // Risk/Reward
  minRiskReward: 1.5,           // Minimum 1.5:1 reward/risk
  preferredRiskReward: 2.0,     // Preferred 2:1 reward/risk
  
  // Volatility
  maxBeta: 2.0,                 // Avoid highly volatile stocks
  highVolatilityPenalty: 0.5,   // Reduce position by 50% for high-vol stocks
  
  // Confidence adjustments
  lowConfidenceReduction: 0.5,  // Reduce position by 50% for low confidence
  highConfidenceBoost: 1.25,    // Increase position by 25% for high confidence
};

export interface RiskAssessment {
  approved: boolean;
  adjustedQuantity?: number;
  riskScore: number;           // 0-100 (higher = riskier)
  warnings: string[];
  stopLossRecommended?: number;
  takeProfitRecommended?: number;
  positionSizePercent: number;
  maxLossAmount: number;
  expectedRiskReward: number;
  portfolioImpact: {
    newExposure: number;
    sectorExposure: number;
    concentrationRisk: number;
  };
}

export class RiskManager extends BaseAgent {
  constructor(config: Partial<AgentConfig> = {}) {
    super({ ...DEFAULT_CONFIG, ...config });
  }

  async execute(state: TradingState): Promise<AgentResult> {
    this.log("Starting risk assessment");

    const decisions = state.decisions || [];

    if (decisions.length === 0) {
      this.log("No decisions to assess");
      return this.command("orchestrator", {
        errors: this.addError(state, "No trading decisions to assess for risk"),
      });
    }

    try {
      // Get portfolio context (or use defaults)
      const portfolio = state.portfolio || this.getDefaultPortfolio();
      const marketData = state.marketData || [];

      // Assess risk for each decision
      const assessments: RiskAssessment[] = [];
      const updatedDecisions: TradingDecision[] = [];

      for (const decision of decisions) {
        const assessment = this.assessRisk(decision, portfolio, marketData, state);
        assessments.push(assessment);

        // Update decision with risk-adjusted values
        const adjustedDecision = this.applyRiskAdjustments(decision, assessment);
        updatedDecisions.push(adjustedDecision);
      }

      // Use the first assessment as the primary one (for single-decision flows)
      const primaryAssessment = assessments[0];

      this.log(
        `Risk assessment complete: ${primaryAssessment.approved ? "APPROVED" : "REJECTED"} ` +
          `(risk score: ${primaryAssessment.riskScore})`
      );

      // Generate summary
      const summary = this.generateSummary(updatedDecisions[0], primaryAssessment);

      // Store high-risk events in memory
      await this.storeRiskEvents(primaryAssessment, decisions[0]);

      return this.command("orchestrator", {
        decisions: updatedDecisions,
        riskAssessment: primaryAssessment,
        messages: this.addMessage(state, "assistant", summary),
      });
    } catch (error) {
      this.logError("Risk assessment failed", error);
      return this.command("orchestrator", {
        errors: this.addError(
          state,
          `Risk assessment failed: ${(error as Error).message}`
        ),
      });
    }
  }

  private getDefaultPortfolio(): NonNullable<TradingState["portfolio"]> {
    return {
      cash: 100000, // $100k paper trading default
      totalValue: 100000,
      positions: [],
    };
  }

  private assessRisk(
    decision: TradingDecision,
    portfolio: NonNullable<TradingState["portfolio"]>,
    marketData: NonNullable<TradingState["marketData"]>,
    state: TradingState
  ): RiskAssessment {
    const warnings: string[] = [];
    let riskScore = 0;

    // Get current price
    const quote = marketData.find((m) => m.symbol === decision.symbol);
    const currentPrice = quote?.price || decision.targetPrice || 100;

    // Calculate position sizing
    const { positionSizePercent, quantity, maxLossAmount } = this.calculatePositionSize(
      decision,
      portfolio,
      currentPrice
    );

    // Check existing exposure
    const existingPosition = portfolio.positions.find((p) => p.symbol === decision.symbol);
    const currentExposure = existingPosition
      ? (existingPosition.marketValue / portfolio.totalValue) * 100
      : 0;

    // Risk score components
    // 1. Confidence risk (low confidence = higher risk)
    const confidenceRisk = (1 - decision.confidence) * 25;
    riskScore += confidenceRisk;
    if (decision.confidence < 0.5) {
      warnings.push(`Low confidence (${(decision.confidence * 100).toFixed(0)}%)`);
    }

    // 2. Concentration risk
    const newExposure = currentExposure + positionSizePercent;
    const concentrationRisk = Math.min(25, (newExposure / RISK_RULES.maxSingleStockExposure) * 25);
    riskScore += concentrationRisk;
    if (newExposure > RISK_RULES.maxSingleStockExposure * 100) {
      warnings.push(
        `Position would exceed ${RISK_RULES.maxSingleStockExposure * 100}% single-stock limit`
      );
    }

    // 3. Stop-loss risk
    let stopLossRisk = 0;
    if (!decision.stopLoss) {
      stopLossRisk = 15;
      warnings.push("No stop-loss defined");
    } else {
      const stopLossPercent = ((currentPrice - decision.stopLoss) / currentPrice) * 100;
      if (stopLossPercent > RISK_RULES.maxPositionLoss * 100) {
        stopLossRisk = 10;
        warnings.push(
          `Stop-loss ${stopLossPercent.toFixed(1)}% exceeds ${RISK_RULES.maxPositionLoss * 100}% max`
        );
      }
    }
    riskScore += stopLossRisk;

    // 4. Risk/Reward analysis
    const expectedRiskReward = this.calculateRiskReward(decision, currentPrice);
    let rrRisk = 0;
    if (expectedRiskReward < RISK_RULES.minRiskReward) {
      rrRisk = 15;
      warnings.push(
        `Risk/reward ${expectedRiskReward.toFixed(1)}:1 below minimum ${RISK_RULES.minRiskReward}:1`
      );
    }
    riskScore += rrRisk;

    // 5. Volatility risk
    let volatilityRisk = 0;
    if (quote?.changePercent && Math.abs(quote.changePercent) > 5) {
      volatilityRisk = 10;
      warnings.push("High intraday volatility detected");
    }
    riskScore += volatilityRisk;

    // 6. Mixed signals risk
    if (decision.timeHorizon === "day" && decision.action !== "hold") {
      riskScore += 5;
      warnings.push("Short time horizon due to mixed signals");
    }

    // Calculate stop-loss and take-profit recommendations
    const stopLossRecommended = this.recommendStopLoss(decision, currentPrice, state);
    const takeProfitRecommended = this.recommendTakeProfit(
      decision,
      currentPrice,
      stopLossRecommended
    );

    // Determine approval
    const approved = this.shouldApprove(riskScore, warnings, decision);

    return {
      approved,
      adjustedQuantity: quantity,
      riskScore: Math.min(100, riskScore),
      warnings,
      stopLossRecommended,
      takeProfitRecommended,
      positionSizePercent,
      maxLossAmount,
      expectedRiskReward,
      portfolioImpact: {
        newExposure,
        sectorExposure: 0, // Would need sector data
        concentrationRisk: concentrationRisk / 25, // Normalized 0-1
      },
    };
  }

  private calculatePositionSize(
    decision: TradingDecision,
    portfolio: NonNullable<TradingState["portfolio"]>,
    currentPrice: number
  ): { positionSizePercent: number; quantity: number; maxLossAmount: number } {
    const availableCash = portfolio.cash;
    const totalValue = portfolio.totalValue;

    // Base position size (percentage of portfolio)
    let positionSizePercent = RISK_RULES.maxPositionSize * 100;

    // Adjust based on confidence
    if (decision.confidence < 0.5) {
      positionSizePercent *= RISK_RULES.lowConfidenceReduction;
    } else if (decision.confidence > 0.8) {
      positionSizePercent *= RISK_RULES.highConfidenceBoost;
    }

    // Adjust based on priority
    if (decision.priority === "low") {
      positionSizePercent *= 0.5;
    } else if (decision.priority === "high") {
      positionSizePercent *= 1.25;
    }

    // Cap at max position size
    positionSizePercent = Math.min(positionSizePercent, RISK_RULES.maxPositionSize * 100);

    // Calculate dollar amount and quantity
    const dollarAmount = Math.min(
      (positionSizePercent / 100) * totalValue,
      availableCash * RISK_RULES.maxCashDeploy
    );
    const quantity = Math.floor(dollarAmount / currentPrice);

    // Recalculate actual position size based on quantity
    const actualDollarAmount = quantity * currentPrice;
    const actualPositionSizePercent = (actualDollarAmount / totalValue) * 100;

    // Calculate max loss based on stop-loss or default
    const stopLossPercent = decision.stopLoss
      ? (currentPrice - decision.stopLoss) / currentPrice
      : RISK_RULES.maxPositionLoss;
    const maxLossAmount = actualDollarAmount * stopLossPercent;

    return {
      positionSizePercent: actualPositionSizePercent,
      quantity,
      maxLossAmount,
    };
  }

  private calculateRiskReward(decision: TradingDecision, currentPrice: number): number {
    if (!decision.stopLoss || !decision.targetPrice) {
      return 1.0; // Assume 1:1 if not specified
    }

    if (decision.action === "buy") {
      const potentialGain = decision.targetPrice - currentPrice;
      const potentialLoss = currentPrice - decision.stopLoss;

      if (potentialLoss <= 0) return 10; // Very favorable (stop above current)
      return potentialGain / potentialLoss;
    }

    // For sell/short, reverse the calculation
    if (decision.action === "sell" || decision.action === "short") {
      const potentialGain = currentPrice - decision.targetPrice;
      const potentialLoss = decision.stopLoss - currentPrice;

      if (potentialLoss <= 0) return 10;
      return potentialGain / potentialLoss;
    }

    return 1.0;
  }

  private recommendStopLoss(
    decision: TradingDecision,
    currentPrice: number,
    state: TradingState
  ): number {
    // If already defined and reasonable, use it
    if (decision.stopLoss) {
      const stopPercent = Math.abs((currentPrice - decision.stopLoss) / currentPrice);
      if (stopPercent <= RISK_RULES.maxPositionLoss) {
        return decision.stopLoss;
      }
    }

    // Use technical support levels if available
    if (state.technical?.supportLevels.length) {
      const nearestSupport = state.technical.supportLevels[0];
      const supportPercent = (currentPrice - nearestSupport) / currentPrice;

      if (supportPercent > 0 && supportPercent <= RISK_RULES.maxPositionLoss) {
        return nearestSupport;
      }
    }

    // Default: max position loss below current price
    return currentPrice * (1 - RISK_RULES.maxPositionLoss);
  }

  private recommendTakeProfit(
    decision: TradingDecision,
    currentPrice: number,
    stopLoss: number
  ): number {
    // If already defined, validate it provides good R/R
    if (decision.takeProfit) {
      const potentialGain = decision.takeProfit - currentPrice;
      const potentialLoss = currentPrice - stopLoss;

      if (potentialLoss > 0 && potentialGain / potentialLoss >= RISK_RULES.minRiskReward) {
        return decision.takeProfit;
      }
    }

    // Calculate take profit based on preferred risk/reward
    const riskAmount = currentPrice - stopLoss;
    const targetGain = riskAmount * RISK_RULES.preferredRiskReward;

    return currentPrice + targetGain;
  }

  private shouldApprove(
    riskScore: number,
    warnings: string[],
    decision: TradingDecision
  ): boolean {
    // Hard rejections
    if (riskScore > 75) return false;
    if (warnings.some((w) => w.includes("exceed"))) return false;

    // Hold decisions are always approved
    if (decision.action === "hold") return true;

    // Low confidence + high risk = reject
    if (decision.confidence < 0.4 && riskScore > 50) return false;

    // Otherwise approve with warnings
    return true;
  }

  private applyRiskAdjustments(
    decision: TradingDecision,
    assessment: RiskAssessment
  ): TradingDecision {
    return {
      ...decision,
      quantity: assessment.adjustedQuantity,
      stopLoss: assessment.stopLossRecommended,
      takeProfit: assessment.takeProfitRecommended,
    };
  }

  private generateSummary(decision: TradingDecision, assessment: RiskAssessment): string {
    const lines = ["## Risk Assessment\n"];

    // Approval status
    const statusEmoji = assessment.approved ? "✅" : "❌";
    lines.push(
      `${statusEmoji} **Status**: ${assessment.approved ? "APPROVED" : "REJECTED"}`
    );
    lines.push(`- Risk Score: ${assessment.riskScore}/100`);

    // Position sizing
    lines.push("\n### Position Sizing");
    lines.push(`- Position Size: ${assessment.positionSizePercent.toFixed(2)}% of portfolio`);
    if (assessment.adjustedQuantity) {
      lines.push(`- Quantity: ${assessment.adjustedQuantity} shares`);
    }
    lines.push(`- Max Loss: $${assessment.maxLossAmount.toFixed(2)}`);

    // Risk/Reward
    lines.push("\n### Risk/Reward");
    lines.push(`- Expected R/R: ${assessment.expectedRiskReward.toFixed(2)}:1`);
    if (assessment.stopLossRecommended) {
      lines.push(`- Stop Loss: $${assessment.stopLossRecommended.toFixed(2)}`);
    }
    if (assessment.takeProfitRecommended) {
      lines.push(`- Take Profit: $${assessment.takeProfitRecommended.toFixed(2)}`);
    }

    // Portfolio Impact
    lines.push("\n### Portfolio Impact");
    lines.push(`- New Exposure: ${assessment.portfolioImpact.newExposure.toFixed(2)}%`);
    lines.push(
      `- Concentration Risk: ${(assessment.portfolioImpact.concentrationRisk * 100).toFixed(0)}%`
    );

    // Warnings
    if (assessment.warnings.length > 0) {
      lines.push("\n### Warnings");
      for (const warning of assessment.warnings) {
        lines.push(`- ⚠️ ${warning}`);
      }
    }

    return lines.join("\n");
  }

  private async storeRiskEvents(
    assessment: RiskAssessment,
    decision: TradingDecision
  ): Promise<void> {
    // Store high-risk events for learning
    if (assessment.riskScore > 50 || !assessment.approved) {
      const status = assessment.approved ? "approved with warnings" : "rejected";
      await this.storeMemory(
        `Risk event for ${decision.symbol} on ${new Date().toISOString().split("T")[0]}: ` +
          `${decision.action} decision ${status}. ` +
          `Risk score: ${assessment.riskScore}, Warnings: ${assessment.warnings.join("; ")}`,
        "episodic",
        0.7,
        {
          symbol: decision.symbol,
          action: decision.action,
          riskScore: assessment.riskScore,
          approved: assessment.approved,
        }
      );
    }
  }
}
