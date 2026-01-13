import { BaseAgent, type AgentConfig, type AgentResult } from "../base";
import type { TradingState } from "../../core/state";
import type { TradingDecision } from "./portfolio-manager";
import type { RiskAssessment } from "./risk-manager";
import { sql } from "../../core/database";

// ============================================
// Order Executor Agent
// ============================================

/**
 * OrderExecutor executes approved trades via paper trading simulation.
 * Supports different modes: test, paper, live (future).
 */

const DEFAULT_CONFIG: AgentConfig = {
  id: "order-executor-default",
  type: "order_executor",
  name: "Order Executor",
  description:
    "Executes approved trades via paper trading simulation and tracks portfolio",
  systemPrompt: `You are an Order Executor responsible for trade execution.
Your job is to:
1. Validate orders before execution
2. Execute trades in paper trading mode
3. Update portfolio positions
4. Log all transactions
5. Track P&L`,
};

export type ExecutionMode = "test" | "paper" | "live";

export interface OrderRequest {
  symbol: string;
  action: "buy" | "sell" | "short" | "cover";
  quantity: number;
  orderType: "market" | "limit" | "stop" | "stop_limit";
  limitPrice?: number;
  stopPrice?: number;
  timeInForce: "day" | "gtc" | "ioc";
  stopLoss?: number;
  takeProfit?: number;
}

export interface OrderResult {
  orderId: string;
  status: "pending" | "filled" | "partial" | "cancelled" | "rejected";
  symbol: string;
  action: string;
  quantity: number;
  filledQuantity: number;
  price: number;
  avgPrice: number;
  commission: number;
  timestamp: Date;
  message?: string;
}

export interface ExecutorConfig {
  mode: ExecutionMode;
  commission: number;        // Per trade commission
  slippage: number;          // Percentage slippage simulation
  initialCash?: number;      // Initial portfolio cash
}

const DEFAULT_EXECUTOR_CONFIG: ExecutorConfig = {
  mode: "paper",
  commission: 0,             // Most brokers are zero commission now
  slippage: 0.001,           // 0.1% slippage
  initialCash: 100000,       // $100k paper trading
};

export class OrderExecutor extends BaseAgent {
  private config: ExecutorConfig;

  constructor(
    agentConfig: Partial<AgentConfig> = {},
    executorConfig: Partial<ExecutorConfig> = {}
  ) {
    super({ ...DEFAULT_CONFIG, ...agentConfig });
    this.config = { ...DEFAULT_EXECUTOR_CONFIG, ...executorConfig };
  }

  async execute(state: TradingState): Promise<AgentResult> {
    this.log(`Starting order execution (mode: ${this.config.mode})`);

    const decisions = state.decisions || [];
    const riskAssessment = state.riskAssessment;

    // Check if we have approved decisions to execute
    if (decisions.length === 0) {
      this.log("No decisions to execute");
      return this.command("orchestrator", {
        errors: this.addError(state, "No trading decisions to execute"),
      });
    }

    // Check risk approval
    if (riskAssessment && !riskAssessment.approved) {
      this.log("Risk assessment rejected - skipping execution");
      return this.command("orchestrator", {
        messages: this.addMessage(
          state,
          "assistant",
          "## Order Execution\n\n❌ **Skipped**: Risk assessment rejected the trade."
        ),
      });
    }

    try {
      // Get or initialize portfolio
      const portfolio = state.portfolio || await this.initializePortfolio();
      const marketData = state.marketData || [];

      // Execute each decision
      const orders: OrderResult[] = [];
      let updatedPortfolio = { ...portfolio };

      for (const decision of decisions) {
        // Skip hold decisions
        if (decision.action === "hold") {
          this.log(`Skipping ${decision.symbol} - hold decision`);
          continue;
        }

        // Create order request
        const orderRequest = this.createOrderRequest(decision, riskAssessment);

        // Get current price
        const quote = marketData.find((m) => m.symbol === decision.symbol);
        const currentPrice = quote?.price || decision.targetPrice || 100;

        // Execute order
        const result = await this.executeOrder(
          orderRequest,
          currentPrice,
          updatedPortfolio
        );

        orders.push(result);

        // Update portfolio if filled
        if (result.status === "filled" || result.status === "partial") {
          updatedPortfolio = this.updatePortfolio(
            updatedPortfolio,
            result,
            currentPrice
          );
        }
      }

      // Generate summary
      const summary = this.generateSummary(orders, updatedPortfolio);

      // Store trade in database
      await this.recordTrades(orders, state.workflowId);
      
      // Persist trading decisions to database
      await this.persistDecisions(decisions, orders, state);
      
      // Persist portfolio changes to database
      await this.persistPortfolio(updatedPortfolio, orders);

      this.log(`Executed ${orders.length} orders`);

      return this.command("orchestrator", {
        orders,
        portfolio: updatedPortfolio,
        messages: this.addMessage(state, "assistant", summary),
      });
    } catch (error) {
      this.logError("Order execution failed", error);
      return this.command("orchestrator", {
        errors: this.addError(
          state,
          `Order execution failed: ${(error as Error).message}`
        ),
      });
    }
  }

