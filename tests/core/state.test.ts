import { describe, it, expect, beforeEach } from "vitest";
import {
  TradingStateSchema,
  CommandSchema,
  createInitialState,
  updateState,
  type TradingState,
} from "../../app/src/core/state";

describe("TradingState", () => {
  describe("TradingStateSchema", () => {
    it("should validate a minimal state", () => {
      const minimalState = {
        workflowId: "550e8400-e29b-41d4-a716-446655440000",
        threadId: "thread-123",
        startedAt: new Date(),
        currentStep: "start",
        request: {
          type: "analysis" as const,
        },
        messages: [],
        errors: [],
      };

      const result = TradingStateSchema.safeParse(minimalState);
      expect(result.success).toBe(true);
    });

    it("should validate a complete state with all fields", () => {
      const completeState = {
        workflowId: "550e8400-e29b-41d4-a716-446655440000",
        threadId: "thread-123",
        startedAt: new Date(),
        currentStep: "analysis",
        next: "portfolio_manager",
        request: {
          type: "trade" as const,
          symbols: ["AAPL", "GOOGL"],
          query: "Should I buy tech stocks?",
        },
        news: [
          {
            id: "news-1",
            headline: "Apple reports record earnings",
            summary: "Q4 earnings beat expectations",
            source: "Reuters",
            symbols: ["AAPL"],
            sentiment: 0.8,
            publishedAt: new Date(),
            url: "https://example.com/news",
          },
        ],
        social: {
          mentions: [
            {
              platform: "reddit",
              symbol: "AAPL",
              mentionCount: 500,
              sentiment: 0.6,
            },
          ],
          trendingSymbols: ["AAPL", "TSLA"],
          overallSentiment: 0.55,
        },
        marketData: [
          {
            symbol: "AAPL",
            price: 185.5,
            change: 2.3,
            changePercent: 1.25,
            volume: 50000000,
            high: 187.0,
            low: 183.0,
            open: 184.0,
            previousClose: 183.2,
            marketCap: 2900000000000,
          },
        ],
        technical: {
          symbol: "AAPL",
          trend: "bullish" as const,
          trendStrength: 0.75,
          signals: [
            {
              indicator: "RSI",
              signal: "buy" as const,
              value: 35,
              description: "RSI indicates oversold",
            },
          ],
          supportLevels: [180, 175, 170],
          resistanceLevels: [190, 195, 200],
          recommendation: "Buy on dips near support",
        },
        fundamental: {
          symbol: "AAPL",
          valuation: {
            peRatio: 28.5,
            pbRatio: 45.2,
            psRatio: 7.5,
            evToEbitda: 22.3,
            fairValue: 200,
            upside: 8.1,
          },
          rating: "buy" as const,
          reasoning: "Strong fundamentals with growth potential",
        },
        sentiment: {
          symbol: "AAPL",
          overallScore: 0.72,
          confidence: 0.85,
          sentiment: "bullish" as const,
          keyDrivers: ["Strong earnings", "Product launches", "Services growth"],
        },
        decisions: [
          {
            symbol: "AAPL",
            action: "buy" as const,
            quantity: 100,
            targetPrice: 195,
            stopLoss: 175,
            takeProfit: 210,
            confidence: 0.8,
            reasoning: "Technical and fundamental alignment",
            timeHorizon: "swing" as const,
            priority: "high" as const,
          },
        ],
        riskAssessment: {
          approved: true,
          adjustedQuantity: 80,
          riskScore: 0.4,
          warnings: ["High concentration in tech sector"],
          stopLossRecommended: 175,
          takeProfitRecommended: 210,
        },
        orders: [
          {
            orderId: "order-123",
            status: "pending" as const,
            symbol: "AAPL",
            action: "buy",
            quantity: 80,
            price: 185.5,
            timestamp: new Date(),
          },
        ],
        portfolio: {
          cash: 50000,
          totalValue: 150000,
          positions: [
            {
              symbol: "MSFT",
              quantity: 50,
              avgCost: 350,
              currentPrice: 380,
              marketValue: 19000,
              unrealizedPnl: 1500,
            },
          ],
        },
        messages: [
          {
            role: "user" as const,
            content: "Analyze AAPL",
            timestamp: new Date(),
          },
          {
            role: "assistant" as const,
            content: "Analysis complete",
            agentId: "agent-123",
            timestamp: new Date(),
          },
        ],
        errors: [],
      };

      const result = TradingStateSchema.safeParse(completeState);
      expect(result.success).toBe(true);
    });

    it("should reject invalid request type", () => {
      const invalidState = {
        workflowId: "550e8400-e29b-41d4-a716-446655440000",
        threadId: "thread-123",
        startedAt: new Date(),
        currentStep: "start",
        request: {
          type: "invalid_type",
        },
        messages: [],
        errors: [],
      };

      const result = TradingStateSchema.safeParse(invalidState);
      expect(result.success).toBe(false);
    });

    it("should reject invalid trend values", () => {
      const invalidState = {
        workflowId: "550e8400-e29b-41d4-a716-446655440000",
        threadId: "thread-123",
        startedAt: new Date(),
        currentStep: "start",
        request: { type: "analysis" },
        technical: {
          symbol: "AAPL",
          trend: "sideways", // Invalid - should be bullish/bearish/neutral
          trendStrength: 0.5,
          signals: [],
          supportLevels: [],
          resistanceLevels: [],
          recommendation: "Hold",
        },
        messages: [],
        errors: [],
      };

      const result = TradingStateSchema.safeParse(invalidState);
      expect(result.success).toBe(false);
    });

    it("should reject invalid action values", () => {
      const invalidState = {
        workflowId: "550e8400-e29b-41d4-a716-446655440000",
        threadId: "thread-123",
        startedAt: new Date(),
        currentStep: "start",
        request: { type: "trade" },
        decisions: [
          {
            symbol: "AAPL",
            action: "wait", // Invalid - should be buy/sell/hold/short/cover
            confidence: 0.5,
            reasoning: "Test",
          },
        ],
        messages: [],
        errors: [],
      };

      const result = TradingStateSchema.safeParse(invalidState);
      expect(result.success).toBe(false);
    });
  });

  describe("CommandSchema", () => {
    it("should validate a simple command", () => {
      const command = {
        goto: "portfolio_manager",
      };

      const result = CommandSchema.safeParse(command);
      expect(result.success).toBe(true);
    });

    it("should validate a command with updates", () => {
      const command = {
        goto: "risk_manager",
        update: {
          currentStep: "risk_assessment",
          decisions: [],
        },
      };

      const result = CommandSchema.safeParse(command);
      expect(result.success).toBe(true);
    });
  });

  describe("createInitialState", () => {
    it("should create a valid initial state for analysis", () => {
      const state = createInitialState({
        type: "analysis",
        symbols: ["AAPL"],
      });

      expect(state.workflowId).toBeDefined();
      expect(state.threadId).toBeDefined();
      expect(state.startedAt).toBeInstanceOf(Date);
      expect(state.currentStep).toBe("start");
      expect(state.request.type).toBe("analysis");
      expect(state.request.symbols).toEqual(["AAPL"]);
      expect(state.messages).toEqual([]);
      expect(state.errors).toEqual([]);
    });

    it("should create a valid initial state for trade", () => {
      const state = createInitialState({
        type: "trade",
        symbols: ["GOOGL", "META"],
        query: "Execute buy order",
      });

      expect(state.request.type).toBe("trade");
      expect(state.request.symbols).toEqual(["GOOGL", "META"]);
      expect(state.request.query).toBe("Execute buy order");
    });

    it("should use custom threadId when provided", () => {
      const customThreadId = "custom-thread-123";
      const state = createInitialState({ type: "research" }, customThreadId);

      expect(state.threadId).toBe(customThreadId);
    });

    it("should generate UUID for workflowId", () => {
      const state = createInitialState({ type: "monitor" });

      // UUID format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
      const uuidRegex =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      expect(state.workflowId).toMatch(uuidRegex);
    });
  });

  describe("updateState", () => {
    let initialState: TradingState;

    beforeEach(() => {
      initialState = createInitialState({
        type: "analysis",
        symbols: ["AAPL"],
      });
    });

    it("should update simple fields", () => {
      const updated = updateState(initialState, {
        currentStep: "technical_analysis",
        next: "fundamental_analyst",
      });

      expect(updated.currentStep).toBe("technical_analysis");
      expect(updated.next).toBe("fundamental_analyst");
      expect(updated.workflowId).toBe(initialState.workflowId);
    });

    it("should append messages", () => {
      const stateWithMessage = updateState(initialState, {
        messages: [
          {
            role: "assistant",
            content: "Starting analysis",
            timestamp: new Date(),
          },
        ],
      });

      expect(stateWithMessage.messages).toHaveLength(1);

      const finalState = updateState(stateWithMessage, {
        messages: [
          {
            role: "assistant",
            content: "Analysis complete",
            timestamp: new Date(),
          },
        ],
      });

      expect(finalState.messages).toHaveLength(2);
      expect(finalState.messages[0].content).toBe("Starting analysis");
      expect(finalState.messages[1].content).toBe("Analysis complete");
    });

    it("should append errors", () => {
      const stateWithError = updateState(initialState, {
        errors: [
          {
            agent: "technical_analyst",
            error: "API timeout",
            timestamp: new Date(),
          },
        ],
      });

      expect(stateWithError.errors).toHaveLength(1);

      const finalState = updateState(stateWithError, {
        errors: [
          {
            agent: "news_analyst",
            error: "Rate limited",
            timestamp: new Date(),
          },
        ],
      });

      expect(finalState.errors).toHaveLength(2);
    });

    it("should update complex nested fields", () => {
      const updated = updateState(initialState, {
        marketData: [
          {
            symbol: "AAPL",
            price: 185.0,
            change: 2.0,
            changePercent: 1.1,
            volume: 45000000,
            high: 186.0,
            low: 183.0,
            open: 184.0,
            previousClose: 183.0,
          },
        ],
        technical: {
          symbol: "AAPL",
          trend: "bullish",
          trendStrength: 0.7,
          signals: [],
          supportLevels: [180],
          resistanceLevels: [190],
          recommendation: "Buy",
        },
      });

      expect(updated.marketData).toBeDefined();
      expect(updated.marketData![0].symbol).toBe("AAPL");
      expect(updated.technical).toBeDefined();
      expect(updated.technical!.trend).toBe("bullish");
    });

    it("should preserve original state immutability", () => {
      const updated = updateState(initialState, {
        currentStep: "new_step",
      });

      expect(initialState.currentStep).toBe("start");
      expect(updated.currentStep).toBe("new_step");
    });
  });
});
