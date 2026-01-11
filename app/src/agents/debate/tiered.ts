import { BaseAgent, type AgentConfig, type AgentResult } from "../base";
import type { TradingState } from "../../core/state";
import { DebateTeam, type DebateResult } from "./team";
import { llmProvider } from "../../services/llm";

// ============================================
// Tiered Debate System
// ============================================

/**
 * Tiered debate system that efficiently handles large numbers of symbols
 * by using different analysis depths based on priority:
 * 
 * - HOLDINGS: Individual full debate (highest priority, can't miss sell signals)
 * - WATCHLIST: Small batch debates (high interest stocks)
 * - DISCOVERY: Quick score + batch debate for top candidates
 */

// ============================================
// Types
// ============================================

export type SymbolTier = "holdings" | "watchlist" | "discovery";

export interface TieredSymbol {
  symbol: string;
  tier: SymbolTier;
}

export interface QuickScore {
  symbol: string;
  score: number; // 0-100, higher = more interesting
  technicalScore: number;
  sentimentScore: number;
  fundamentalScore: number;
  momentumScore: number;
  signals: string[];
  recommendation: "strong_buy" | "buy" | "hold" | "sell" | "strong_sell";
}

export interface BatchDebateResult {
  symbols: string[];
  tier: SymbolTier;
  verdict: "bullish" | "bearish" | "mixed" | "neutral";
  confidence: number;
  summary: string;
  symbolAnalysis: Array<{
    symbol: string;
    verdict: "bullish" | "bearish" | "neutral";
    confidence: number;
    keyPoint: string;
    recommendation: string;
  }>;
  topOpportunities: string[];
  topRisks: string[];
}

export interface TieredDebateConfig {
  /** Max symbols per batch for watchlist tier */
  watchlistBatchSize: number;
  /** Max symbols per batch for discovery tier */
  discoveryBatchSize: number;
  /** How many top discovery symbols to debate */
  discoveryTopN: number;
  /** Minimum quick score to be considered for debate */
  discoveryMinScore: number;
}

export const DEFAULT_TIERED_CONFIG: TieredDebateConfig = {
  watchlistBatchSize: 5,
  discoveryBatchSize: 10,
  discoveryTopN: 10,
  discoveryMinScore: 40,
};

// ============================================
// Quick Scoring (No LLM)
// ============================================

/**
 * Calculate a quick score for a symbol based on available data.
 * This is used to filter discovery symbols before LLM debate.
 * NO LLM calls - pure data analysis.
 */
