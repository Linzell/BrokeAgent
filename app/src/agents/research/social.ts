import { BaseAgent, type AgentConfig, type AgentResult } from "../base";
import type { TradingState } from "../../core/state";
import { redditTool, type SocialResult } from "../../tools/social";

// ============================================
// Social Agent
// ============================================

const DEFAULT_CONFIG: AgentConfig = {
  id: "social-analyst-default",
  type: "social_analyst",
  name: "Social Analyst",
  description: "Monitors and analyzes social media sentiment from Reddit trading communities",
  systemPrompt: `You are a Social Media Analyst monitoring trading communities.
Your job is to:
1. Track stock mentions across Reddit (r/wallstreetbets, r/stocks, r/investing)
2. Identify trending symbols and sentiment shifts
3. Flag unusual activity or viral posts that may affect prices`,
};

export class SocialAgent extends BaseAgent {
  constructor(config: Partial<AgentConfig> = {}) {
    super({ ...DEFAULT_CONFIG, ...config });
  }

  async execute(state: TradingState): Promise<AgentResult> {
    this.log("Starting social media analysis");

    const symbols = state.request.symbols || [];

    try {
      // Get social mentions from Reddit
      const socialData = await redditTool.getSymbolMentions(symbols);
      this.log(`Found ${socialData.mentions.length} symbol mentions`);

      // Transform to state format
      const social = {
        mentions: socialData.mentions.map((m) => ({
          platform: m.platform,
          symbol: m.symbol,
          mentionCount: m.mentionCount,
          sentiment: m.sentiment,
        })),
        trendingSymbols: socialData.trendingSymbols,
        overallSentiment: socialData.overallSentiment,
      };

      // Generate summary message
      const summary = this.generateSummary(socialData, symbols);

      // Store significant findings in memory
      await this.storeSignificantFindings(socialData);

      return this.command("orchestrator", {
        social,
        messages: this.addMessage(state, "assistant", summary),
      });
    } catch (error) {
      this.logError("Failed to analyze social media", error);
      return this.command("orchestrator", {
        errors: this.addError(state, `Social analysis failed: ${(error as Error).message}`),
      });
    }
  }

  private generateSummary(data: SocialResult, requestedSymbols: string[]): string {
    const lines = ["## Social Media Analysis\n"];

    // Overall sentiment
    const sentimentEmoji = data.overallSentiment > 0.2 ? "🟢" : 
                          data.overallSentiment < -0.2 ? "🔴" : "🟡";
    const sentimentLabel = data.overallSentiment > 0.2 ? "Bullish" :
                          data.overallSentiment < -0.2 ? "Bearish" : "Neutral";
    
    lines.push(`**Overall Sentiment**: ${sentimentEmoji} ${sentimentLabel} (${(data.overallSentiment * 100).toFixed(0)}%)\n`);

    // Trending symbols
    if (data.trendingSymbols.length > 0) {
      lines.push("### Trending on Reddit");
      lines.push(data.trendingSymbols.slice(0, 5).map((s, i) => `${i + 1}. $${s}`).join(", "));
      lines.push("");
    }

    // Requested symbols analysis
    if (requestedSymbols.length > 0) {
      lines.push("### Requested Symbols");
      for (const symbol of requestedSymbols) {
        const mention = data.mentions.find((m) => m.symbol === symbol);
        if (mention) {
          const emoji = mention.sentiment > 0.2 ? "📈" : mention.sentiment < -0.2 ? "📉" : "➡️";
          lines.push(`${emoji} **$${symbol}**: ${mention.mentionCount} mentions, sentiment ${(mention.sentiment * 100).toFixed(0)}%`);
        } else {
          lines.push(`- **$${symbol}**: No recent mentions`);
        }
      }
      lines.push("");
    }

    // Top posts
    const topMentions = data.mentions.slice(0, 3);
    if (topMentions.length > 0 && topMentions.some((m) => m.posts.length > 0)) {
      lines.push("### Notable Posts");
      for (const mention of topMentions) {
        if (mention.posts.length > 0) {
          const topPost = mention.posts[0];
          lines.push(`- **$${mention.symbol}**: "${topPost.content.substring(0, 80)}..." (${topPost.score} upvotes)`);
        }
      }
    }

    return lines.join("\n");
  }

  private async storeSignificantFindings(data: SocialResult): Promise<void> {
    // Store trending symbols
    if (data.trendingSymbols.length > 0) {
      await this.storeMemory(
        `Reddit trending symbols (${new Date().toISOString().split("T")[0]}): ${data.trendingSymbols.slice(0, 5).join(", ")}`,
        "episodic",
        0.6,
        { trendingSymbols: data.trendingSymbols, overallSentiment: data.overallSentiment }
      );
    }

    // Store unusual sentiment readings
    for (const mention of data.mentions) {
      if (Math.abs(mention.sentiment) > 0.5 && mention.mentionCount > 10) {
        const direction = mention.sentiment > 0 ? "bullish" : "bearish";
        await this.storeMemory(
          `Strong ${direction} sentiment for $${mention.symbol} on Reddit: ${mention.mentionCount} mentions, ${(mention.sentiment * 100).toFixed(0)}% sentiment`,
          "episodic",
          0.7,
          { symbol: mention.symbol, mentionCount: mention.mentionCount, sentiment: mention.sentiment }
        );
      }
    }
  }
}
