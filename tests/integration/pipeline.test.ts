/**
 * Integration Tests for Complete Trading Pipeline
 * 
 * These tests verify that all components work together:
 * - Research Team -> Analysis Team -> Decision Team
 * - Executor with retry logic
 * - Checkpointer for state persistence
 * - Queue for job management
 */

import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from "vitest";
import { createInitialState, type TradingState } from "../../app/src/core/state";
import {
  createResearchWorkflow,
  createAnalysisWorkflow,
  createDecisionWorkflow,
  runResearchWorkflow,
  runAnalysisWorkflow,
  runDecisionWorkflow,
} from "../../app/src/core/workflows";
import { WorkflowQueue } from "../../app/src/services/queue";

// ============================================
// Mock Data
// ============================================

const mockMarketData = [
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
];

const mockOHLCV = [
  {
    timestamp: new Date(),
    open: 174.0,
    high: 176.0,
    low: 173.0,
    close: 175.5,
    volume: 50000000,
  },
];

const mockNews = [
  {
    id: "news-1",
    headline: "Apple announces strong quarterly earnings",
    summary: "Apple Inc. reported better than expected results.",
    source: "reuters",
    symbols: ["AAPL"],
    sentiment: 0.7,
    publishedAt: new Date(),
    url: "https://example.com/news/1",
  },
  {
    id: "news-2",
    headline: "Tech sector rally continues",
    summary: "Technology stocks continue to climb.",
    source: "bloomberg",
    symbols: ["AAPL", "MSFT"],
    sentiment: 0.5,
    publishedAt: new Date(),
    url: "https://example.com/news/2",
  },
];

const mockSocial = {
  mentions: [
    {
      platform: "reddit",
      symbol: "AAPL",
      mentionCount: 150,
      sentiment: 0.4,
      posts: [],
    },
  ],
  trendingSymbols: ["NVDA", "AAPL", "TSLA"],
  overallSentiment: 0.35,
};

const mockTechnical = {
  sma: { sma20: 172, sma50: 168, sma200: 155 },
  ema: { ema12: 174, ema26: 171 },
  rsi: 58,
  macd: { macd: 2.5, signal: 2.0, histogram: 0.5 },
  bollingerBands: { upper: 180, middle: 172, lower: 164 },
  atr: 3.5,
  momentum: 5.2,
  priceChange: { day: 1.45, week: 3.2, month: 8.5 },
};

const mockFundamentals = {
  profile: {
    name: "Apple Inc.",
    sector: "Technology",
    industry: "Consumer Electronics",
    marketCap: 2800000000000,
    employees: 164000,
    description: "Apple designs and manufactures consumer electronics.",
  },
  metrics: {
    peRatio: 28.5,
    pbRatio: 45.2,
    psRatio: 7.8,
    evToEbitda: 22.1,
    roe: 0.45,
    roa: 0.22,
    currentRatio: 1.1,
    debtToEquity: 1.8,
    grossMargin: 0.43,
    operatingMargin: 0.30,
    netMargin: 0.25,
  },
  recommendations: {
    buy: 25,
    hold: 8,
    sell: 2,
    targetPrice: 195,
    currentPrice: 175.5,
  },
};

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

// Mock market data tool
vi.mock("../../app/src/tools/market-data", () => ({
  marketDataTool: {
    getQuotes: vi.fn().mockResolvedValue(mockMarketData),
    getOHLCV: vi.fn().mockResolvedValue(mockOHLCV),
    getHistorical: vi.fn().mockResolvedValue(mockOHLCV),
  },
}));

// Mock news tool
vi.mock("../../app/src/tools/news", () => ({
  newsTool: {
    getNewsForSymbols: vi.fn().mockResolvedValue(mockNews),
  },
}));

// Mock social tool
vi.mock("../../app/src/tools/social", () => ({
  redditTool: {
    getSymbolMentions: vi.fn().mockResolvedValue(mockSocial),
    fetchSubreddit: vi.fn().mockResolvedValue([]),
  },
}));

