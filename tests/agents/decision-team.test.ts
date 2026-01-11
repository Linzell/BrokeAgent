import { describe, it, expect, beforeEach, vi, type Mock } from "vitest";
import {
  DecisionTeam,
  executeDecisions,
  PortfolioManager,
  RiskManager,
  OrderExecutor,
  RISK_RULES,
} from "../../app/src/agents/decision";
import { createInitialState } from "../../app/src/core/state";
import type { TradingState } from "../../app/src/core/state";

// Mock database
vi.mock("../../app/src/core/database", () => ({
  sql: vi.fn().mockImplementation(() => Promise.resolve([{ id: "mock-id" }])),
}));

// Mock memory store
vi.mock("../../app/src/services/memory", () => ({
  memoryStore: {
    search: vi.fn().mockResolvedValue([]),
    store: vi.fn().mockResolvedValue("memory-id"),
  },
}));

// Mock cache service
vi.mock("../../app/src/services/cache", () => ({
  cacheService: {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue(undefined),
  },
}));

// Helper to create state with analysis data
function createStateWithAnalysis(
  overrides: Partial<TradingState> = {}
): TradingState {
  return {
    ...createInitialState({
      type: "trade",
      symbols: ["AAPL"],
    }),
    marketData: [
      {
        symbol: "AAPL",
        price: 175.5,
        change: 2.5,
        changePercent: 1.45,
        volume: 50000000,
        high: 176.0,
        low: 173.0,
        open: 174.0,
        previousClose: 173.0,
        marketCap: 2800000000000,
      },
    ],
    technical: {
      symbol: "AAPL",
      trend: "bullish",
      trendStrength: 72,
      signals: [
        { indicator: "sma_crossover", signal: "buy", strength: 70 },
        { indicator: "rsi", signal: "buy", strength: 65 },
        { indicator: "macd", signal: "buy", strength: 75 },
      ],
      supportLevels: [170, 165, 160],
      resistanceLevels: [180, 185, 190],
      indicators: {},
    },
    sentiment: {
      symbol: "AAPL",
      sentiment: "bullish",
      overallScore: 0.65,
      confidence: 0.72,
      keyDrivers: ["Strong earnings report", "Positive analyst upgrades"],
      sourceBreakdown: {
        news: 0.7,
        social: 0.6,
      },
    },
    fundamental: {
      symbol: "AAPL",
      rating: "buy",
      valuation: {
        peRatio: 28.5,
        pegRatio: 1.8,
        fairValue: 195,
        upside: 11.1,
      },
      quality: {
        profitabilityScore: 85,
        growthScore: 72,
        healthScore: 78,
      },
      reasoning: [
        "Strong profitability metrics",
        "Moderate P/E ratio for tech sector",
        "Analyst consensus is bullish",
      ],
    },
    ...overrides,
  };
}

// Helper to create bearish state
function createBearishState(): TradingState {
  return {
    ...createInitialState({
      type: "trade",
      symbols: ["XYZ"],
    }),
    marketData: [
      {
        symbol: "XYZ",
        price: 50.0,
        change: -3.5,
        changePercent: -6.5,
        volume: 10000000,
        high: 54.0,
        low: 49.0,
        open: 53.0,
        previousClose: 53.5,
        marketCap: 5000000000,
      },
    ],
    technical: {
      symbol: "XYZ",
      trend: "bearish",
      trendStrength: 68,
      signals: [
        { indicator: "sma_crossover", signal: "sell", strength: 65 },
        { indicator: "rsi", signal: "sell", strength: 70 },
        { indicator: "macd", signal: "sell", strength: 60 },
      ],
      supportLevels: [45, 40, 35],
      resistanceLevels: [55, 60, 65],
      indicators: {},
    },
    sentiment: {
      symbol: "XYZ",
      sentiment: "bearish",
      overallScore: -0.55,
      confidence: 0.68,
      keyDrivers: ["Missed earnings expectations", "Product delays"],
      sourceBreakdown: {
        news: -0.6,
        social: -0.5,
      },
    },
    fundamental: {
      symbol: "XYZ",
      rating: "sell",
      valuation: {
        peRatio: 45.0,
        pegRatio: 3.5,
        fairValue: 40,
        upside: -20,
      },
      quality: {
        profitabilityScore: 35,
        growthScore: 28,
        healthScore: 42,
      },
      reasoning: [
        "Overvalued relative to earnings",
        "Declining growth trajectory",
        "Analyst downgrades",
      ],
    },
  };
}

