import { BaseAgent, type AgentConfig, type AgentResult } from "../base";
import type { TradingState } from "../../core/state";
import { MarketDataAgent } from "./market-data";
import { NewsAgent } from "./news";
import { SocialAgent } from "./social";

// ============================================
// Research Team - Parallel Agent Execution
// ============================================

/**
 * Research Team runs MarketDataAgent, NewsAgent, and SocialAgent
 * in parallel and aggregates their results.
 * 
 * This is a "team supervisor" pattern - it doesn't use an LLM,
 * it simply orchestrates parallel execution of specialized agents.
 */

const DEFAULT_CONFIG: AgentConfig = {
  id: "research-team-default",
  type: "research_team",
  name: "Research Team",
  description: "Coordinates parallel execution of research agents (market data, news, social)",
  systemPrompt: "",
};

export interface ResearchTeamResult {
  marketData: TradingState["marketData"];
  news: TradingState["news"];
  social: TradingState["social"];
  errors: TradingState["errors"];
  messages: TradingState["messages"];
}

interface AgentExecutionResult {
  agent: string;
  success: boolean;
  result?: AgentResult;
  error?: string;
  durationMs: number;
}

export class ResearchTeam extends BaseAgent {
  private marketDataAgent: MarketDataAgent;
  private newsAgent: NewsAgent;
  private socialAgent: SocialAgent;

  constructor(config: Partial<AgentConfig> = {}) {
    super({ ...DEFAULT_CONFIG, ...config });

    // Initialize sub-agents
    this.marketDataAgent = new MarketDataAgent();
    this.newsAgent = new NewsAgent();
    this.socialAgent = new SocialAgent();
  }

  /**
   * Execute all research agents in parallel
   */
  async execute(state: TradingState): Promise<AgentResult> {
    this.log("Starting research team - parallel agent execution");
    const startTime = Date.now();

    // Run all agents in parallel with individual error handling
    const results = await Promise.allSettled([
      this.executeAgent("market_data", this.marketDataAgent, state),
      this.executeAgent("news", this.newsAgent, state),
      this.executeAgent("social", this.socialAgent, state),
    ]);

    // Process results
    const agentResults = results.map((result, index) => {
      const agentNames = ["market_data", "news", "social"];
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
      `Research complete: ${successful} succeeded, ${failed} failed in ${totalDuration}ms`
    );

    // Aggregate results
    const aggregated = this.aggregateResults(state, agentResults);

    // Generate team summary message
    const summaryMessage = this.generateTeamSummary(agentResults, aggregated);

    return this.command("orchestrator", {
      marketData: aggregated.marketData,
      news: aggregated.news,
      social: aggregated.social,
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
      this.log(`Starting ${name} agent`);
      const result = await agent.execute(state);
      const durationMs = Date.now() - startTime;

      this.log(`${name} agent completed in ${durationMs}ms`);

      return {
        agent: name,
        success: true,
        result,
        durationMs,
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      this.logError(`${name} agent failed after ${durationMs}ms`, error);

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
  ): ResearchTeamResult {
    const aggregated: ResearchTeamResult = {
      marketData: undefined,
      news: undefined,
      social: undefined,
      errors: [...state.errors],
      messages: [...state.messages],
    };

    for (const r of results) {
      if (r.success && r.result) {
        // Merge successful results
        const update = r.result.update;

        if (update.marketData) {
          aggregated.marketData = update.marketData;
        }
        if (update.news) {
          aggregated.news = update.news;
        }
        if (update.social) {
          aggregated.social = update.social;
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
          agent: `ResearchTeam/${r.agent}`,
          error: r.error || "Unknown error",
          timestamp: new Date(),
        });
      }
    }

    return aggregated;
  }

  /**
   * Generate a summary message for the team execution
   */
  private generateTeamSummary(
    results: AgentExecutionResult[],
    aggregated: ResearchTeamResult
  ): string {
    const lines = ["## Research Team Summary\n"];

    // Agent status
    lines.push("### Agent Status");
    for (const r of results) {
      const status = r.success ? "✅" : "❌";
      const timing = `(${r.durationMs}ms)`;
      const error = r.error ? ` - ${r.error}` : "";
      lines.push(`${status} **${r.agent}** ${timing}${error}`);
    }

    // Data summary
    lines.push("\n### Data Collected");

    if (aggregated.marketData?.length) {
      lines.push(`- Market Data: ${aggregated.marketData.length} symbols`);
    } else {
      lines.push("- Market Data: No data");
    }

    if (aggregated.news?.length) {
      lines.push(`- News: ${aggregated.news.length} articles`);
    } else {
      lines.push("- News: No articles");
    }

    if (aggregated.social) {
      lines.push(`- Social: ${aggregated.social.mentions.length} symbol mentions`);
      if (aggregated.social.trendingSymbols.length > 0) {
        lines.push(
          `  - Trending: ${aggregated.social.trendingSymbols.slice(0, 5).join(", ")}`
        );
      }
    } else {
      lines.push("- Social: No data");
    }

    // Errors
    const newErrors = aggregated.errors.filter((e) =>
      e.agent.startsWith("ResearchTeam/")
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
    const team = new ResearchTeam();
    return (state: TradingState) => team.execute(state);
  }
}

// ============================================
// Helper function for quick team execution
// ============================================

/**
 * Execute research team and return aggregated results
 * Useful for standalone research without full workflow
 */
export async function executeResearch(
  symbols: string[],
  threadId?: string
): Promise<ResearchTeamResult> {
  const team = new ResearchTeam();

  const state: TradingState = {
    workflowId: crypto.randomUUID(),
    threadId: threadId || crypto.randomUUID(),
    startedAt: new Date(),
    currentStep: "research",
    request: {
      type: "research",
      symbols,
    },
    messages: [],
    errors: [],
  };

  const result = await team.execute(state);

  return {
    marketData: result.update.marketData,
    news: result.update.news,
    social: result.update.social,
    errors: result.update.errors || [],
    messages: result.update.messages || [],
  };
}