export function calculateQuickScore(
  symbol: string,
  state: TradingState
): QuickScore {
  const scores = {
    technical: 50,
    sentiment: 50,
    fundamental: 50,
    momentum: 50,
  };
  const signals: string[] = [];

  // Get data for this symbol
  const marketData = state.marketData?.find(m => m.symbol === symbol);
  const technical = state.technical?.symbol === symbol ? state.technical : 
    state.analysis?.technical?.find(t => t.symbol === symbol);
  const fundamental = state.fundamental?.symbol === symbol ? state.fundamental :
    state.analysis?.fundamental?.find(f => f.symbol === symbol);
  const sentiment = state.sentiment || state.analysis?.sentiment;
  const news = state.news?.filter(n => n.symbols?.includes(symbol)) || [];

  // Technical scoring (0-100)
  if (technical) {
    if (technical.signal === "bullish" || technical.trend === "bullish") {
      scores.technical = 70;
      signals.push("Bullish technical signal");
    } else if (technical.signal === "bearish" || technical.trend === "bearish") {
      scores.technical = 30;
      signals.push("Bearish technical signal");
    }
    
    // RSI signals
    if (technical.indicators?.rsi) {
      if (technical.indicators.rsi < 30) {
        scores.technical += 15;
        signals.push("RSI oversold - potential bounce");
      } else if (technical.indicators.rsi > 70) {
        scores.technical -= 10;
        signals.push("RSI overbought - caution");
      }
    }

    // Trend strength
    if (technical.trendStrength) {
      scores.technical += (technical.trendStrength - 50) * 0.3;
    }
  }

  // Sentiment scoring (0-100)
  if (sentiment) {
    const sentimentValue = sentiment.overallScore || sentiment.score || 0;
    scores.sentiment = 50 + (sentimentValue * 50); // Convert -1 to 1 → 0 to 100
    
    if (sentimentValue > 0.3) {
      signals.push("Positive market sentiment");
    } else if (sentimentValue < -0.3) {
      signals.push("Negative market sentiment");
    }
  }

  // News sentiment
  if (news.length > 0) {
    const avgNewsSentiment = news.reduce((sum, n) => sum + (n.sentiment || 0), 0) / news.length;
    scores.sentiment = (scores.sentiment + (50 + avgNewsSentiment * 50)) / 2;
    
    if (news.length >= 5) {
      signals.push(`High news activity (${news.length} articles)`);
    }
  }

  // Fundamental scoring (0-100)
  if (fundamental) {
    if (fundamental.recommendation === "buy" || fundamental.recommendation === "strong_buy") {
      scores.fundamental = 75;
      signals.push("Fundamentally attractive");
    } else if (fundamental.recommendation === "sell" || fundamental.recommendation === "strong_sell") {
      scores.fundamental = 25;
      signals.push("Fundamental concerns");
    }

    if (fundamental.valuation === "undervalued") {
      scores.fundamental += 15;
      signals.push("Undervalued");
    } else if (fundamental.valuation === "overvalued") {
      scores.fundamental -= 15;
      signals.push("Overvalued");
    }

    if (fundamental.quality === "excellent") {
      scores.fundamental += 10;
    }
  }

  // Momentum scoring (0-100) based on price action
  if (marketData) {
    const changePercent = marketData.changePercent || marketData.change || 0;
    
    // Strong moves are interesting (both up and down)
    if (Math.abs(changePercent) > 3) {
      scores.momentum = 70 + Math.min(Math.abs(changePercent) * 2, 20);
      signals.push(`Strong move: ${changePercent > 0 ? '+' : ''}${changePercent.toFixed(1)}%`);
    } else if (Math.abs(changePercent) > 1) {
      scores.momentum = 55 + Math.abs(changePercent) * 5;
    }

    // Volume spike detection (if we had volume data comparison)
    if (marketData.volume && marketData.volume > 10000000) {
      scores.momentum += 10;
      signals.push("High volume");
    }
  }

  // Calculate overall score (weighted average)
  const overallScore = Math.round(
    scores.technical * 0.3 +
    scores.sentiment * 0.2 +
    scores.fundamental * 0.3 +
    scores.momentum * 0.2
  );

  // Determine recommendation based on score
  let recommendation: QuickScore["recommendation"];
  if (overallScore >= 75) recommendation = "strong_buy";
  else if (overallScore >= 60) recommendation = "buy";
  else if (overallScore >= 40) recommendation = "hold";
  else if (overallScore >= 25) recommendation = "sell";
  else recommendation = "strong_sell";

  return {
    symbol,
    score: Math.max(0, Math.min(100, overallScore)),
    technicalScore: Math.max(0, Math.min(100, scores.technical)),
    sentimentScore: Math.max(0, Math.min(100, scores.sentiment)),
    fundamentalScore: Math.max(0, Math.min(100, scores.fundamental)),
    momentumScore: Math.max(0, Math.min(100, scores.momentum)),
    signals,
    recommendation,
  };
}

// ============================================
// Batch Debate (Single LLM call for multiple symbols)
// ============================================

const BATCH_DEBATE_CONFIG: AgentConfig = {
  id: "batch-debate-agent",
  type: "analyst",
  name: "Batch Debate Analyst",
  description: "Analyzes multiple symbols in a single debate",
  systemPrompt: `You are an expert market analyst conducting a comparative bull/bear analysis.
Your task is to efficiently analyze multiple stocks together, identifying:
1. Overall market sentiment for the group
2. Individual verdicts for each symbol
3. Top opportunities and risks
4. Actionable recommendations

Be concise but insightful. Focus on what matters most for trading decisions.`,
};

export class BatchDebateAgent extends BaseAgent {
  constructor() {
    super(BATCH_DEBATE_CONFIG);
  }