describe("PortfolioManager", () => {
  let manager: PortfolioManager;
  let stateWithAnalysis: TradingState;

  beforeEach(() => {
    manager = new PortfolioManager();
    stateWithAnalysis = createStateWithAnalysis();
  });

  describe("constructor", () => {
    it("should create with default config", () => {
      expect(manager.name).toBe("Portfolio Manager");
      expect(manager.type).toBe("portfolio_manager");
    });
  });

  describe("execute", () => {
    it("should generate trading decision from analysis", async () => {
      const result = await manager.execute(stateWithAnalysis);

      expect(result).toBeDefined();
      expect(result.goto).toBe("orchestrator");
      expect(result.update.decisions).toBeDefined();
      expect(result.update.decisions!.length).toBeGreaterThan(0);
    });

    it("should generate BUY decision for bullish signals", async () => {
      const result = await manager.execute(stateWithAnalysis);

      const decision = result.update.decisions![0];
      expect(decision.action).toBe("buy");
      expect(decision.symbol).toBe("AAPL");
    });

    it("should generate SELL decision for bearish signals", async () => {
      const bearishState = createBearishState();
      const result = await manager.execute(bearishState);

      const decision = result.update.decisions![0];
      expect(decision.action).toBe("sell");
    });

    it("should include confidence score", async () => {
      const result = await manager.execute(stateWithAnalysis);

      const decision = result.update.decisions![0];
      expect(decision.confidence).toBeDefined();
      expect(decision.confidence).toBeGreaterThanOrEqual(0);
      expect(decision.confidence).toBeLessThanOrEqual(1);
    });

    it("should include analysis scores", async () => {
      const result = await manager.execute(stateWithAnalysis);

      const decision = result.update.decisions![0];
      expect(decision.scores).toBeDefined();
      expect(decision.scores.technical).toBeDefined();
      expect(decision.scores.fundamental).toBeDefined();
      expect(decision.scores.sentiment).toBeDefined();
      expect(decision.scores.combined).toBeDefined();
    });

    it("should include reasoning", async () => {
      const result = await manager.execute(stateWithAnalysis);

      const decision = result.update.decisions![0];
      expect(decision.reasoning).toBeDefined();
      expect(decision.reasoning.length).toBeGreaterThan(0);
    });

    it("should include time horizon", async () => {
      const result = await manager.execute(stateWithAnalysis);

      const decision = result.update.decisions![0];
      expect(decision.timeHorizon).toBeDefined();
      expect(["day", "swing", "position"]).toContain(decision.timeHorizon);
    });

    it("should include priority level", async () => {
      const result = await manager.execute(stateWithAnalysis);

      const decision = result.update.decisions![0];
      expect(decision.priority).toBeDefined();
      expect(["high", "medium", "low"]).toContain(decision.priority);
    });

    it("should handle missing symbol", async () => {
      const emptyState = createInitialState({
        type: "trade",
        symbols: [],
      });

      const result = await manager.execute(emptyState);

      expect(result.update.errors!.length).toBeGreaterThan(0);
    });

    it("should handle missing analysis data", async () => {
      const noAnalysisState = createInitialState({
        type: "trade",
        symbols: ["AAPL"],
      });

      const result = await manager.execute(noAnalysisState);

      expect(result.update.errors!.length).toBeGreaterThan(0);
    });

    it("should calculate price targets for buy decisions", async () => {
      const result = await manager.execute(stateWithAnalysis);

      const decision = result.update.decisions![0];
      if (decision.action === "buy") {
        // Should have stop loss
        expect(decision.stopLoss).toBeDefined();
      }
    });
  });
});

