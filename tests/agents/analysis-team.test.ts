import { describe, it, expect, beforeEach, vi, type Mock } from "vitest";
import {
  AnalysisTeam,
  executeAnalysis,
  TechnicalAnalyst,
  SentimentAnalyst,
  FundamentalAnalyst,
} from "../../app/src/agents/analysis";
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

// Mock market data tool (for technical analysis)
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
    getHistorical: vi.fn().mockImplementation(() => {
      // Generate 250 days of mock OHLCV data
      const bars = [];
      let price = 150;
      const now = Date.now();
      for (let i = 250; i > 0; i--) {
        const change = (Math.random() - 0.48) * 5;
        price = Math.max(100, price + change);
        bars.push({
          timestamp: new Date(now - i * 24 * 60 * 60 * 1000),
          open: price - Math.random() * 2,
          high: price + Math.random() * 3,
          low: price - Math.random() * 3,
          close: price,
          volume: Math.floor(40000000 + Math.random() * 20000000),
        });
      }
      return Promise.resolve(bars);
    }),
  },
}));

// Mock fundamentals tool
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
        shareOutstanding: 15500000000,
        logo: "https://example.com/logo.png",
        weburl: "https://apple.com",
      },
      metrics: {
        symbol: "AAPL",
        peRatio: 28.5,
        pegRatio: 1.8,
        pbRatio: 45.2,
        psRatio: 7.5,
        evToEbitda: 22.1,
        evToRevenue: 8.2,
        grossMargin: 43.5,
        operatingMargin: 29.8,
        netMargin: 25.3,
        roe: 147.5,
        roa: 28.3,
        roic: 50.2,
        revenueGrowth: 8.2,
        epsGrowth: 12.5,
        dividendYield: 0.52,
        currentRatio: 1.02,
        quickRatio: 0.98,
        debtToEquity: 1.56,
        debtToAssets: 0.32,
        eps: 6.15,
        bookValuePerShare: 3.88,
        revenuePerShare: 23.45,
        freeCashFlowPerShare: 5.12,
        targetHigh: 220,
        targetLow: 160,
        targetMean: 195,
        targetMedian: 198,
        analystCount: 42,
        high52Week: 182,
        low52Week: 142,
        beta: 1.28,
      },
      recommendations: [
        {
          period: "2025-01",
          strongBuy: 15,
          buy: 20,
          hold: 8,
          sell: 1,
          strongSell: 0,
        },
      ],
      valuation: {
        rating: "fair",
        score: 55,
        reasoning: ["P/E of 28.5 is moderate", "PEG of 1.8 suggests fair value"],
      },
      quality: {
        rating: "excellent",
        score: 82,
        reasoning: ["Strong ROE of 147.5%", "Excellent net margin of 25.3%"],
      },
      overallRating: "buy",
      summary:
        "Apple Inc. (AAPL) is a Consumer Electronics company with a market cap of $2.8T.",
    }),
    getCompanyProfile: vi.fn().mockResolvedValue(null),
    getFinancialMetrics: vi.fn().mockResolvedValue({}),
    getRecommendationTrends: vi.fn().mockResolvedValue([]),
  },
}));

describe("TechnicalAnalyst", () => {
  let analyst: TechnicalAnalyst;
  let initialState: TradingState;

  beforeEach(() => {
    analyst = new TechnicalAnalyst();
    initialState = createInitialState({
      type: "analysis",
      symbols: ["AAPL"],
    });
  });

  describe("constructor", () => {
    it("should create with default config", () => {
      expect(analyst.name).toBe("Technical Analyst");
      expect(analyst.type).toBe("technical_analyst");
    });
  });

  describe("execute", () => {
    it("should analyze technical indicators", async () => {
      const result = await analyst.execute(initialState);

      expect(result).toBeDefined();
      expect(result.goto).toBe("orchestrator");
      expect(result.update.technical).toBeDefined();
    });

    it("should include trend information", async () => {
      const result = await analyst.execute(initialState);

      const technical = result.update.technical!;
      expect(technical.trend).toBeDefined();
      expect(["bullish", "bearish", "neutral"]).toContain(technical.trend);
      expect(technical.trendStrength).toBeGreaterThanOrEqual(0);
      expect(technical.trendStrength).toBeLessThanOrEqual(100);
    });

    it("should include signals", async () => {
      const result = await analyst.execute(initialState);

      const technical = result.update.technical!;
      expect(technical.signals).toBeDefined();
      expect(Array.isArray(technical.signals)).toBe(true);
    });

    it("should include support and resistance levels", async () => {
      const result = await analyst.execute(initialState);

      const technical = result.update.technical!;
      expect(technical.supportLevels).toBeDefined();
      expect(technical.resistanceLevels).toBeDefined();
    });

    it("should handle empty symbols", async () => {
      const emptyState = createInitialState({
        type: "analysis",
        symbols: [],
      });

      const result = await analyst.execute(emptyState);

      expect(result.update.errors!.length).toBeGreaterThan(0);
    });
  });
});

