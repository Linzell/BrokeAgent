import { sql } from "../core/database";
import { cache, CacheKeys, RateLimits } from "../services/cache";

// ============================================
// Yahoo Finance Types
// ============================================

export interface YahooQuote {
  symbol: string;
  shortName?: string;
  longName?: string;
  regularMarketPrice: number;
  regularMarketChange: number;
  regularMarketChangePercent: number;
  regularMarketVolume: number;
  regularMarketDayHigh: number;
  regularMarketDayLow: number;
  regularMarketOpen: number;
  regularMarketPreviousClose: number;
  marketCap?: number;
  trailingPE?: number;
  fiftyTwoWeekHigh?: number;
  fiftyTwoWeekLow?: number;
}

export interface MarketDataResult {
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
  name?: string;
}

export interface HistoricalBar {
  timestamp: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

// ============================================
// Yahoo Finance Authentication
// Yahoo now requires a crumb token for API access
// ============================================

interface YahooAuth {
  cookie: string;
  crumb: string;
  expiresAt: number;
}

let yahooAuth: YahooAuth | null = null;

async function getYahooAuth(): Promise<YahooAuth | null> {
  // Return cached auth if still valid (expires after 1 hour)
  if (yahooAuth && yahooAuth.expiresAt > Date.now()) {
    return yahooAuth;
  }

  try {
    // First, get cookies from the main page
    const cookieResponse = await fetch("https://fc.yahoo.com", {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
      signal: AbortSignal.timeout(10000), // 10 second timeout
    });

    const setCookie = cookieResponse.headers.get("set-cookie");
    if (!setCookie) {
      console.warn("[MarketData] No cookies received from Yahoo");
      return null;
    }

    // Extract the A3 cookie
    const cookies = setCookie.split(",").map(c => c.trim().split(";")[0]).join("; ");

    // Now get the crumb using the cookies
    const crumbResponse = await fetch("https://query1.finance.yahoo.com/v1/test/getcrumb", {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Cookie": cookies,
      },
      signal: AbortSignal.timeout(10000), // 10 second timeout
    });

    if (!crumbResponse.ok) {
      console.warn("[MarketData] Failed to get Yahoo crumb:", crumbResponse.status);
      return null;
    }

    const crumb = await crumbResponse.text();
    
    yahooAuth = {
      cookie: cookies,
      crumb,
      expiresAt: Date.now() + 3600000, // 1 hour
    };

    return yahooAuth;
  } catch (error) {
    console.warn("[MarketData] Failed to authenticate with Yahoo:", error);
    return null;
  }
}

// ============================================
// Market Data Tool
// ============================================

export class MarketDataTool {
  private baseUrl = "https://query1.finance.yahoo.com";
  private cacheTimeout = 60 * 1000; // 1 minute cache

