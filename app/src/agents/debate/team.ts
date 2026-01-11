import { BaseAgent, type AgentConfig, type AgentResult } from "../base";
import type { TradingState } from "../../core/state";
import { BullResearcherAgent, type BullCase } from "./bull";
import { BearResearcherAgent, type BearCase } from "./bear";
import { llmProvider } from "../../services/llm";

// ============================================
// Debate Team - Bull vs Bear Orchestration
// ============================================

/**
 * The Debate Team orchestrates a structured debate between
 * Bull and Bear researchers, then synthesizes their arguments
 * into a balanced recommendation.
 * 
 * Flow:
 * 1. Run Bull and Bear agents in parallel
 * 2. Compare their cases
 * 3. Synthesize a balanced verdict
 * 4. Store lessons learned
 */

const DEFAULT_CONFIG: AgentConfig = {
  id: "debate-team-default",
  type: "orchestrator",
  name: "Debate Team",
  description: "Orchestrates bull/bear debate and synthesizes balanced recommendations",
  systemPrompt: `You are a Debate Synthesizer. Your role is to:
1. Objectively evaluate arguments from both Bull and Bear researchers
2. Identify the strongest points from each side
3. Weigh the evidence fairly
4. Provide a balanced recommendation
5. Acknowledge uncertainty and competing views`,
};

export interface DebateResult {
  symbol: string;
  bullCase: BullCase;
  bearCase: BearCase;
  synthesis: {
    verdict: 'bullish' | 'bearish' | 'neutral';
    confidence: number;
    summary: string;
    strongestBullPoints: string[];
    strongestBearPoints: string[];
    recommendation: string;
    riskRewardRatio?: number;
  };
}

export interface DebateState {
  bullCases?: BullCase[];
  bearCases?: BearCase[];
  bullSummary?: string;
  bearSummary?: string;
  debates?: DebateResult[];
  finalVerdict?: string;
}

interface AgentExecutionResult {
  agent: string;
  success: boolean;
  result?: AgentResult;
  error?: string;
  durationMs: number;
}

export class DebateTeam extends BaseAgent {
  private bullAgent: BullResearcherAgent;
  private bearAgent: BearResearcherAgent;

  constructor(config: Partial<AgentConfig> = {}) {
    super({ ...DEFAULT_CONFIG, ...config });

    // Initialize debate agents
    this.bullAgent = new BullResearcherAgent();
    this.bearAgent = new BearResearcherAgent();
  }

