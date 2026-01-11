# BrokeAgent - Agent Specifications

## Agent Types Overview

```typescript
export const AgentTypeSchema = z.enum([
  // Orchestration Layer
  "orchestrator",
  
  // Research Team
  "news_analyst",
  "social_analyst", 
  "market_data_agent",
  
  // Analysis Team
  "technical_analyst",
  "fundamental_analyst",
  "sentiment_analyst",
  
  // Decision Team
  "portfolio_manager",
  "risk_manager",
  "order_executor",
  
  // Debate Agents (Optional)
  "bull_researcher",
  "bear_researcher",
]);
```

---

## Orchestration Layer

### Orchestrator (Supervisor)

**Purpose**: Central router that decides which agent(s) handle each task.

**Responsibilities**:
- Parse incoming requests
- Route to appropriate team/agent
- Aggregate results from multiple agents
- Manage workflow state
- Handle errors and retries

**Implementation Pattern**:
```typescript
interface OrchestratorConfig {
  llm: ChatModel;
  members: string[];  // Available agents/teams
}

async function orchestrator(state: TradingState): Promise<Command> {
  const systemPrompt = `You are a supervisor managing trading agents.
  Available teams: ${members.join(", ")}
  Route the task to the most appropriate team.
  Respond with: { "next": "team_name" } or { "next": "FINISH" }`;
  
  const response = await llm.invoke(state.messages);
  const { next } = parseJSON(response);
  
  if (next === "FINISH") {
    return Command({ goto: END });
  }
  return Command({ goto: next });
}
```

**Decision Criteria**:
| Task Type | Route To |
|-----------|----------|
| "Get latest news" | research_team |
| "Analyze AAPL" | analysis_team |
| "Should I buy?" | decision_team |
| "Execute trade" | order_executor |
| Complex query | Multiple teams (sequential) |

---

## Research Team

### News Analyst

**Purpose**: Fetch and summarize financial news from multiple sources.

**Data Sources**:
- FinnHub News API
- Google News RSS
- Financial Times
- Bloomberg (if available)
- Seeking Alpha

**Input**:
```typescript
interface NewsRequest {
  symbols?: string[];      // Filter by stock symbols
  timeRange?: "1h" | "24h" | "7d";
  categories?: ("earnings" | "merger" | "product" | "regulatory")[];
  limit?: number;
}
```

**Output**:
```typescript
interface NewsResult {
  articles: {
    id: string;
    headline: string;
    summary: string;
    source: string;
    symbols: string[];
    sentiment: number;      // -1 to +1
    publishedAt: Date;
    url: string;
  }[];
  overallSentiment: "bullish" | "bearish" | "neutral";
}
```

**Tools**:
- `fetchFinnhubNews(symbols, from, to)`
- `fetchGoogleNews(query)`
- `summarizeArticle(content)`

---

### Social Analyst

**Purpose**: Monitor and analyze social media sentiment.

**Data Sources**:
- Reddit (r/wallstreetbets, r/stocks, r/investing)
- Twitter/X (cashtags, financial influencers)
- Telegram (trading channels)
- StockTwits

**Input**:
```typescript
interface SocialRequest {
  symbols?: string[];
  platforms?: ("reddit" | "twitter" | "telegram")[];
  timeRange?: "1h" | "24h" | "7d";
}
```

**Output**:
```typescript
interface SocialResult {
  mentions: {
    platform: string;
    symbol: string;
    mentionCount: number;
    sentiment: number;
    topPosts: {
      content: string;
      score: number;
      url: string;
    }[];
  }[];
  trendingSymbols: string[];
  overallSentiment: number;
}
```

**Tools**:
- `fetchRedditPosts(subreddit, query)`
- `fetchTwitterMentions(cashtag)`
- `analyzeSentiment(texts)`

---

### Market Data Agent

**Purpose**: Fetch real-time and historical market data.

**Data Sources**:
- Yahoo Finance (yfinance)
- Alpha Vantage
- FinnHub
- Interactive Brokers (for live trading)

**Input**:
```typescript
interface MarketDataRequest {
  symbols: string[];
  dataTypes: ("price" | "volume" | "indicators" | "options")[];
  interval?: "1m" | "5m" | "1h" | "1d";
  period?: "1d" | "1w" | "1m" | "1y";
}
```

