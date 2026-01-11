import { BaseAgent, type AgentConfig, type AgentResult } from "../base";
import type { TradingState } from "../../core/state";
import { llmProvider } from "../../services/llm";

// ============================================
// Bull Researcher Agent
// ============================================

/**
 * The Bull Researcher agent focuses on finding bullish signals
 * and reasons to be optimistic about a stock. It presents the
 * case for buying/holding and identifies upside potential.
 */

const DEFAULT_CONFIG: AgentConfig = {
  id: "bull-researcher-default",
  type: "bull_researcher",
  name: "Bull Researcher",
  description: "Analyzes stocks from a bullish perspective, identifying upside potential and reasons to buy",
  systemPrompt: `You are a Bull Researcher - your job is to make the BEST possible case for buying or holding a stock.

Your role in the debate:
1. Find and emphasize all POSITIVE aspects of the investment
2. Identify potential upside catalysts and growth drivers
3. Counter bearish arguments with optimistic perspectives
4. Highlight strengths: strong fundamentals, positive technicals, bullish sentiment
5. Present a compelling bull case with price targets and reasoning

Be thorough and persuasive, but stay grounded in the data provided.
Your goal is to present the strongest possible bull case for the debate.`,
};

export interface BullCase {
  symbol: string;
  thesis: string;
  keyPoints: string[];
  upwardCatalysts: string[];
  counterToBearish: string[];
  priceTarget?: {
    target: number;
    timeframe: string;
    confidence: number;
  };
  riskMitigations: string[];
  overallConfidence: number; // 0-1
}

export class BullResearcherAgent extends BaseAgent {
  constructor(config: Partial<AgentConfig> = {}) {
    super({ ...DEFAULT_CONFIG, ...config });
  }

  async execute(state: TradingState): Promise<AgentResult> {
    this.log("Starting bull case research");

    const symbols = state.request.symbols || [];
    if (symbols.length === 0) {
      return this.command("debate_orchestrator", {
        errors: this.addError(state, "No symbols provided for bull research"),
      });
    }

    const bullCases: BullCase[] = [];

    for (const symbol of symbols) {
      try {
        const bullCase = await this.buildBullCase(symbol, state);
        bullCases.push(bullCase);
        
        // Store significant bull thesis in memory
        await this.storeMemory(
          `BULL CASE ${symbol}: ${bullCase.thesis}. Key catalysts: ${bullCase.upwardCatalysts.slice(0, 2).join(", ")}`,
          "episodic",
          0.6,
          { symbol, confidence: bullCase.overallConfidence }
        );
      } catch (error) {
        this.logError(`Failed to build bull case for ${symbol}`, error);
      }
    }

    // Generate summary
    const summary = this.generateBullSummary(bullCases);

    return this.command("debate_orchestrator", {
      debateState: {
        ...state.debateState,
        bullCases,
        bullSummary: summary,
      },
      messages: this.addMessage(state, "assistant", summary),
    });
  }

