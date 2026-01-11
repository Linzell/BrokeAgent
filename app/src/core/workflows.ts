import { StateGraph, END, type GraphConfig, type WorkflowEvent } from "./graph";
import { createInitialState, type TradingState } from "./state";
import { OrchestratorAgent } from "../agents/orchestrator";
import { ResearchTeam } from "../agents/research";
import { AnalysisTeam } from "../agents/analysis";
import { DecisionTeam } from "../agents/decision";
import { DebateTeam } from "../agents/debate/team";
import type { AgentResult } from "../agents/base";

// Global event emitter - will be set by the API server
let globalEventEmitter: ((event: WorkflowEvent) => void) | null = null;

export function setWorkflowEventEmitter(emitter: (event: WorkflowEvent) => void) {
  globalEventEmitter = emitter;
}

function getGraphConfig(): GraphConfig {
  return {
    checkpointer: true,
    onEvent: globalEventEmitter || undefined,
  };
}

// ============================================
// Main Trading Workflow
// ============================================

/**
 * Creates the main trading workflow graph.
 * 
 * Flow:
 *   START -> orchestrator -> [research_team | analysis_team | decision_team] -> orchestrator -> ... -> END
 * 
 * The orchestrator acts as a supervisor, routing to teams based on
 * what data/analysis is needed, then receiving results back.
 */
export function createTradingWorkflow() {
  const graph = new StateGraph();

  // Initialize agents
  const orchestrator = new OrchestratorAgent();
  const researchTeam = new ResearchTeam();
  const analysisTeam = new AnalysisTeam();
  const decisionTeam = new DecisionTeam();

  // Add nodes
  graph.addAgentNode(orchestrator);
  graph.addNode("research_team", async (state) => researchTeam.execute(state));
  graph.addNode("analysis_team", async (state) => analysisTeam.execute(state));
  graph.addNode("decision_team", async (state) => decisionTeam.execute(state));

  // Set entry point
  graph.setEntryPoint("orchestrator");

  // Add edges - teams return to orchestrator
  graph.addEdge("research_team", "orchestrator");
  graph.addEdge("analysis_team", "orchestrator");
  graph.addEdge("decision_team", "orchestrator");

  return graph.compile(getGraphConfig());
}

// ============================================
// Research-Only Workflow (Simplified)
// ============================================

/**
 * A simpler workflow that just runs research without orchestrator routing.
 * Useful for direct research requests.
 */
export function createResearchWorkflow() {
  const graph = new StateGraph();
  const researchTeam = new ResearchTeam();

  graph.addNode("research", async (state) => {
    const result = await researchTeam.execute(state);
    // Override goto to END since this is a single-step workflow
    return {
      ...result,
      goto: END,
    };
  });

  graph.setEntryPoint("research");
  graph.addEdge("research", END);

  return graph.compile(getGraphConfig());
}

// ============================================
// Analysis-Only Workflow (Simplified)
// ============================================

/**
 * A workflow that runs analysis (technical, sentiment, fundamental) in parallel.
 * Expects research data (news, social) to already be in state for sentiment analysis.
 * Can optionally run research first if includeResearch is true.
 */
export function createAnalysisWorkflow(includeResearch: boolean = false) {
  const graph = new StateGraph();
  const researchTeam = new ResearchTeam();
  const analysisTeam = new AnalysisTeam();

  if (includeResearch) {
    // Research -> Analysis -> END
    graph.addNode("research", async (state) => {
      const result = await researchTeam.execute(state);
      return {
        ...result,
        goto: "analysis",
      };
    });

    graph.addNode("analysis", async (state) => {
      const result = await analysisTeam.execute(state);
      return {
        ...result,
        goto: END,
      };
    });

    graph.setEntryPoint("research");
    graph.addEdge("research", "analysis");
    graph.addEdge("analysis", END);
  } else {
    // Analysis only -> END
    graph.addNode("analysis", async (state) => {
      const result = await analysisTeam.execute(state);
      return {
        ...result,
        goto: END,
      };
    });

    graph.setEntryPoint("analysis");
    graph.addEdge("analysis", END);
  }

  return graph.compile(getGraphConfig());
}

// ============================================
// Decision-Only Workflow (Full Pipeline)
// ============================================

/**
 * A workflow that runs the full decision pipeline:
 * Research -> Analysis -> Decision (PM -> Risk -> Executor)
 * 
 * This is the complete trading workflow for a single symbol.
 */