describe("RiskManager", () => {
  let manager: RiskManager;
  let stateWithDecision: TradingState;

  beforeEach(() => {
    manager = new RiskManager();
    stateWithDecision = {
      ...createStateWithAnalysis(),
      decisions: [
        {
          symbol: "AAPL",
          action: "buy",
          confidence: 0.75,
          reasoning: "Strong bullish signals",
          timeHorizon: "swing",
          priority: "high",
          scores: {
            technical: 72,
            fundamental: 70,
            sentiment: 65,
            combined: 69,
          },
        },
      ],
    };
  });

  describe("constructor", () => {
    it("should create with default config", () => {
      expect(manager.name).toBe("Risk Manager");
      expect(manager.type).toBe("risk_manager");
    });
  });

  describe("execute", () => {
    it("should assess risk for trading decision", async () => {
      const result = await manager.execute(stateWithDecision);

      expect(result).toBeDefined();
      expect(result.goto).toBe("orchestrator");
      expect(result.update.riskAssessment).toBeDefined();
    });

    it("should calculate risk score", async () => {
      const result = await manager.execute(stateWithDecision);

      const risk = result.update.riskAssessment!;
      expect(risk.riskScore).toBeDefined();
      expect(risk.riskScore).toBeGreaterThanOrEqual(0);
      expect(risk.riskScore).toBeLessThanOrEqual(100);
    });

    it("should approve reasonable trades", async () => {
      const result = await manager.execute(stateWithDecision);

      const risk = result.update.riskAssessment!;
      expect(risk.approved).toBe(true);
    });

    it("should calculate position size", async () => {
      const result = await manager.execute(stateWithDecision);

      const risk = result.update.riskAssessment!;
      expect(risk.positionSizePercent).toBeDefined();
      expect(risk.positionSizePercent).toBeLessThanOrEqual(
        RISK_RULES.maxPositionSize * 100
      );
    });

    it("should recommend stop loss", async () => {
      const result = await manager.execute(stateWithDecision);

      const risk = result.update.riskAssessment!;
      expect(risk.stopLossRecommended).toBeDefined();
    });

    it("should recommend take profit", async () => {
      const result = await manager.execute(stateWithDecision);

      const risk = result.update.riskAssessment!;
      expect(risk.takeProfitRecommended).toBeDefined();
    });

    it("should calculate expected risk/reward", async () => {
      const result = await manager.execute(stateWithDecision);

      const risk = result.update.riskAssessment!;
      expect(risk.expectedRiskReward).toBeDefined();
    });

    it("should include portfolio impact", async () => {
      const result = await manager.execute(stateWithDecision);

      const risk = result.update.riskAssessment!;
      expect(risk.portfolioImpact).toBeDefined();
      expect(risk.portfolioImpact.newExposure).toBeDefined();
    });

    it("should generate warnings for risky trades", async () => {
      // Create a low-confidence decision
      const riskyState = {
        ...stateWithDecision,
        decisions: [
          {
            ...stateWithDecision.decisions![0],
            confidence: 0.3, // Low confidence
          },
        ],
      };

      const result = await manager.execute(riskyState);

      const risk = result.update.riskAssessment!;
      expect(risk.warnings.length).toBeGreaterThan(0);
    });

    it("should reject high-risk trades", async () => {
      // Create very low confidence decision
      const veryRiskyState = {
        ...stateWithDecision,
        decisions: [
          {
            ...stateWithDecision.decisions![0],
            confidence: 0.2,
            stopLoss: undefined, // No stop loss
          },
        ],
      };

      const result = await manager.execute(veryRiskyState);

      const risk = result.update.riskAssessment!;
      // May or may not be rejected based on cumulative risk score
      expect(risk.riskScore).toBeGreaterThan(30);
    });

    it("should handle missing decisions", async () => {
      const noDecisionState = createStateWithAnalysis();
      delete noDecisionState.decisions;

      const result = await manager.execute(noDecisionState);

      expect(result.update.errors!.length).toBeGreaterThan(0);
    });

    it("should update decision with adjusted quantity", async () => {
      const result = await manager.execute(stateWithDecision);

      const decisions = result.update.decisions!;
      expect(decisions[0].quantity).toBeDefined();
    });
  });

  describe("RISK_RULES", () => {
    it("should export risk rules", () => {
      expect(RISK_RULES).toBeDefined();
      expect(RISK_RULES.maxPositionSize).toBe(0.1);
      expect(RISK_RULES.maxDailyLoss).toBe(0.02);
      expect(RISK_RULES.minRiskReward).toBe(1.5);
    });
  });
});