describe("SentimentAnalyst", () => {
  let analyst: SentimentAnalyst;
  let stateWithData: TradingState;

  beforeEach(() => {
    analyst = new SentimentAnalyst();
    stateWithData = {
      ...createInitialState({
        type: "analysis",
        symbols: ["AAPL"],
      }),
      news: [
        {
          id: "news-1",
          headline: "Apple reports record earnings",
          summary: "Strong quarter for tech giant",
          source: "reuters",
          symbols: ["AAPL"],
          sentiment: 0.7,
          publishedAt: new Date(),
        },
        {
          id: "news-2",
          headline: "Apple faces supply chain issues",
          summary: "Concerns over production",
          source: "wsj",
          symbols: ["AAPL"],
          sentiment: -0.3,
          publishedAt: new Date(),
        },
      ],
      social: {
        mentions: [
          {
            platform: "reddit",
            symbol: "AAPL",
            mentionCount: 150,
            sentiment: 0.4,
          },
        ],
        trendingSymbols: ["AAPL", "NVDA", "MSFT"],
        overallSentiment: 0.35,
      },
    };
  });

  describe("constructor", () => {
    it("should create with default config", () => {
      expect(analyst.name).toBe("Sentiment Analyst");
      expect(analyst.type).toBe("sentiment_analyst");
    });
  });

  describe("execute", () => {
    it("should analyze sentiment from news and social data", async () => {
      const result = await analyst.execute(stateWithData);

      expect(result).toBeDefined();
      expect(result.goto).toBe("orchestrator");
      expect(result.update.sentiment).toBeDefined();
    });

    it("should calculate overall sentiment score", async () => {
      const result = await analyst.execute(stateWithData);

      const sentiment = result.update.sentiment!;
      expect(sentiment.overallScore).toBeDefined();
      expect(sentiment.overallScore).toBeGreaterThanOrEqual(-1);
      expect(sentiment.overallScore).toBeLessThanOrEqual(1);
    });

    it("should include confidence level", async () => {
      const result = await analyst.execute(stateWithData);

      const sentiment = result.update.sentiment!;
      expect(sentiment.confidence).toBeDefined();
      expect(sentiment.confidence).toBeGreaterThanOrEqual(0);
      expect(sentiment.confidence).toBeLessThanOrEqual(1);
    });

    it("should include sentiment label", async () => {
      const result = await analyst.execute(stateWithData);

      const sentiment = result.update.sentiment!;
      const validLabels = [
        "very_bearish",
        "bearish",
        "neutral",
        "bullish",
        "very_bullish",
      ];
      expect(validLabels).toContain(sentiment.sentiment);
    });

    it("should identify key drivers", async () => {
      const result = await analyst.execute(stateWithData);

      const sentiment = result.update.sentiment!;
      expect(sentiment.keyDrivers).toBeDefined();
      expect(Array.isArray(sentiment.keyDrivers)).toBe(true);
    });

    it("should handle missing data gracefully", async () => {
      const emptyState = createInitialState({
        type: "analysis",
        symbols: ["AAPL"],
      });

      const result = await analyst.execute(emptyState);

      // Should still return a result with low confidence
      expect(result.update.sentiment).toBeDefined();
      expect(result.update.sentiment!.confidence).toBeLessThan(0.5);
    });
  });
});

