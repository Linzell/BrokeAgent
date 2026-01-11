import { z } from "zod";

// ============================================
// Debate Types (for Bull/Bear analysis)
// ============================================

const BullCaseSchema = z.object({
  symbol: z.string(),
  thesis: z.string(),
  keyPoints: z.array(z.string()),
  upwardCatalysts: z.array(z.string()),
  counterToBearish: z.array(z.string()),
  priceTarget: z.object({
    target: z.number(),
    timeframe: z.string(),
    confidence: z.number(),
  }).optional(),
  riskMitigations: z.array(z.string()),
  overallConfidence: z.number(),
});

const BearCaseSchema = z.object({
  symbol: z.string(),
  thesis: z.string(),
  keyRisks: z.array(z.string()),
  downwardCatalysts: z.array(z.string()),
  counterToBullish: z.array(z.string()),
  priceTarget: z.object({
    target: z.number(),
    timeframe: z.string(),
    confidence: z.number(),
  }).optional(),
  warningSignals: z.array(z.string()),
  overallConfidence: z.number(),
});

const DebateSynthesisSchema = z.object({
  verdict: z.enum(['bullish', 'bearish', 'neutral']),
  confidence: z.number(),
  summary: z.string(),
  strongestBullPoints: z.array(z.string()),
  strongestBearPoints: z.array(z.string()),
  recommendation: z.string(),
  riskRewardRatio: z.number().optional(),
});

const DebateResultSchema = z.object({
  symbol: z.string(),
  bullCase: BullCaseSchema,
  bearCase: BearCaseSchema,
  synthesis: DebateSynthesisSchema,
});

const DebateStateSchema = z.object({
  bullCases: z.array(BullCaseSchema).optional(),
  bearCases: z.array(BearCaseSchema).optional(),
  bullSummary: z.string().optional(),
  bearSummary: z.string().optional(),
  debates: z.array(DebateResultSchema).optional(),
  finalVerdict: z.string().optional(),
}).optional();

// ============================================
// Analysis Group Schema (for easier access)
// ============================================

const AnalysisGroupSchema = z.object({
  technical: z.array(z.object({
    symbol: z.string(),
    signal: z.string(),
    confidence: z.number(),
    indicators: z.object({
      rsi: z.number().optional(),
      macd: z.object({
        histogram: z.number().optional(),
      }).optional(),
    }).optional(),
  })).optional(),
  fundamental: z.array(z.object({
    symbol: z.string(),
    rating: z.string(),
    valuation: z.string(),
    quality: z.string(),
    metrics: z.object({
      peRatio: z.number().optional(),
      debtToEquity: z.number().optional(),
      roe: z.number().optional(),
    }).optional(),
  })).optional(),
  sentiment: z.object({
    overall: z.string(),
    score: z.number(),
  }).optional(),
}).optional();

// ============================================
// Trading State Schema
// ============================================