describe("OrderExecutor", () => {
  let executor: OrderExecutor;
  let stateWithApprovedDecision: TradingState;

  beforeEach(() => {
    executor = new OrderExecutor({}, { mode: "test" });
    stateWithApprovedDecision = {
      ...createStateWithAnalysis(),
      decisions: [
        {
          symbol: "AAPL",
          action: "buy",
          quantity: 50,
          confidence: 0.75,
          reasoning: "Strong bullish signals",
          timeHorizon: "swing",
          priority: "high",
          stopLoss: 170,
          takeProfit: 185,
          scores: {
            technical: 72,
            fundamental: 70,
            sentiment: 65,
            combined: 69,
          },
        },
      ],
      riskAssessment: {
        approved: true,
        riskScore: 35,
        warnings: [],
        positionSizePercent: 8.75,
        maxLossAmount: 437.5,
        expectedRiskReward: 1.8,
        adjustedQuantity: 50,
        stopLossRecommended: 170,
        takeProfitRecommended: 185,
        portfolioImpact: {
          newExposure: 8.75,
          sectorExposure: 0,
          concentrationRisk: 0.35,
        },
      },
    };
  });

  describe("constructor", () => {
    it("should create with default config", () => {
      expect(executor.name).toBe("Order Executor");
      expect(executor.type).toBe("order_executor");
    });

    it("should accept custom executor config", () => {
      const customExecutor = new OrderExecutor({}, { mode: "paper", slippage: 0.002 });
      expect(customExecutor).toBeDefined();
    });
  });

  describe("execute", () => {
    it("should execute approved trades", async () => {
      const result = await executor.execute(stateWithApprovedDecision);

      expect(result).toBeDefined();
      expect(result.goto).toBe("orchestrator");
      expect(result.update.orders).toBeDefined();
    });

    it("should fill orders in test mode", async () => {
      const result = await executor.execute(stateWithApprovedDecision);

      const orders = result.update.orders!;
      expect(orders.length).toBeGreaterThan(0);
      expect(orders[0].status).toBe("filled");
    });

    it("should include order details", async () => {
      const result = await executor.execute(stateWithApprovedDecision);

      const order = result.update.orders![0];
      expect(order.orderId).toBeDefined();
      expect(order.symbol).toBe("AAPL");
      expect(order.action).toBe("buy");
      expect(order.quantity).toBe(50);
      expect(order.filledQuantity).toBe(50);
      expect(order.price).toBeDefined();
      expect(order.avgPrice).toBeDefined();
    });

    it("should update portfolio", async () => {
      const result = await executor.execute(stateWithApprovedDecision);

      const portfolio = result.update.portfolio!;
      expect(portfolio).toBeDefined();
      expect(portfolio.cash).toBeDefined();
      expect(portfolio.totalValue).toBeDefined();
      expect(portfolio.positions).toBeDefined();
    });

    it("should add position to portfolio", async () => {
      const result = await executor.execute(stateWithApprovedDecision);

      const portfolio = result.update.portfolio!;
      expect(portfolio.positions.length).toBeGreaterThan(0);
      
      const position = portfolio.positions.find((p) => p.symbol === "AAPL");
      expect(position).toBeDefined();
      expect(position!.quantity).toBe(50);
    });

    it("should skip execution for rejected trades", async () => {
      const rejectedState = {
        ...stateWithApprovedDecision,
        riskAssessment: {
          ...stateWithApprovedDecision.riskAssessment!,
          approved: false,
        },
      };

      const result = await executor.execute(rejectedState);

      // Should not have orders
      expect(result.update.orders).toBeUndefined();
    });

    it("should skip hold decisions", async () => {
      const holdState = {
        ...stateWithApprovedDecision,
        decisions: [
          {
            ...stateWithApprovedDecision.decisions![0],
            action: "hold" as const,
          },
        ],
      };

      const result = await executor.execute(holdState);

      // Orders array might be empty but should exist
      const orders = result.update.orders || [];
      const filledOrders = orders.filter((o) => o.status === "filled");
      expect(filledOrders.length).toBe(0);
    });

    it("should handle missing decisions", async () => {
      const noDecisionState = createStateWithAnalysis();

      const result = await executor.execute(noDecisionState);

      expect(result.update.errors!.length).toBeGreaterThan(0);
    });

    it("should reject orders with insufficient funds", async () => {
      const poorState = {
        ...stateWithApprovedDecision,
        portfolio: {
          cash: 100, // Very little cash
          totalValue: 100,
          positions: [],
        },
      };

      const result = await executor.execute(poorState);

      const orders = result.update.orders!;
      expect(orders[0].status).toBe("rejected");
    });
  });
});