  /**
   * Execute the full debate: Bull vs Bear, then synthesis
   */
  async execute(state: TradingState): Promise<AgentResult> {
    this.log("Starting Bull vs Bear debate");
    const startTime = Date.now();

    const symbols = state.request.symbols || [];
    if (symbols.length === 0) {
      return this.command("orchestrator", {
        errors: this.addError(state, "No symbols provided for debate"),
      });
    }

    // Initialize debate state
    const debateState: DebateState = state.debateState || {};

    // Step 1: Run Bull and Bear agents in parallel
    const [bullResult, bearResult] = await Promise.allSettled([
      this.executeAgent("bull", this.bullAgent, state),
      this.executeAgent("bear", this.bearAgent, state),
    ]);

    // Extract results
    if (bullResult.status === "fulfilled" && bullResult.value.success) {
      const bullUpdate = bullResult.value.result?.update;
      debateState.bullCases = bullUpdate?.debateState?.bullCases;
      debateState.bullSummary = bullUpdate?.debateState?.bullSummary;
    }

    if (bearResult.status === "fulfilled" && bearResult.value.success) {
      const bearUpdate = bearResult.value.result?.update;
      debateState.bearCases = bearUpdate?.debateState?.bearCases;
      debateState.bearSummary = bearUpdate?.debateState?.bearSummary;
    }

    // Step 2: Synthesize debates for each symbol
    const debates: DebateResult[] = [];
    for (const symbol of symbols) {
      const bullCase = debateState.bullCases?.find(c => c.symbol === symbol);
      const bearCase = debateState.bearCases?.find(c => c.symbol === symbol);

      if (bullCase && bearCase) {
        const debate = await this.synthesizeDebate(symbol, bullCase, bearCase);
        debates.push(debate);

        // Store the debate outcome in memory
        await this.storeMemory(
          `DEBATE ${symbol}: ${debate.synthesis.verdict.toUpperCase()} verdict (confidence: ${(debate.synthesis.confidence * 100).toFixed(0)}%). ` +
          `Bull: ${bullCase.thesis}. Bear: ${bearCase.thesis}. ` +
          `Recommendation: ${debate.synthesis.recommendation}`,
          "episodic",
          0.7,
          { 
            symbol, 
            verdict: debate.synthesis.verdict, 
            confidence: debate.synthesis.confidence,
            bullConfidence: bullCase.overallConfidence,
            bearConfidence: bearCase.overallConfidence,
          }
        );
      }
    }

    debateState.debates = debates;

    // Step 3: Generate final verdict summary
    const finalVerdict = this.generateFinalVerdict(debates);
    debateState.finalVerdict = finalVerdict;

    const totalDuration = Date.now() - startTime;
    this.log(`Debate complete in ${totalDuration}ms: ${debates.length} symbols analyzed`);

    return this.command("orchestrator", {
      debateState,
      messages: this.addMessage(state, "assistant", finalVerdict),
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
      this.log(`Starting ${name} researcher`);
      const result = await agent.execute(state);
      const durationMs = Date.now() - startTime;

      this.log(`${name} researcher completed in ${durationMs}ms`);

      return {
        agent: name,
        success: true,
        result,
        durationMs,
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      this.logError(`${name} researcher failed after ${durationMs}ms`, error);

      return {
        agent: name,
        success: false,
        error: errorMessage,
        durationMs,
      };
    }
  }

  /**
   * Synthesize bull and bear cases into a balanced verdict
   */
  private async synthesizeDebate(
    symbol: string,
    bullCase: BullCase,
    bearCase: BearCase
  ): Promise<DebateResult> {
    // Try LLM synthesis first
    try {
      const synthesis = await this.llmSynthesis(symbol, bullCase, bearCase);
      return {
        symbol,
        bullCase,
        bearCase,
        synthesis,
      };
    } catch (error) {
      this.logError(`LLM synthesis failed for ${symbol}`, error);
    }

    // Fallback to rule-based synthesis
    return {
      symbol,
      bullCase,
      bearCase,
      synthesis: this.ruleSynthesis(bullCase, bearCase),
    };
  }

  /**
   * Use LLM to synthesize the debate
   */
  private async llmSynthesis(
    symbol: string,
    bullCase: BullCase,
    bearCase: BearCase
  ): Promise<DebateResult['synthesis']> {
    const prompt = `You are an objective market analyst synthesizing a Bull vs Bear debate.

## BULL CASE for ${symbol}
**Thesis**: ${bullCase.thesis}
**Confidence**: ${(bullCase.overallConfidence * 100).toFixed(0)}%
**Key Points**: ${bullCase.keyPoints.join("; ")}
**Upward Catalysts**: ${bullCase.upwardCatalysts.join("; ")}
${bullCase.priceTarget ? `**Bull Target**: $${bullCase.priceTarget.target}` : ''}

## BEAR CASE for ${symbol}
**Thesis**: ${bearCase.thesis}
**Confidence**: ${(bearCase.overallConfidence * 100).toFixed(0)}%
**Key Risks**: ${bearCase.keyRisks.join("; ")}
**Downward Catalysts**: ${bearCase.downwardCatalysts.join("; ")}
${bearCase.priceTarget ? `**Bear Target**: $${bearCase.priceTarget.target}` : ''}

## Your Task
Synthesize these opposing views into a balanced recommendation.

Respond in JSON format:
{
  "verdict": "bullish" | "bearish" | "neutral",
  "confidence": <0-1>,
  "summary": "A balanced 2-3 sentence summary of the debate outcome",
  "strongestBullPoints": ["Point 1", "Point 2"],
  "strongestBearPoints": ["Point 1", "Point 2"],
  "recommendation": "Specific actionable recommendation"
}`;

    const llm = llmProvider.getLLM();
    const response = await llm.invoke(prompt);
    const content = typeof response.content === 'string' 
      ? response.content 
      : JSON.stringify(response.content);

    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        verdict: parsed.verdict || 'neutral',
        confidence: parsed.confidence || 0.5,
        summary: parsed.summary || `Balanced analysis of ${symbol}`,
        strongestBullPoints: parsed.strongestBullPoints || [],
        strongestBearPoints: parsed.strongestBearPoints || [],
        recommendation: parsed.recommendation || 'Monitor the position',
      };
    }

    throw new Error("Failed to parse LLM response");
  }