export const TradingStateSchema = z.object({
  // Workflow metadata
  workflowId: z.string().uuid(),
  threadId: z.string(),
  startedAt: z.date(),
  currentStep: z.string(),

  // Routing
  next: z.string().optional(),

  // Request context
  request: z.object({
    type: z.enum(["analysis", "trade", "monitor", "research", "debate"]),
    symbols: z.array(z.string()).optional(),
    query: z.string().optional(),
  }),

  // Research outputs
  news: z
    .array(
      z.object({
        id: z.string(),
        headline: z.string(),
        summary: z.string().optional(),
        source: z.string(),
        symbols: z.array(z.string()),
        sentiment: z.number().nullable(),
        publishedAt: z.date(),
        url: z.string().optional(),
      }),
    )
    .optional(),

  social: z
    .object({
      mentions: z.array(
        z.object({
          platform: z.string(),
          symbol: z.string(),
          mentionCount: z.number(),
          sentiment: z.number(),
        }),
      ),
      trendingSymbols: z.array(z.string()),
      overallSentiment: z.number(),
    })
    .optional(),

  marketData: z
    .array(
      z.object({
        symbol: z.string(),
        price: z.number(),
        change: z.number(),
        changePercent: z.number(),
        volume: z.number(),
        high: z.number(),
        low: z.number(),
        open: z.number(),
        previousClose: z.number(),
        marketCap: z.number().optional(),
        high52Week: z.number().optional(),
        low52Week: z.number().optional(),
      }),
    )
    .optional(),

  // Analysis outputs
  technical: z
    .object({
      symbol: z.string(),
      trend: z.enum(["bullish", "bearish", "neutral"]),
      trendStrength: z.number(),
      signals: z.array(
        z.object({
          indicator: z.string(),
          signal: z.enum(["buy", "sell", "neutral"]),
          value: z.number(),
          description: z.string(),
        }),
      ),
      supportLevels: z.array(z.number()),
      resistanceLevels: z.array(z.number()),
      recommendation: z.string(),
    })
    .optional(),

  fundamental: z
    .object({
      symbol: z.string(),
      valuation: z.object({
        peRatio: z.number().nullable(),
        pbRatio: z.number().nullable(),
        psRatio: z.number().nullable(),
        evToEbitda: z.number().nullable(),
        fairValue: z.number().optional(),
        upside: z.number().optional(),
      }),
      rating: z.enum(["strong_buy", "buy", "hold", "sell", "strong_sell"]),
      reasoning: z.string(),
    })
    .optional(),

  sentiment: z
    .object({
      symbol: z.string(),
      overallScore: z.number(),
      confidence: z.number(),
      sentiment: z.enum([
        "very_bearish",
        "bearish",
        "neutral",
        "bullish",
        "very_bullish",
      ]),
      keyDrivers: z.array(z.string()),
    })
    .optional(),

  // Grouped analysis (for easier access in debate agents)
  analysis: AnalysisGroupSchema,

  // Debate state (Bull vs Bear)
  debateState: DebateStateSchema,

  // Decision outputs
  decisions: z
    .array(
      z.object({
        symbol: z.string(),
        action: z.enum(["buy", "sell", "hold", "short", "cover"]),
        quantity: z.number().optional(),
        targetPrice: z.number().optional(),
        stopLoss: z.number().optional(),
        takeProfit: z.number().optional(),
        confidence: z.number(),
        reasoning: z.string(),
        timeHorizon: z.enum(["day", "swing", "position"]).optional(),
        priority: z.enum(["high", "medium", "low"]).optional(),
      }),
    )
    .optional(),

  riskAssessment: z
    .object({
      approved: z.boolean(),
      adjustedQuantity: z.number().optional(),
      riskScore: z.number(),
      warnings: z.array(z.string()),
      stopLossRecommended: z.number().optional(),
      takeProfitRecommended: z.number().optional(),
    })
    .optional(),

  orders: z
    .array(
      z.object({
        orderId: z.string(),
        status: z.enum([
          "pending",
          "filled",
          "partial",
          "cancelled",
          "rejected",
        ]),
        symbol: z.string(),
        action: z.string(),
        quantity: z.number(),
        price: z.number(),
        timestamp: z.date(),
      }),
    )
    .optional(),

  // Portfolio context
  portfolio: z
    .object({
      cash: z.number(),
      totalValue: z.number(),
      positions: z.array(
        z.object({
          symbol: z.string(),
          quantity: z.number(),
          avgCost: z.number(),
          currentPrice: z.number(),
          marketValue: z.number(),
          unrealizedPnl: z.number(),
        }),
      ),
    })
    .optional(),

  // Messages (conversation history)
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant", "system", "tool"]),
        content: z.string(),
        agentId: z.string().optional(),
        toolCallId: z.string().optional(),
        timestamp: z.date(),
      }),
    )
    .default([]),

  // Errors
  errors: z
    .array(
      z.object({
        agent: z.string(),
        error: z.string(),
        timestamp: z.date(),
      }),
    )
    .default([]),
});

export type TradingState = z.infer<typeof TradingStateSchema>;

// ============================================
// Command Schema (for agent routing)
// ============================================

export const CommandSchema = z.object({
  goto: z.string(),
  update: z.record(z.string(), z.unknown()).optional(),
});

export type Command = z.infer<typeof CommandSchema>;

// ============================================
// Helper to create initial state
// ============================================

export function createInitialState(
  request: TradingState["request"],
  threadId?: string,
): TradingState {
  return {
    workflowId: crypto.randomUUID(),
    threadId: threadId || crypto.randomUUID(),
    startedAt: new Date(),
    currentStep: "start",
    request,
    messages: [],
    errors: [],
  };
}

// ============================================
// State update helper
// ============================================

export function updateState(
  state: TradingState,
  updates: Partial<TradingState>,
): TradingState {
  return {
    ...state,
    ...updates,
    messages: [...state.messages, ...(updates.messages || [])],
    errors: [...state.errors, ...(updates.errors || [])],
  };
}