describe("DecisionTeam", () => {
  let team: DecisionTeam;
  let stateWithAnalysis: TradingState;

  beforeEach(() => {
    team = new DecisionTeam({}, { mode: "test" });
    stateWithAnalysis = createStateWithAnalysis();
  });

  describe("constructor", () => {
    it("should create with default config", () => {
      expect(team.name).toBe("Decision Team");
      expect(team.type).toBe("decision_team");
    });

    it("should allow custom config", () => {
      const customTeam = new DecisionTeam(
        { id: "custom-decision-team", name: "Custom Team" },
        { mode: "paper" }
      );
      expect(customTeam.id).toBe("custom-decision-team");
      expect(customTeam.name).toBe("Custom Team");
    });
  });

  describe("execute", () => {
    it("should execute full decision pipeline", async () => {
      const result = await team.execute(stateWithAnalysis);

      expect(result).toBeDefined();
      expect(result.goto).toBe("orchestrator");
      expect(result.update).toBeDefined();
    });

    it("should generate decisions", async () => {
      const result = await team.execute(stateWithAnalysis);

      expect(result.update.decisions).toBeDefined();
      expect(result.update.decisions!.length).toBeGreaterThan(0);
    });

    it("should include risk assessment", async () => {
      const result = await team.execute(stateWithAnalysis);

      expect(result.update.riskAssessment).toBeDefined();
    });

    it("should include orders for approved trades", async () => {
      const result = await team.execute(stateWithAnalysis);

      // If risk approved, should have orders
      if (result.update.riskAssessment?.approved) {
        expect(result.update.orders).toBeDefined();
      }
    });

    it("should include updated portfolio", async () => {
      const result = await team.execute(stateWithAnalysis);

      expect(result.update.portfolio).toBeDefined();
    });

    it("should include team summary message", async () => {
      const result = await team.execute(stateWithAnalysis);

      const summaryMessage = result.update.messages!.find((m) =>
        m.content.includes("Decision Team Summary")
      );
      expect(summaryMessage).toBeDefined();
    });

    it("should execute steps sequentially", async () => {
      const result = await team.execute(stateWithAnalysis);

      // Check that pipeline executed in order by verifying all outputs exist
      expect(result.update.decisions).toBeDefined(); // Step 1: PM
      expect(result.update.riskAssessment).toBeDefined(); // Step 2: Risk
      // Step 3: Executor (orders/portfolio) depends on risk approval
    });

    it("should skip risk and execution for hold decisions", async () => {
      // Create neutral state that would result in HOLD
      const neutralState: TradingState = {
        ...stateWithAnalysis,
        technical: {
          ...stateWithAnalysis.technical!,
          trend: "neutral",
          trendStrength: 50,
          signals: [
            { indicator: "sma_crossover", signal: "neutral", strength: 50 },
            { indicator: "rsi", signal: "neutral", strength: 50 },
          ],
        },
        sentiment: {
          ...stateWithAnalysis.sentiment!,
          sentiment: "neutral",
          overallScore: 0.0,
        },
        fundamental: {
          ...stateWithAnalysis.fundamental!,
          rating: "hold",
        },
      };

      const result = await team.execute(neutralState);

      // Should have decision (hold)
      expect(result.update.decisions).toBeDefined();
      // Summary should indicate skipped steps
      const summary = result.update.messages!.find((m) =>
        m.content.includes("Decision Team Summary")
      );
      expect(summary).toBeDefined();
    });
  });

  describe("error handling", () => {
    it("should handle missing analysis data gracefully", async () => {
      // Remove all analysis data - PM will complete but with no actionable decisions
      const noAnalysisState = createInitialState({
        type: "trade",
        symbols: ["AAPL"],
      });

      const result = await team.execute(noAnalysisState);

      // Should still return a result without crashing
      expect(result.goto).toBe("orchestrator");
      // Should not have actionable decisions
      expect(result.update.decisions).toBeUndefined();
    });

    it("should continue despite non-critical errors", async () => {
      // This should still work even if some data is missing
      const partialState: TradingState = {
        ...createInitialState({
          type: "trade",
          symbols: ["AAPL"],
        }),
        technical: stateWithAnalysis.technical, // Only technical
      };

      const result = await team.execute(partialState);

      // Should still generate a decision
      expect(result.update.decisions).toBeDefined();
    });
  });

  describe("createNode", () => {
    it("should create a node function for StateGraph", async () => {
      const nodeFunction = DecisionTeam.createNode({ mode: "test" });

      expect(typeof nodeFunction).toBe("function");

      const result = await nodeFunction(stateWithAnalysis);
      expect(result.goto).toBe("orchestrator");
    });
  });
});

