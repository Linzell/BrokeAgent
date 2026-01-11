import { sql } from "../core/database";

// ============================================
// Reddit Types
// ============================================

export interface RedditPost {
  id: string;
  title: string;
  selftext: string;
  score: number;
  numComments: number;
  url: string;
  created: Date;
  subreddit: string;
  mentionedSymbols: string[];
}

export interface SocialMention {
  platform: string;
  symbol: string;
  mentionCount: number;
  sentiment: number;
  posts: {
    content: string;
    score: number;
    url: string;
  }[];
}

export interface SocialResult {
  mentions: SocialMention[];
  trendingSymbols: string[];
  overallSentiment: number;
}

// ============================================
// Reddit Tool
// ============================================

export class RedditTool {
  private userAgent = "BrokeAgent/1.0 (Trading Research Bot)";
  private cacheTimeout = 5 * 60 * 1000; // 5 minutes

  /**
   * Fetch posts from trading subreddits
   */
  async getPosts(
    subreddit: "wallstreetbets" | "stocks" | "investing" | "options" = "wallstreetbets",
    sort: "hot" | "new" | "top" = "hot",
    limit: number = 25,
    timeframe: "hour" | "day" | "week" = "day"
  ): Promise<RedditPost[]> {
    try {
      const url = `https://www.reddit.com/r/${subreddit}/${sort}.json?limit=${limit}&t=${timeframe}`;
      
      const response = await fetch(url, {
        headers: { "User-Agent": this.userAgent },
        signal: AbortSignal.timeout(10000), // 10 second timeout
      });

      if (!response.ok) {
        throw new Error(`Reddit API error: ${response.status}`);
      }

      const data = await response.json();
      
      const posts = data.data.children.map((child: any) => {
        const post = child.data;
        return {
          id: post.id,
          title: post.title,
          selftext: post.selftext?.substring(0, 1000) || "",
          score: post.score,
          numComments: post.num_comments,
          url: `https://reddit.com${post.permalink}`,
          created: new Date(post.created_utc * 1000),
          subreddit: post.subreddit,
          mentionedSymbols: this.extractSymbols(post.title + " " + (post.selftext || "")),
        };
      });

      // Store in database
      await this.storePosts(posts);

      return posts;
    } catch (error) {
      console.error("Failed to fetch Reddit posts:", error);
      // Return cached data on error
      return this.getCachedPosts(subreddit);
    }
  }

  /**
   * Get social mentions aggregated by symbol
   */
  async getSymbolMentions(symbols: string[]): Promise<SocialResult> {
    // Fetch from multiple subreddits
    const subreddits: ("wallstreetbets" | "stocks" | "investing")[] = [
      "wallstreetbets",
      "stocks",
      "investing",
    ];

    const allPosts: RedditPost[] = [];

    for (const subreddit of subreddits) {
      try {
        const posts = await this.getPosts(subreddit, "hot", 50, "day");
        allPosts.push(...posts);
      } catch (error) {
        console.error(`Failed to fetch from r/${subreddit}:`, error);
      }
    }

    // Aggregate mentions by symbol
    const mentionMap = new Map<string, SocialMention>();

    for (const post of allPosts) {
      for (const symbol of post.mentionedSymbols) {
        // Only track requested symbols or if none specified, track all
        if (symbols.length > 0 && !symbols.includes(symbol)) {
          continue;
        }

        if (!mentionMap.has(symbol)) {
          mentionMap.set(symbol, {
            platform: "reddit",
            symbol,
            mentionCount: 0,
            sentiment: 0,
            posts: [],
          });
        }

        const mention = mentionMap.get(symbol)!;
        mention.mentionCount++;
        
        // Simple sentiment: positive score = positive sentiment
        const postSentiment = this.estimateSentiment(post);
        mention.sentiment = (mention.sentiment * (mention.mentionCount - 1) + postSentiment) / mention.mentionCount;

        if (mention.posts.length < 5) {
          mention.posts.push({
            content: post.title,
            score: post.score,
            url: post.url,
          });
        }
      }
    }

    const mentions = Array.from(mentionMap.values())
      .sort((a, b) => b.mentionCount - a.mentionCount);

    // Get trending symbols (most mentioned)
    const trendingSymbols = mentions
      .slice(0, 10)
      .map((m) => m.symbol);

    // Calculate overall sentiment
    const overallSentiment = mentions.length > 0
      ? mentions.reduce((sum, m) => sum + m.sentiment * m.mentionCount, 0) /
        mentions.reduce((sum, m) => sum + m.mentionCount, 0)
      : 0;

    return {
      mentions,
      trendingSymbols,
      overallSentiment,
    };
  }