describe("FundamentalAnalyst", () => {
  let analyst: FundamentalAnalyst;
  let initialState: TradingState;

  beforeEach(() => {
    analyst = new FundamentalAnalyst();
    initialState = createInitialState({
      type: "analysis",
      symbols: ["AAPL"],
    });
  });

  describe("constructor", () => {
    it("should create with default config", () => {
      expect(analyst.name).toBe("Fundamental Analyst");
      expect(analyst.type).toBe("fundamental_analyst");
    });
  });

  describe("execute", () => {
    it("should analyze fundamental metrics", async () => {
      const result = await analyst.execute(initialState);

      expect(result).toBeDefined();
      expect(result.goto).toBe("orchestrator");
      expect(result.update.fundamental).toBeDefined();
    });

    it("should include valuation metrics", async () => {
      const result = await analyst.execute(initialState);

      const fundamental = result.update.fundamental!;
      expect(fundamental.valuation).toBeDefined();
      expect(fundamental.valuation.peRatio).toBeDefined();
    });

    it("should include overall rating", async () => {
      const result = await analyst.execute(initialState);

      const fundamental = result.update.fundamental!;
      const validRatings = ["strong_buy", "buy", "hold", "sell", "strong_sell"];
      expect(validRatings).toContain(fundamental.rating);
    });

    it("should include reasoning", async () => {
      const result = await analyst.execute(initialState);

      const fundamental = result.update.fundamental!;
      expect(fundamental.reasoning).toBeDefined();
      expect(fundamental.reasoning.length).toBeGreaterThan(0);
    });

    it("should handle empty symbols", async () => {
      const emptyState = createInitialState({
        type: "analysis",
        symbols: [],
      });

      const result = await analyst.execute(emptyState);

      expect(result.update.errors!.length).toBeGreaterThan(0);
    });
  });
});

describe("AnalysisTeam", () => {
  let team: AnalysisTeam;
  let stateWithData: TradingState;

  beforeEach(() => {
    team = new AnalysisTeam();
    stateWithData = {
      ...createInitialState({
        type: "analysis",
        symbols: ["AAPL"],
      }),
      news: [
        {
          id: "news-1",
          headline: "Apple reports record earnings",
          source: "reuters",
          symbols: ["AAPL"],
          sentiment: 0.7,
          publishedAt: new Date(),
        },
      ],
      social: {
        mentions: [
          {
            platform: "reddit",
            symbol: "AAPL",
            mentionCount: 150,
            sentiment: 0.4,
          },
        ],
        trendingSymbols: ["AAPL"],
        overallSentiment: 0.35,
      },
    };
  });

  describe("constructor", () => {
    it("should create with default config", () => {
      expect(team.name).toBe("Analysis Team");
      expect(team.type).toBe("analysis_team");
    });

    it("should allow custom config", () => {
      const customTeam = new AnalysisTeam({
        id: "custom-analysis-team",
        name: "Custom Analysis Team",
      });
      expect(customTeam.id).toBe("custom-analysis-team");
      expect(customTeam.name).toBe("Custom Analysis Team");
    });
  });

  describe("execute", () => {
    it("should execute all analysis agents in parallel", async () => {
      const result = await team.execute(stateWithData);

      expect(result).toBeDefined();
      expect(result.goto).toBe("orchestrator");
      expect(result.update).toBeDefined();
    });

    it("should aggregate technical analysis results", async () => {
      const result = await team.execute(stateWithData);

      expect(result.update.technical).toBeDefined();
      expect(result.update.technical!.symbol).toBe("AAPL");
    });

    it("should aggregate sentiment analysis results", async () => {
      const result = await team.execute(stateWithData);

      expect(result.update.sentiment).toBeDefined();
      expect(result.update.sentiment!.symbol).toBe("AAPL");
    });

    it("should aggregate fundamental analysis results", async () => {
      const result = await team.execute(stateWithData);

      expect(result.update.fundamental).toBeDefined();
      expect(result.update.fundamental!.symbol).toBe("AAPL");
    });

    it("should include a team summary message", async () => {
      const result = await team.execute(stateWithData);

      const summaryMessage = result.update.messages!.find((m) =>
        m.content.includes("Analysis Team Summary")
      );
      expect(summaryMessage).toBeDefined();
    });

    it("should include combined rating in summary", async () => {
      const result = await team.execute(stateWithData);

      const summaryMessage = result.update.messages!.find((m) =>
        m.content.includes("Combined Rating")
      );
      expect(summaryMessage).toBeDefined();
    });
  });

  describe("error handling", () => {
    it("should continue if one agent fails", async () => {
      // Override fundamentals mock to fail
      const fundamentalsTool = await import("../../app/src/tools/fundamentals");
      (fundamentalsTool.fundamentalsTool.analyze as Mock).mockRejectedValueOnce(
        new Error("API Error")
      );

      const result = await team.execute(stateWithData);

      // Should still have results from other agents
      expect(result.update.technical).toBeDefined();
      expect(result.update.sentiment).toBeDefined();

      // Should have error recorded
      expect(result.update.errors!.length).toBeGreaterThan(0);
    });

    it("should handle empty symbols gracefully", async () => {
      const emptyState = createInitialState({
        type: "analysis",
        symbols: [],
      });

      const result = await team.execute(emptyState);

      expect(result).toBeDefined();
      expect(result.goto).toBe("orchestrator");
    });
  });

  describe("createNode", () => {
    it("should create a node function for StateGraph", async () => {
      const nodeFunction = AnalysisTeam.createNode();

      expect(typeof nodeFunction).toBe("function");

      const result = await nodeFunction(stateWithData);
      expect(result.goto).toBe("orchestrator");
    });
  });
});

