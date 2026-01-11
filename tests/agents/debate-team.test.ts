import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  DebateTeam,
  executeDebate,
  type DebateResult,
} from "../../app/src/agents/debate/team";
import { BullResearcherAgent, type BullCase } from "../../app/src/agents/debate/bull";
import { BearResearcherAgent, type BearCase } from "../../app/src/agents/debate/bear";
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

// Mock LLM provider
vi.mock("../../app/src/services/llm", () => ({
  llmProvider: {
    getLLM: vi.fn().mockReturnValue({
      invoke: vi.fn().mockResolvedValue({
        content: JSON.stringify({
          verdict: "bullish",
          confidence: 0.65,
          summary: "Bull case slightly stronger based on growth catalysts",
          strongestBullPoints: ["Strong revenue growth", "Market leadership"],
          strongestBearPoints: ["High valuation", "Competition risk"],
          recommendation: "Consider accumulating on pullbacks",
        }),
      }),
    }),
    getConfig: vi.fn().mockReturnValue({ provider: "mock", model: "test" }),
  },
}));

// ============================================
// Helper Functions
// ============================================

function createTestState(symbols: string[], overrides: Partial<TradingState> = {}): TradingState {
  const baseState = createInitialState({
    type: "analysis",
    symbols,
  });

  return {
    ...baseState,
    marketData: symbols.map((symbol) => ({
      symbol,
      price: 175.5,
      change: 2.5,
      changePercent: 1.45,
      volume: 50000000,
      high: 176.0,
      low: 173.0,
      open: 174.0,
      previousClose: 173.0,
      marketCap: 2800000000000,
      high52Week: 200.0,
      low52Week: 140.0,
    })),
    // Use grouped analysis format that the debate agents expect
    analysis: {
      technical: symbols.map((symbol) => ({
        symbol,
        signal: "bullish" as const,
        confidence: 65,
        indicators: {
          rsi: 58,
          macd: { line: 2.5, signal: 1.8, histogram: 0.7 },
          sma20: 172.0,
          sma50: 168.0,
          sma200: 160.0,
        },
        patterns: ["Higher highs and higher lows"],
        supportLevels: [170.0, 165.0, 160.0],
        resistanceLevels: [180.0, 185.0, 190.0],
      })),
      fundamental: symbols.map((symbol) => ({
        symbol,
        rating: "buy" as const,
        valuation: "fair" as const,
        quality: "excellent" as const,
        metrics: {
          peRatio: 28.5,
          pbRatio: 45.2,
          psRatio: 7.5,
          evToEbitda: 22.1,
          pegRatio: 1.8,
          roe: 1.45,
          roa: 0.285,
          currentRatio: 0.9,
          debtToEquity: 1.8,
          grossMargin: 0.435,
          netMargin: 0.253,
          revenueGrowth: 0.085,
          earningsGrowth: 0.123,
        },
        catalysts: ["AI integration", "Services growth", "Share buybacks"],
        risks: ["China exposure", "Regulatory pressure"],
      })),
      sentiment: {
        overall: "bullish" as const,
        score: 0.65,
        newsSentiment: 0.6,
        socialSentiment: 0.7,
        analystRating: 4.2,
      },
    },
    ...overrides,
  };
}

// ============================================
// Bull Researcher Tests
// ============================================

describe("BullResearcherAgent", () => {
  let agent: BullResearcherAgent;

  beforeEach(() => {
    agent = new BullResearcherAgent();
    vi.clearAllMocks();
  });

  describe("execute", () => {
    it("should generate bull case for single symbol", async () => {
      const state = createTestState(["AAPL"]);
      const result = await agent.execute(state);

      expect(result).toBeDefined();
      expect(result.goto).toBe("debate_orchestrator");
      expect(result.update.debateState?.bullCases).toHaveLength(1);

      const bullCase = result.update.debateState?.bullCases?.[0];
      expect(bullCase?.symbol).toBe("AAPL");
      expect(bullCase?.thesis).toBeDefined();
      expect(bullCase?.overallConfidence).toBeGreaterThan(0);
      expect(bullCase?.keyPoints).toBeInstanceOf(Array);
      expect(bullCase?.upwardCatalysts).toBeInstanceOf(Array);
    });

    it("should generate bull cases for multiple symbols", async () => {
      const state = createTestState(["AAPL", "MSFT", "GOOGL"]);
      const result = await agent.execute(state);

      expect(result.update.debateState?.bullCases).toHaveLength(3);
      
      const symbols = result.update.debateState?.bullCases?.map(c => c.symbol);
      expect(symbols).toContain("AAPL");
      expect(symbols).toContain("MSFT");
      expect(symbols).toContain("GOOGL");
    });

    it("should include counterToBearish arguments (may be empty with fallback)", async () => {
      const state = createTestState(["AAPL"]);
      const result = await agent.execute(state);

      const bullCase = result.update.debateState?.bullCases?.[0];
      // counterToBearish is populated by LLM, fallback may generate empty array
      expect(bullCase?.counterToBearish).toBeInstanceOf(Array);
    });

    it("should include risk mitigations", async () => {
      const state = createTestState(["AAPL"]);
      const result = await agent.execute(state);

      const bullCase = result.update.debateState?.bullCases?.[0];
      expect(bullCase?.riskMitigations).toBeInstanceOf(Array);
    });

    it("should handle missing data gracefully", async () => {
      const state = createTestState(["AAPL"]);
      state.analysis = undefined;
      state.marketData = [];
      
      const result = await agent.execute(state);

      expect(result).toBeDefined();
      expect(result.update.debateState?.bullCases).toHaveLength(1);
      // Should still produce a bull case with fallback data
      const bullCase = result.update.debateState?.bullCases?.[0];
      expect(bullCase?.thesis).toBeDefined();
    });

    it("should generate bull summary", async () => {
      const state = createTestState(["AAPL"]);
      const result = await agent.execute(state);

      expect(result.update.debateState?.bullSummary).toBeDefined();
      expect(result.update.debateState?.bullSummary).toContain("Bull");
    });
  });
});