**Output**:
```typescript
interface MarketDataResult {
  quotes: {
    symbol: string;
    price: number;
    change: number;
    changePercent: number;
    volume: number;
    high: number;
    low: number;
    open: number;
    previousClose: number;
    marketCap?: number;
  }[];
  historical?: {
    symbol: string;
    data: OHLCV[];
  }[];
  indicators?: {
    symbol: string;
    sma20: number;
    sma50: number;
    rsi: number;
    macd: { value: number; signal: number; histogram: number };
  }[];
}
```

**Tools**:
- `getQuote(symbol)`
- `getHistoricalData(symbol, period, interval)`
- `calculateIndicators(data, indicators)`

---

## Analysis Team

### Technical Analyst

**Purpose**: Analyze price charts and technical indicators.

**Capabilities**:
- Trend analysis (moving averages, trend lines)
- Momentum indicators (RSI, MACD, Stochastic)
- Volume analysis
- Support/resistance levels
- Pattern recognition (head & shoulders, flags, etc.)

**Input**:
```typescript
interface TechnicalAnalysisRequest {
  symbol: string;
  timeframe: "1h" | "4h" | "1d" | "1w";
  indicators?: string[];
}
```

**Output**:
```typescript
interface TechnicalAnalysisResult {
  symbol: string;
  trend: "bullish" | "bearish" | "neutral";
  trendStrength: number;  // 0-100
  signals: {
    indicator: string;
    signal: "buy" | "sell" | "neutral";
    value: number;
    description: string;
  }[];
  supportLevels: number[];
  resistanceLevels: number[];
  patterns: {
    name: string;
    confidence: number;
    implication: "bullish" | "bearish";
  }[];
  recommendation: string;
}
```

---

### Fundamental Analyst

**Purpose**: Analyze company financials and valuations.

**Capabilities**:
- Financial statement analysis
- Ratio analysis (P/E, P/B, ROE, etc.)
- Earnings analysis
- Competitor comparison
- DCF valuation (simplified)

**Input**:
```typescript
interface FundamentalAnalysisRequest {
  symbol: string;
  metrics?: string[];
  compareWith?: string[];  // Competitor symbols
}
```

**Output**:
```typescript
interface FundamentalAnalysisResult {
  symbol: string;
  valuation: {
    peRatio: number;
    pbRatio: number;
    psRatio: number;
    evToEbitda: number;
    fairValue?: number;
    upside?: number;
  };
  financials: {
    revenue: number;
    revenueGrowth: number;
    netIncome: number;
    profitMargin: number;
    roe: number;
    debtToEquity: number;
  };
  earnings: {
    nextEarningsDate?: Date;
    lastEps: number;
    epsGrowth: number;
    surpriseHistory: { date: Date; surprise: number }[];
  };
  rating: "strong_buy" | "buy" | "hold" | "sell" | "strong_sell";
  reasoning: string;
}
```

---

### Sentiment Analyst

**Purpose**: Aggregate and score sentiment from all sources.

**Input**:
```typescript
interface SentimentRequest {
  symbol: string;
  sources: ("news" | "social" | "analyst")[];
}
```

**Output**:
```typescript
interface SentimentResult {
  symbol: string;
  overallScore: number;      // -1 to +1
  confidence: number;        // 0 to 1
  breakdown: {
    news: { score: number; weight: number; articles: number };
    social: { score: number; weight: number; mentions: number };
    analyst: { score: number; weight: number; ratings: number };
  };
  sentiment: "very_bearish" | "bearish" | "neutral" | "bullish" | "very_bullish";
  keyDrivers: string[];      // Top factors influencing sentiment
  recentChanges: string[];   // Notable sentiment shifts
}
```

---

## Decision Team

### Portfolio Manager

**Purpose**: Make final buy/sell/hold decisions.

**Responsibilities**:
- Synthesize all analysis inputs
- Apply investment strategy rules
- Consider portfolio constraints
- Generate actionable decisions

**Input**:
```typescript
interface DecisionRequest {
  symbol: string;
  technicalAnalysis: TechnicalAnalysisResult;
  fundamentalAnalysis: FundamentalAnalysisResult;
  sentimentAnalysis: SentimentResult;
  portfolio: Portfolio;
  strategy: TradingStrategy;
}
```

**Output**:
```typescript
interface TradingDecision {
  symbol: string;
  action: "buy" | "sell" | "hold" | "short" | "cover";
  quantity?: number;
  targetPrice?: number;
  stopLoss?: number;
  takeProfit?: number;
  confidence: number;
  reasoning: string;
  timeHorizon: "day" | "swing" | "position";
  priority: "high" | "medium" | "low";
}
```