  /**
   * Run a batch debate on multiple symbols
   */
  async executeBatch(
    symbols: string[],
    tier: SymbolTier,
    state: TradingState
  ): Promise<BatchDebateResult> {
    this.log(`Starting batch debate for ${symbols.length} ${tier} symbols`);
    const startTime = Date.now();

    // Build context for all symbols
    const context = this.buildBatchContext(symbols, state);

    const prompt = `${this.systemPrompt}

## Symbols to Analyze (${tier.toUpperCase()} tier):
${symbols.join(", ")}

## Available Data:
${context}

## Your Task:
Provide a comparative bull/bear analysis for these ${symbols.length} symbols.

Respond in this JSON format:
{
  "verdict": "bullish" | "bearish" | "mixed" | "neutral",
  "confidence": <0-1>,
  "summary": "2-3 sentence overall assessment",
  "symbolAnalysis": [
    {
      "symbol": "AAPL",
      "verdict": "bullish" | "bearish" | "neutral",
      "confidence": <0-1>,
      "keyPoint": "Most important insight for this stock",
      "recommendation": "buy" | "sell" | "hold" | "watch"
    }
  ],
  "topOpportunities": ["Best opportunity 1", "Best opportunity 2"],
  "topRisks": ["Key risk 1", "Key risk 2"]
}`;

    try {
      const llm = llmProvider.getLLM();
      const response = await llm.invoke(prompt);
      const content = typeof response.content === 'string' 
        ? response.content 
        : JSON.stringify(response.content);

      // Parse JSON from response
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        const duration = Date.now() - startTime;
        this.log(`Batch debate completed in ${duration}ms`);

        return {
          symbols,
          tier,
          verdict: parsed.verdict || "neutral",
          confidence: parsed.confidence || 0.5,
          summary: parsed.summary || "Analysis completed",
          symbolAnalysis: parsed.symbolAnalysis || symbols.map(s => ({
            symbol: s,
            verdict: "neutral" as const,
            confidence: 0.5,
            keyPoint: "No specific analysis available",
            recommendation: "hold",
          })),
          topOpportunities: parsed.topOpportunities || [],
          topRisks: parsed.topRisks || [],
        };
      }
    } catch (error) {
      this.logError("Batch debate LLM failed", error);
    }

    // Fallback
    return {
      symbols,
      tier,
      verdict: "neutral",
      confidence: 0.3,
      summary: "Unable to complete full analysis - using fallback",
      symbolAnalysis: symbols.map(s => ({
        symbol: s,
        verdict: "neutral" as const,
        confidence: 0.3,
        keyPoint: "Analysis unavailable",
        recommendation: "hold",
      })),
      topOpportunities: [],
      topRisks: [],
    };
  }

  private buildBatchContext(symbols: string[], state: TradingState): string {
    const sections: string[] = [];

    for (const symbol of symbols) {
      const lines: string[] = [`### ${symbol}`];

      const marketData = state.marketData?.find(m => m.symbol === symbol);
      if (marketData) {
        lines.push(`Price: $${marketData.price?.toFixed(2) || 'N/A'}`);
        if (marketData.changePercent) {
          lines.push(`Change: ${marketData.changePercent > 0 ? '+' : ''}${marketData.changePercent.toFixed(2)}%`);
        }
      }

      const technical = state.analysis?.technical?.find(t => t.symbol === symbol);
      if (technical) {
        lines.push(`Technical: ${technical.signal || technical.trend || 'N/A'}`);
      }

      const fundamental = state.analysis?.fundamental?.find(f => f.symbol === symbol);
      if (fundamental) {
        lines.push(`Fundamental: ${fundamental.recommendation || 'N/A'} (${fundamental.valuation || 'N/A'})`);
      }

      const news = state.news?.filter(n => n.symbols?.includes(symbol)).slice(0, 3) || [];
      if (news.length > 0) {
        lines.push(`Recent news: ${news.map(n => n.headline).join("; ")}`);
      }

      sections.push(lines.join("\n"));
    }

    return sections.join("\n\n");
  }
}

// ============================================
// Tiered Debate Orchestrator
// ============================================

export interface TieredDebateInput {
  holdings: string[];
  watchlist: string[];
  discovery: string[];
}

export interface TieredDebateOutput {
  holdingsDebates: DebateResult[];
  watchlistDebates: BatchDebateResult[];
  discoveryScores: QuickScore[];
  discoveryDebates: BatchDebateResult[];
  summary: {
    totalSymbols: number;
    holdingsAnalyzed: number;
    watchlistAnalyzed: number;
    discoveryScored: number;
    discoveryDebated: number;
    llmCalls: number;
    durationMs: number;
  };
}

