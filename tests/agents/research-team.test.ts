import { describe, it, expect, beforeEach, vi, type Mock } from "vitest";
import { ResearchTeam, executeResearch } from "../../app/src/agents/research/team";
import { createInitialState } from "../../app/src/core/state";
import type { TradingState } from "../../app/src/core/state";
import type { AgentResult } from "../../app/src/agents/base";

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
      {
        symbol: "MSFT",
        price: 380.25,
        change: -1.25,
        changePercent: -0.33,
        volume: 30000000,
        high: 382.0,
        low: 378.0,
        open: 381.0,
        previousClose: 381.5,
        marketCap: 2900000000000,
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
        headline: "Apple announces new product line",
        summary: "Apple Inc. today announced a new product line.",
        source: "reuters",
        symbols: ["AAPL"],
        sentiment: 0.6,
        publishedAt: new Date(),
        url: "https://example.com/news/1",
      },
      {
        id: "news-2",
        headline: "Microsoft earnings beat expectations",
        summary: "Microsoft reported better than expected earnings.",
        source: "wsj",
        symbols: ["MSFT"],
        sentiment: 0.8,
        publishedAt: new Date(),
        url: "https://example.com/news/2",
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
          mentionCount: 150,
          sentiment: 0.4,
          posts: [
            {
              id: "post-1",
              title: "AAPL to the moon!",
              content: "Really bullish on Apple right now",
              subreddit: "wallstreetbets",
              author: "user1",
              score: 500,
              numComments: 120,
              createdAt: new Date(),
            },
          ],
        },
        {
          platform: "reddit",
          symbol: "MSFT",
          mentionCount: 75,
          sentiment: 0.2,
          posts: [],
        },
      ],
      trendingSymbols: ["NVDA", "AAPL", "MSFT", "TSLA", "GME"],
      overallSentiment: 0.35,
    }),
    fetchSubreddit: vi.fn().mockResolvedValue([]),
  },
}));

describe("ResearchTeam", () => {
  let team: ResearchTeam;
  let initialState: TradingState;

  beforeEach(() => {
    team = new ResearchTeam();
    initialState = createInitialState({
      type: "research",
      symbols: ["AAPL", "MSFT"],
    });
  });

  describe("constructor", () => {
    it("should create with default config", () => {
      expect(team.name).toBe("Research Team");
      expect(team.type).toBe("research_team");
    });

    it("should allow custom config", () => {
      const customTeam = new ResearchTeam({
        id: "custom-team-id",
        name: "Custom Research Team",
      });
      expect(customTeam.id).toBe("custom-team-id");
      expect(customTeam.name).toBe("Custom Research Team");
    });
  });

  describe("execute", () => {
    it("should execute all research agents in parallel", async () => {
      const result = await team.execute(initialState);

      expect(result).toBeDefined();
      expect(result.goto).toBe("orchestrator");
      expect(result.update).toBeDefined();
    });

    it("should aggregate market data results", async () => {
      const result = await team.execute(initialState);

      expect(result.update.marketData).toBeDefined();
      expect(result.update.marketData).toHaveLength(2);
      expect(result.update.marketData![0].symbol).toBe("AAPL");
      expect(result.update.marketData![1].symbol).toBe("MSFT");
    });

    it("should aggregate news results", async () => {
      const result = await team.execute(initialState);

      expect(result.update.news).toBeDefined();
      expect(result.update.news!.length).toBeGreaterThan(0);
    });

    it("should aggregate social results", async () => {
      const result = await team.execute(initialState);

      expect(result.update.social).toBeDefined();
      expect(result.update.social!.mentions).toBeDefined();
      expect(result.update.social!.trendingSymbols).toBeDefined();
    });

    it("should include messages from all agents", async () => {
      const result = await team.execute(initialState);

      expect(result.update.messages).toBeDefined();
      // Should have messages from individual agents + team summary
      expect(result.update.messages!.length).toBeGreaterThan(0);
    });

    it("should include a team summary message", async () => {
      const result = await team.execute(initialState);

      const summaryMessage = result.update.messages!.find(
        (m) => m.content.includes("Research Team Summary")
      );
      expect(summaryMessage).toBeDefined();
    });
  });

  describe("error handling", () => {
    it("should continue execution if one agent fails", async () => {
      // Override market data mock to fail
      const marketDataTool = await import("../../app/src/tools/market-data");
      (marketDataTool.marketDataTool.getQuotes as Mock).mockRejectedValueOnce(
        new Error("API Error")
      );

      const result = await team.execute(initialState);

      // Should still have results from other agents
      expect(result.update.news).toBeDefined();
      expect(result.update.social).toBeDefined();

      // Should have error recorded
      expect(result.update.errors!.length).toBeGreaterThan(0);
    });

    it("should handle empty symbols gracefully", async () => {
      const emptyState = createInitialState({
        type: "research",
        symbols: [],
      });

      const result = await team.execute(emptyState);

      expect(result).toBeDefined();
      expect(result.goto).toBe("orchestrator");
    });
  });

  describe("createNode", () => {
    it("should create a node function for StateGraph", async () => {
      const nodeFunction = ResearchTeam.createNode();

      expect(typeof nodeFunction).toBe("function");

      const result = await nodeFunction(initialState);
      expect(result.goto).toBe("orchestrator");
    });
  });
});

describe("executeResearch", () => {
  it("should execute research for given symbols", async () => {
    const result = await executeResearch(["AAPL", "MSFT"]);

    expect(result).toBeDefined();
    expect(result.marketData).toBeDefined();
    expect(result.news).toBeDefined();
    expect(result.social).toBeDefined();
  });

  it("should work with custom threadId", async () => {
    const threadId = "custom-thread-123";
    const result = await executeResearch(["AAPL"], threadId);

    expect(result).toBeDefined();
  });

  it("should return errors array even when successful", async () => {
    const result = await executeResearch(["AAPL"]);

    expect(result.errors).toBeDefined();
    expect(Array.isArray(result.errors)).toBe(true);
  });

  it("should return messages array", async () => {
    const result = await executeResearch(["AAPL"]);

    expect(result.messages).toBeDefined();
    expect(Array.isArray(result.messages)).toBe(true);
  });
});

describe("ResearchTeam integration", () => {
  it("should work with real StateGraph pattern", async () => {
    // Simulate how the orchestrator would use the research team
    const state = createInitialState({
      type: "analysis",
      symbols: ["AAPL"],
    });

    const team = new ResearchTeam();
    const result = await team.execute(state);

    // After research team completes, orchestrator would use results
    const updatedState = {
      ...state,
      ...result.update,
      messages: [...state.messages, ...(result.update.messages || [])],
      errors: [...state.errors, ...(result.update.errors || [])],
    };

    expect(updatedState.marketData).toBeDefined();
    expect(updatedState.news).toBeDefined();
    expect(updatedState.social).toBeDefined();
  });

  it("should respect the supervisor pattern", async () => {
    const team = new ResearchTeam();
    const state = createInitialState({
      type: "research",
      symbols: ["NVDA", "AMD"],
    });

    const result = await team.execute(state);

    // Team should return control to orchestrator
    expect(result.goto).toBe("orchestrator");

    // All data should be aggregated
    expect(result.update.marketData).toBeDefined();
    expect(result.update.news).toBeDefined();
    expect(result.update.social).toBeDefined();
  });
});
