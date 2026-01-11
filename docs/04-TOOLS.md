# BrokeAgent - Tools and Integrations

## Overview

Tools are functions that agents can call to interact with external systems. Each tool has a defined schema for input/output validation.

## Tool Categories

```
Tools/
├── Market Data/         # Price, volume, historical data
├── News/               # Financial news sources
├── Social/             # Reddit, Twitter, Telegram
├── Fundamentals/       # Company financials
├── Technical/          # Indicators, patterns
├── Trading/            # Order execution
├── Search/             # Web search, RAG
└── Utilities/          # Calculations, formatting
```

---

## Market Data Tools

### `getQuote`

Get real-time quote for a symbol.

```typescript
const getQuoteTool = {
  name: "getQuote",
  description: "Get real-time stock quote including price, change, and volume",
  parameters: z.object({
    symbol: z.string().describe("Stock ticker symbol (e.g., AAPL)"),
  }),
  execute: async ({ symbol }) => {
    // Primary: Yahoo Finance
    const response = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d`
    );
    const data = await response.json();
    const quote = data.chart.result[0].meta;
    
    return {
      symbol,
      price: quote.regularMarketPrice,
      change: quote.regularMarketPrice - quote.previousClose,
      changePercent: ((quote.regularMarketPrice - quote.previousClose) / quote.previousClose) * 100,
      volume: quote.regularMarketVolume,
      high: quote.regularMarketDayHigh,
      low: quote.regularMarketDayLow,
      open: quote.regularMarketOpen,
      previousClose: quote.previousClose,
      marketCap: quote.marketCap,
      timestamp: new Date(),
    };
  },
};
```

### `getHistoricalData`

Get OHLCV historical data.

```typescript
const getHistoricalDataTool = {
  name: "getHistoricalData",
  description: "Get historical OHLCV data for technical analysis",
  parameters: z.object({
    symbol: z.string(),
    period: z.enum(["1d", "5d", "1mo", "3mo", "6mo", "1y", "2y", "5y"]),
    interval: z.enum(["1m", "5m", "15m", "1h", "1d", "1wk"]),
  }),
  execute: async ({ symbol, period, interval }) => {
    const response = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?period1=${getStartTimestamp(period)}&period2=${Date.now() / 1000}&interval=${interval}`
    );
    const data = await response.json();
    const result = data.chart.result[0];
    
    const timestamps = result.timestamp;
    const ohlcv = result.indicators.quote[0];
    
    return timestamps.map((ts, i) => ({
      timestamp: new Date(ts * 1000),
      open: ohlcv.open[i],
      high: ohlcv.high[i],
      low: ohlcv.low[i],
      close: ohlcv.close[i],
      volume: ohlcv.volume[i],
    }));
  },
};
```

### `getMultipleQuotes`

Batch quote retrieval.

```typescript
const getMultipleQuotesTool = {
  name: "getMultipleQuotes",
  description: "Get quotes for multiple symbols at once",
  parameters: z.object({
    symbols: z.array(z.string()).max(50),
  }),
  execute: async ({ symbols }) => {
    const symbolList = symbols.join(",");
    const response = await fetch(
      `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${symbolList}`
    );
    const data = await response.json();
    
    return data.quoteResponse.result.map(quote => ({
      symbol: quote.symbol,
      price: quote.regularMarketPrice,
      change: quote.regularMarketChange,
      changePercent: quote.regularMarketChangePercent,
      volume: quote.regularMarketVolume,
    }));
  },
};
```

---

## News Tools

### `getFinancialNews`

Fetch news from FinnHub.

```typescript
const getFinancialNewsTool = {
  name: "getFinancialNews",
  description: "Get latest financial news, optionally filtered by symbol",
  parameters: z.object({
    symbol: z.string().optional(),
    category: z.enum(["general", "forex", "crypto", "merger"]).optional(),
    minId: z.number().optional().describe("For pagination"),
  }),
  execute: async ({ symbol, category, minId }) => {
    const FINNHUB_API_KEY = process.env.FINNHUB_API_KEY;
    
    let url: string;
    if (symbol) {
      url = `https://finnhub.io/api/v1/company-news?symbol=${symbol}&from=${getDateDaysAgo(7)}&to=${getToday()}&token=${FINNHUB_API_KEY}`;
    } else {
      url = `https://finnhub.io/api/v1/news?category=${category || "general"}&minId=${minId || 0}&token=${FINNHUB_API_KEY}`;
    }
    
    const response = await fetch(url);
    const articles = await response.json();
    
    return articles.slice(0, 20).map(article => ({
      id: article.id,
      headline: article.headline,
      summary: article.summary,
      source: article.source,
      url: article.url,
      symbols: article.related?.split(",") || [],
      publishedAt: new Date(article.datetime * 1000),
      sentiment: null, // To be filled by sentiment agent
    }));
  },
};
```

### `searchNews`

Search news via Tavily.

```typescript
const searchNewsTool = {
  name: "searchNews",
  description: "Search for specific news topics using web search",
  parameters: z.object({
    query: z.string().describe("Search query for news"),
    maxResults: z.number().min(1).max(20).default(10),
  }),
  execute: async ({ query, maxResults }) => {
    const TAVILY_API_KEY = process.env.TAVILY_API_KEY;
    
    const response = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: TAVILY_API_KEY,
        query: `${query} stock market financial news`,
        search_depth: "advanced",
        include_domains: ["reuters.com", "bloomberg.com", "cnbc.com", "wsj.com", "seekingalpha.com"],
        max_results: maxResults,
      }),
    });
    
    const data = await response.json();
    
    return data.results.map(result => ({
      title: result.title,
      content: result.content,
      url: result.url,
      publishedDate: result.published_date,
      score: result.score,
    }));
  },
};
```

---

## Social Media Tools

### `getRedditPosts`

Fetch posts from trading subreddits.

```typescript
const getRedditPostsTool = {
  name: "getRedditPosts",
  description: "Get posts from Reddit trading communities",
  parameters: z.object({
    subreddit: z.enum(["wallstreetbets", "stocks", "investing", "options"]),
    sort: z.enum(["hot", "new", "top"]).default("hot"),
    limit: z.number().min(1).max(100).default(25),
    timeframe: z.enum(["hour", "day", "week"]).default("day"),
  }),
  execute: async ({ subreddit, sort, limit, timeframe }) => {
    const response = await fetch(
      `https://www.reddit.com/r/${subreddit}/${sort}.json?limit=${limit}&t=${timeframe}`,
      { headers: { "User-Agent": "BrokeAgent/1.0" } }
    );
    
    const data = await response.json();
    
    return data.data.children.map(post => ({
      id: post.data.id,
      title: post.data.title,
      selftext: post.data.selftext?.substring(0, 500),
      score: post.data.score,
      numComments: post.data.num_comments,
      url: `https://reddit.com${post.data.permalink}`,
      created: new Date(post.data.created_utc * 1000),
      // Extract stock symbols from title
      mentionedSymbols: extractSymbols(post.data.title + " " + post.data.selftext),
    }));
  },
};