  private async buildBullCase(symbol: string, state: TradingState): Promise<BullCase> {
    // Gather all available data for the symbol
    // Support both grouped and ungrouped state formats
    const marketData = state.marketData?.find(m => m.symbol === symbol);
    const news = state.news?.filter(n => n.symbols?.includes(symbol)) || [];
    
    // Try grouped format first, then fall back to direct properties
    const technicalAnalysis = state.analysis?.technical?.find(t => t.symbol === symbol) ||
      (state.technical?.symbol === symbol ? state.technical : undefined);
    const fundamentalAnalysis = state.analysis?.fundamental?.find(f => f.symbol === symbol) ||
      (state.fundamental?.symbol === symbol ? state.fundamental : undefined);
    const sentimentAnalysis = state.analysis?.sentiment ||
      (state.sentiment ? { overall: state.sentiment.sentiment, score: state.sentiment.overallScore } : undefined);

    // Get relevant memories
    const memories = await this.getRelevantMemories(`bullish ${symbol} opportunities growth catalysts`);

    // Build context for LLM
    const context = this.buildContext(symbol, {
      marketData,
      news: news.slice(0, 10),
      technical: technicalAnalysis,
      fundamental: fundamentalAnalysis,
      sentiment: sentimentAnalysis,
      memories,
    });

    // Generate bull case using LLM
    const prompt = `${this.systemPrompt}

## Current Data for ${symbol}:
${context}

## Your Task:
Analyze this data and build the strongest possible BULL CASE for ${symbol}.

Respond in this JSON format:
{
  "thesis": "A compelling 1-2 sentence bull thesis",
  "keyPoints": ["Point 1", "Point 2", "Point 3"],
  "upwardCatalysts": ["Catalyst 1", "Catalyst 2"],
  "counterToBearish": ["Counter-argument 1", "Counter-argument 2"],
  "priceTarget": {
    "target": <number or null>,
    "timeframe": "3-6 months",
    "confidence": <0-1>
  },
  "riskMitigations": ["How to manage risk 1", "How to manage risk 2"],
  "overallConfidence": <0-1>
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
        return {
          symbol,
          thesis: parsed.thesis || `${symbol} shows bullish potential`,
          keyPoints: parsed.keyPoints || [],
          upwardCatalysts: parsed.upwardCatalysts || [],
          counterToBearish: parsed.counterToBearish || [],
          priceTarget: parsed.priceTarget,
          riskMitigations: parsed.riskMitigations || [],
          overallConfidence: parsed.overallConfidence || 0.5,
        };
      }
    } catch (error) {
      this.logError(`LLM failed for ${symbol} bull case`, error);
    }

    // Fallback: build bull case from available data
    return this.buildFallbackBullCase(symbol, marketData, technicalAnalysis, fundamentalAnalysis);
  }

  private buildContext(
    symbol: string,
    data: {
      marketData?: TradingState["marketData"][0];
      news?: TradingState["news"];
      technical?: TradingState["analysis"]["technical"][0];
      fundamental?: TradingState["analysis"]["fundamental"][0];
      sentiment?: TradingState["analysis"]["sentiment"];
      memories?: string;
    }
  ): string {
    const lines: string[] = [];

    if (data.marketData) {
      lines.push(`### Market Data`);
      lines.push(`Price: $${data.marketData.price}`);
      if (data.marketData.change) lines.push(`Change: ${data.marketData.change > 0 ? '+' : ''}${data.marketData.change.toFixed(2)}%`);
      if (data.marketData.volume) lines.push(`Volume: ${data.marketData.volume.toLocaleString()}`);
      if (data.marketData.high52Week) lines.push(`52-Week High: $${data.marketData.high52Week}`);
      if (data.marketData.low52Week) lines.push(`52-Week Low: $${data.marketData.low52Week}`);
    }

    if (data.technical) {
      lines.push(`\n### Technical Analysis`);
      lines.push(`Signal: ${data.technical.signal}`);
      lines.push(`Confidence: ${data.technical.confidence}%`);
      if (data.technical.indicators) {
        lines.push(`RSI: ${data.technical.indicators.rsi?.toFixed(1) || 'N/A'}`);
        lines.push(`MACD: ${data.technical.indicators.macd?.histogram?.toFixed(2) || 'N/A'}`);
      }
    }

    if (data.fundamental) {
      lines.push(`\n### Fundamental Analysis`);
      lines.push(`Rating: ${data.fundamental.rating}`);
      lines.push(`Valuation: ${data.fundamental.valuation}`);
      lines.push(`Quality: ${data.fundamental.quality}`);
      if (data.fundamental.metrics) {
        const m = data.fundamental.metrics;
        if (m.peRatio) lines.push(`P/E Ratio: ${m.peRatio.toFixed(1)}`);
        if (m.roe) lines.push(`ROE: ${(m.roe * 100).toFixed(1)}%`);
      }
    }

    if (data.sentiment) {
      lines.push(`\n### Sentiment`);
      lines.push(`Overall: ${data.sentiment.overall}`);
      lines.push(`Score: ${(data.sentiment.score * 100).toFixed(0)}%`);
    }