  /**
   * Get real-time quotes for multiple symbols
   */
  async getQuotes(symbols: string[]): Promise<MarketDataResult[]> {
    const symbolsStr = symbols.map((s) => s.toUpperCase()).join(",");

    try {
      // Check rate limit first
      const rateLimit = await cache.checkRateLimit(
        CacheKeys.rateLimit("yahoo"),
        RateLimits.yahooFinance.limit,
        RateLimits.yahooFinance.windowSeconds
      );

      if (!rateLimit.allowed) {
        console.log("[MarketData] Rate limited, using cache only");
        return this.getFromCache(symbols);
      }

      // Check Redis cache first (faster than DB)
      const cacheKey = CacheKeys.quotes(symbols);
      const redisCached = await cache.get<MarketDataResult[]>(cacheKey);
      if (redisCached) {
        return redisCached;
      }

      // Then check DB cache
      const cached = await this.getFromCache(symbols);
      const cachedSymbols = new Set(cached.map((c) => c.symbol));
      const uncachedSymbols = symbols.filter((s) => !cachedSymbols.has(s.toUpperCase()));

      if (uncachedSymbols.length === 0) {
        // Store in Redis for faster subsequent access
        await cache.set(cacheKey, cached, { ttl: 60 });
        return cached;
      }

      // Try to get Yahoo auth
      const auth = await getYahooAuth();
      
      // Fetch from Yahoo Finance
      let url = `${this.baseUrl}/v7/finance/quote?symbols=${uncachedSymbols.join(",")}`;
      if (auth?.crumb) {
        url += `&crumb=${encodeURIComponent(auth.crumb)}`;
      }

      const headers: Record<string, string> = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "application/json",
      };

      if (auth?.cookie) {
        headers["Cookie"] = auth.cookie;
      }

      const response = await fetch(url, { 
        headers,
        signal: AbortSignal.timeout(10000), // 10 second timeout
      });

      if (!response.ok) {
        // If auth failed, try alternate endpoint
        console.warn(`[MarketData] Yahoo API returned ${response.status}, trying alternate approach`);
        return this.getQuotesAlternate(symbols, cached);
      }

      const data = (await response.json()) as {
        quoteResponse: { result: YahooQuote[] };
      };

      if (!data.quoteResponse?.result) {
        console.warn("[MarketData] No results from Yahoo API");
        return cached;
      }

      const quotes = data.quoteResponse.result.map((q) => this.mapQuote(q));

      // Store in DB cache
      await this.storeInCache(quotes);

      const allQuotes = [...cached, ...quotes];

      // Store in Redis for faster access
      await cache.set(cacheKey, allQuotes, { ttl: 60 });

      return allQuotes;
    } catch (error) {
      console.error("[MarketData] Failed to fetch quotes:", error);
      // Return cached data if available
      return this.getFromCache(symbols);
    }
  }

  /**
   * Alternate quote fetch using chart endpoint (more reliable)
   */
  private async getQuotesAlternate(symbols: string[], existingCached: MarketDataResult[]): Promise<MarketDataResult[]> {
    const quotes: MarketDataResult[] = [...existingCached];
    const cachedSymbols = new Set(existingCached.map(c => c.symbol));

    for (const symbol of symbols) {
      if (cachedSymbols.has(symbol.toUpperCase())) continue;

      try {
        // Use the chart endpoint which is more lenient with auth
        const url = `${this.baseUrl}/v8/finance/chart/${symbol.toUpperCase()}?interval=1d&range=1d`;
        const response = await fetch(url, {
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          },
          signal: AbortSignal.timeout(10000), // 10 second timeout
        });

        if (!response.ok) continue;

        const data = await response.json() as {
          chart: {
            result: [{
              meta: {
                symbol: string;
                regularMarketPrice: number;
                previousClose: number;
                regularMarketVolume?: number;
                regularMarketDayHigh?: number;
                regularMarketDayLow?: number;
                regularMarketOpen?: number;
                shortName?: string;
              };
            }];
          };
        };

        const meta = data.chart?.result?.[0]?.meta;
        if (meta) {
          const quote: MarketDataResult = {
            symbol: meta.symbol,
            name: meta.shortName,
            price: meta.regularMarketPrice,
            change: meta.regularMarketPrice - meta.previousClose,
            changePercent: ((meta.regularMarketPrice - meta.previousClose) / meta.previousClose) * 100,
            volume: meta.regularMarketVolume || 0,
            high: meta.regularMarketDayHigh || meta.regularMarketPrice,
            low: meta.regularMarketDayLow || meta.regularMarketPrice,
            open: meta.regularMarketOpen || meta.previousClose,
            previousClose: meta.previousClose,
          };
          quotes.push(quote);
          await this.storeInCache([quote]);
        }
      } catch (e) {
        console.warn(`[MarketData] Failed to fetch ${symbol} via chart endpoint:`, e);
      }
    }

    return quotes;
  }

  /**
   * Get single quote
   */
  async getQuote(symbol: string): Promise<MarketDataResult | null> {
    const results = await this.getQuotes([symbol]);
    return results[0] || null;
  }

  /**
   * Get historical OHLCV data
   */
  async getHistorical(
    symbol: string,
    interval: "1d" | "1wk" | "1mo" = "1d",
    range: "1mo" | "3mo" | "6mo" | "1y" | "2y" | "5y" = "3mo"
  ): Promise<HistoricalBar[]> {
    try {
      const url = `${this.baseUrl}/v8/finance/chart/${symbol.toUpperCase()}?interval=${interval}&range=${range}`;
      const response = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        },
        signal: AbortSignal.timeout(15000), // 15 second timeout for historical data
      });

      if (!response.ok) {
        throw new Error(`Yahoo Finance API error: ${response.status}`);
      }

      const data = (await response.json()) as {
        chart: {
          result: [
            {
              timestamp: number[];
              indicators: {
                quote: [
                  {
                    open: number[];
                    high: number[];
                    low: number[];
                    close: number[];
                    volume: number[];
                  }
                ];
              };
            }
          ];
        };
      };

      const result = data.chart.result[0];
      const quotes = result.indicators.quote[0];
      const bars: HistoricalBar[] = [];

      for (let i = 0; i < result.timestamp.length; i++) {
        if (quotes.close[i] !== null) {
          bars.push({
            timestamp: new Date(result.timestamp[i] * 1000),
            open: quotes.open[i],
            high: quotes.high[i],
            low: quotes.low[i],
            close: quotes.close[i],
            volume: quotes.volume[i],
          });
        }
      }

      // Store historical data
      await this.storeHistorical(symbol, interval, bars);

      return bars;
    } catch (error) {
      console.error("[MarketData] Failed to fetch historical data:", error);
      // Return from database if available
      return this.getHistoricalFromDb(symbol, interval);
    }
  }

  // ============================================
  // Cache Operations
  // ============================================

  private async getFromCache(symbols: string[]): Promise<MarketDataResult[]> {
    const cutoff = new Date(Date.now() - this.cacheTimeout);
    const upperSymbols = symbols.map((s) => s.toUpperCase());

    const results = await sql`
      SELECT DISTINCT ON (symbol)
        symbol, price, change, change_percent as "changePercent",
        volume, high, low, open_price as open, previous_close as "previousClose",
        market_cap as "marketCap"
      FROM market_data
      WHERE symbol = ANY(${upperSymbols})
        AND fetched_at > ${cutoff}
      ORDER BY symbol, fetched_at DESC
    `;

    return results.map((r) => ({
      symbol: r.symbol,
      price: Number(r.price),
      change: Number(r.change),
      changePercent: Number(r.changePercent),
      volume: Number(r.volume),
      high: Number(r.high),
      low: Number(r.low),
      open: Number(r.open),
      previousClose: Number(r.previousClose),
      marketCap: r.marketCap ? Number(r.marketCap) : undefined,
    }));
  }

  private async storeInCache(quotes: MarketDataResult[]): Promise<void> {
    for (const q of quotes) {
      await sql`
        INSERT INTO market_data (
          symbol, price, change, change_percent, volume,
          high, low, open_price, previous_close, market_cap, quote_time
        )
        VALUES (
          ${q.symbol}, ${q.price}, ${q.change}, ${q.changePercent}, ${q.volume},
          ${q.high}, ${q.low}, ${q.open}, ${q.previousClose}, ${q.marketCap || null}, NOW()
        )
      `;
    }
  }

  private async storeHistorical(
    symbol: string,
    interval: string,
    bars: HistoricalBar[]
  ): Promise<void> {
    for (const bar of bars) {
      await sql`
        INSERT INTO historical_data (symbol, interval, timestamp, open, high, low, close, volume)
        VALUES (${symbol.toUpperCase()}, ${interval}, ${bar.timestamp}, ${bar.open}, ${bar.high}, ${bar.low}, ${bar.close}, ${bar.volume})
        ON CONFLICT (symbol, interval, timestamp) DO UPDATE
        SET open = ${bar.open}, high = ${bar.high}, low = ${bar.low}, close = ${bar.close}, volume = ${bar.volume}
      `;
    }
  }

  private async getHistoricalFromDb(
    symbol: string,
    interval: string
  ): Promise<HistoricalBar[]> {
    const results = await sql`
      SELECT timestamp, open, high, low, close, volume
      FROM historical_data
      WHERE symbol = ${symbol.toUpperCase()} AND interval = ${interval}
      ORDER BY timestamp DESC
      LIMIT 365
    `;

    return results.map((r) => ({
      timestamp: new Date(r.timestamp),
      open: Number(r.open),
      high: Number(r.high),
      low: Number(r.low),
      close: Number(r.close),
      volume: Number(r.volume),
    }));
  }

  // ============================================
  // Helper Methods
  // ============================================

  private mapQuote(q: YahooQuote): MarketDataResult {
    return {
      symbol: q.symbol,
      name: q.shortName || q.longName,
      price: q.regularMarketPrice,
      change: q.regularMarketChange,
      changePercent: q.regularMarketChangePercent,
      volume: q.regularMarketVolume,
      high: q.regularMarketDayHigh,
      low: q.regularMarketDayLow,
      open: q.regularMarketOpen,
      previousClose: q.regularMarketPreviousClose,
      marketCap: q.marketCap,
    };
  }
}

// Export singleton instance
export const marketDataTool = new MarketDataTool();