---

### Risk Manager

**Purpose**: Assess and limit portfolio risk.

**Responsibilities**:
- Position sizing calculation
- Portfolio exposure limits
- Stop-loss recommendations
- Risk/reward analysis
- Correlation analysis

**Rules**:
```typescript
const RISK_RULES = {
  maxPositionSize: 0.10,       // 10% of portfolio per position
  maxSectorExposure: 0.30,    // 30% in any sector
  maxDailyLoss: 0.02,         // 2% daily loss limit
  minRiskReward: 2.0,         // Minimum 2:1 reward/risk
  maxCorrelation: 0.70,       // Avoid highly correlated positions
};
```

**Output**:
```typescript
interface RiskAssessment {
  approved: boolean;
  adjustedQuantity?: number;    // Reduced quantity if needed
  riskScore: number;            // 0-100 (higher = riskier)
  warnings: string[];
  stopLossRecommended: number;
  takeProfitRecommended: number;
  positionSizePercent: number;
  portfolioImpact: {
    newExposure: number;
    sectorExposure: number;
    correlationRisk: number;
  };
}
```

---

### Order Executor

**Purpose**: Execute approved trades via broker API.

**Modes**:
- `test` - Simulation only, no broker connection
- `paper` - Paper trading account
- `live` - Real money (requires confirmation)

**Input**:
```typescript
interface OrderRequest {
  symbol: string;
  action: "buy" | "sell";
  quantity: number;
  orderType: "market" | "limit" | "stop" | "stop_limit";
  limitPrice?: number;
  stopPrice?: number;
  timeInForce: "day" | "gtc" | "ioc";
}
```

**Output**:
```typescript
interface OrderResult {
  orderId: string;
  status: "pending" | "filled" | "partial" | "cancelled" | "rejected";
  filledQuantity: number;
  avgPrice: number;
  commission: number;
  timestamp: Date;
}
```

---

## Debate Agents (Optional)

### Bull Researcher

**Purpose**: Argue the bullish case for a stock.

**Approach**:
- Find positive catalysts
- Highlight growth potential
- Emphasize competitive advantages
- Minimize risks

### Bear Researcher

**Purpose**: Argue the bearish case for a stock.

**Approach**:
- Identify risks and threats
- Question valuation
- Find negative trends
- Challenge bull thesis

**Debate Flow**:
```
1. Bull presents case (3 points)
2. Bear presents counter-case (3 points)
3. Bull rebuts (2 points)
4. Bear rebuts (2 points)
5. Portfolio Manager synthesizes both views
```

---

## Agent State Schema

All agents share a common state structure:

```typescript
interface TradingState {
  // Workflow metadata
  workflowId: string;
  startedAt: Date;
  currentStep: string;
  
  // Messages (conversation history)
  messages: Message[];
  
  // Routing
  next: string;
  
  // Request context
  request: {
    type: "analysis" | "trade" | "monitor";
    symbols?: string[];
    query?: string;
  };
  
  // Research outputs
  news?: NewsResult;
  social?: SocialResult;
  marketData?: MarketDataResult;
  
  // Analysis outputs
  technical?: TechnicalAnalysisResult;
  fundamental?: FundamentalAnalysisResult;
  sentiment?: SentimentResult;
  
  // Decision outputs
  decisions?: TradingDecision[];
  riskAssessment?: RiskAssessment;
  orders?: OrderResult[];
  
  // Portfolio context
  portfolio: Portfolio;
  
  // Errors
  errors?: { agent: string; error: string }[];
}
```

---

## Agent Memory Namespaces

Each agent has access to scoped memory:

| Agent | Namespace | What it stores |
|-------|-----------|----------------|
| orchestrator | `global/routing` | Successful routing patterns |
| news_analyst | `agent/news` | Important news patterns |
| social_analyst | `agent/social` | Viral patterns, influencers |
| technical_analyst | `agent/technical` | Pattern recognition learnings |
| fundamental_analyst | `agent/fundamental` | Valuation models |
| portfolio_manager | `agent/decisions` | Past decisions & outcomes |
| risk_manager | `agent/risk` | Risk events, lessons |

---

## Next Steps

See [03-MEMORY.md](./03-MEMORY.md) for memory system implementation details.