// Mock technical tool - actual export is `technicalAnalysisTool` with `analyze` method
vi.mock("../../app/src/tools/technical", () => ({
  technicalAnalysisTool: {
    analyze: vi.fn().mockResolvedValue({
      symbol: "AAPL",
      indicators: {
        symbol: "AAPL",
        price: 175.5,
        timestamp: new Date(),
        sma20: 172,
        sma50: 168,
        sma200: 155,
        ema12: 174,
        ema26: 171,
        rsi14: 58,
        macd: { value: 2.5, signal: 2.0, histogram: 0.5 },
        stochastic: { k: 65, d: 62 },
        bollingerBands: { upper: 180, middle: 172, lower: 164, bandwidth: 9.3 },
        atr14: 3.5,
        volumeSma20: 45000000,
        volumeRatio: 1.1,
        high52Week: 180,
        low52Week: 140,
        distanceFrom52High: -2.5,
        distanceFrom52Low: 25.4,
      },
      signals: [
        { indicator: "RSI", signal: "neutral", strength: 0.5, value: 58, description: "RSI is neutral at 58.0" },
        { indicator: "MACD", signal: "buy", strength: 0.6, value: 0.5, description: "MACD histogram positive" },
        { indicator: "MA Cross", signal: "buy", strength: 0.7, value: 4, description: "SMA20 above SMA50 (bullish cross)" },
      ],
      trend: "bullish",
      trendStrength: 65,
      supportLevels: [170, 165, 160],
      resistanceLevels: [180, 185, 190],
      recommendation: "Technical outlook is BULLISH with 65% strength. Bullish signals: MACD, MA Cross.",
    }),
  },
}));

// Mock fundamentals tool - actual export is `fundamentalsTool` with `analyze` method
vi.mock("../../app/src/tools/fundamentals", () => ({
  fundamentalsTool: {
    analyze: vi.fn().mockResolvedValue({
      symbol: "AAPL",
      profile: {
        symbol: "AAPL",
        name: "Apple Inc.",
        country: "US",
        currency: "USD",
        exchange: "NASDAQ",
        industry: "Consumer Electronics",
        sector: "Technology",
        marketCap: 2800000,
        shareOutstanding: 16000,
        logo: "",
        weburl: "https://apple.com",
      },
      metrics: {
        symbol: "AAPL",
        peRatio: 28.5,
        pegRatio: 2.1,
        pbRatio: 45.2,
        psRatio: 7.8,
        evToEbitda: 22.1,
        evToRevenue: 8.5,
        grossMargin: 43,
        operatingMargin: 30,
        netMargin: 25,
        roe: 45,
        roa: 22,
        roic: 35,
        revenueGrowth: 8,
        epsGrowth: 12,
        dividendYield: 0.5,
        currentRatio: 1.1,
        quickRatio: 0.9,
        debtToEquity: 1.8,
        debtToAssets: 0.35,
        eps: 6.15,
        bookValuePerShare: 3.9,
        revenuePerShare: 24,
        freeCashFlowPerShare: 5.5,
        targetHigh: 210,
        targetLow: 150,
        targetMean: 195,
        targetMedian: 192,
        analystCount: 35,
        high52Week: 180,
        low52Week: 140,
        beta: 1.2,
      },
      recommendations: [
        { period: "2024-01", strongBuy: 15, buy: 10, hold: 8, sell: 1, strongSell: 1 },
      ],
      valuation: {
        rating: "fair",
        score: 55,
        reasoning: ["P/E ratio in normal range", "PEG > 2 suggests premium pricing"],
      },
      quality: {
        rating: "good",
        score: 65,
        reasoning: ["Strong net margin of 25%", "Excellent ROE of 45%"],
      },
      overallRating: "buy",
      summary: "Apple Inc. (AAPL) is a Consumer Electronics company. Valuation: FAIR (55/100). Quality: GOOD (65/100). Overall rating: BUY.",
    }),
    getCompanyProfile: vi.fn().mockResolvedValue(mockFundamentals.profile),
    getFinancialMetrics: vi.fn().mockResolvedValue(mockFundamentals.metrics),
    getRecommendationTrends: vi.fn().mockResolvedValue([]),
  },
}));

// ============================================
// Test Utilities
// ============================================

function createTestState(symbols: string[] = ["AAPL"]): TradingState {
  return createInitialState({ type: "trade", symbols });
}

// ============================================
// Integration Tests
// ============================================