  /**
   * Rule-based synthesis when LLM is unavailable
   */
  private ruleSynthesis(
    bullCase: BullCase,
    bearCase: BearCase
  ): DebateResult['synthesis'] {
    // Compare confidence levels
    const bullScore = bullCase.overallConfidence;
    const bearScore = bearCase.overallConfidence;
    const difference = bullScore - bearScore;

    let verdict: 'bullish' | 'bearish' | 'neutral';
    let confidence: number;

    if (difference > 0.2) {
      verdict = 'bullish';
      confidence = Math.min(0.8, 0.5 + difference);
    } else if (difference < -0.2) {
      verdict = 'bearish';
      confidence = Math.min(0.8, 0.5 - difference);
    } else {
      verdict = 'neutral';
      confidence = 0.5 - Math.abs(difference);
    }

    // Build recommendation based on verdict
    let recommendation: string;
    if (verdict === 'bullish') {
      recommendation = `Consider accumulating on dips. Bull case stronger with ${(bullScore * 100).toFixed(0)}% confidence vs bear ${(bearScore * 100).toFixed(0)}%.`;
    } else if (verdict === 'bearish') {
      recommendation = `Exercise caution or reduce exposure. Bear case stronger with ${(bearScore * 100).toFixed(0)}% confidence vs bull ${(bullScore * 100).toFixed(0)}%.`;
    } else {
      recommendation = `Hold current position and monitor. Mixed signals warrant patience.`;
    }

    // Calculate risk/reward if price targets available
    let riskRewardRatio: number | undefined;
    if (bullCase.priceTarget?.target && bearCase.priceTarget?.target) {
      const upside = bullCase.priceTarget.target;
      const downside = bearCase.priceTarget.target;
      // Assuming current price is between them
      const midPrice = (upside + downside) / 2;
      riskRewardRatio = (upside - midPrice) / (midPrice - downside);
    }

    return {
      verdict,
      confidence,
      summary: `${verdict.charAt(0).toUpperCase() + verdict.slice(1)} verdict based on comparative analysis. ` +
        `Bull confidence: ${(bullScore * 100).toFixed(0)}%, Bear confidence: ${(bearScore * 100).toFixed(0)}%.`,
      strongestBullPoints: bullCase.keyPoints.slice(0, 2),
      strongestBearPoints: bearCase.keyRisks.slice(0, 2),
      recommendation,
      riskRewardRatio,
    };
  }

  /**
   * Generate overall verdict summary
   */
  private generateFinalVerdict(debates: DebateResult[]): string {
    if (debates.length === 0) {
      return "## Debate Summary\n\nNo debates completed.";
    }

    const lines = ["## Bull vs Bear Debate Results\n"];

    for (const debate of debates) {
      const { symbol, synthesis, bullCase, bearCase } = debate;
      const verdictEmoji = synthesis.verdict === 'bullish' ? '🟢' : 
                          synthesis.verdict === 'bearish' ? '🔴' : '🟡';

      lines.push(`### ${symbol} ${verdictEmoji}`);
      lines.push(`**Verdict**: ${synthesis.verdict.toUpperCase()} (${(synthesis.confidence * 100).toFixed(0)}% confidence)\n`);
      lines.push(`${synthesis.summary}\n`);

      lines.push("**Strongest Bull Arguments**:");
      for (const point of synthesis.strongestBullPoints) {
        lines.push(`  + ${point}`);
      }

      lines.push("\n**Strongest Bear Arguments**:");
      for (const point of synthesis.strongestBearPoints) {
        lines.push(`  - ${point}`);
      }

      if (synthesis.riskRewardRatio) {
        lines.push(`\n**Risk/Reward Ratio**: ${synthesis.riskRewardRatio.toFixed(2)}`);
      }

      lines.push(`\n**Recommendation**: ${synthesis.recommendation}\n`);
      lines.push("---\n");
    }

    // Overall summary
    const bullishCount = debates.filter(d => d.synthesis.verdict === 'bullish').length;
    const bearishCount = debates.filter(d => d.synthesis.verdict === 'bearish').length;
    const neutralCount = debates.filter(d => d.synthesis.verdict === 'neutral').length;

    lines.push("### Overall Summary");
    lines.push(`- Bullish: ${bullishCount} symbols`);
    lines.push(`- Bearish: ${bearishCount} symbols`);
    lines.push(`- Neutral: ${neutralCount} symbols`);

    return lines.join("\n");
  }

  /**
   * Static factory to create a node function for the StateGraph
   */
  static createNode(): (state: TradingState) => Promise<AgentResult> {
    const team = new DebateTeam();
    return (state: TradingState) => team.execute(state);
  }
}

// ============================================
// Helper function for quick debate execution
// ============================================

/**
 * Execute a full bull/bear debate for given symbols
 * Useful for standalone debate without full workflow
 */
export async function executeDebate(
  symbols: string[],
  analysisState?: Partial<TradingState>
): Promise<DebateResult[]> {
  const team = new DebateTeam();

  const state: TradingState = {
    workflowId: crypto.randomUUID(),
    threadId: crypto.randomUUID(),
    startedAt: new Date(),
    currentStep: "debate",
    request: {
      type: "analysis",
      symbols,
    },
    messages: [],
    errors: [],
    ...analysisState,
  };

  const result = await team.execute(state);

  return result.update.debateState?.debates || [];
}
