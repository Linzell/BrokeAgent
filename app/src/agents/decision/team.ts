import { BaseAgent, type AgentConfig, type AgentResult } from "../base";
import type { TradingState } from "../../core/state";
import { PortfolioManager, type TradingDecision } from "./portfolio-manager";
import { RiskManager, type RiskAssessment } from "./risk-manager";
import { OrderExecutor, type OrderResult, type ExecutorConfig } from "./order-executor";

// ============================================
// Decision Team - Sequential Agent Execution
// ============================================

/**
 * DecisionTeam runs the decision-making pipeline SEQUENTIALLY:
 * 1. PortfolioManager: Synthesizes analysis -> trading decisions
 * 2. RiskManager: Assesses risk, calculates position sizing
 * 3. OrderExecutor: Executes approved trades (paper/test mode)
 *
 * Unlike AnalysisTeam (parallel), DecisionTeam is sequential because
 * each step depends on the previous step's output.
 */

const DEFAULT_CONFIG: AgentConfig = {
  id: "decision-team-default",
  type: "decision_team",
  name: "Decision Team",
  description:
    "Coordinates sequential execution of decision agents (portfolio manager, risk manager, order executor)",
  systemPrompt: "",
};

export interface DecisionTeamResult {
  decisions: TradingDecision[];
  riskAssessment?: RiskAssessment;
  orders: OrderResult[];
  portfolio: TradingState["portfolio"];
  errors: TradingState["errors"];
  messages: TradingState["messages"];
}

interface StepResult {
  step: string;
  success: boolean;
  result?: AgentResult;
  error?: string;
  durationMs: number;
  skipped?: boolean;
}

export class DecisionTeam extends BaseAgent {
  private portfolioManager: PortfolioManager;
  private riskManager: RiskManager;
  private orderExecutor: OrderExecutor;

  constructor(
    config: Partial<AgentConfig> = {},
    executorConfig: Partial<ExecutorConfig> = {}
  ) {
    super({ ...DEFAULT_CONFIG, ...config });

    // Initialize sub-agents
    this.portfolioManager = new PortfolioManager();
    this.riskManager = new RiskManager();
    this.orderExecutor = new OrderExecutor({}, executorConfig);
  }

  /**
   * Execute decision pipeline sequentially
   */
  async execute(state: TradingState): Promise<AgentResult> {
    this.log("Starting decision team - sequential agent execution");
    const startTime = Date.now();

    const stepResults: StepResult[] = [];
    let currentState = { ...state };

    // Step 1: Portfolio Manager - Generate decisions
    const pmResult = await this.executeStep(
      "portfolio_manager",
      this.portfolioManager,
      currentState
    );
    stepResults.push(pmResult);

    if (!pmResult.success || !pmResult.result) {
      return this.handlePipelineFailure(state, stepResults, "Portfolio Manager failed");
    }

    // Merge PM results into state
    currentState = this.mergeStateUpdate(currentState, pmResult.result.update);

    // Check if we have actionable decisions (not just hold)
    const decisions = currentState.decisions || [];
    const actionableDecisions = decisions.filter((d) => d.action !== "hold");

    if (actionableDecisions.length === 0) {
      this.log("No actionable decisions - skipping risk and execution");
      stepResults.push({
        step: "risk_manager",
        success: true,
        skipped: true,
        durationMs: 0,
      });
      stepResults.push({
        step: "order_executor",
        success: true,
        skipped: true,
        durationMs: 0,
      });

      return this.finalizePipeline(currentState, stepResults);
    }

    // Step 2: Risk Manager - Assess risk and size positions
    const rmResult = await this.executeStep(
      "risk_manager",
      this.riskManager,
      currentState
    );
    stepResults.push(rmResult);

    if (!rmResult.success || !rmResult.result) {
      return this.handlePipelineFailure(state, stepResults, "Risk Manager failed");
    }

    // Merge RM results into state
    currentState = this.mergeStateUpdate(currentState, rmResult.result.update);

    // Check if risk approved the trade
    const riskAssessment = currentState.riskAssessment;
    if (riskAssessment && !riskAssessment.approved) {
      this.log("Risk assessment rejected - skipping execution");
      stepResults.push({
        step: "order_executor",
        success: true,
        skipped: true,
        durationMs: 0,
      });

      return this.finalizePipeline(currentState, stepResults);
    }

    // Step 3: Order Executor - Execute approved trades
    const oeResult = await this.executeStep(
      "order_executor",
      this.orderExecutor,
      currentState
    );
    stepResults.push(oeResult);

    if (!oeResult.success || !oeResult.result) {
      return this.handlePipelineFailure(state, stepResults, "Order Executor failed");
    }

    // Merge OE results into state
    currentState = this.mergeStateUpdate(currentState, oeResult.result.update);

    // Finalize and return
    const totalDuration = Date.now() - startTime;
    this.log(`Decision pipeline completed in ${totalDuration}ms`);

    return this.finalizePipeline(currentState, stepResults);
  }

