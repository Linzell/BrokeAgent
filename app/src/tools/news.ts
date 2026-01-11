import { sql } from "../core/database";

// ============================================
// News Types
// ============================================

export interface NewsArticle {
  id: string;
  headline: string;
  summary: string;
  source: string;
  symbols: string[];
  sentiment: number | null;
  publishedAt: Date;
  url: string;
}

export interface FinnHubArticle {
  id: number;
  category: string;
  datetime: number;
  headline: string;
  image: string;
  related: string;
  source: string;
  summary: string;
  url: string;
}

// ============================================
// News Tool
// ============================================

export class NewsTool {
  private finnhubApiKey: string | undefined;
  private cacheTimeout = 15 * 60 * 1000; // 15 minutes

  constructor() {
    this.finnhubApiKey = process.env.FINNHUB_API_KEY;
  }

  /**
   * Fetch news for specific symbols from FinnHub
   */
  async getCompanyNews(symbol: string, daysBack: number = 7): Promise<NewsArticle[]> {
    if (!this.finnhubApiKey) {
      console.warn("FINNHUB_API_KEY not set, using cached news only");
      return this.getCachedNews([symbol]);
    }

    try {
      const to = new Date();
      const from = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000);
      
      const url = `https://finnhub.io/api/v1/company-news?symbol=${symbol}&from=${this.formatDate(from)}&to=${this.formatDate(to)}&token=${this.finnhubApiKey}`;
      
      const response = await fetch(url, {
        signal: AbortSignal.timeout(10000), // 10 second timeout
      });
      
      if (!response.ok) {
        throw new Error(`FinnHub API error: ${response.status}`);
      }

      const articles: FinnHubArticle[] = await response.json();
      
      const mapped = articles.slice(0, 50).map((a) => this.mapFinnHubArticle(a, [symbol]));
      
      // Store in database
      await this.storeArticles(mapped);
      
      return mapped;
    } catch (error) {
      console.error(`Failed to fetch news for ${symbol}:`, error);
      return this.getCachedNews([symbol]);
    }
  }

  /**
   * Fetch general market news from FinnHub
   */
  async getMarketNews(category: "general" | "forex" | "crypto" | "merger" = "general"): Promise<NewsArticle[]> {
    if (!this.finnhubApiKey) {
      console.warn("FINNHUB_API_KEY not set, using cached news only");
      return this.getCachedNews([]);
    }

    try {
      const url = `https://finnhub.io/api/v1/news?category=${category}&token=${this.finnhubApiKey}`;
      
      const response = await fetch(url, {
        signal: AbortSignal.timeout(10000), // 10 second timeout
      });
      
      if (!response.ok) {
        throw new Error(`FinnHub API error: ${response.status}`);
      }

      const articles: FinnHubArticle[] = await response.json();
      
      const mapped = articles.slice(0, 50).map((a) => {
        const symbols = a.related ? a.related.split(",").map((s) => s.trim()) : [];
        return this.mapFinnHubArticle(a, symbols);
      });
      
      // Store in database
      await this.storeArticles(mapped);
      
      return mapped;
    } catch (error) {
      console.error("Failed to fetch market news:", error);
      return this.getCachedNews([]);
    }
  }

  /**
   * Get news for multiple symbols
   */
  async getNewsForSymbols(symbols: string[]): Promise<NewsArticle[]> {
    const allNews: NewsArticle[] = [];
    const seenIds = new Set<string>();

    // Fetch general market news first
    const marketNews = await this.getMarketNews();
    for (const article of marketNews) {
      if (!seenIds.has(article.id)) {
        seenIds.add(article.id);
        allNews.push(article);
      }
    }

    // Fetch symbol-specific news
    for (const symbol of symbols) {
      try {
        const news = await this.getCompanyNews(symbol);
        for (const article of news) {
          if (!seenIds.has(article.id)) {
            seenIds.add(article.id);
            allNews.push(article);
          }
        }
      } catch (error) {
        console.error(`Failed to fetch news for ${symbol}:`, error);
      }
    }

    // Sort by date, newest first
    return allNews.sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime());
  }

  /**
   * Simple sentiment analysis based on headline/summary
   */
  analyzeSentiment(text: string): number {
    const lowerText = text.toLowerCase();
    let score = 0;

    const positiveWords = [
      "surge", "soar", "jump", "gain", "rise", "bull", "buy", "upgrade",
      "beat", "exceed", "profit", "growth", "record", "high", "strong",
      "positive", "optimistic", "rally", "breakout", "momentum"
    ];

    const negativeWords = [
      "fall", "drop", "crash", "plunge", "decline", "bear", "sell", "downgrade",
      "miss", "loss", "cut", "low", "weak", "negative", "pessimistic",
      "selloff", "slump", "warning", "risk", "concern", "fear"
    ];

    for (const word of positiveWords) {
      if (lowerText.includes(word)) score += 0.15;
    }

    for (const word of negativeWords) {
      if (lowerText.includes(word)) score -= 0.15;
    }

    return Math.max(-1, Math.min(1, score));
  }

  // ============================================
  // Private helpers
  // ============================================

  private mapFinnHubArticle(article: FinnHubArticle, symbols: string[]): NewsArticle {
    const sentiment = this.analyzeSentiment(article.headline + " " + article.summary);
    
    return {
      id: `finnhub-${article.id}`,
      headline: article.headline,
      summary: article.summary,
      source: article.source,
      symbols,
      sentiment,
      publishedAt: new Date(article.datetime * 1000),
      url: article.url,
    };
  }

  private formatDate(date: Date): string {
    return date.toISOString().split("T")[0];
  }

  private async storeArticles(articles: NewsArticle[]): Promise<void> {
    for (const article of articles) {
      try {
        await sql`
          INSERT INTO news_articles (
            external_id, headline, summary, url, source, symbols,
            sentiment_score, sentiment_label, published_at
          )
          VALUES (
            ${article.id},
            ${article.headline},
            ${article.summary},
            ${article.url},
            ${article.source},
            ${article.symbols},
            ${article.sentiment},
            ${article.sentiment !== null ? (article.sentiment > 0.2 ? 'positive' : article.sentiment < -0.2 ? 'negative' : 'neutral') : null},
            ${article.publishedAt}
          )
          ON CONFLICT (source, external_id) WHERE external_id IS NOT NULL
          DO UPDATE SET 
            sentiment_score = EXCLUDED.sentiment_score,
            sentiment_label = EXCLUDED.sentiment_label
        `;
      } catch (error) {
        // Ignore duplicate errors
      }
    }
  }

  private async getCachedNews(symbols: string[]): Promise<NewsArticle[]> {
    const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    let results;
    if (symbols.length > 0) {
      results = await sql`
        SELECT 
          external_id as id, headline, summary, source, symbols,
          sentiment_score as sentiment, published_at as "publishedAt", url
        FROM news_articles
        WHERE published_at > ${cutoff}
          AND symbols && ${symbols}
        ORDER BY published_at DESC
        LIMIT 100
      `;
    } else {
      results = await sql`
        SELECT 
          external_id as id, headline, summary, source, symbols,
          sentiment_score as sentiment, published_at as "publishedAt", url
        FROM news_articles
        WHERE published_at > ${cutoff}
        ORDER BY published_at DESC
        LIMIT 100
      `;
    }

    return results.map((r) => ({
      id: r.id || `db-${r.headline.substring(0, 20)}`,
      headline: r.headline,
      summary: r.summary || "",
      source: r.source,
      symbols: r.symbols || [],
      sentiment: r.sentiment ? Number(r.sentiment) : null,
      publishedAt: new Date(r.publishedAt),
      url: r.url || "",
    }));
  }
}

// Export singleton
export const newsTool = new NewsTool();