  private async initializePortfolio(): Promise<NonNullable<TradingState["portfolio"]>> {
    return {
      cash: this.config.initialCash || 100000,
      totalValue: this.config.initialCash || 100000,
      positions: [],
    };
  }

  private createOrderRequest(
    decision: TradingDecision,
    riskAssessment?: RiskAssessment
  ): OrderRequest {
    return {
      symbol: decision.symbol,
      action: decision.action as "buy" | "sell" | "short" | "cover",
      quantity: decision.quantity || riskAssessment?.adjustedQuantity || 10,
      orderType: "market", // Default to market orders for paper trading
      timeInForce: "day",
      stopLoss: decision.stopLoss || riskAssessment?.stopLossRecommended,
      takeProfit: decision.takeProfit || riskAssessment?.takeProfitRecommended,
    };
  }

  private async executeOrder(
    order: OrderRequest,
    currentPrice: number,
    portfolio: NonNullable<TradingState["portfolio"]>
  ): Promise<OrderResult> {
    const orderId = crypto.randomUUID();
    const timestamp = new Date();

    // Validate order
    const validation = this.validateOrder(order, currentPrice, portfolio);
    if (!validation.valid) {
      return {
        orderId,
        status: "rejected",
        symbol: order.symbol,
        action: order.action,
        quantity: order.quantity,
        filledQuantity: 0,
        price: currentPrice,
        avgPrice: 0,
        commission: 0,
        timestamp,
        message: validation.reason,
      };
    }

    // Simulate execution based on mode
    if (this.config.mode === "test") {
      // Test mode: Just simulate, don't change anything
      return this.simulateExecution(order, currentPrice, orderId, timestamp, true);
    }

    if (this.config.mode === "paper") {
      // Paper mode: Simulate with slippage
      return this.simulateExecution(order, currentPrice, orderId, timestamp, false);
    }

    // Live mode: Not implemented yet
    return {
      orderId,
      status: "rejected",
      symbol: order.symbol,
      action: order.action,
      quantity: order.quantity,
      filledQuantity: 0,
      price: currentPrice,
      avgPrice: 0,
      commission: 0,
      timestamp,
      message: "Live trading not yet implemented",
    };
  }

  private validateOrder(
    order: OrderRequest,
    currentPrice: number,
    portfolio: NonNullable<TradingState["portfolio"]>
  ): { valid: boolean; reason?: string } {
    // Check quantity
    if (order.quantity <= 0) {
      return { valid: false, reason: "Invalid quantity" };
    }

    // Check for buy orders: sufficient cash
    if (order.action === "buy") {
      const totalCost = order.quantity * currentPrice + this.config.commission;
      if (totalCost > portfolio.cash) {
        return {
          valid: false,
          reason: `Insufficient cash: need $${totalCost.toFixed(2)}, have $${portfolio.cash.toFixed(2)}`,
        };
      }
    }

    // Check for sell orders: have the position
    if (order.action === "sell") {
      const position = portfolio.positions.find((p) => p.symbol === order.symbol);
      if (!position || position.quantity < order.quantity) {
        return {
          valid: false,
          reason: `Insufficient shares: need ${order.quantity}, have ${position?.quantity || 0}`,
        };
      }
    }

    return { valid: true };
  }

  private simulateExecution(
    order: OrderRequest,
    currentPrice: number,
    orderId: string,
    timestamp: Date,
    testMode: boolean
  ): OrderResult {
    // Apply slippage (worse price for the trader)
    let executionPrice = currentPrice;
    if (!testMode) {
      const slippageMultiplier =
        order.action === "buy" ? 1 + this.config.slippage : 1 - this.config.slippage;
      executionPrice = currentPrice * slippageMultiplier;
    }

    return {
      orderId,
      status: "filled",
      symbol: order.symbol,
      action: order.action,
      quantity: order.quantity,
      filledQuantity: order.quantity,
      price: currentPrice,
      avgPrice: executionPrice,
      commission: this.config.commission,
      timestamp,
      message: testMode ? "Test mode - no actual execution" : "Paper trade executed",
    };
  }

