import { BaseAgent, type AgentConfig, type AgentResult } from "../base";
import type { TradingState } from "../../core/state";
import { newsTool, type NewsArticle } from "../../tools/news";

// ============================================
// News Agent
// ============================================

const DEFAULT_CONFIG: AgentConfig = {
  id: "news-analyst-default",
  type: "news_analyst",
  name: "News Analyst",
  description: "Fetches and analyzes financial news for trading signals",
  systemPrompt: `You are a News Analyst responsible for gathering and analyzing financial news.
Your job is to:
1. Fetch recent news for requested symbols from FinnHub and other sources
2. Identify news sentiment and potential market impact
3. Flag significant events that may affect trading decisions`,
};

export class NewsAgent extends BaseAgent {
  constructor(config: Partial<AgentConfig> = {}) {
    super({ ...DEFAULT_CONFIG, ...config });
  }

  async execute(state: TradingState): Promise<AgentResult> {
    this.log("Starting news analysis");

    const symbols = state.request.symbols || [];

    try {
      // Fetch news using the news tool (FinnHub + cache)
      const news = await newsTool.getNewsForSymbols(symbols);
      this.log(`Found ${news.length} news articles`);

      // Transform to state format
      const newsData = news.slice(0, 50).map((n) => ({
        id: n.id,
        headline: n.headline,
        summary: n.summary,
        source: n.source,
        symbols: n.symbols,
        sentiment: n.sentiment,
        publishedAt: n.publishedAt,
        url: n.url,
      }));

      // Generate summary message
      const summary = this.generateNewsSummary(news, symbols);

      // Store significant news in memory
      await this.storeSignificantNews(news);

      return this.command("orchestrator", {
        news: newsData,
        messages: this.addMessage(state, "assistant", summary),
      });
    } catch (error) {
      this.logError("Failed to fetch news", error);
      return this.command("orchestrator", {
        errors: this.addError(state, `News fetch failed: ${(error as Error).message}`),
      });
    }
  }

  private generateNewsSummary(news: NewsArticle[], symbols: string[]): string {
    if (news.length === 0) {
      return `No recent news found${symbols.length > 0 ? ` for ${symbols.join(", ")}` : ""}.`;
    }

    const lines = ["## News Summary\n"];
    lines.push(`Found **${news.length}** articles in the last 7 days.\n`);

    // Group by sentiment
    const positive = news.filter((n) => n.sentiment && n.sentiment > 0.2);
    const negative = news.filter((n) => n.sentiment && n.sentiment < -0.2);

    if (positive.length > 0) {
      lines.push(`### Positive News (${positive.length})`);
      for (const n of positive.slice(0, 3)) {
        lines.push(`- ${n.headline}`);
      }
    }

    if (negative.length > 0) {
      lines.push(`\n### Negative News (${negative.length})`);
      for (const n of negative.slice(0, 3)) {
        lines.push(`- ${n.headline}`);
      }
    }

    // Symbol-specific highlights
    if (symbols.length > 0) {
      lines.push("\n### By Symbol");
      for (const symbol of symbols) {
        const symbolNews = news.filter((n) => n.symbols.includes(symbol));
        if (symbolNews.length > 0) {
          const avgSentiment = this.calculateAverageSentiment(symbolNews);
          const emoji = avgSentiment > 0.1 ? "📈" : avgSentiment < -0.1 ? "📉" : "➡️";
          lines.push(`${emoji} **$${symbol}**: ${symbolNews.length} articles, sentiment ${(avgSentiment * 100).toFixed(0)}%`);
        } else {
          lines.push(`- **$${symbol}**: No recent news`);
        }
      }
    }

    // Overall sentiment
    const avgSentiment = this.calculateAverageSentiment(news);
    const sentimentLabel =
      avgSentiment > 0.1
        ? "positive"
        : avgSentiment < -0.1
          ? "negative"
          : "neutral";

    lines.push(
      `\n**Overall News Sentiment**: ${sentimentLabel} (${(avgSentiment * 100).toFixed(0)}%)`
    );

    return lines.join("\n");
  }

  private calculateAverageSentiment(news: NewsArticle[]): number {
    const withSentiment = news.filter((n) => n.sentiment !== null);
    if (withSentiment.length === 0) return 0;

    const sum = withSentiment.reduce((acc, n) => acc + (n.sentiment || 0), 0);
    return sum / withSentiment.length;
  }

  private async storeSignificantNews(news: NewsArticle[]): Promise<void> {
    // Store highly positive or negative news in memory
    const significant = news.filter(
      (n) => n.sentiment && Math.abs(n.sentiment) > 0.5
    );

    for (const n of significant.slice(0, 5)) {
      const sentiment = n.sentiment! > 0 ? "positive" : "negative";
      await this.storeMemory(
        `${sentiment.toUpperCase()} news for ${n.symbols.join(", ") || "market"}: "${n.headline}" (source: ${n.source})`,
        "episodic",
        0.6,
        { symbols: n.symbols, sentiment: n.sentiment, source: n.source }
      );
    }
  }
}