  /**
   * Extract stock symbols from text
   */
  private extractSymbols(text: string): string[] {
    // Match $SYMBOL or standalone 2-5 letter uppercase words
    // Filter out common words that aren't symbols
    const commonWords = new Set([
      "THE", "AND", "FOR", "ARE", "BUT", "NOT", "YOU", "ALL", "CAN", "HAD",
      "HER", "WAS", "ONE", "OUR", "OUT", "HAS", "HIS", "HOW", "ITS", "MAY",
      "NEW", "NOW", "OLD", "SEE", "WAY", "WHO", "BOY", "DID", "GET", "HIM",
      "LET", "PUT", "SAY", "SHE", "TOO", "USE", "CEO", "IPO", "ETF", "GDP",
      "USA", "USD", "EUR", "GBP", "IMO", "IMHO", "TBH", "FYI", "YOLO", "FOMO",
      "ATH", "ATL", "EOD", "EOW", "EOM", "YTD", "QOQ", "YOY", "HODL", "BTFD",
      "LMAO", "LMFAO", "WTF", "OMG", "TIL", "ELI", "AMA", "EDIT", "UPDATE",
    ]);

    const matches = text.match(/\$[A-Z]{1,5}|\b[A-Z]{2,5}\b/g) || [];
    
    return [...new Set(
      matches
        .map((s) => s.replace("$", "").toUpperCase())
        .filter((s) => !commonWords.has(s) && s.length >= 2)
    )];
  }

  /**
   * Simple sentiment estimation based on post characteristics
   */
  private estimateSentiment(post: RedditPost): number {
    let sentiment = 0;
    const text = (post.title + " " + post.selftext).toLowerCase();

    // Positive indicators
    const positiveWords = ["moon", "rocket", "gains", "profit", "bull", "buy", "long", "calls", "up", "green", "winning"];
    const negativeWords = ["crash", "dump", "loss", "bear", "sell", "short", "puts", "down", "red", "losing", "bag"];

    for (const word of positiveWords) {
      if (text.includes(word)) sentiment += 0.1;
    }
    for (const word of negativeWords) {
      if (text.includes(word)) sentiment -= 0.1;
    }

    // High score posts are generally more reliable sentiment
    if (post.score > 1000) sentiment *= 1.2;
    if (post.score > 5000) sentiment *= 1.3;
    if (post.score < 10) sentiment *= 0.5;

    // Clamp to [-1, 1]
    return Math.max(-1, Math.min(1, sentiment));
  }

  /**
   * Store posts in database
   */
  private async storePosts(posts: RedditPost[]): Promise<void> {
    for (const post of posts) {
      try {
        await sql`
          INSERT INTO social_mentions (
            external_id, platform, content, url, score, comments,
            symbols, sentiment_score, posted_at
          )
          VALUES (
            ${post.id},
            'reddit',
            ${post.title},
            ${post.url},
            ${post.score},
            ${post.numComments},
            ${post.mentionedSymbols},
            ${this.estimateSentiment(post)},
            ${post.created}
          )
          ON CONFLICT (platform, external_id) DO UPDATE
          SET score = ${post.score}, comments = ${post.numComments}
        `;
      } catch (error) {
        // Ignore duplicate errors
      }
    }
  }

  /**
   * Get cached posts from database
   */
  private async getCachedPosts(subreddit: string): Promise<RedditPost[]> {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000); // Last 24 hours

    const results = await sql`
      SELECT 
        external_id as id, content as title, url, score, 
        comments as "numComments", symbols as "mentionedSymbols", posted_at
      FROM social_mentions
      WHERE platform = 'reddit' AND posted_at > ${cutoff}
      ORDER BY score DESC
      LIMIT 50
    `;

    return results.map((r) => ({
      id: r.id,
      title: r.title,
      selftext: "",
      score: r.score,
      numComments: r.numComments,
      url: r.url,
      created: new Date(r.posted_at),
      subreddit,
      mentionedSymbols: r.mentionedSymbols || [],
    }));
  }
}

// Export singleton
export const redditTool = new RedditTool();