export function createDecisionWorkflow(includeResearchAndAnalysis: boolean = true) {
  const graph = new StateGraph();
  const researchTeam = new ResearchTeam();
  const analysisTeam = new AnalysisTeam();
  const decisionTeam = new DecisionTeam();

  if (includeResearchAndAnalysis) {
    // Full pipeline: Research -> Analysis -> Decision -> END
    graph.addNode("research", async (state) => {
      const result = await researchTeam.execute(state);
      return {
        ...result,
        goto: "analysis",
      };
    });

    graph.addNode("analysis", async (state) => {
      const result = await analysisTeam.execute(state);
      return {
        ...result,
        goto: "decision",
      };
    });

    graph.addNode("decision", async (state) => {
      const result = await decisionTeam.execute(state);
      return {
        ...result,
        goto: END,
      };
    });

    graph.setEntryPoint("research");
    graph.addEdge("research", "analysis");
    graph.addEdge("analysis", "decision");
    graph.addEdge("decision", END);
  } else {
    // Decision only (expects analysis data in state)
    graph.addNode("decision", async (state) => {
      const result = await decisionTeam.execute(state);
      return {
        ...result,
        goto: END,
      };
    });

    graph.setEntryPoint("decision");
    graph.addEdge("decision", END);
  }

  return graph.compile(getGraphConfig());
}

// ============================================
// Debate Workflow (Bull vs Bear Analysis)
// ============================================

/**
 * A workflow that runs adversarial bull/bear analysis:
 * Research -> Bull Case + Bear Case (parallel) -> Synthesis
 * 
 * This produces balanced investment recommendations through structured debate.
 */
export function createDebateWorkflow(includeResearch: boolean = true) {
  const graph = new StateGraph();
  const researchTeam = new ResearchTeam();
  const analysisTeam = new AnalysisTeam();
  const debateTeam = new DebateTeam();

  if (includeResearch) {
    // Research -> Analysis -> Debate -> END
    graph.addNode("research", async (state) => {
      const result = await researchTeam.execute(state);
      return {
        ...result,
        goto: "analysis",
      };
    });

    graph.addNode("analysis", async (state) => {
      const result = await analysisTeam.execute(state);
      return {
        ...result,
        goto: "debate",
      };
    });

    graph.addNode("debate", async (state) => {
      const result = await debateTeam.execute(state);
      return {
        ...result,
        goto: END,
      };
    });

    graph.setEntryPoint("research");
    graph.addEdge("research", "analysis");
    graph.addEdge("analysis", "debate");
    graph.addEdge("debate", END);
  } else {
    // Debate only (expects analysis data in state)
    graph.addNode("debate", async (state) => {
      const result = await debateTeam.execute(state);
      return {
        ...result,
        goto: END,
      };
    });

    graph.setEntryPoint("debate");
    graph.addEdge("debate", END);
  }

  return graph.compile(getGraphConfig());
}

// ============================================
// Workflow Execution Helpers
// ============================================

/**
 * Execute a full trading workflow
 */
export async function runTradingWorkflow(
  request: TradingState["request"],
  threadId?: string
): Promise<TradingState> {
  const workflow = createTradingWorkflow();
  const initialState = createInitialState(request, threadId);

  console.log(`[Workflow] Starting trading workflow for ${request.type}`);
  console.log(`[Workflow] Symbols: ${request.symbols?.join(", ") || "none"}`);

  const result = await workflow.invoke(initialState);

  console.log(`[Workflow] Completed with ${result.messages.length} messages`);
  console.log(`[Workflow] Errors: ${result.errors.length}`);

  return result;
}

/**
 * Execute research-only workflow
 */
export async function runResearchWorkflow(
  symbols: string[],
  threadId?: string
): Promise<TradingState> {
  console.log(`[Workflow] Creating research workflow...`);
  const workflow = createResearchWorkflow();
  console.log(`[Workflow] Creating initial state...`);
  const initialState = createInitialState(
    { type: "research", symbols },
    threadId
  );

  console.log(`[Workflow] Starting research workflow`);
  console.log(`[Workflow] Symbols: ${symbols.join(", ")}`);

  const result = await workflow.invoke(initialState);

  console.log(`[Workflow] Research completed`);
  console.log(`[Workflow] Market data: ${result.marketData?.length || 0} symbols`);
  console.log(`[Workflow] News: ${result.news?.length || 0} articles`);
  console.log(`[Workflow] Social mentions: ${result.social?.mentions.length || 0}`);

  return result;
}

/**
 * Execute analysis-only workflow
 * Set includeResearch to true to fetch fresh data first
 */
export async function runAnalysisWorkflow(
  symbols: string[],
  includeResearch: boolean = true,
  threadId?: string
): Promise<TradingState> {
  const workflow = createAnalysisWorkflow(includeResearch);
  const initialState = createInitialState(
    { type: "analysis", symbols },
    threadId
  );

  console.log(`[Workflow] Starting analysis workflow`);
  console.log(`[Workflow] Symbols: ${symbols.join(", ")}`);
  console.log(`[Workflow] Include research: ${includeResearch}`);

  const result = await workflow.invoke(initialState);

  console.log(`[Workflow] Analysis completed`);
  console.log(`[Workflow] Technical: ${result.technical ? "yes" : "no"}`);
  console.log(`[Workflow] Sentiment: ${result.sentiment ? "yes" : "no"}`);
  console.log(`[Workflow] Fundamental: ${result.fundamental ? "yes" : "no"}`);

  return result;
}

