import { BaseAgent, type AgentConfig, type AgentResult } from "../base";
import type { TradingState } from "../../core/state";
import { TechnicalAnalyst } from "./technical";
import { SentimentAnalyst } from "./sentiment";
import { FundamentalAnalyst } from "./fundamental";

// ============================================
// Analysis Team - Parallel Agent Execution
// ============================================

/**
 * Analysis Team runs TechnicalAnalyst, SentimentAnalyst, and FundamentalAnalyst
 * in parallel and aggregates their results.
 *
 * This is a "team supervisor" pattern - it orchestrates parallel execution
 * of specialized analysis agents.
 */

const DEFAULT_CONFIG: AgentConfig = {
  id: "analysis-team-default",
  type: "analysis_team",
  name: "Analysis Team",
  description:
    "Coordinates parallel execution of analysis agents (technical, sentiment, fundamental)",
  systemPrompt: "",
};

export interface AnalysisTeamResult {
  technical: TradingState["technical"];
  sentiment: TradingState["sentiment"];
  fundamental: TradingState["fundamental"];
  errors: TradingState["errors"];
  messages: TradingState["messages"];
  combinedRating?: {
    rating: "strong_buy" | "buy" | "hold" | "sell" | "strong_sell";
    confidence: number;
    reasoning: string[];
  };
}

interface AgentExecutionResult {
  agent: string;
  success: boolean;
  result?: AgentResult;
  error?: string;
  durationMs: number;
}

export class AnalysisTeam extends BaseAgent {
  private technicalAnalyst: TechnicalAnalyst;
  private sentimentAnalyst: SentimentAnalyst;
  private fundamentalAnalyst: FundamentalAnalyst;

  constructor(config: Partial<AgentConfig> = {}) {
    super({ ...DEFAULT_CONFIG, ...config });

    // Initialize sub-agents
    this.technicalAnalyst = new TechnicalAnalyst();
    this.sentimentAnalyst = new SentimentAnalyst();
    this.fundamentalAnalyst = new FundamentalAnalyst();
  }

  /**
   * Execute all analysis agents in parallel
   */
  async execute(state: TradingState): Promise<AgentResult> {
    this.log("Starting analysis team - parallel agent execution");
    const startTime = Date.now();

    // Run all agents in parallel with individual error handling
    const results = await Promise.allSettled([
      this.executeAgent("technical", this.technicalAnalyst, state),
      this.executeAgent("sentiment", this.sentimentAnalyst, state),
      this.executeAgent("fundamental", this.fundamentalAnalyst, state),
    ]);

    // Process results
    const agentResults = results.map((result, index) => {
      const agentNames = ["technical", "sentiment", "fundamental"];
      if (result.status === "fulfilled") {
        return result.value;
      }
      return {
        agent: agentNames[index],
        success: false,
        error: result.reason?.message || "Unknown error",
        durationMs: 0,
      } as AgentExecutionResult;
    });

    // Log summary
    const successful = agentResults.filter((r) => r.success).length;
    const failed = agentResults.filter((r) => !r.success).length;
    const totalDuration = Date.now() - startTime;

    this.log(
      `Analysis complete: ${successful} succeeded, ${failed} failed in ${totalDuration}ms`
    );

    // Aggregate results
    const aggregated = this.aggregateResults(state, agentResults);

    // Calculate combined rating
    const combinedRating = this.calculateCombinedRating(aggregated);

    // Generate team summary message
    const summaryMessage = this.generateTeamSummary(
      agentResults,
      aggregated,
      combinedRating
    );

    return this.command("orchestrator", {
      technical: aggregated.technical,
      sentiment: aggregated.sentiment,
      fundamental: aggregated.fundamental,
      errors: aggregated.errors,
      messages: [
        ...aggregated.messages,
        {
          role: "assistant" as const,
          content: summaryMessage,
          agentId: this.id,
          timestamp: new Date(),
        },
      ],
    });
  }