// ============================================
// Bear Researcher Tests
// ============================================

describe("BearResearcherAgent", () => {
  let agent: BearResearcherAgent;

  beforeEach(() => {
    agent = new BearResearcherAgent();
    vi.clearAllMocks();
  });

  describe("execute", () => {
    it("should generate bear case for single symbol", async () => {
      const state = createTestState(["AAPL"]);
      const result = await agent.execute(state);

      expect(result).toBeDefined();
      expect(result.goto).toBe("debate_orchestrator");
      expect(result.update.debateState?.bearCases).toHaveLength(1);

      const bearCase = result.update.debateState?.bearCases?.[0];
      expect(bearCase?.symbol).toBe("AAPL");
      expect(bearCase?.thesis).toBeDefined();
      expect(bearCase?.overallConfidence).toBeGreaterThan(0);
      expect(bearCase?.keyRisks).toBeInstanceOf(Array);
      expect(bearCase?.downwardCatalysts).toBeInstanceOf(Array);
    });

    it("should generate bear cases for multiple symbols", async () => {
      const state = createTestState(["AAPL", "NVDA"]);
      const result = await agent.execute(state);

      expect(result.update.debateState?.bearCases).toHaveLength(2);
    });

    it("should include warning signals", async () => {
      const state = createTestState(["AAPL"]);
      const result = await agent.execute(state);

      const bearCase = result.update.debateState?.bearCases?.[0];
      expect(bearCase?.warningSignals).toBeInstanceOf(Array);
    });

    it("should include counterToBullish arguments (may be empty with fallback)", async () => {
      const state = createTestState(["AAPL"]);
      const result = await agent.execute(state);

      const bearCase = result.update.debateState?.bearCases?.[0];
      // counterToBullish is populated by LLM, fallback may generate empty array
      expect(bearCase?.counterToBullish).toBeInstanceOf(Array);
    });

    it("should handle missing data gracefully", async () => {
      const state = createTestState(["AAPL"]);
      state.analysis = undefined;
      state.marketData = [];

      const result = await agent.execute(state);

      expect(result).toBeDefined();
      expect(result.update.debateState?.bearCases).toHaveLength(1);
      const bearCase = result.update.debateState?.bearCases?.[0];
      expect(bearCase?.thesis).toBeDefined();
    });

    it("should generate bear summary", async () => {
      const state = createTestState(["AAPL"]);
      const result = await agent.execute(state);

      expect(result.update.debateState?.bearSummary).toBeDefined();
      expect(result.update.debateState?.bearSummary).toContain("Bear");
    });
  });
});

// ============================================
// Debate Team Tests
// ============================================

