import { BaseAgent, type AgentConfig, type AgentResult } from "./base";
import type { TradingState } from "../core/state";
import { END } from "../core/graph";

// ============================================
// Orchestrator Agent
// ============================================

const ORCHESTRATOR_PROMPT = `You are the Orchestrator, a supervisor managing a team of specialized trading agents.

Your teams:
- research_team: News Analyst, Social Analyst, Market Data Agent (data collection)
- analysis_team: Technical Analyst, Fundamental Analyst, Sentiment Analyst (data analysis)
- decision_team: Portfolio Manager, Risk Manager (trading decisions)

Based on the user's request, decide which team should handle it:
- For gathering data → research_team
- For analyzing data → analysis_team  
- For making trading decisions → decision_team
- When done → FINISH

Respond with the team name or FINISH.`;

export class OrchestratorAgent extends BaseAgent {
  constructor() {
    super({
      id: "00000000-0000-0000-0000-000000000001",
      type: "orchestrator",
      name: "Orchestrator",
      description: "Central supervisor that routes tasks to appropriate teams",
      systemPrompt: ORCHESTRATOR_PROMPT,
    });
  }

  async execute(state: TradingState): Promise<AgentResult> {
    this.log("Processing request", { type: state.request.type });

    // Simple routing logic based on request type and current state
    const nextTeam = this.determineNextTeam(state);

    if (nextTeam === "FINISH") {
      this.log("Workflow complete");
      return this.end({
        messages: this.addMessage(state, "assistant", "Workflow completed successfully."),
      });
    }

    this.log(`Routing to: ${nextTeam}`);
    return this.command(nextTeam, {
      messages: this.addMessage(state, "assistant", `Delegating to ${nextTeam}...`),
    });
  }

  private determineNextTeam(state: TradingState): string {
    const { request, marketData, news, technical, sentiment, decisions } = state;

    // If requesting analysis and we don't have market data, get it first
    if (request.type === "analysis" || request.type === "trade") {
      if (!marketData || marketData.length === 0) {
        return "research_team";
      }

      if (!technical || !sentiment) {
        return "analysis_team";
      }

      if (request.type === "trade" && (!decisions || decisions.length === 0)) {
        return "decision_team";
      }
    }

    // Research request
    if (request.type === "research") {
      if (!news && !marketData) {
        return "research_team";
      }
    }

    // Monitor request - just get latest data
    if (request.type === "monitor") {
      if (!marketData) {
        return "research_team";
      }
    }

    return "FINISH";
  }
}

// Export singleton instance
export const orchestratorAgent = new OrchestratorAgent();