describe("executeAnalysis", () => {
  it("should execute analysis for given symbols", async () => {
    const result = await executeAnalysis(["AAPL"]);

    expect(result).toBeDefined();
    expect(result.technical).toBeDefined();
    expect(result.sentiment).toBeDefined();
    expect(result.fundamental).toBeDefined();
  });

  it("should use existing state if provided", async () => {
    const existingState = {
      news: [
        {
          id: "news-1",
          headline: "Test headline",
          source: "test",
          symbols: ["AAPL"],
          sentiment: 0.5,
          publishedAt: new Date(),
        },
      ],
    };

    const result = await executeAnalysis(["AAPL"], existingState);

    expect(result).toBeDefined();
    expect(result.sentiment).toBeDefined();
  });

  it("should return errors array even when successful", async () => {
    const result = await executeAnalysis(["AAPL"]);

    expect(result.errors).toBeDefined();
    expect(Array.isArray(result.errors)).toBe(true);
  });

  it("should return messages array", async () => {
    const result = await executeAnalysis(["AAPL"]);

    expect(result.messages).toBeDefined();
    expect(Array.isArray(result.messages)).toBe(true);
  });
});

describe("AnalysisTeam integration", () => {
  it("should work with real StateGraph pattern", async () => {
    const state: TradingState = {
      ...createInitialState({
        type: "analysis",
        symbols: ["AAPL"],
      }),
      news: [
        {
          id: "news-1",
          headline: "Apple stock soars",
          source: "reuters",
          symbols: ["AAPL"],
          sentiment: 0.8,
          publishedAt: new Date(),
        },
      ],
      social: {
        mentions: [
          {
            platform: "reddit",
            symbol: "AAPL",
            mentionCount: 200,
            sentiment: 0.5,
          },
        ],
        trendingSymbols: ["AAPL"],
        overallSentiment: 0.5,
      },
    };

    const team = new AnalysisTeam();
    const result = await team.execute(state);

    // After analysis team completes, orchestrator would use results
    const updatedState = {
      ...state,
      ...result.update,
      messages: [...state.messages, ...(result.update.messages || [])],
      errors: [...state.errors, ...(result.update.errors || [])],
    };

    expect(updatedState.technical).toBeDefined();
    expect(updatedState.sentiment).toBeDefined();
    expect(updatedState.fundamental).toBeDefined();
  });

  it("should respect the supervisor pattern", async () => {
    const team = new AnalysisTeam();
    const state = createInitialState({
      type: "analysis",
      symbols: ["NVDA"],
    });

    const result = await team.execute(state);

    // Team should return control to orchestrator
    expect(result.goto).toBe("orchestrator");

    // All analysis should be aggregated
    expect(result.update.technical).toBeDefined();
    expect(result.update.sentiment).toBeDefined();
    expect(result.update.fundamental).toBeDefined();
  });
});
