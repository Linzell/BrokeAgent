import { BaseAgent, type AgentConfig, type AgentResult } from "../base";
import type { TradingState } from "../../core/state";

// ============================================
// Sentiment Analyst Agent
// ============================================

/**
 * SentimentAnalyst aggregates sentiment from news and social sources
 * to produce an overall sentiment assessment for symbols.
 * 
 * Unlike TechnicalAnalyst which uses a dedicated tool,
 * this agent analyzes data already collected by ResearchTeam.
 */

const DEFAULT_CONFIG: AgentConfig = {
  id: "sentiment-analyst-default",
  type: "sentiment_analyst",
  name: "Sentiment Analyst",
  description:
    "Analyzes news and social sentiment to gauge market mood and investor emotions",
  systemPrompt: `You are a Sentiment Analyst specializing in market psychology.
Your job is to:
1. Analyze news headlines and articles for market sentiment
2. Interpret social media mentions and community mood
3. Identify sentiment shifts and extreme readings
4. Provide an overall sentiment score and confidence level`,
};

export interface SentimentBreakdown {
  news: {
    count: number;
    averageSentiment: number;
    positiveCount: number;
    negativeCount: number;
    neutralCount: number;
    keyHeadlines: string[];
  };
  social: {
    mentionCount: number;
    averageSentiment: number;
    platforms: string[];
    trendingStrength: number;
  };
}

export interface SentimentResult {
  symbol: string;
  overallScore: number; // -1 to 1
  confidence: number; // 0 to 1
  sentiment: "very_bearish" | "bearish" | "neutral" | "bullish" | "very_bullish";
  keyDrivers: string[];
  breakdown: SentimentBreakdown;
}

export class SentimentAnalyst extends BaseAgent {
  constructor(config: Partial<AgentConfig> = {}) {
    super({ ...DEFAULT_CONFIG, ...config });
  }

  async execute(state: TradingState): Promise<AgentResult> {
    this.log("Starting sentiment analysis");

    const symbols = state.request.symbols || [];
    const primarySymbol = symbols[0];

    if (!primarySymbol) {
      this.log("No symbol provided for sentiment analysis");
      return this.command("orchestrator", {
        errors: this.addError(state, "No symbol provided for sentiment analysis"),
      });
    }

    try {
      // Analyze news sentiment
      const newsAnalysis = this.analyzeNewsSentiment(state, primarySymbol);

      // Analyze social sentiment
      const socialAnalysis = this.analyzeSocialSentiment(state, primarySymbol);

      // Combine into overall sentiment
      const result = this.calculateOverallSentiment(
        primarySymbol,
        newsAnalysis,
        socialAnalysis
      );

      this.log(
        `Sentiment analysis complete for ${primarySymbol}: ${result.sentiment} (${result.overallScore.toFixed(2)})`
      );

      // Generate summary message
      const summary = this.generateSummary(result);

      // Store significant findings
      await this.storeSignificantFindings(result);

      return this.command("orchestrator", {
        sentiment: {
          symbol: result.symbol,
          overallScore: result.overallScore,
          confidence: result.confidence,
          sentiment: result.sentiment,
          keyDrivers: result.keyDrivers,
        },
        messages: this.addMessage(state, "assistant", summary),
      });
    } catch (error) {
      this.logError("Sentiment analysis failed", error);
      return this.command("orchestrator", {
        errors: this.addError(
          state,
          `Sentiment analysis failed: ${(error as Error).message}`
        ),
      });
    }
  }

  private analyzeNewsSentiment(
    state: TradingState,
    symbol: string
  ): SentimentBreakdown["news"] {
    const news = state.news || [];

    // Filter news relevant to the symbol
    const relevantNews = news.filter(
      (article) =>
        article.symbols.includes(symbol) ||
        article.headline.toUpperCase().includes(symbol)
    );

    if (relevantNews.length === 0) {
      return {
        count: 0,
        averageSentiment: 0,
        positiveCount: 0,
        negativeCount: 0,
        neutralCount: 0,
        keyHeadlines: [],
      };
    }

    // Calculate sentiment statistics
    let totalSentiment = 0;
    let positiveCount = 0;
    let negativeCount = 0;
    let neutralCount = 0;

    for (const article of relevantNews) {
      const sentiment = article.sentiment ?? 0;
      totalSentiment += sentiment;

      if (sentiment > 0.2) {
        positiveCount++;
      } else if (sentiment < -0.2) {
        negativeCount++;
      } else {
        neutralCount++;
      }
    }

    // Get top headlines sorted by absolute sentiment (most impactful)
    const sortedNews = [...relevantNews].sort(
      (a, b) => Math.abs(b.sentiment ?? 0) - Math.abs(a.sentiment ?? 0)
    );
    const keyHeadlines = sortedNews.slice(0, 5).map((a) => a.headline);

    return {
      count: relevantNews.length,
      averageSentiment: totalSentiment / relevantNews.length,
      positiveCount,
      negativeCount,
      neutralCount,
      keyHeadlines,
    };
  }