  private updatePortfolio(
    portfolio: NonNullable<TradingState["portfolio"]>,
    order: OrderResult,
    currentPrice: number
  ): NonNullable<TradingState["portfolio"]> {
    const positions = [...portfolio.positions];
    let cash = portfolio.cash;

    const existingIndex = positions.findIndex((p) => p.symbol === order.symbol);

    if (order.action === "buy") {
      // Deduct cash
      const totalCost = order.filledQuantity * order.avgPrice + order.commission;
      cash -= totalCost;

      if (existingIndex >= 0) {
        // Add to existing position
        const existing = positions[existingIndex];
        const totalQuantity = existing.quantity + order.filledQuantity;
        const totalCostBasis =
          existing.avgCost * existing.quantity + order.avgPrice * order.filledQuantity;

        positions[existingIndex] = {
          ...existing,
          quantity: totalQuantity,
          avgCost: totalCostBasis / totalQuantity,
          currentPrice,
          marketValue: totalQuantity * currentPrice,
          unrealizedPnl: totalQuantity * currentPrice - totalCostBasis,
        };
      } else {
        // New position
        positions.push({
          symbol: order.symbol,
          quantity: order.filledQuantity,
          avgCost: order.avgPrice,
          currentPrice,
          marketValue: order.filledQuantity * currentPrice,
          unrealizedPnl: order.filledQuantity * (currentPrice - order.avgPrice),
        });
      }
    } else if (order.action === "sell") {
      // Add cash (minus commission)
      const proceeds = order.filledQuantity * order.avgPrice - order.commission;
      cash += proceeds;

      if (existingIndex >= 0) {
        const existing = positions[existingIndex];
        const remainingQuantity = existing.quantity - order.filledQuantity;

        if (remainingQuantity <= 0) {
          // Close position
          positions.splice(existingIndex, 1);
        } else {
          // Reduce position
          positions[existingIndex] = {
            ...existing,
            quantity: remainingQuantity,
            currentPrice,
            marketValue: remainingQuantity * currentPrice,
            unrealizedPnl: remainingQuantity * (currentPrice - existing.avgCost),
          };
        }
      }
    }

    // Calculate total value
    const positionsValue = positions.reduce((sum, p) => sum + p.marketValue, 0);
    const totalValue = cash + positionsValue;

    return {
      cash,
      totalValue,
      positions,
    };
  }

  private async recordTrades(orders: OrderResult[], workflowExecutionId?: string): Promise<void> {
    for (const order of orders) {
      if (order.status !== "filled" && order.status !== "partial") continue;

      try {
        // Insert into orders table (workflow_execution_id is nullable for standalone trades)
        await sql`
          INSERT INTO orders (
            id, symbol, action, quantity, order_type, status,
            filled_quantity, avg_fill_price, commission, mode,
            created_at, filled_at
          )
          VALUES (
            ${order.orderId},
            ${order.symbol},
            ${order.action},
            ${order.quantity},
            'market',
            ${order.status},
            ${order.filledQuantity},
            ${order.avgPrice},
            ${order.commission},
            ${this.config.mode},
            ${order.timestamp},
            ${order.timestamp}
          )
          ON CONFLICT (id) DO NOTHING
        `;
        this.log(`Recorded order ${order.orderId} to database`);
      } catch (error) {
        this.log(`Could not record order: ${(error as Error).message}`);
      }
    }
  }

  /**
   * Persist portfolio changes to database
   */
  private async persistPortfolio(
    portfolio: NonNullable<TradingState["portfolio"]>,
    orders: OrderResult[]
  ): Promise<void> {
    try {
      // Update account cash and total value
      await sql`
        UPDATE accounts
        SET 
          cash = ${portfolio.cash},
          total_value = ${portfolio.totalValue},
          updated_at = NOW()
        WHERE mode = 'paper'
      `;

      // Update positions
      for (const pos of portfolio.positions) {
        // Check if position exists
        const existing = await sql`
          SELECT id FROM portfolio WHERE symbol = ${pos.symbol}
        `;

        if (existing.length > 0) {
          // Update existing position
          await sql`
            UPDATE portfolio
            SET 
              quantity = ${pos.quantity},
              avg_cost = ${pos.avgCost},
              current_price = ${pos.currentPrice},
              market_value = ${pos.marketValue},
              unrealized_pnl = ${pos.unrealizedPnl},
              unrealized_pnl_percent = ${pos.quantity > 0 ? ((pos.currentPrice - pos.avgCost) / pos.avgCost * 100) : 0},
              last_trade_at = NOW(),
              updated_at = NOW()
            WHERE symbol = ${pos.symbol}
          `;
        } else {
          // Insert new position
          await sql`
            INSERT INTO portfolio (
              id, symbol, quantity, avg_cost, current_price, 
              market_value, unrealized_pnl, unrealized_pnl_percent,
              first_bought_at, last_trade_at, created_at, updated_at
            )
            VALUES (
              ${crypto.randomUUID()},
              ${pos.symbol},
              ${pos.quantity},
              ${pos.avgCost},
              ${pos.currentPrice},
              ${pos.marketValue},
              ${pos.unrealizedPnl},
              ${pos.quantity > 0 ? ((pos.currentPrice - pos.avgCost) / pos.avgCost * 100) : 0},
              NOW(),
              NOW(),
              NOW(),
              NOW()
            )
          `;
        }
      }

      // Remove closed positions (quantity = 0)
      const closedSymbols = orders
        .filter(o => o.action === "sell" && o.status === "filled")
        .map(o => o.symbol);
      
      for (const symbol of closedSymbols) {
        const stillHolding = portfolio.positions.find(p => p.symbol === symbol);
        if (!stillHolding) {
          await sql`DELETE FROM portfolio WHERE symbol = ${symbol}`;
        }
      }

      this.log(`Persisted portfolio: $${portfolio.cash.toFixed(2)} cash, ${portfolio.positions.length} positions`);
    } catch (error) {
      this.log(`Could not persist portfolio: ${(error as Error).message}`);
    }
  }