/**
 * Execute full decision workflow (research -> analysis -> decision)
 * This is the complete paper trading pipeline
 */
export async function runDecisionWorkflow(
  symbols: string[],
  includeResearchAndAnalysis: boolean = true,
  threadId?: string
): Promise<TradingState> {
  const workflow = createDecisionWorkflow(includeResearchAndAnalysis);
  const initialState = createInitialState(
    { type: "trade", symbols },
    threadId
  );

  console.log(`[Workflow] Starting decision workflow`);
  console.log(`[Workflow] Symbols: ${symbols.join(", ")}`);
  console.log(`[Workflow] Include research/analysis: ${includeResearchAndAnalysis}`);

  const result = await workflow.invoke(initialState);

  console.log(`[Workflow] Decision completed`);
  console.log(`[Workflow] Decisions: ${result.decisions?.length || 0}`);
  console.log(`[Workflow] Risk approved: ${result.riskAssessment?.approved ?? "N/A"}`);
  console.log(`[Workflow] Orders: ${result.orders?.length || 0}`);
  console.log(`[Workflow] Portfolio value: $${result.portfolio?.totalValue?.toFixed(2) || "N/A"}`);

  return result;
}

/**
 * Execute debate workflow (research -> analysis -> bull/bear debate)
 * This produces balanced investment recommendations through adversarial analysis
 */
export async function runDebateWorkflow(
  symbols: string[],
  includeResearchAndAnalysis: boolean = true,
  threadId?: string
): Promise<TradingState> {
  const workflow = createDebateWorkflow(includeResearchAndAnalysis);
  const initialState = createInitialState(
    { type: "debate", symbols },
    threadId
  );

  console.log(`[Workflow] Starting debate workflow`);
  console.log(`[Workflow] Symbols: ${symbols.join(", ")}`);
  console.log(`[Workflow] Include research/analysis: ${includeResearchAndAnalysis}`);

  const result = await workflow.invoke(initialState);

  console.log(`[Workflow] Debate completed`);
  console.log(`[Workflow] Debates: ${result.debateState?.debates?.length || 0}`);
  
  const debates = result.debateState?.debates || [];
  const bullishCount = debates.filter(d => d.synthesis.verdict === 'bullish').length;
  const bearishCount = debates.filter(d => d.synthesis.verdict === 'bearish').length;
  const neutralCount = debates.filter(d => d.synthesis.verdict === 'neutral').length;
  console.log(`[Workflow] Verdicts: ${bullishCount} bullish, ${bearishCount} bearish, ${neutralCount} neutral`);

  return result;
}

/**
 * Execute tiered debate workflow (research phase only, stores as 'debate' type)
 * This gathers research data for the tiered debate system
 */
export async function runTieredDebateWorkflow(
  symbols: string[],
  threadId?: string
): Promise<TradingState> {
  console.log(`[Workflow] Creating tiered debate workflow (research phase)...`);
  const workflow = createResearchWorkflow();
  console.log(`[Workflow] Creating initial state with type 'debate'...`);
  
  // Key difference: store as "debate" type, not "research"
  const initialState = createInitialState(
    { type: "debate", symbols },
    threadId
  );

  console.log(`[Workflow] Starting tiered debate research phase`);
  console.log(`[Workflow] Symbols: ${symbols.join(", ")}`);

  const result = await workflow.invoke(initialState);

  console.log(`[Workflow] Tiered debate research completed`);
  console.log(`[Workflow] Market data: ${result.marketData?.length || 0} symbols`);
  console.log(`[Workflow] News: ${result.news?.length || 0} articles`);
  console.log(`[Workflow] Social mentions: ${result.social?.mentions.length || 0}`);

  return result;
}

// ============================================
// Workflow Registry
// ============================================

export type WorkflowType = "trading" | "research" | "analysis" | "decision" | "debate";

const workflows = {
  trading: createTradingWorkflow,
  research: createResearchWorkflow,
  analysis: () => createAnalysisWorkflow(true), // Default includes research
  decision: () => createDecisionWorkflow(true), // Default includes research + analysis
  debate: () => createDebateWorkflow(true), // Default includes research + analysis
};

export function getWorkflow(type: WorkflowType) {
  const factory = workflows[type];
  if (!factory) {
    throw new Error(`Unknown workflow type: ${type}`);
  }
  return factory();
}
