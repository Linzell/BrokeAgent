import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import {
  createTradingWorkflow,
  createResearchWorkflow,
  runResearchWorkflow,
} from "../../app/src/core/workflows";
import { createInitialState } from "../../app/src/core/state";

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
    getQuotes: vi.fn().mockResolvedValue([
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
    ]),
    getOHLCV: vi.fn().mockResolvedValue([]),
  },
}));

// Mock news tool
vi.mock("../../app/src/tools/news", () => ({
  newsTool: {
    getNewsForSymbols: vi.fn().mockResolvedValue([
      {
        id: "news-1",
        headline: "Apple announces new product",
        summary: "Apple Inc. today announced a new product.",
        source: "reuters",
        symbols: ["AAPL"],
        sentiment: 0.6,
        publishedAt: new Date(),
        url: "https://example.com/news/1",
      },
    ]),
  },
}));

// Mock social tool
vi.mock("../../app/src/tools/social", () => ({
  redditTool: {
    getSymbolMentions: vi.fn().mockResolvedValue({
      mentions: [
        {
          platform: "reddit",
          symbol: "AAPL",
          mentionCount: 100,
          sentiment: 0.3,
          posts: [],
        },
      ],
      trendingSymbols: ["NVDA", "AAPL"],
      overallSentiment: 0.25,
    }),
    fetchSubreddit: vi.fn().mockResolvedValue([]),
  },
}));

describe("Workflows", () => {
  describe("createResearchWorkflow", () => {
    it("should create a compiled research workflow", () => {
      const workflow = createResearchWorkflow();
      expect(workflow).toBeDefined();
      expect(typeof workflow.invoke).toBe("function");
    });

    it("should execute research and return results", async () => {
      const workflow = createResearchWorkflow();
      const state = createInitialState({
        type: "research",
        symbols: ["AAPL"],
      });

      const result = await workflow.invoke(state);

      expect(result).toBeDefined();
      expect(result.marketData).toBeDefined();
      expect(result.marketData).toHaveLength(1);
      expect(result.marketData![0].symbol).toBe("AAPL");
      expect(result.news).toBeDefined();
      expect(result.social).toBeDefined();
    });
  });

  describe("createTradingWorkflow", () => {
    it("should create a compiled trading workflow", () => {
      const workflow = createTradingWorkflow();
      expect(workflow).toBeDefined();
      expect(typeof workflow.invoke).toBe("function");
    });

    it("should route research requests to research team", async () => {
      const workflow = createTradingWorkflow();
      const state = createInitialState({
        type: "research",
        symbols: ["AAPL"],
      });

      const result = await workflow.invoke(state);

      // Should have market data after research team runs
      expect(result.marketData).toBeDefined();
      expect(result.news).toBeDefined();
    });
  });

  describe("runResearchWorkflow", () => {
    it("should run research workflow with symbols", async () => {
      const result = await runResearchWorkflow(["AAPL"]);

      expect(result).toBeDefined();
      expect(result.workflowId).toBeDefined();
      expect(result.threadId).toBeDefined();
      expect(result.marketData).toHaveLength(1);
    });

    it("should accept custom threadId", async () => {
      const customThreadId = "custom-thread-123";
      const result = await runResearchWorkflow(["AAPL"], customThreadId);

      expect(result.threadId).toBe(customThreadId);
    });

    it("should aggregate data from all research agents", async () => {
      const result = await runResearchWorkflow(["AAPL"]);

      // Market data from MarketDataAgent
      expect(result.marketData).toBeDefined();
      expect(result.marketData![0].symbol).toBe("AAPL");

      // News from NewsAgent
      expect(result.news).toBeDefined();
      expect(result.news!.length).toBeGreaterThan(0);

      // Social from SocialAgent
      expect(result.social).toBeDefined();
      expect(result.social!.mentions.length).toBeGreaterThan(0);
    });

    it("should include messages from agents", async () => {
      const result = await runResearchWorkflow(["AAPL"]);

      expect(result.messages).toBeDefined();
      expect(result.messages.length).toBeGreaterThan(0);

      // Should have a research team summary
      const summaryMessage = result.messages.find((m) =>
        m.content.includes("Research Team Summary")
      );
      expect(summaryMessage).toBeDefined();
    });
  });
});

describe("Workflow Integration", () => {
  it("should complete a full research cycle", async () => {
    const symbols = ["AAPL"];

    // Run research workflow
    const result = await runResearchWorkflow(symbols);

    // Verify all data was collected
    expect(result.marketData).toBeDefined();
    expect(result.news).toBeDefined();
    expect(result.social).toBeDefined();

    // Verify no errors
    expect(result.errors.length).toBe(0);

    // Verify workflow completed
    expect(result.currentStep).toBeDefined();
  });

  it("should handle multiple symbols", async () => {
    // Update mock to return multiple quotes
    const marketDataTool = await import("../../app/src/tools/market-data");
    (marketDataTool.marketDataTool.getQuotes as Mock).mockResolvedValueOnce([
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
      {
        symbol: "MSFT",
        price: 380.0,
        change: -1.0,
        changePercent: -0.26,
        volume: 30000000,
        high: 382.0,
        low: 378.0,
        open: 381.0,
        previousClose: 381.0,
        marketCap: 2900000000000,
      },
    ]);

    const result = await runResearchWorkflow(["AAPL", "MSFT"]);

    expect(result.marketData).toBeDefined();
    expect(result.marketData!.length).toBe(2);
  });
});