  /**
   * Persist trading decisions to database for analytics and history
   */
  private async persistDecisions(
    decisions: TradingDecision[],
    orders: OrderResult[],
    state: TradingState
  ): Promise<void> {
    for (const decision of decisions) {
      try {
        // Find matching order if executed
        const matchingOrder = orders.find(
          o => o.symbol === decision.symbol && o.status === "filled"
        );

        const decisionId = crypto.randomUUID();

        await sql`
          INSERT INTO trading_decisions (
            id, workflow_execution_id, symbol, action, quantity,
            target_price, stop_loss, take_profit, confidence, reasoning,
            technical_summary, fundamental_summary, sentiment_summary,
            executed, order_id, created_at, executed_at
          )
          VALUES (
            ${decisionId},
            ${null},
            ${decision.symbol},
            ${decision.action},
            ${decision.quantity || matchingOrder?.filledQuantity || 0},
            ${decision.targetPrice || null},
            ${decision.stopLoss || null},
            ${decision.takeProfit || null},
            ${decision.confidence},
            ${decision.reasoning},
            ${state.technical ? `${state.technical.trend} trend, ${state.technical.trendStrength}% strength` : null},
            ${state.fundamental ? `${state.fundamental.rating} rating` : null},
            ${state.sentiment ? `${state.sentiment.sentiment}, score: ${state.sentiment.overallScore.toFixed(2)}` : null},
            ${matchingOrder ? true : false},
            ${matchingOrder?.orderId || null},
            NOW(),
            ${matchingOrder ? 'NOW()' : null}
          )
        `;

        this.log(`Persisted decision: ${decision.action} ${decision.symbol}`);
      } catch (error) {
        this.log(`Could not persist decision: ${(error as Error).message}`);
      }
    }
  }

  private generateSummary(
    orders: OrderResult[],
    portfolio: NonNullable<TradingState["portfolio"]>
  ): string {
    const lines = ["## Order Execution\n"];

    // Mode indicator
    const modeEmoji = {
      test: "🧪",
      paper: "📝",
      live: "💰",
    }[this.config.mode];
    lines.push(`${modeEmoji} **Mode**: ${this.config.mode.toUpperCase()}\n`);

    // Orders
    if (orders.length === 0) {
      lines.push("No orders executed (hold decisions only).");
    } else {
      lines.push("### Orders");
      for (const order of orders) {
        const statusEmoji = {
          filled: "✅",
          partial: "⚠️",
          pending: "⏳",
          cancelled: "🚫",
          rejected: "❌",
        }[order.status];

        lines.push(
          `${statusEmoji} **${order.action.toUpperCase()}** ${order.filledQuantity} ${order.symbol} @ $${order.avgPrice.toFixed(2)}`
        );

        if (order.message) {
          lines.push(`   ${order.message}`);
        }
      }
    }

    // Portfolio summary
    lines.push("\n### Portfolio Summary");
    lines.push(`- Cash: $${portfolio.cash.toFixed(2)}`);
    lines.push(`- Positions Value: $${(portfolio.totalValue - portfolio.cash).toFixed(2)}`);
    lines.push(`- **Total Value**: $${portfolio.totalValue.toFixed(2)}`);

    // Open positions
    if (portfolio.positions.length > 0) {
      lines.push("\n### Open Positions");
      for (const pos of portfolio.positions) {
        const pnlEmoji = pos.unrealizedPnl >= 0 ? "🟢" : "🔴";
        const pnlPercent = ((pos.unrealizedPnl / (pos.avgCost * pos.quantity)) * 100).toFixed(2);
        lines.push(
          `${pnlEmoji} ${pos.symbol}: ${pos.quantity} shares @ $${pos.avgCost.toFixed(2)} ` +
            `(P&L: $${pos.unrealizedPnl.toFixed(2)} / ${pnlPercent}%)`
        );
      }
    }

    return lines.join("\n");
  }
}