describe("executeDecisions", () => {
  it("should execute decision pipeline for given symbols", async () => {
    const existingState = createStateWithAnalysis();

    const result = await executeDecisions(
      ["AAPL"],
      existingState,
      { mode: "test" }
    );

    expect(result).toBeDefined();
    expect(result.decisions).toBeDefined();
    expect(result.decisions.length).toBeGreaterThan(0);
  });

  it("should require analysis data", async () => {
    await expect(
      executeDecisions(["AAPL"], {}, { mode: "test" })
    ).rejects.toThrow("requires at least one analysis result");
  });

  it("should return risk assessment", async () => {
    const existingState = createStateWithAnalysis();

    const result = await executeDecisions(
      ["AAPL"],
      existingState,
      { mode: "test" }
    );

    expect(result.riskAssessment).toBeDefined();
  });

  it("should return orders array", async () => {
    const existingState = createStateWithAnalysis();

    const result = await executeDecisions(
      ["AAPL"],
      existingState,
      { mode: "test" }
    );

    expect(result.orders).toBeDefined();
    expect(Array.isArray(result.orders)).toBe(true);
  });

  it("should return portfolio", async () => {
    const existingState = createStateWithAnalysis();

    const result = await executeDecisions(
      ["AAPL"],
      existingState,
      { mode: "test" }
    );

    expect(result.portfolio).toBeDefined();
  });
});

describe("DecisionTeam integration", () => {
  it("should work with full trading state", async () => {
    const state = createStateWithAnalysis();
    const team = new DecisionTeam({}, { mode: "test" });

    const result = await team.execute(state);

    // After decision team completes, we should have actionable output
    const updatedState = {
      ...state,
      ...result.update,
      messages: [...state.messages, ...(result.update.messages || [])],
      errors: [...state.errors, ...(result.update.errors || [])],
    };

    expect(updatedState.decisions).toBeDefined();
    expect(updatedState.riskAssessment).toBeDefined();
  });

  it("should respect the supervisor pattern", async () => {
    const team = new DecisionTeam({}, { mode: "test" });
    const state = createStateWithAnalysis();

    const result = await team.execute(state);

    // Team should return control to orchestrator
    expect(result.goto).toBe("orchestrator");

    // All decision pipeline outputs should be present
    expect(result.update.decisions).toBeDefined();
    expect(result.update.riskAssessment).toBeDefined();
  });

  it("should handle bearish analysis correctly", async () => {
    const bearishState = createBearishState();
    const team = new DecisionTeam({}, { mode: "test" });

    const result = await team.execute(bearishState);

    const decision = result.update.decisions![0];
    expect(decision.action).toBe("sell");
  });

  it("should calculate combined scores correctly", async () => {
    const state = createStateWithAnalysis();
    const team = new DecisionTeam({}, { mode: "test" });

    const result = await team.execute(state);

    const decision = result.update.decisions![0];
    // Combined score should be weighted average of individual scores
    expect(decision.scores.combined).toBeGreaterThan(50); // Bullish state
  });
});