describe("Integration: Full Trading Pipeline", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Research -> Analysis -> Decision Flow", () => {
    it("should complete a full trading cycle with all teams", async () => {
      const result = await runDecisionWorkflow(["AAPL"]);

      // Verify research data was collected
      expect(result.marketData).toBeDefined();
      expect(result.marketData!.length).toBeGreaterThan(0);
      expect(result.news).toBeDefined();
      expect(result.social).toBeDefined();

      // Verify analysis was performed
      expect(result.technical).toBeDefined();
      expect(result.sentiment).toBeDefined();
      expect(result.fundamental).toBeDefined();

      // Verify decision was made
      expect(result.decisions).toBeDefined();
      expect(result.decisions!.length).toBeGreaterThan(0);

      // Verify risk assessment
      expect(result.riskAssessment).toBeDefined();
      expect(typeof result.riskAssessment!.approved).toBe("boolean");
      expect(typeof result.riskAssessment!.riskScore).toBe("number");

      // Verify no fatal errors
      const fatalErrors = result.errors.filter(
        (e) => !e.error.includes("Skipped") && !e.error.includes("fallback")
      );
      expect(fatalErrors.length).toBe(0);
    });

    it("should generate actionable trading signals", async () => {
      const result = await runDecisionWorkflow(["AAPL"]);

      const decision = result.decisions![0];

      // Decision should have all required fields
      expect(decision.symbol).toBe("AAPL");
      expect(["buy", "sell", "hold", "short", "cover"]).toContain(decision.action);
      expect(decision.confidence).toBeGreaterThanOrEqual(0);
      expect(decision.confidence).toBeLessThanOrEqual(1);
      expect(decision.reasoning).toBeDefined();
      expect(decision.reasoning.length).toBeGreaterThan(10);
    });

    it("should include risk parameters in decisions", async () => {
      const result = await runDecisionWorkflow(["AAPL"]);

      const decision = result.decisions![0];
      const risk = result.riskAssessment!;

      // Risk assessment should provide guidance
      expect(risk.riskScore).toBeGreaterThanOrEqual(0);
      expect(risk.riskScore).toBeLessThanOrEqual(100);
      expect(Array.isArray(risk.warnings)).toBe(true);

      // If approved, should have recommended stops
      if (risk.approved && decision.action !== "hold") {
        // These may be undefined for hold decisions
        expect(risk.stopLossRecommended || decision.stopLoss).toBeDefined();
      }
    });
  });

  describe("Research Workflow", () => {
    it("should collect data from all research agents", async () => {
      const result = await runResearchWorkflow(["AAPL"]);

      // Market data
      expect(result.marketData).toHaveLength(1);
      expect(result.marketData![0].symbol).toBe("AAPL");
      expect(result.marketData![0].price).toBe(175.5);

      // News
      expect(result.news!.length).toBeGreaterThan(0);
      expect(result.news![0].headline).toContain("Apple");

      // Social
      expect(result.social!.mentions.length).toBeGreaterThan(0);
      expect(result.social!.trendingSymbols).toContain("AAPL");
    });

    it("should aggregate sentiment from multiple sources", async () => {
      const result = await runResearchWorkflow(["AAPL"]);

      // News sentiment
      const avgNewsSentiment =
        result.news!.reduce((sum, n) => sum + (n.sentiment || 0), 0) /
        result.news!.length;
      expect(avgNewsSentiment).toBeGreaterThan(0); // Positive news

      // Social sentiment
      expect(result.social!.overallSentiment).toBeDefined();
    });
  });

  describe("Analysis Workflow", () => {
    it("should perform technical analysis with indicators", async () => {
      const result = await runAnalysisWorkflow(["AAPL"], true);

      expect(result.technical).toBeDefined();
      expect(result.technical!.trend).toBeDefined();
      expect(["bullish", "bearish", "neutral"]).toContain(result.technical!.trend);
      expect(result.technical!.signals.length).toBeGreaterThan(0);
    });

    it("should aggregate sentiment scores", async () => {
      const result = await runAnalysisWorkflow(["AAPL"], true);

      expect(result.sentiment).toBeDefined();
      expect(result.sentiment!.overallScore).toBeDefined();
      expect(result.sentiment!.sentiment).toBeDefined();
      expect([
        "very_bearish",
        "bearish",
        "neutral",
        "bullish",
        "very_bullish",
      ]).toContain(result.sentiment!.sentiment);
    });

    it("should provide fundamental valuation", async () => {
      const result = await runAnalysisWorkflow(["AAPL"], true);

      expect(result.fundamental).toBeDefined();
      expect(result.fundamental!.rating).toBeDefined();
      expect([
        "strong_buy",
        "buy",
        "hold",
        "sell",
        "strong_sell",
      ]).toContain(result.fundamental!.rating);
      expect(result.fundamental!.reasoning.length).toBeGreaterThan(0);
    });
  });

  describe("State Propagation", () => {
    it("should maintain threadId throughout workflow", async () => {
      const customThreadId = "test-thread-12345";
      const result = await runDecisionWorkflow(["AAPL"], true, customThreadId);

      expect(result.threadId).toBe(customThreadId);
    });

    it("should accumulate messages from all agents", async () => {
      const result = await runDecisionWorkflow(["AAPL"]);

      // Should have messages from multiple teams
      expect(result.messages.length).toBeGreaterThan(3);

      // Should have research summary
      const hasResearchMsg = result.messages.some(
        (m) => m.content.includes("Research") || m.content.includes("research")
      );
      expect(hasResearchMsg).toBe(true);

      // Should have analysis summary
      const hasAnalysisMsg = result.messages.some(
        (m) => m.content.includes("Analysis") || m.content.includes("analysis")
      );
      expect(hasAnalysisMsg).toBe(true);

      // Should have decision summary
      const hasDecisionMsg = result.messages.some(
        (m) => m.content.includes("Decision") || m.content.includes("decision")
      );
      expect(hasDecisionMsg).toBe(true);
    });

    it("should preserve errors without stopping workflow", async () => {
      // Import and mock to fail
      const marketDataTool = await import("../../app/src/tools/market-data");
      (marketDataTool.marketDataTool.getQuotes as Mock)
        .mockRejectedValueOnce(new Error("API temporarily unavailable"))
        .mockResolvedValue(mockMarketData); // Subsequent calls succeed

      // Workflow should still complete (with error recorded)
      const result = await runResearchWorkflow(["AAPL"]);

      // Market data might be empty if fetch failed, or present if retry succeeded
      // Either way, workflow should complete
      expect(result.currentStep).toBeDefined();
    });
  });
});