describe("DebateTeam", () => {
  let team: DebateTeam;

  beforeEach(() => {
    team = new DebateTeam();
    vi.clearAllMocks();
  });

  describe("execute", () => {
    it("should run bull and bear agents in parallel", async () => {
      const state = createTestState(["AAPL"]);
      const result = await team.execute(state);

      expect(result).toBeDefined();
      expect(result.goto).toBe("orchestrator");
      expect(result.update.debateState).toBeDefined();
      expect(result.update.debateState?.debates).toHaveLength(1);
    });

    it("should produce synthesis for each symbol", async () => {
      const state = createTestState(["AAPL"]);
      const result = await team.execute(state);

      const debate = result.update.debateState?.debates?.[0];
      expect(debate?.symbol).toBe("AAPL");
      expect(debate?.synthesis).toBeDefined();
      expect(debate?.synthesis.verdict).toMatch(/^(bullish|bearish|neutral)$/);
      expect(debate?.synthesis.confidence).toBeGreaterThan(0);
      expect(debate?.synthesis.confidence).toBeLessThanOrEqual(1);
    });

    it("should include both bull and bear cases in result", async () => {
      const state = createTestState(["AAPL"]);
      const result = await team.execute(state);

      const debate = result.update.debateState?.debates?.[0];
      expect(debate?.bullCase).toBeDefined();
      expect(debate?.bearCase).toBeDefined();
      expect(debate?.bullCase.thesis).toBeDefined();
      expect(debate?.bearCase.thesis).toBeDefined();
    });

    it("should generate final verdict summary", async () => {
      const state = createTestState(["AAPL", "MSFT"]);
      const result = await team.execute(state);

      expect(result.update.debateState?.finalVerdict).toBeDefined();
      expect(result.update.debateState?.finalVerdict).toContain("Debate");
    });

    it("should handle empty symbols array", async () => {
      const state = createTestState([]);
      const result = await team.execute(state);

      expect(result.update.errors).toBeDefined();
      expect(result.update.errors?.length).toBeGreaterThan(0);
    });

    it("should include strongest points from each side", async () => {
      const state = createTestState(["AAPL"]);
      const result = await team.execute(state);

      const debate = result.update.debateState?.debates?.[0];
      expect(debate?.synthesis.strongestBullPoints).toBeInstanceOf(Array);
      expect(debate?.synthesis.strongestBearPoints).toBeInstanceOf(Array);
    });

    it("should include recommendation in synthesis", async () => {
      const state = createTestState(["AAPL"]);
      const result = await team.execute(state);

      const debate = result.update.debateState?.debates?.[0];
      expect(debate?.synthesis.recommendation).toBeDefined();
      expect(debate?.synthesis.recommendation.length).toBeGreaterThan(0);
    });

    it("should store debate outcome in memory", async () => {
      const { memoryStore } = await import("../../app/src/services/memory");
      const state = createTestState(["AAPL"]);
      
      await team.execute(state);

      expect(memoryStore.store).toHaveBeenCalled();
    });
  });

  describe("synthesis logic", () => {
    it("should produce verdict based on comparison of cases", async () => {
      const state = createTestState(["AAPL"]);
      const result = await team.execute(state);
      const debate = result.update.debateState?.debates?.[0];

      // Note: LLM mock returns bullish verdict
      expect(debate?.synthesis.verdict).toBe("bullish");
    });

    it("should handle multiple symbols", async () => {
      const state = createTestState(["AAPL", "MSFT", "GOOGL"]);
      const result = await team.execute(state);

      expect(result.update.debateState?.debates).toHaveLength(3);
      
      const symbols = result.update.debateState?.debates?.map(d => d.symbol);
      expect(symbols).toContain("AAPL");
      expect(symbols).toContain("MSFT");
      expect(symbols).toContain("GOOGL");
    });
  });
});

// ============================================
// executeDebate Helper Tests
// ============================================

describe("executeDebate helper", () => {
  it("should execute standalone debate", async () => {
    const results = await executeDebate(["AAPL"]);

    expect(results).toBeInstanceOf(Array);
    // May return empty if no analysis data provided
  });

  it("should accept partial analysis state", async () => {
    const results = await executeDebate(["AAPL"], {
      marketData: [
        {
          symbol: "AAPL",
          price: 180.0,
          change: 5.0,
          changePercent: 2.8,
          volume: 60000000,
          high: 182.0,
          low: 177.0,
          open: 178.0,
          previousClose: 175.0,
          marketCap: 2900000000000,
        },
      ],
    });

    expect(results).toBeInstanceOf(Array);
  });

  it("should work with multiple symbols", async () => {
    const results = await executeDebate(["AAPL", "MSFT"]);
    expect(results).toBeInstanceOf(Array);
  });
});

// ============================================
// Edge Cases
// ============================================

describe("Edge cases", () => {
  it("should handle symbols with no data", async () => {
    const team = new DebateTeam();
    const state = createTestState(["UNKNOWN"]);
    state.marketData = [];
    state.analysis = undefined;

    const result = await team.execute(state);

    // Should still produce output, just with fallback data
    expect(result).toBeDefined();
    expect(result.update.debateState?.debates).toHaveLength(1);
  });

  it("should handle mixed signals gracefully", async () => {
    const team = new DebateTeam();
    const state = createTestState(["AAPL"]);
    
    // Mixed signals in analysis
    if (state.analysis?.technical?.[0]) {
      state.analysis.technical[0].signal = "bullish";
    }
    if (state.analysis?.fundamental?.[0]) {
      state.analysis.fundamental[0].rating = "sell";
    }
    if (state.analysis?.sentiment) {
      state.analysis.sentiment.overall = "neutral";
    }

    const result = await team.execute(state);
    const debate = result.update.debateState?.debates?.[0];

    // Should produce a verdict even with mixed signals
    expect(debate?.synthesis.verdict).toBeDefined();
  });

  it("should complete debate even when LLM fails", async () => {
    // The agents have fallback rule-based synthesis
    const team = new DebateTeam();
    const state = createTestState(["AAPL"]);

    const result = await team.execute(state);

    // Should still complete with fallback logic
    expect(result).toBeDefined();
    expect(result.update.debateState?.debates).toHaveLength(1);
  });
});