export class TieredDebateOrchestrator {
  private config: TieredDebateConfig;
  private debateTeam: DebateTeam;
  private batchAgent: BatchDebateAgent;

  constructor(config: Partial<TieredDebateConfig> = {}) {
    this.config = { ...DEFAULT_TIERED_CONFIG, ...config };
    this.debateTeam = new DebateTeam();
    this.batchAgent = new BatchDebateAgent();
  }

  /**
   * Execute tiered debate analysis
   */
  async execute(
    input: TieredDebateInput,
    state: TradingState
  ): Promise<TieredDebateOutput> {
    const startTime = Date.now();
    let llmCalls = 0;

    console.log(`[TieredDebate] Starting analysis:`);
    console.log(`  Holdings: ${input.holdings.length}`);
    console.log(`  Watchlist: ${input.watchlist.length}`);
    console.log(`  Discovery: ${input.discovery.length}`);

    // TIER 1: Holdings - Individual full debate
    const holdingsDebates: DebateResult[] = [];
    if (input.holdings.length > 0) {
      console.log(`[TieredDebate] Processing ${input.holdings.length} holdings individually`);
      
      for (const symbol of input.holdings) {
        const holdingState: TradingState = {
          ...state,
          request: { ...state.request, symbols: [symbol] },
        };
        
        const result = await this.debateTeam.execute(holdingState);
        const debates = result.update?.debateState?.debates || [];
        holdingsDebates.push(...debates);
        llmCalls += 3; // bull + bear + synthesis
      }
    }

    // TIER 2: Watchlist - Small batch debates
    const watchlistDebates: BatchDebateResult[] = [];
    if (input.watchlist.length > 0) {
      console.log(`[TieredDebate] Processing ${input.watchlist.length} watchlist in batches`);
      
      const batches = this.chunkArray(input.watchlist, this.config.watchlistBatchSize);
      for (const batch of batches) {
        const result = await this.batchAgent.executeBatch(batch, "watchlist", state);
        watchlistDebates.push(result);
        llmCalls += 1;
      }
    }

    // TIER 3: Discovery - Quick score then batch debate top candidates
    const discoveryScores: QuickScore[] = [];
    const discoveryDebates: BatchDebateResult[] = [];
    
    if (input.discovery.length > 0) {
      console.log(`[TieredDebate] Scoring ${input.discovery.length} discovery symbols`);
      
      // Quick score all discovery symbols (no LLM)
      for (const symbol of input.discovery) {
        const score = calculateQuickScore(symbol, state);
        discoveryScores.push(score);
      }

      // Sort by score and take top N
      const topDiscovery = discoveryScores
        .filter(s => s.score >= this.config.discoveryMinScore)
        .sort((a, b) => b.score - a.score)
        .slice(0, this.config.discoveryTopN)
        .map(s => s.symbol);

      console.log(`[TieredDebate] Top ${topDiscovery.length} discovery symbols for debate`);

      if (topDiscovery.length > 0) {
        const batches = this.chunkArray(topDiscovery, this.config.discoveryBatchSize);
        for (const batch of batches) {
          const result = await this.batchAgent.executeBatch(batch, "discovery", state);
          discoveryDebates.push(result);
          llmCalls += 1;
        }
      }
    }

    const durationMs = Date.now() - startTime;
    console.log(`[TieredDebate] Complete in ${durationMs}ms with ${llmCalls} LLM calls`);

    return {
      holdingsDebates,
      watchlistDebates,
      discoveryScores,
      discoveryDebates,
      summary: {
        totalSymbols: input.holdings.length + input.watchlist.length + input.discovery.length,
        holdingsAnalyzed: holdingsDebates.length,
        watchlistAnalyzed: input.watchlist.length,
        discoveryScored: discoveryScores.length,
        discoveryDebated: discoveryDebates.reduce((sum, d) => sum + d.symbols.length, 0),
        llmCalls,
        durationMs,
      },
    };
  }

  private chunkArray<T>(array: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }
}

// ============================================
// Helper for quick execution
// ============================================

/**
 * Quick helper to run tiered debate
 */
export async function executeTieredDebate(
  input: TieredDebateInput,
  state: TradingState,
  config?: Partial<TieredDebateConfig>
): Promise<TieredDebateOutput> {
  const orchestrator = new TieredDebateOrchestrator(config);
  return orchestrator.execute(input, state);
}