function extractSymbols(text: string): string[] {
  // Match $SYMBOL or standalone 1-5 letter uppercase
  const matches = text.match(/\$[A-Z]{1,5}|\b[A-Z]{2,5}\b/g) || [];
  return [...new Set(matches.map(s => s.replace("$", "")))];
}
```

### `getTwitterMentions`

Get Twitter/X mentions for cashtags.

```typescript
const getTwitterMentionsTool = {
  name: "getTwitterMentions",
  description: "Get Twitter mentions for stock cashtags",
  parameters: z.object({
    symbol: z.string(),
    maxResults: z.number().default(50),
  }),
  execute: async ({ symbol, maxResults }) => {
    // Note: Requires Twitter API v2 access
    const TWITTER_BEARER = process.env.TWITTER_BEARER_TOKEN;
    
    const response = await fetch(
      `https://api.twitter.com/2/tweets/search/recent?query=%24${symbol}&max_results=${maxResults}&tweet.fields=created_at,public_metrics`,
      { headers: { Authorization: `Bearer ${TWITTER_BEARER}` } }
    );
    
    const data = await response.json();
    
    return {
      symbol,
      mentionCount: data.meta.result_count,
      tweets: data.data?.map(tweet => ({
        id: tweet.id,
        text: tweet.text,
        likes: tweet.public_metrics.like_count,
        retweets: tweet.public_metrics.retweet_count,
        created: tweet.created_at,
      })) || [],
    };
  },
};
```

---

## Fundamentals Tools

### `getCompanyProfile`

Get company information.

```typescript
const getCompanyProfileTool = {
  name: "getCompanyProfile",
  description: "Get company profile and basic information",
  parameters: z.object({
    symbol: z.string(),
  }),
  execute: async ({ symbol }) => {
    const FINNHUB_API_KEY = process.env.FINNHUB_API_KEY;
    
    const response = await fetch(
      `https://finnhub.io/api/v1/stock/profile2?symbol=${symbol}&token=${FINNHUB_API_KEY}`
    );
    
    return await response.json();
  },
};
```

### `getFinancials`

Get financial statements.

```typescript
const getFinancialsTool = {
  name: "getFinancials",
  description: "Get company financial statements",
  parameters: z.object({
    symbol: z.string(),
    statement: z.enum(["income", "balance", "cashflow"]),
    frequency: z.enum(["annual", "quarterly"]).default("quarterly"),
  }),
  execute: async ({ symbol, statement, frequency }) => {
    const FINNHUB_API_KEY = process.env.FINNHUB_API_KEY;
    
    const response = await fetch(
      `https://finnhub.io/api/v1/stock/financials-reported?symbol=${symbol}&freq=${frequency}&token=${FINNHUB_API_KEY}`
    );
    
    const data = await response.json();
    return data.data?.slice(0, 8) || []; // Last 8 periods
  },
};
```

### `getEarningsCalendar`

Get upcoming earnings dates.

```typescript
const getEarningsCalendarTool = {
  name: "getEarningsCalendar",
  description: "Get upcoming earnings dates for symbols",
  parameters: z.object({
    from: z.string().describe("Start date YYYY-MM-DD"),
    to: z.string().describe("End date YYYY-MM-DD"),
    symbol: z.string().optional(),
  }),
  execute: async ({ from, to, symbol }) => {
    const FINNHUB_API_KEY = process.env.FINNHUB_API_KEY;
    
    let url = `https://finnhub.io/api/v1/calendar/earnings?from=${from}&to=${to}&token=${FINNHUB_API_KEY}`;
    if (symbol) {
      url += `&symbol=${symbol}`;
    }
    
    const response = await fetch(url);
    const data = await response.json();
    
    return data.earningsCalendar || [];
  },
};
```

---

## Technical Analysis Tools

### `calculateIndicators`

Calculate technical indicators.

```typescript
const calculateIndicatorsTool = {
  name: "calculateIndicators",
  description: "Calculate technical indicators for a symbol",
  parameters: z.object({
    symbol: z.string(),
    indicators: z.array(z.enum(["sma", "ema", "rsi", "macd", "bollinger", "atr"])),
    period: z.number().default(14),
  }),
  execute: async ({ symbol, indicators, period }) => {
    // Get historical data first
    const history = await getHistoricalDataTool.execute({
      symbol,
      period: "3mo",
      interval: "1d",
    });
    
    const closes = history.map(d => d.close);
    const highs = history.map(d => d.high);
    const lows = history.map(d => d.low);
    
    const results: Record<string, any> = { symbol };
    
    for (const indicator of indicators) {
      switch (indicator) {
        case "sma":
          results.sma = calculateSMA(closes, period);
          break;
        case "ema":
          results.ema = calculateEMA(closes, period);
          break;
        case "rsi":
          results.rsi = calculateRSI(closes, period);
          break;
        case "macd":
          results.macd = calculateMACD(closes);
          break;
        case "bollinger":
          results.bollinger = calculateBollinger(closes, 20);
          break;
        case "atr":
          results.atr = calculateATR(highs, lows, closes, period);
          break;
      }
    }
    
    return results;
  },
};

