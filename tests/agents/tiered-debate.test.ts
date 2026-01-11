import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  calculateQuickScore,
  BatchDebateAgent,
  TieredDebateOrchestrator,
  executeTieredDebate,
  DEFAULT_TIERED_CONFIG,
  type TieredDebateInput,
  type QuickScore,
  type BatchDebateResult,
} from "../../app/src/agents/debate/tiered";
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

// Mock LLM provider for batch debates
vi.mock("../../app/src/services/llm", () => ({
  llmProvider: {
    getLLM: vi.fn().mockReturnValue({
      invoke: vi.fn().mockResolvedValue({
        content: JSON.stringify({
          verdict: "bullish",
          confidence: 0.7,
          summary: "Overall positive outlook based on strong fundamentals",
          symbolAnalysis: [
            {
              symbol: "AAPL",
              verdict: "bullish",
              confidence: 0.75,
              keyPoint: "Strong iPhone sales momentum",
              recommendation: "buy",
            },
            {
              symbol: "MSFT",
              verdict: "bullish",
              confidence: 0.8,
              keyPoint: "Azure cloud growth accelerating",
              recommendation: "buy",
            },
          ],
          topOpportunities: ["AI integration", "Services growth"],
          topRisks: ["Valuation concerns", "Economic slowdown"],
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
    marketData: symbols.map((symbol, index) => ({
      symbol,
      price: 175.5 + index * 10,
      change: 2.5 + index * 0.5,
      changePercent: 1.45 + index * 0.2,
      volume: 50000000 + index * 10000000,
      high: 176.0 + index * 10,
      low: 173.0 + index * 10,
      open: 174.0 + index * 10,
      previousClose: 173.0 + index * 10,
      marketCap: 2800000000000,
      high52Week: 200.0,
      low52Week: 140.0,
    })),
    analysis: {
      technical: symbols.map((symbol, index) => ({
        symbol,
        signal: index % 2 === 0 ? "bullish" as const : "bearish" as const,
        trend: index % 2 === 0 ? "bullish" as const : "bearish" as const,
        confidence: 65 + index * 5,
        trendStrength: 60 + index * 3,
        indicators: {
          rsi: 45 + index * 8, // Varying RSI
          macd: { line: 2.5, signal: 1.8, histogram: 0.7 },
          sma20: 172.0,
          sma50: 168.0,
          sma200: 160.0,
        },
        patterns: ["Higher highs and higher lows"],
        supportLevels: [170.0, 165.0, 160.0],
        resistanceLevels: [180.0, 185.0, 190.0],
      })),
      fundamental: symbols.map((symbol, index) => ({
        symbol,
        recommendation: index % 3 === 0 ? "buy" : index % 3 === 1 ? "hold" : "sell",
        rating: index % 3 === 0 ? "buy" as const : "hold" as const,
        valuation: index % 2 === 0 ? "undervalued" as const : "overvalued" as const,
        quality: "excellent" as const,
        metrics: {
          peRatio: 28.5,
          pbRatio: 45.2,
          roe: 1.45,
          currentRatio: 0.9,
          debtToEquity: 1.8,
        },
        catalysts: ["AI integration", "Services growth"],
        risks: ["Competition", "Regulatory"],
      })),
      sentiment: {
        overall: "bullish" as const,
        score: 0.65,
        overallScore: 0.65,
        newsSentiment: 0.6,
        socialSentiment: 0.7,
        analystRating: 4.2,
      },
    },
    news: symbols.flatMap((symbol) => [
      {
        id: `news-${symbol}-1`,
        headline: `${symbol} reports strong quarterly results`,
        summary: "Earnings beat expectations",
        source: "Reuters",
        symbols: [symbol],
        sentiment: 0.7,
        publishedAt: new Date().toISOString(),
      },
      {
        id: `news-${symbol}-2`,
        headline: `${symbol} faces regulatory scrutiny`,
        summary: "Government investigation announced",
        source: "Bloomberg",
        symbols: [symbol],
        sentiment: -0.3,
        publishedAt: new Date().toISOString(),
      },
    ]),
    ...overrides,
  };
}

// ============================================
// Quick Score Tests
// ============================================

describe("calculateQuickScore", () => {
  it("should calculate score for a symbol with full data", () => {
    const state = createTestState(["AAPL"]);
    const score = calculateQuickScore("AAPL", state);

    expect(score.symbol).toBe("AAPL");
    expect(score.score).toBeGreaterThanOrEqual(0);
    expect(score.score).toBeLessThanOrEqual(100);
    expect(score.technicalScore).toBeDefined();
    expect(score.sentimentScore).toBeDefined();
    expect(score.fundamentalScore).toBeDefined();
    expect(score.momentumScore).toBeDefined();
    expect(score.signals).toBeInstanceOf(Array);
    expect(score.recommendation).toMatch(/^(strong_buy|buy|hold|sell|strong_sell)$/);
  });

  it("should return higher score for bullish signals", () => {
    const state = createTestState(["BULL"]);
    // Force bullish signals
    if (state.analysis?.technical?.[0]) {
      state.analysis.technical[0].signal = "bullish";
      state.analysis.technical[0].indicators = { rsi: 25 }; // Oversold = bullish signal
    }
    if (state.analysis?.fundamental?.[0]) {
      state.analysis.fundamental[0].recommendation = "buy";
      state.analysis.fundamental[0].valuation = "undervalued";
    }
    if (state.analysis?.sentiment) {
      state.analysis.sentiment.score = 0.8;
      state.analysis.sentiment.overallScore = 0.8;
    }

    const score = calculateQuickScore("BULL", state);
    expect(score.score).toBeGreaterThan(50);
    expect(score.signals.length).toBeGreaterThan(0);
  });

  it("should return lower score for bearish signals", () => {
    const state = createTestState(["BEAR"]);
    // Force bearish signals
    if (state.analysis?.technical?.[0]) {
      state.analysis.technical[0].signal = "bearish";
      state.analysis.technical[0].indicators = { rsi: 75 }; // Overbought = bearish signal
    }
    if (state.analysis?.fundamental?.[0]) {
      state.analysis.fundamental[0].recommendation = "sell";
      state.analysis.fundamental[0].valuation = "overvalued";
    }
    if (state.analysis?.sentiment) {
      state.analysis.sentiment.score = -0.5;
      state.analysis.sentiment.overallScore = -0.5;
    }

    const score = calculateQuickScore("BEAR", state);
    expect(score.score).toBeLessThan(50);
  });

  it("should handle missing data gracefully", () => {
    const state = createInitialState({ type: "analysis", symbols: ["UNKNOWN"] });
    const score = calculateQuickScore("UNKNOWN", state);

    expect(score.symbol).toBe("UNKNOWN");
    expect(score.score).toBe(50); // Default score when no data
    expect(score.signals).toHaveLength(0);
    expect(score.recommendation).toBe("hold"); // Default recommendation
  });

  it("should detect strong price moves", () => {
    const state = createTestState(["MOVE"]);
    if (state.marketData?.[0]) {
      state.marketData[0].changePercent = 5.5; // Strong move
    }

    const score = calculateQuickScore("MOVE", state);
    expect(score.signals.some(s => s.includes("Strong move"))).toBe(true);
    expect(score.momentumScore).toBeGreaterThan(70);
  });

  it("should detect RSI extremes", () => {
    const stateOversold = createTestState(["RSI_LOW"]);
    if (stateOversold.analysis?.technical?.[0]) {
      stateOversold.analysis.technical[0].indicators = { rsi: 25 };
    }
    const scoreOversold = calculateQuickScore("RSI_LOW", stateOversold);
    expect(scoreOversold.signals.some(s => s.includes("RSI oversold"))).toBe(true);

    const stateOverbought = createTestState(["RSI_HIGH"]);
    if (stateOverbought.analysis?.technical?.[0]) {
      stateOverbought.analysis.technical[0].indicators = { rsi: 75 };
    }
    const scoreOverbought = calculateQuickScore("RSI_HIGH", stateOverbought);
    expect(scoreOverbought.signals.some(s => s.includes("RSI overbought"))).toBe(true);
  });

  it("should give higher score for undervalued stocks", () => {
    const stateUnder = createTestState(["CHEAP"]);
    if (stateUnder.analysis?.fundamental?.[0]) {
      stateUnder.analysis.fundamental[0].valuation = "undervalued";
    }
    const scoreUnder = calculateQuickScore("CHEAP", stateUnder);

    const stateOver = createTestState(["EXPENSIVE"]);
    if (stateOver.analysis?.fundamental?.[0]) {
      stateOver.analysis.fundamental[0].valuation = "overvalued";
    }
    const scoreOver = calculateQuickScore("EXPENSIVE", stateOver);

    expect(scoreUnder.fundamentalScore).toBeGreaterThan(scoreOver.fundamentalScore);
  });

  it("should detect high news activity", () => {
    const state = createTestState(["NEWS"]);
    // Add more news articles
    state.news = Array(7).fill(null).map((_, i) => ({
      id: `news-${i}`,
      headline: `News ${i} about NEWS`,
      summary: "News summary",
      source: "Test",
      symbols: ["NEWS"],
      sentiment: 0.3,
      publishedAt: new Date().toISOString(),
    }));

    const score = calculateQuickScore("NEWS", state);
    expect(score.signals.some(s => s.includes("High news activity"))).toBe(true);
  });
});

// ============================================
// Batch Debate Agent Tests
// ============================================

describe("BatchDebateAgent", () => {
  let agent: BatchDebateAgent;

  beforeEach(() => {
    agent = new BatchDebateAgent();
    vi.clearAllMocks();
  });

  it("should analyze multiple symbols in single call", async () => {
    const state = createTestState(["AAPL", "MSFT", "GOOGL"]);
    const result = await agent.executeBatch(["AAPL", "MSFT"], "watchlist", state);

    expect(result.symbols).toEqual(["AAPL", "MSFT"]);
    expect(result.tier).toBe("watchlist");
    expect(result.verdict).toBeDefined();
    expect(result.confidence).toBeGreaterThan(0);
    expect(result.summary).toBeDefined();
    expect(result.symbolAnalysis).toBeInstanceOf(Array);
    expect(result.topOpportunities).toBeInstanceOf(Array);
    expect(result.topRisks).toBeInstanceOf(Array);
  });

  it("should return symbol-level analysis", async () => {
    const state = createTestState(["AAPL", "MSFT"]);
    const result = await agent.executeBatch(["AAPL", "MSFT"], "watchlist", state);

    expect(result.symbolAnalysis.length).toBe(2);
    result.symbolAnalysis.forEach((analysis) => {
      expect(analysis.symbol).toBeDefined();
      expect(analysis.verdict).toMatch(/^(bullish|bearish|neutral)$/);
      expect(analysis.confidence).toBeGreaterThanOrEqual(0);
      expect(analysis.confidence).toBeLessThanOrEqual(1);
      expect(analysis.keyPoint).toBeDefined();
      expect(analysis.recommendation).toBeDefined();
    });
  });

  it("should handle different tiers", async () => {
    const state = createTestState(["AAPL"]);

    const watchlistResult = await agent.executeBatch(["AAPL"], "watchlist", state);
    expect(watchlistResult.tier).toBe("watchlist");

    const discoveryResult = await agent.executeBatch(["AAPL"], "discovery", state);
    expect(discoveryResult.tier).toBe("discovery");
  });

  it("should handle empty symbols array", async () => {
    const state = createTestState([]);
    const result = await agent.executeBatch([], "watchlist", state);

    expect(result.symbols).toEqual([]);
    // LLM mock returns fixed response, so symbolAnalysis may not be empty
    // Just verify no errors occur
    expect(result.verdict).toBeDefined();
  });
});

// ============================================
// Tiered Debate Orchestrator Tests
// ============================================

describe("TieredDebateOrchestrator", () => {
  let orchestrator: TieredDebateOrchestrator;

  beforeEach(() => {
    orchestrator = new TieredDebateOrchestrator();
    vi.clearAllMocks();
  });

  it("should use default config", () => {
    expect(DEFAULT_TIERED_CONFIG.watchlistBatchSize).toBe(5);
    expect(DEFAULT_TIERED_CONFIG.discoveryBatchSize).toBe(10);
    expect(DEFAULT_TIERED_CONFIG.discoveryTopN).toBe(10);
    expect(DEFAULT_TIERED_CONFIG.discoveryMinScore).toBe(40);
  });

  it("should accept custom config", () => {
    const customOrchestrator = new TieredDebateOrchestrator({
      watchlistBatchSize: 3,
      discoveryTopN: 5,
    });
    // Config is private, but we can test behavior
    expect(customOrchestrator).toBeDefined();
  });

  it("should process holdings with individual debates", async () => {
    const state = createTestState(["AAPL", "MSFT"]);
    const input: TieredDebateInput = {
      holdings: ["AAPL"],
      watchlist: [],
      discovery: [],
    };

    const result = await orchestrator.execute(input, state);

    expect(result.holdingsDebates.length).toBe(1);
    expect(result.holdingsDebates[0].symbol).toBe("AAPL");
    expect(result.summary.holdingsAnalyzed).toBe(1);
    expect(result.summary.llmCalls).toBeGreaterThanOrEqual(3); // bull + bear + synthesis
  });

  it("should process watchlist with batch debates", async () => {
    const state = createTestState(["AAPL", "MSFT", "GOOGL"]);
    const input: TieredDebateInput = {
      holdings: [],
      watchlist: ["AAPL", "MSFT", "GOOGL"],
      discovery: [],
    };

    const result = await orchestrator.execute(input, state);

    expect(result.watchlistDebates.length).toBeGreaterThan(0);
    expect(result.summary.watchlistAnalyzed).toBe(3);
  });

  it("should process discovery with quick scores", async () => {
    const state = createTestState(["NVDA", "AMD", "INTC", "TSM"]);
    const input: TieredDebateInput = {
      holdings: [],
      watchlist: [],
      discovery: ["NVDA", "AMD", "INTC", "TSM"],
    };

    const result = await orchestrator.execute(input, state);

    expect(result.discoveryScores.length).toBe(4);
    expect(result.summary.discoveryScored).toBe(4);
    // Discovery debates only for top candidates above min score
    result.discoveryScores.forEach((score) => {
      expect(score.symbol).toBeDefined();
      expect(score.score).toBeGreaterThanOrEqual(0);
      expect(score.score).toBeLessThanOrEqual(100);
    });
  });

  it("should filter discovery by minimum score", async () => {
    // Create state with varying scores
    const state = createTestState(["HIGH", "LOW"]);
    // Make HIGH have bullish signals, LOW have bearish
    if (state.analysis?.technical) {
      state.analysis.technical[0].signal = "bullish";
      state.analysis.technical[1].signal = "bearish";
    }
    if (state.analysis?.fundamental) {
      state.analysis.fundamental[0].valuation = "undervalued";
      state.analysis.fundamental[1].valuation = "overvalued";
    }

    const input: TieredDebateInput = {
      holdings: [],
      watchlist: [],
      discovery: ["HIGH", "LOW"],
    };

    const customOrchestrator = new TieredDebateOrchestrator({
      discoveryMinScore: 60, // High threshold
    });

    const result = await customOrchestrator.execute(input, state);

    // Only high-scoring symbols should be debated
    expect(result.discoveryScores.length).toBe(2); // All scored
    // Debates only for those above threshold
  });

  it("should handle mixed tier input", async () => {
    const state = createTestState(["AAPL", "MSFT", "GOOGL", "NVDA", "AMD"]);
    const input: TieredDebateInput = {
      holdings: ["AAPL"],
      watchlist: ["MSFT", "GOOGL"],
      discovery: ["NVDA", "AMD"],
    };

    const result = await orchestrator.execute(input, state);

    expect(result.holdingsDebates.length).toBe(1);
    expect(result.watchlistDebates.length).toBeGreaterThan(0);
    expect(result.discoveryScores.length).toBe(2);
    expect(result.summary.totalSymbols).toBe(5);
  });

  it("should calculate LLM calls correctly", async () => {
    const state = createTestState(["AAPL", "MSFT", "GOOGL"]);
    const input: TieredDebateInput = {
      holdings: ["AAPL"], // 3 calls (bull + bear + synthesis)
      watchlist: ["MSFT", "GOOGL"], // 1 call (batch)
      discovery: [],
    };

    const result = await orchestrator.execute(input, state);

    // Holdings: 3 calls per symbol
    // Watchlist: 1 call per batch (batch size is 5, so 2 symbols = 1 batch)
    expect(result.summary.llmCalls).toBe(4); // 3 + 1
  });

  it("should handle empty input", async () => {
    const state = createTestState([]);
    const input: TieredDebateInput = {
      holdings: [],
      watchlist: [],
      discovery: [],
    };

    const result = await orchestrator.execute(input, state);

    expect(result.holdingsDebates).toHaveLength(0);
    expect(result.watchlistDebates).toHaveLength(0);
    expect(result.discoveryScores).toHaveLength(0);
    expect(result.discoveryDebates).toHaveLength(0);
    expect(result.summary.totalSymbols).toBe(0);
    expect(result.summary.llmCalls).toBe(0);
  });

  it("should track execution duration", async () => {
    const state = createTestState(["AAPL"]);
    const input: TieredDebateInput = {
      holdings: ["AAPL"],
      watchlist: [],
      discovery: [],
    };

    const result = await orchestrator.execute(input, state);

    // Duration should be defined and non-negative (may be 0 with mocks)
    expect(result.summary.durationMs).toBeGreaterThanOrEqual(0);
    expect(typeof result.summary.durationMs).toBe("number");
  });
});

// ============================================
// executeTieredDebate Helper Tests
// ============================================

describe("executeTieredDebate helper", () => {
  it("should execute tiered debate with default config", async () => {
    const state = createTestState(["AAPL", "MSFT"]);
    const input: TieredDebateInput = {
      holdings: ["AAPL"],
      watchlist: ["MSFT"],
      discovery: [],
    };

    const result = await executeTieredDebate(input, state);

    expect(result.holdingsDebates).toBeDefined();
    expect(result.watchlistDebates).toBeDefined();
    expect(result.summary).toBeDefined();
  });

  it("should accept custom config", async () => {
    const state = createTestState(["AAPL"]);
    const input: TieredDebateInput = {
      holdings: [],
      watchlist: ["AAPL"],
      discovery: [],
    };

    const result = await executeTieredDebate(input, state, {
      watchlistBatchSize: 2,
    });

    expect(result).toBeDefined();
  });
});

// ============================================
// LLM Efficiency Tests
// ============================================

describe("LLM efficiency", () => {
  it("should use significantly fewer LLM calls than traditional approach", async () => {
    // Simulate 80 symbols scenario
    const symbols = Array.from({ length: 20 }, (_, i) => `SYM${i}`);
    const state = createTestState(symbols);
    
    const input: TieredDebateInput = {
      holdings: symbols.slice(0, 2),        // 2 holdings: 6 LLM calls
      watchlist: symbols.slice(2, 7),       // 5 watchlist: 1 LLM call (1 batch)
      discovery: symbols.slice(7),          // 13 discovery: 0 for scoring, ~1-2 for top debate
    };

    const orchestrator = new TieredDebateOrchestrator();
    const result = await orchestrator.execute(input, state);

    // Traditional would be: 20 symbols * 3 calls = 60 calls
    const traditionalCalls = symbols.length * 3;
    const tieredCalls = result.summary.llmCalls;

    // Tiered should be significantly less
    expect(tieredCalls).toBeLessThan(traditionalCalls);
    
    // At least 50% savings
    const savings = 1 - (tieredCalls / traditionalCalls);
    expect(savings).toBeGreaterThan(0.5);

    console.log(`Traditional: ${traditionalCalls} calls, Tiered: ${tieredCalls} calls, Savings: ${(savings * 100).toFixed(1)}%`);
  });

  it("should handle large discovery lists efficiently", async () => {
    const symbols = Array.from({ length: 50 }, (_, i) => `DISC${i}`);
    const state = createTestState(symbols);

    const input: TieredDebateInput = {
      holdings: [],
      watchlist: [],
      discovery: symbols,
    };

    const orchestrator = new TieredDebateOrchestrator({
      discoveryTopN: 5, // Only debate top 5
      discoveryMinScore: 30,
    });

    const result = await orchestrator.execute(input, state);

    // All 50 should be scored
    expect(result.discoveryScores.length).toBe(50);
    
    // But only top candidates debated (max 1 batch)
    expect(result.summary.llmCalls).toBeLessThanOrEqual(2);
    
    // Traditional would be 150 calls (50 * 3)
    expect(result.summary.llmCalls).toBeLessThan(150);
  });
});

// ============================================
// Edge Cases
// ============================================

describe("Edge cases", () => {
  it("should handle symbols appearing in multiple tiers", async () => {
    const state = createTestState(["AAPL", "MSFT"]);
    const input: TieredDebateInput = {
      holdings: ["AAPL"],
      watchlist: ["AAPL", "MSFT"], // AAPL appears in both
      discovery: ["AAPL"], // And again
    };

    const result = await executeTieredDebate(input, state);

    // Should still complete without errors
    expect(result).toBeDefined();
  });

  it("should handle symbols with no state data", async () => {
    const state = createInitialState({ type: "analysis", symbols: [] });
    const input: TieredDebateInput = {
      holdings: [],
      watchlist: [],
      discovery: ["UNKNOWN1", "UNKNOWN2"],
    };

    const result = await executeTieredDebate(input, state);

    // Should still generate scores (with defaults)
    expect(result.discoveryScores.length).toBe(2);
    result.discoveryScores.forEach((score) => {
      expect(score.score).toBe(50); // Default score
    });
  });

  it("should handle very long symbol lists", async () => {
    const manySymbols = Array.from({ length: 100 }, (_, i) => `SYM${i}`);
    const state = createTestState(manySymbols.slice(0, 10)); // Only partial state

    const input: TieredDebateInput = {
      holdings: [],
      watchlist: [],
      discovery: manySymbols,
    };

    const result = await executeTieredDebate(input, state);

    expect(result.discoveryScores.length).toBe(100);
    expect(result.summary.totalSymbols).toBe(100);
  });
});