  private analyzeSocialSentiment(
    state: TradingState,
    symbol: string
  ): SentimentBreakdown["social"] {
    const social = state.social;

    if (!social) {
      return {
        mentionCount: 0,
        averageSentiment: 0,
        platforms: [],
        trendingStrength: 0,
      };
    }

    // Find mentions for this symbol
    const symbolMentions = social.mentions.filter((m) => m.symbol === symbol);

    if (symbolMentions.length === 0) {
      return {
        mentionCount: 0,
        averageSentiment: social.overallSentiment || 0,
        platforms: [],
        trendingStrength: 0,
      };
    }

    // Aggregate mentions
    const totalMentions = symbolMentions.reduce((sum, m) => sum + m.mentionCount, 0);
    const weightedSentiment = symbolMentions.reduce(
      (sum, m) => sum + m.sentiment * m.mentionCount,
      0
    );
    const avgSentiment = totalMentions > 0 ? weightedSentiment / totalMentions : 0;
    const platforms = [...new Set(symbolMentions.map((m) => m.platform))];

    // Calculate trending strength (how much is this symbol being discussed?)
    const totalAllMentions = social.mentions.reduce((sum, m) => sum + m.mentionCount, 0);
    const trendingStrength =
      totalAllMentions > 0 ? totalMentions / totalAllMentions : 0;

    // Boost if symbol is in trending list
    const isTrending = social.trendingSymbols.includes(symbol);
    const trendingBoost = isTrending ? 0.3 : 0;

    return {
      mentionCount: totalMentions,
      averageSentiment: avgSentiment,
      platforms,
      trendingStrength: Math.min(1, trendingStrength + trendingBoost),
    };
  }

  private calculateOverallSentiment(
    symbol: string,
    news: SentimentBreakdown["news"],
    social: SentimentBreakdown["social"]
  ): SentimentResult {
    // Weight news more heavily than social (60/40 split)
    // But adjust weights based on data availability
    let newsWeight = 0.6;
    let socialWeight = 0.4;

    // Adjust weights if one source is missing data
    if (news.count === 0 && social.mentionCount > 0) {
      newsWeight = 0;
      socialWeight = 1;
    } else if (social.mentionCount === 0 && news.count > 0) {
      newsWeight = 1;
      socialWeight = 0;
    } else if (news.count === 0 && social.mentionCount === 0) {
      // No data - return neutral with low confidence
      return {
        symbol,
        overallScore: 0,
        confidence: 0.1,
        sentiment: "neutral",
        keyDrivers: ["Insufficient data for sentiment analysis"],
        breakdown: { news, social },
      };
    }

    // Calculate weighted sentiment
    const overallScore =
      news.averageSentiment * newsWeight + social.averageSentiment * socialWeight;

    // Calculate confidence based on data volume and consistency
    const dataVolumeScore = Math.min(
      1,
      (news.count / 10 + social.mentionCount / 50) / 2
    );
    const consistencyScore = this.calculateConsistency(news, social);
    const confidence = (dataVolumeScore * 0.5 + consistencyScore * 0.5);

    // Determine sentiment label
    const sentiment = this.scoresToLabel(overallScore, confidence);

    // Identify key drivers
    const keyDrivers = this.identifyKeyDrivers(news, social, overallScore);

    return {
      symbol,
      overallScore,
      confidence,
      sentiment,
      keyDrivers,
      breakdown: { news, social },
    };
  }

  private calculateConsistency(
    news: SentimentBreakdown["news"],
    social: SentimentBreakdown["social"]
  ): number {
    // How consistent are news and social sentiment?
    if (news.count === 0 || social.mentionCount === 0) {
      return 0.5; // Neutral if one source missing
    }

    const difference = Math.abs(news.averageSentiment - social.averageSentiment);
    
    // If both agree on direction and magnitude, high consistency
    // If they disagree, low consistency
    const consistency = 1 - Math.min(1, difference);
    
    return consistency;
  }

  private scoresToLabel(
    score: number,
    confidence: number
  ): SentimentResult["sentiment"] {
    // Require higher confidence for extreme labels
    const adjustedScore = score * (0.5 + confidence * 0.5);

    if (adjustedScore > 0.5) return "very_bullish";
    if (adjustedScore > 0.2) return "bullish";
    if (adjustedScore < -0.5) return "very_bearish";
    if (adjustedScore < -0.2) return "bearish";
    return "neutral";
  }