// Helper functions
function calculateSMA(data: number[], period: number): number {
  const slice = data.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

function calculateRSI(data: number[], period: number): number {
  const changes = data.slice(1).map((val, i) => val - data[i]);
  const gains = changes.map(c => c > 0 ? c : 0);
  const losses = changes.map(c => c < 0 ? -c : 0);
  
  const avgGain = gains.slice(-period).reduce((a, b) => a + b, 0) / period;
  const avgLoss = losses.slice(-period).reduce((a, b) => a + b, 0) / period;
  
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

function calculateMACD(data: number[]): { value: number; signal: number; histogram: number } {
  const ema12 = calculateEMA(data, 12);
  const ema26 = calculateEMA(data, 26);
  const macdLine = ema12 - ema26;
  const signal = calculateEMA([...data.slice(-9), macdLine], 9); // Simplified
  return {
    value: macdLine,
    signal,
    histogram: macdLine - signal,
  };
}
```

---

## Trading Tools

### `getPortfolio`

Get current portfolio state.

```typescript
const getPortfolioTool = {
  name: "getPortfolio",
  description: "Get current portfolio holdings and cash balance",
  parameters: z.object({}),
  execute: async () => {
    const result = await db.query(`
      SELECT 
        symbol, quantity, avg_cost, current_price, 
        market_value, unrealized_pnl
      FROM portfolio
      WHERE quantity > 0
    `);
    
    const cash = await db.query(`SELECT cash FROM accounts LIMIT 1`);
    
    const positions = result.rows;
    const totalValue = positions.reduce((sum, p) => sum + p.market_value, 0) + cash.rows[0].cash;
    
    return {
      cash: cash.rows[0].cash,
      positions,
      totalValue,
      positionCount: positions.length,
    };
  },
};
```

### `placeOrder`

Execute a trade (paper/live).

```typescript
const placeOrderTool = {
  name: "placeOrder",
  description: "Place a buy or sell order (paper trading by default)",
  parameters: z.object({
    symbol: z.string(),
    action: z.enum(["buy", "sell"]),
    quantity: z.number().positive(),
    orderType: z.enum(["market", "limit"]).default("market"),
    limitPrice: z.number().optional(),
  }),
  execute: async ({ symbol, action, quantity, orderType, limitPrice }) => {
    const mode = process.env.TRADING_MODE || "paper";
    
    if (mode === "live") {
      // Interactive Brokers integration
      throw new Error("Live trading not implemented - use paper mode");
    }
    
    // Paper trading simulation
    const quote = await getQuoteTool.execute({ symbol });
    const price = orderType === "market" ? quote.price : limitPrice;
    
    // Record in database
    const orderId = crypto.randomUUID();
    await db.query(`
      INSERT INTO orders (id, symbol, action, quantity, price, order_type, status, mode)
      VALUES ($1, $2, $3, $4, $5, $6, 'filled', $7)
    `, [orderId, symbol, action, quantity, price, orderType, mode]);
    
    // Update portfolio
    if (action === "buy") {
      await updatePortfolioBuy(symbol, quantity, price);
    } else {
      await updatePortfolioSell(symbol, quantity, price);
    }
    
    return {
      orderId,
      status: "filled",
      symbol,
      action,
      quantity,
      price,
      totalValue: quantity * price,
      timestamp: new Date(),
    };
  },
};
```

---

## Search & RAG Tools

### `webSearch`

General web search.

```typescript
const webSearchTool = {
  name: "webSearch",
  description: "Search the web for information",
  parameters: z.object({
    query: z.string(),
    maxResults: z.number().default(5),
  }),
  execute: async ({ query, maxResults }) => {
    const TAVILY_API_KEY = process.env.TAVILY_API_KEY;
    
    const response = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: TAVILY_API_KEY,
        query,
        max_results: maxResults,
      }),
    });
    
    const data = await response.json();
    return data.results;
  },
};
```

### `queryMemory`

Search agent memory.

```typescript
const queryMemoryTool = {
  name: "queryMemory",
  description: "Search past memories and learnings",
  parameters: z.object({
    query: z.string(),
    namespace: z.string().optional(),
    limit: z.number().default(5),
  }),
  execute: async ({ query, namespace, limit }) => {
    return await memoryStore.search({
      query,
      namespace,
      limit,
      threshold: 0.7,
    });
  },
};
```

---

## Tool Registration

```typescript
// Register all tools with agent
const tradingTools = [
  // Market Data
  getQuoteTool,
  getHistoricalDataTool,
  getMultipleQuotesTool,
  
  // News
  getFinancialNewsTool,
  searchNewsTool,
  
  // Social
  getRedditPostsTool,
  getTwitterMentionsTool,
  
  // Fundamentals
  getCompanyProfileTool,
  getFinancialsTool,
  getEarningsCalendarTool,
  
  // Technical
  calculateIndicatorsTool,
  
  // Trading
  getPortfolioTool,
  placeOrderTool,
  
  // Search
  webSearchTool,
  queryMemoryTool,
];