  /**
   * Execute a single agent with error handling and timing
   */
  private async executeAgent(
    name: string,
    agent: BaseAgent,
    state: TradingState
  ): Promise<AgentExecutionResult> {
    const startTime = Date.now();

    try {
      this.log(`Starting ${name} analysis`);
      const result = await agent.execute(state);
      const durationMs = Date.now() - startTime;

      this.log(`${name} analysis completed in ${durationMs}ms`);

      return {
        agent: name,
        success: true,
        result,
        durationMs,
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      this.logError(`${name} analysis failed after ${durationMs}ms`, error);

      return {
        agent: name,
        success: false,
        error: errorMessage,
        durationMs,
      };
    }
  }

  /**
   * Aggregate results from all agents
   */
  private aggregateResults(
    state: TradingState,
    results: AgentExecutionResult[]
  ): AnalysisTeamResult {
    const aggregated: AnalysisTeamResult = {
      technical: undefined,
      sentiment: undefined,
      fundamental: undefined,
      errors: [...state.errors],
      messages: [...state.messages],
    };

    for (const r of results) {
      if (r.success && r.result) {
        // Merge successful results
        const update = r.result.update;

        if (update.technical) {
          aggregated.technical = update.technical;
        }
        if (update.sentiment) {
          aggregated.sentiment = update.sentiment;
        }
        if (update.fundamental) {
          aggregated.fundamental = update.fundamental;
        }
        if (update.messages) {
          aggregated.messages = [...aggregated.messages, ...update.messages];
        }
        if (update.errors) {
          aggregated.errors = [...aggregated.errors, ...update.errors];
        }
      } else if (!r.success) {
        // Add error for failed agent
        aggregated.errors.push({
          agent: `AnalysisTeam/${r.agent}`,
          error: r.error || "Unknown error",
          timestamp: new Date(),
        });
      }
    }

    return aggregated;
  }

  /**
   * Calculate a combined rating from all analysis sources
   */
  private calculateCombinedRating(
    aggregated: AnalysisTeamResult
  ): AnalysisTeamResult["combinedRating"] {
    const ratings: { score: number; weight: number; source: string }[] = [];
    const reasoning: string[] = [];

    // Technical analysis (weight: 30%)
    if (aggregated.technical) {
      const tech = aggregated.technical;
      let techScore = 50; // neutral

      if (tech.trend === "bullish") {
        techScore = 50 + tech.trendStrength * 0.5;
      } else if (tech.trend === "bearish") {
        techScore = 50 - (100 - tech.trendStrength) * 0.5;
      }

      ratings.push({ score: techScore, weight: 0.3, source: "technical" });
      reasoning.push(
        `Technical: ${tech.trend} (${tech.trendStrength}% strength)`
      );
    }

    // Sentiment analysis (weight: 30%)
    if (aggregated.sentiment) {
      const sent = aggregated.sentiment;
      // Convert -1 to 1 scale to 0-100
      const sentScore = (sent.overallScore + 1) * 50;

      ratings.push({
        score: sentScore * sent.confidence + 50 * (1 - sent.confidence),
        weight: 0.3,
        source: "sentiment",
      });
      reasoning.push(
        `Sentiment: ${sent.sentiment.replace("_", " ")} (${(sent.confidence * 100).toFixed(0)}% confidence)`
      );
    }

    // Fundamental analysis (weight: 40%)
    if (aggregated.fundamental) {
      const fund = aggregated.fundamental;
      const ratingScores: Record<string, number> = {
        strong_buy: 90,
        buy: 70,
        hold: 50,
        sell: 30,
        strong_sell: 10,
      };

      ratings.push({
        score: ratingScores[fund.rating] || 50,
        weight: 0.4,
        source: "fundamental",
      });
      reasoning.push(`Fundamental: ${fund.rating.replace("_", " ")}`);
    }

    // If no analysis available
    if (ratings.length === 0) {
      return undefined;
    }

    // Normalize weights and calculate weighted average
    const totalWeight = ratings.reduce((sum, r) => sum + r.weight, 0);
    const weightedScore =
      ratings.reduce((sum, r) => sum + r.score * (r.weight / totalWeight), 0);

    // Convert score to rating
    let rating: "strong_buy" | "buy" | "hold" | "sell" | "strong_sell";
    if (weightedScore >= 75) {
      rating = "strong_buy";
    } else if (weightedScore >= 60) {
      rating = "buy";
    } else if (weightedScore >= 40) {
      rating = "hold";
    } else if (weightedScore >= 25) {
      rating = "sell";
    } else {
      rating = "strong_sell";
    }

    // Calculate confidence based on agreement between sources
    const scores = ratings.map((r) => r.score);
    const avgScore = scores.reduce((a, b) => a + b, 0) / scores.length;
    const variance =
      scores.reduce((sum, s) => sum + Math.pow(s - avgScore, 2), 0) / scores.length;
    const confidence = Math.max(0.3, 1 - variance / 1000);

    return {
      rating,
      confidence,
      reasoning,
    };
  }

  /**
   * Generate a summary message for the team execution
   */
  private generateTeamSummary(
    results: AgentExecutionResult[],
    aggregated: AnalysisTeamResult,
    combinedRating?: AnalysisTeamResult["combinedRating"]
  ): string {
    const lines = ["## Analysis Team Summary\n"];

    // Agent status
    lines.push("### Agent Status");
    for (const r of results) {
      const status = r.success ? "✅" : "❌";
      const timing = `(${r.durationMs}ms)`;
      const error = r.error ? ` - ${r.error}` : "";
      lines.push(`${status} **${r.agent}** ${timing}${error}`);
    }

    // Individual analysis summaries
    lines.push("\n### Analysis Results");

    if (aggregated.technical) {
      const tech = aggregated.technical;
      const trendEmoji =
        tech.trend === "bullish" ? "📈" : tech.trend === "bearish" ? "📉" : "➡️";
      lines.push(
        `- **Technical**: ${trendEmoji} ${tech.trend} (${tech.trendStrength}% strength)`
      );
    } else {
      lines.push("- **Technical**: No data");
    }

    if (aggregated.sentiment) {
      const sent = aggregated.sentiment;
      const sentEmoji = sent.overallScore > 0.2 ? "🟢" : sent.overallScore < -0.2 ? "🔴" : "🟡";
      lines.push(
        `- **Sentiment**: ${sentEmoji} ${sent.sentiment.replace("_", " ")} (${(sent.confidence * 100).toFixed(0)}% confidence)`
      );
    } else {
      lines.push("- **Sentiment**: No data");
    }

    if (aggregated.fundamental) {
      const fund = aggregated.fundamental;
      const fundEmoji =
        fund.rating.includes("buy") ? "🟢" : fund.rating.includes("sell") ? "🔴" : "🟡";
      lines.push(`- **Fundamental**: ${fundEmoji} ${fund.rating.replace("_", " ")}`);
    } else {
      lines.push("- **Fundamental**: No data");
    }

    // Combined rating
    if (combinedRating) {
      lines.push("\n### Combined Rating");
      const ratingEmoji =
        combinedRating.rating.includes("buy")
          ? "🟢"
          : combinedRating.rating.includes("sell")
            ? "🔴"
            : "🟡";
      lines.push(
        `${ratingEmoji} **${combinedRating.rating.replace("_", " ").toUpperCase()}** ` +
          `(${(combinedRating.confidence * 100).toFixed(0)}% confidence)`
      );
      lines.push("\nBased on:");
      for (const reason of combinedRating.reasoning) {
        lines.push(`- ${reason}`);
      }
    }

    // Errors
    const newErrors = aggregated.errors.filter((e) =>
      e.agent.startsWith("AnalysisTeam/")
    );
    if (newErrors.length > 0) {
      lines.push("\n### Errors");
      for (const e of newErrors) {
        lines.push(`- ${e.agent}: ${e.error}`);
      }
    }

    return lines.join("\n");
  }

  /**
   * Static factory to create a node function for the StateGraph
   */
  static createNode(): (state: TradingState) => Promise<AgentResult> {
    const team = new AnalysisTeam();
    return (state: TradingState) => team.execute(state);
  }
}

// ============================================
// Helper function for quick team execution
// ============================================

/**
 * Execute analysis team and return aggregated results
 * Useful for standalone analysis without full workflow
 */
export async function executeAnalysis(
  symbols: string[],
  existingState?: Partial<TradingState>
): Promise<AnalysisTeamResult> {
  const team = new AnalysisTeam();

  const state: TradingState = {
    workflowId: crypto.randomUUID(),
    threadId: crypto.randomUUID(),
    startedAt: new Date(),
    currentStep: "analysis",
    request: {
      type: "analysis",
      symbols,
    },
    messages: [],
    errors: [],
    // Include any existing research data
    ...existingState,
  };

  const result = await team.execute(state);

  return {
    technical: result.update.technical,
    sentiment: result.update.sentiment,
    fundamental: result.update.fundamental,
    errors: result.update.errors || [],
    messages: result.update.messages || [],
  };
}