    if (data.news && data.news.length > 0) {
      lines.push(`\n### Recent News`);
      for (const n of data.news.slice(0, 5)) {
        const sentiment = n.sentiment ? ` (sentiment: ${n.sentiment > 0 ? '+' : ''}${(n.sentiment * 100).toFixed(0)}%)` : '';
        lines.push(`- ${n.headline}${sentiment}`);
      }
    }

    if (data.memories) {
      lines.push(`\n${data.memories}`);
    }

    return lines.join('\n');
  }

  private buildFallbackBullCase(
    symbol: string,
    marketData?: TradingState["marketData"][0],
    technical?: TradingState["analysis"]["technical"][0],
    fundamental?: TradingState["analysis"]["fundamental"][0],
  ): BullCase {
    const keyPoints: string[] = [];
    const upwardCatalysts: string[] = [];
    let confidence = 0.5;

    // Extract bullish signals from technical
    if (technical?.signal === 'bullish' || technical?.signal === 'strong_buy') {
      keyPoints.push(`Technical indicators show ${technical.signal} signal`);
      confidence += 0.1;
    }
    if (technical?.indicators?.rsi && technical.indicators.rsi < 40) {
      keyPoints.push(`RSI at ${technical.indicators.rsi.toFixed(0)} suggests oversold conditions - potential bounce`);
      upwardCatalysts.push("Oversold bounce opportunity");
    }

    // Extract bullish signals from fundamental
    if (fundamental?.quality === 'excellent' || fundamental?.quality === 'good') {
      keyPoints.push(`Strong fundamentals with ${fundamental.quality} quality rating`);
      confidence += 0.1;
    }
    if (fundamental?.valuation === 'undervalued') {
      keyPoints.push("Stock appears undervalued based on fundamental metrics");
      upwardCatalysts.push("Valuation re-rating potential");
      confidence += 0.15;
    }

    // Price momentum
    if (marketData?.change && marketData.change > 0) {
      keyPoints.push(`Positive momentum with ${marketData.change.toFixed(1)}% recent gain`);
    }

    // Near 52-week low = opportunity
    if (marketData?.price && marketData?.low52Week) {
      const distanceFromLow = ((marketData.price - marketData.low52Week) / marketData.low52Week) * 100;
      if (distanceFromLow < 20) {
        upwardCatalysts.push(`Trading near 52-week low - recovery potential`);
      }
    }

    return {
      symbol,
      thesis: `${symbol} presents a buying opportunity based on ${keyPoints.length > 0 ? keyPoints[0].toLowerCase() : 'current market conditions'}`,
      keyPoints: keyPoints.length > 0 ? keyPoints : ["Market conditions may support upside"],
      upwardCatalysts: upwardCatalysts.length > 0 ? upwardCatalysts : ["Potential positive catalyst emergence"],
      counterToBearish: ["Short-term concerns may be overblown", "Market sentiment can shift quickly"],
      riskMitigations: ["Use stop-loss orders", "Position size appropriately"],
      overallConfidence: Math.min(0.9, Math.max(0.3, confidence)),
    };
  }

  private generateBullSummary(bullCases: BullCase[]): string {
    if (bullCases.length === 0) {
      return "## Bull Research\n\nNo bull cases generated.";
    }

    const lines = ["## Bull Research Summary\n"];

    for (const bc of bullCases) {
      lines.push(`### ${bc.symbol} - BULL CASE`);
      lines.push(`**Thesis**: ${bc.thesis}`);
      lines.push(`**Confidence**: ${(bc.overallConfidence * 100).toFixed(0)}%\n`);
      
      lines.push("**Key Points**:");
      for (const point of bc.keyPoints.slice(0, 3)) {
        lines.push(`- ${point}`);
      }
      
      lines.push("\n**Upward Catalysts**:");
      for (const catalyst of bc.upwardCatalysts.slice(0, 3)) {
        lines.push(`- ${catalyst}`);
      }

      if (bc.priceTarget) {
        lines.push(`\n**Price Target**: $${bc.priceTarget.target} (${bc.priceTarget.timeframe})`);
      }
      
      lines.push("");
    }

    return lines.join("\n");
  }
}