// Create tool node for graph
const toolNode = new ToolNode(tradingTools);
```

---

## API Keys Required

| Service | Environment Variable | Purpose |
|---------|---------------------|---------|
| FinnHub | `FINNHUB_API_KEY` | News, fundamentals, earnings |
| Tavily | `TAVILY_API_KEY` | Web search |
| Twitter | `TWITTER_BEARER_TOKEN` | Social sentiment |
| OpenAI | `OPENAI_API_KEY` | LLM, embeddings (optional if using Ollama) |
| OpenRouter | `OPENROUTER_API_KEY` | Alternative LLM |
| Ollama | `OLLAMA_BASE_URL` | Local LLM (default: http://localhost:11434) |
| IB | `IB_*` | Interactive Brokers (live trading) |

---

## LLM & Embedding Providers

BrokeAgent supports multiple LLM and embedding providers with automatic fallback.

### Provider Priority

1. **Explicit Configuration** - `LLM_PROVIDER` or `EMBEDDING_PROVIDER` env vars
2. **OpenAI** - If `OPENAI_API_KEY` is set
3. **Ollama** - If available at localhost:11434 (or `OLLAMA_BASE_URL`)
4. **Mock** - In development/test mode only

### Ollama Configuration (Recommended for Local Development)

```bash
# Install Ollama: https://ollama.ai
# Pull required models:
ollama pull llama3.2          # Chat model
ollama pull nomic-embed-text  # Embedding model