  private identifyKeyDrivers(
    news: SentimentBreakdown["news"],
    social: SentimentBreakdown["social"],
    overallScore: number
  ): string[] {
    const drivers: string[] = [];

    // News-based drivers
    if (news.count > 0) {
      if (news.positiveCount > news.negativeCount * 2) {
        drivers.push("Predominantly positive news coverage");
      } else if (news.negativeCount > news.positiveCount * 2) {
        drivers.push("Predominantly negative news coverage");
      }

      if (news.count >= 10) {
        drivers.push(`High news volume (${news.count} articles)`);
      }
    }

    // Social-based drivers
    if (social.mentionCount > 0) {
      if (social.trendingStrength > 0.5) {
        drivers.push("Trending on social media");
      }

      if (social.averageSentiment > 0.3) {
        drivers.push("Strong positive social sentiment");
      } else if (social.averageSentiment < -0.3) {
        drivers.push("Strong negative social sentiment");
      }

      if (social.mentionCount > 100) {
        drivers.push(`High social engagement (${social.mentionCount} mentions)`);
      }
    }

    // Add key headlines
    if (news.keyHeadlines.length > 0) {
      drivers.push(`Key headline: "${news.keyHeadlines[0]}"`);
    }

    // If no specific drivers found
    if (drivers.length === 0) {
      if (Math.abs(overallScore) < 0.2) {
        drivers.push("Mixed or neutral sentiment signals");
      } else {
        drivers.push("Moderate sentiment with limited data");
      }
    }

    return drivers.slice(0, 5);
  }

  private generateSummary(result: SentimentResult): string {
    const lines = ["## Sentiment Analysis\n"];

    // Overall sentiment
    const sentimentEmoji = {
      very_bullish: "🚀",
      bullish: "📈",
      neutral: "➡️",
      bearish: "📉",
      very_bearish: "💥",
    }[result.sentiment];

    lines.push(
      `${sentimentEmoji} **${result.symbol}**: ${result.sentiment.replace("_", " ").toUpperCase()}`
    );
    lines.push(
      `- Score: ${(result.overallScore * 100).toFixed(0)}% | Confidence: ${(result.confidence * 100).toFixed(0)}%\n`
    );

    // News breakdown
    lines.push("### News Sentiment");
    const { news } = result.breakdown;
    if (news.count > 0) {
      lines.push(`- Articles analyzed: ${news.count}`);
      lines.push(
        `- Breakdown: ${news.positiveCount} positive, ${news.neutralCount} neutral, ${news.negativeCount} negative`
      );
      lines.push(`- Average sentiment: ${(news.averageSentiment * 100).toFixed(0)}%`);
    } else {
      lines.push("- No relevant news articles found");
    }

    // Social breakdown
    lines.push("\n### Social Sentiment");
    const { social } = result.breakdown;
    if (social.mentionCount > 0) {
      lines.push(`- Mentions: ${social.mentionCount}`);
      lines.push(`- Platforms: ${social.platforms.join(", ") || "N/A"}`);
      lines.push(`- Average sentiment: ${(social.averageSentiment * 100).toFixed(0)}%`);
      if (social.trendingStrength > 0.3) {
        lines.push(`- Trending: Yes (strength: ${(social.trendingStrength * 100).toFixed(0)}%)`);
      }
    } else {
      lines.push("- No social mentions found");
    }

    // Key drivers
    lines.push("\n### Key Drivers");
    for (const driver of result.keyDrivers) {
      lines.push(`- ${driver}`);
    }

    return lines.join("\n");
  }

  private async storeSignificantFindings(result: SentimentResult): Promise<void> {
    // Store extreme sentiment readings
    if (Math.abs(result.overallScore) > 0.5 && result.confidence > 0.5) {
      const direction = result.overallScore > 0 ? "strongly bullish" : "strongly bearish";
      await this.storeMemory(
        `${result.symbol} showing ${direction} sentiment on ${new Date().toISOString().split("T")[0]}. ` +
          `Score: ${(result.overallScore * 100).toFixed(0)}%, Confidence: ${(result.confidence * 100).toFixed(0)}%. ` +
          `Key drivers: ${result.keyDrivers.slice(0, 2).join(", ")}`,
        "episodic",
        0.7,
        {
          symbol: result.symbol,
          sentiment: result.sentiment,
          score: result.overallScore,
        }
      );
    }

    // Store trending symbols
    if (result.breakdown.social.trendingStrength > 0.5) {
      await this.storeMemory(
        `${result.symbol} is trending on social media with ${result.breakdown.social.mentionCount} mentions. ` +
          `Social sentiment: ${(result.breakdown.social.averageSentiment * 100).toFixed(0)}%`,
        "episodic",
        0.6,
        { symbol: result.symbol, trending: true }
      );
    }
  }
}