  /**
   * Execute a single step with error handling and timing
   */
  private async executeStep(
    stepName: string,
    agent: BaseAgent,
    state: TradingState
  ): Promise<StepResult> {
    const startTime = Date.now();

    try {
      this.log(`Starting ${stepName}`);
      const result = await agent.execute(state);
      const durationMs = Date.now() - startTime;

      this.log(`${stepName} completed in ${durationMs}ms`);

      return {
        step: stepName,
        success: true,
        result,
        durationMs,
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      this.logError(`${stepName} failed after ${durationMs}ms`, error);

      return {
        step: stepName,
        success: false,
        error: errorMessage,
        durationMs,
      };
    }
  }

  /**
   * Merge update into current state
   */
  private mergeStateUpdate(
    state: TradingState,
    update: Partial<TradingState>
  ): TradingState {
    return {
      ...state,
      ...update,
      // Preserve and extend arrays
      messages: [...state.messages, ...(update.messages || [])],
      errors: [...state.errors, ...(update.errors || [])],
    };
  }

  /**
   * Handle pipeline failure - return partial results with error
   */
  private handlePipelineFailure(
    originalState: TradingState,
    stepResults: StepResult[],
    message: string
  ): AgentResult {
    this.logError(message);

    const summaryMessage = this.generateSummary(stepResults, undefined);

    return this.command("orchestrator", {
      errors: this.addError(originalState, message),
      messages: this.addMessage(originalState, "assistant", summaryMessage),
    });
  }

  /**
   * Finalize pipeline with success summary
   */
  private finalizePipeline(
    state: TradingState,
    stepResults: StepResult[]
  ): AgentResult {
    const summaryMessage = this.generateSummary(stepResults, state);

    // Store significant decisions in memory
    this.storeDecisionMemory(state);

    return this.command("orchestrator", {
      decisions: state.decisions,
      riskAssessment: state.riskAssessment,
      orders: state.orders,
      portfolio: state.portfolio,
      messages: this.addMessage(state, "assistant", summaryMessage),
    });
  }

  /**
   * Generate team summary message
   */
  private generateSummary(stepResults: StepResult[], state?: TradingState): string {
    const lines = ["## Decision Team Summary\n"];

    // Pipeline status
    lines.push("### Pipeline Execution");
    for (const step of stepResults) {
      let status: string;
      if (step.skipped) {
        status = "~~ (skipped)";
      } else if (step.success) {
        status = `(${step.durationMs}ms)`;
      } else {
        status = ` - ${step.error}`;
      }

      const icon = step.skipped ? "⏭️" : step.success ? "✅" : "❌";
      const stepName = step.step.replace("_", " ");
      lines.push(`${icon} **${stepName}** ${status}`);
    }

    // Decision summary
    if (state?.decisions?.length) {
      const decision = state.decisions[0];
      const actionEmoji = {
        buy: "🟢",
        sell: "🔴",
        hold: "🟡",
        short: "🔻",
        cover: "🔺",
      }[decision.action] || "⚪";

      lines.push("\n### Decision");
      lines.push(
        `${actionEmoji} **${decision.symbol}**: ${decision.action.toUpperCase()} ` +
          `(${(decision.confidence * 100).toFixed(0)}% confidence)`
      );
    }

    // Risk summary
    if (state?.riskAssessment) {
      const risk = state.riskAssessment;
      const riskIcon = risk.approved ? "✅" : "❌";
      lines.push("\n### Risk Assessment");
      lines.push(`${riskIcon} ${risk.approved ? "Approved" : "Rejected"} (risk score: ${risk.riskScore}/100)`);
      if (risk.warnings.length > 0) {
        lines.push(`- Warnings: ${risk.warnings.slice(0, 3).join(", ")}`);
      }
    }

    // Execution summary
    if (state?.orders?.length) {
      const filledOrders = state.orders.filter(
        (o) => o.status === "filled" || o.status === "partial"
      );
      lines.push("\n### Execution");
      lines.push(`- Orders: ${state.orders.length} total, ${filledOrders.length} filled`);

      for (const order of filledOrders) {
        lines.push(
          `- ${order.action.toUpperCase()} ${order.filledQuantity} ${order.symbol} @ $${order.avgPrice.toFixed(2)}`
        );
      }
    }

    // Portfolio summary
    if (state?.portfolio) {
      const port = state.portfolio;
      lines.push("\n### Portfolio");
      lines.push(`- Cash: $${port.cash.toFixed(2)}`);
      lines.push(`- Total Value: $${port.totalValue.toFixed(2)}`);
      lines.push(`- Positions: ${port.positions.length}`);
    }

    return lines.join("\n");
  }

  /**
   * Store significant decisions in memory for future reference
   */
  private async storeDecisionMemory(state: TradingState): Promise<void> {
    if (!state.decisions?.length || !state.orders?.length) return;

    const decision = state.decisions[0];
    const filledOrders = state.orders.filter((o) => o.status === "filled");

    if (filledOrders.length === 0) return;

    const order = filledOrders[0];
    const riskApproved = state.riskAssessment?.approved ?? true;

    const memoryContent =
      `Trade executed for ${decision.symbol} on ${new Date().toISOString().split("T")[0]}: ` +
      `${decision.action.toUpperCase()} ${order.filledQuantity} shares @ $${order.avgPrice.toFixed(2)}. ` +
      `Confidence: ${(decision.confidence * 100).toFixed(0)}%, ` +
      `Risk approved: ${riskApproved}, Risk score: ${state.riskAssessment?.riskScore ?? "N/A"}. ` +
      `Combined score: ${decision.scores.combined.toFixed(0)}/100.`;

    await this.storeMemory(memoryContent, "episodic", 0.9, {
      symbol: decision.symbol,
      action: decision.action,
      quantity: order.filledQuantity,
      price: order.avgPrice,
      confidence: decision.confidence,
      riskScore: state.riskAssessment?.riskScore,
    });
  }

  /**
   * Static factory to create a node function for the StateGraph
   */
  static createNode(
    executorConfig?: Partial<ExecutorConfig>
  ): (state: TradingState) => Promise<AgentResult> {
    const team = new DecisionTeam({}, executorConfig);
    return (state: TradingState) => team.execute(state);
  }
}

// ============================================
// Helper function for quick team execution
// ============================================

/**
 * Execute decision team and return results
 * Useful for standalone decision-making after analysis
 */
export async function executeDecisions(
  symbols: string[],
  existingState: Partial<TradingState>,
  executorConfig?: Partial<ExecutorConfig>
): Promise<DecisionTeamResult> {
  const team = new DecisionTeam({}, executorConfig);

  // Validate required analysis data
  if (!existingState.technical && !existingState.fundamental && !existingState.sentiment) {
    throw new Error("Decision team requires at least one analysis result (technical, fundamental, or sentiment)");
  }

  const state: TradingState = {
    workflowId: crypto.randomUUID(),
    threadId: crypto.randomUUID(),
    startedAt: new Date(),
    currentStep: "decision",
    request: {
      type: "trade",
      symbols,
    },
    messages: [],
    errors: [],
    ...existingState,
  };

  const result = await team.execute(state);

  return {
    decisions: result.update.decisions || [],
    riskAssessment: result.update.riskAssessment,
    orders: result.update.orders || [],
    portfolio: result.update.portfolio,
    errors: result.update.errors || [],
    messages: result.update.messages || [],
  };
}