# Environment variables (optional - these are defaults)
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=llama3.2
OLLAMA_EMBEDDING_MODEL=nomic-embed-text

# Explicit provider selection
LLM_PROVIDER=ollama
EMBEDDING_PROVIDER=ollama
```

### LLM Provider Usage

```typescript
import { 
  createDefaultLLMProvider,
  createDefaultLLMProviderAsync,
  OllamaLLMProvider,
  OpenAILLMProvider,
} from "./services/llm";

// Auto-detect provider (sync - uses env vars)
const llm = createDefaultLLMProvider();

// Auto-detect with Ollama availability check (async)
const llm = await createDefaultLLMProviderAsync();

// Explicit provider
const ollamaLLM = new OllamaLLMProvider({
  baseUrl: "http://localhost:11434",
  model: "llama3.2",
  temperature: 0.7,
});

// Chat completion
const response = await llm.chat([
  { role: "system", content: "You are a trading assistant." },
  { role: "user", content: "Analyze AAPL stock" },
]);
console.log(response.content);

// Streaming
for await (const chunk of llm.stream(messages)) {
  process.stdout.write(chunk);
}

// Access underlying LangChain model
const langChainModel = llm.getModel();
```

### Embedding Provider Usage

```typescript
import {
  createDefaultEmbeddingProvider,
  createDefaultEmbeddingProviderAsync,
  OllamaEmbeddingProvider,
  OpenAIEmbeddingProvider,
} from "./services/embeddings";

// Auto-detect provider
const embeddings = createDefaultEmbeddingProvider();

// With async Ollama detection
const embeddings = await createDefaultEmbeddingProviderAsync();

// Explicit Ollama
const ollamaEmbeddings = new OllamaEmbeddingProvider({
  baseUrl: "http://localhost:11434",
  model: "nomic-embed-text",
});

// Generate embeddings
const vector = await embeddings.embed("Apple stock analysis");
const vectors = await embeddings.embedBatch(["text1", "text2", "text3"]);
```

### Provider Comparison

| Provider | Pros | Cons |
|----------|------|------|
| **Ollama** | Free, private, no API keys | Requires local setup, slower |
| **OpenAI** | Fast, high quality | Costs money, requires API key |
| **Mock** | Testing only | No real embeddings/reasoning |

---

## Next Steps

See [05-DATABASE.md](./05-DATABASE.md) for database schema details.