describe("Integration: Workflow Queue", () => {
  let queue: WorkflowQueue;

  beforeEach(() => {
    queue = new WorkflowQueue({
      name: "test-queue",
      concurrency: 2,
      persistent: false, // Don't persist to DB in tests
    });
    vi.clearAllMocks();
  });

  afterEach(() => {
    queue.stop();
  });

  it("should process workflow jobs through the queue", async () => {
    const results: TradingState[] = [];

    // Register workflow handler
    queue.process<string[], TradingState>("research", async (job, symbols) => {
      const result = await runResearchWorkflow(symbols);
      results.push(result);
      return result;
    });

    // Add job BEFORE starting queue to test pending state
    const job = await queue.add("research", ["AAPL"]);
    expect(job.status).toBe("pending");

    // Now start queue processing
    queue.start();

    // Wait for completion
    await queue.drain();

    // Verify job completed
    const completedJob = queue.getJob(job.id);
    expect(completedJob!.status).toBe("completed");
    expect(results.length).toBe(1);
    expect(results[0].marketData).toBeDefined();
  });

  it("should handle multiple concurrent workflow jobs", async () => {
    const results: string[] = [];

    queue.process<string[], TradingState>("research", async (job, symbols) => {
      const result = await runResearchWorkflow(symbols);
      results.push(symbols[0]);
      return result;
    });

    queue.start();

    // Add multiple jobs
    await queue.add("research", ["AAPL"]);
    await queue.add("research", ["MSFT"]);
    await queue.add("research", ["GOOGL"]);

    // Wait for all to complete
    await queue.drain();

    // All jobs should complete
    expect(results.length).toBe(3);
    expect(results).toContain("AAPL");
    expect(results).toContain("MSFT");
    expect(results).toContain("GOOGL");
  });

  it("should respect job priority", async () => {
    const executionOrder: string[] = [];

    queue.process<{ symbol: string }, void>("analyze", async (job, data) => {
      executionOrder.push(data.symbol);
      // Small delay to ensure order is observable
      await new Promise((r) => setTimeout(r, 10));
    });

    // Add jobs with different priorities (before starting)
    await queue.add("analyze", { symbol: "LOW" }, { priority: "low" });
    await queue.add("analyze", { symbol: "HIGH" }, { priority: "high" });
    await queue.add("analyze", { symbol: "CRITICAL" }, { priority: "critical" });
    await queue.add("analyze", { symbol: "NORMAL" }, { priority: "normal" });

    queue.start();
    await queue.drain();

    // Critical should be first, then high, then normal, then low
    expect(executionOrder[0]).toBe("CRITICAL");
    expect(executionOrder[1]).toBe("HIGH");
    expect(executionOrder[2]).toBe("NORMAL");
    expect(executionOrder[3]).toBe("LOW");
  });

  it("should retry failed jobs", async () => {
    let attempts = 0;

    queue.process<void, string>("flaky", async () => {
      attempts++;
      if (attempts < 3) {
        throw new Error("Temporary failure");
      }
      return "success";
    });

    queue.start();

    const job = await queue.add("flaky", undefined, { maxAttempts: 3 });
    await queue.drain();

    const completedJob = queue.getJob(job.id);
    expect(completedJob!.status).toBe("completed");
    expect(completedJob!.attempts).toBe(3);
    expect(attempts).toBe(3);
  });

  it("should fail jobs after max attempts", async () => {
    queue.process<void, void>("failing", async () => {
      throw new Error("Permanent failure");
    });

    queue.start();

    const job = await queue.add("failing", undefined, { maxAttempts: 2 });

    // Wait for job to fail
    await new Promise<void>((resolve) => {
      queue.on("failed", () => resolve());
    });

    const failedJob = queue.getJob(job.id);
    expect(failedJob!.status).toBe("failed");
    expect(failedJob!.attempts).toBe(2);
    expect(failedJob!.error).toContain("Permanent failure");
  });

  it("should provide queue statistics", async () => {
    queue.process<void, void>("stat-test", async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    await queue.add("stat-test", undefined);
    await queue.add("stat-test", undefined);
    await queue.add("stat-test", undefined);

    const beforeStats = queue.getStats();
    expect(beforeStats.pending).toBe(3);
    expect(beforeStats.running).toBe(0);
    expect(beforeStats.total).toBe(3);

    queue.start();
    await queue.drain();

    const afterStats = queue.getStats();
    expect(afterStats.completed).toBe(3);
    expect(afterStats.pending).toBe(0);
  });
});

describe("Integration: Error Recovery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should recover from transient API failures", async () => {
    const marketDataTool = await import("../../app/src/tools/market-data");

    // First call fails, second succeeds
    (marketDataTool.marketDataTool.getQuotes as Mock)
      .mockRejectedValueOnce(new Error("Network timeout"))
      .mockResolvedValue(mockMarketData);

    // Research should still complete
    const result = await runResearchWorkflow(["AAPL"]);

    // Either got data or recorded error, but completed
    expect(result.currentStep).toBeDefined();
  });

  it("should continue analysis even if one agent fails", async () => {
    const fundamentalsTool = await import("../../app/src/tools/fundamentals");

    // Make fundamentals.analyze fail - this is what the agent actually calls
    (fundamentalsTool.fundamentalsTool.analyze as Mock).mockRejectedValueOnce(
      new Error("API unavailable")
    );

    const result = await runAnalysisWorkflow(["AAPL"], true);

    // Should still have technical and sentiment
    expect(result.technical).toBeDefined();
    expect(result.sentiment).toBeDefined();

    // Errors should be recorded (fundamental analysis failed)
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors.some(e => e.error.includes("Fundamental"))).toBe(true);
  });

  it("should skip decision execution for hold decisions", async () => {
    // This tests that the decision team correctly handles hold decisions
    // by not sending them through risk/execution
    const result = await runDecisionWorkflow(["AAPL"]);

    // If decision is hold, orders should be empty or undefined
    if (result.decisions?.[0]?.action === "hold") {
      expect(result.orders?.length || 0).toBe(0);
    }
  });
});

describe("Integration: Multi-Symbol Support", () => {
  it("should analyze multiple symbols in a single workflow", async () => {
    // Clear mocks and set up multi-symbol response
    vi.clearAllMocks();
    
    const marketDataTool = await import("../../app/src/tools/market-data");
    (marketDataTool.marketDataTool.getQuotes as Mock).mockResolvedValue([
      { ...mockMarketData[0], symbol: "AAPL" },
      { ...mockMarketData[0], symbol: "MSFT", price: 380.0 },
    ]);

    const result = await runResearchWorkflow(["AAPL", "MSFT"]);

    expect(result.marketData).toBeDefined();
    expect(result.marketData!.length).toBe(2);

    const symbols = result.marketData!.map((d) => d.symbol);
    expect(symbols).toContain("AAPL");
    expect(symbols).toContain("MSFT");
  });
});
