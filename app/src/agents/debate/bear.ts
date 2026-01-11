import { BaseAgent, type AgentConfig, type AgentResult } from "../base";
import type { TradingState } from "../../core/state";
import { llmProvider } from "../../services/llm";

// ============================================
// Bear Researcher Agent
// ============================================

/**
 * The Bear Researcher agent focuses on finding bearish signals
 * and reasons to be cautious about a stock. It presents the
 * case for selling/avoiding and identifies downside risks.
 */

const DEFAULT_CONFIG: AgentConfig = {
  id: "bear-researcher-default",
  type: "bear_researcher",
  name: "Bear Researcher",
  description: "Analyzes stocks from a bearish perspective, identifying downside risks and reasons to sell",
  systemPrompt: `You are a Bear Researcher - your job is to make the BEST possible case for selling or avoiding a stock.

Your role in the debate:
1. Find and emphasize all NEGATIVE aspects and risks of the investment
2. Identify potential downside catalysts and warning signs
3. Counter bullish arguments with skeptical perspectives
4. Highlight weaknesses: poor fundamentals, bearish technicals, negative sentiment
5. Present a compelling bear case with downside targets and reasoning

Be thorough and persuasive, but stay grounded in the data provided.
Your goal is to present the strongest possible bear case for the debate.
Remember: skepticism protects capital. Find the risks others might miss.`,
};

export interface BearCase {
  symbol: string;
  thesis: string;
  keyRisks: string[];
  downwardCatalysts: string[];
  counterToBullish: string[];
  priceTarget?: {
    target: number;
    timeframe: string;
    confidence: number;
  };
  warningSignals: string[];
  overallConfidence: number; // 0-1 (confidence in bearish thesis)
}

export class BearResearcherAgent extends BaseAgent {
  constructor(config: Partial<AgentConfig> = {}) {
    super({ ...DEFAULT_CONFIG, ...config });
  }

  async execute(state: TradingState): Promise<AgentResult> {
    this.log("Starting bear case research");

    const symbols = state.request.symbols || [];
    if (symbols.length === 0) {
      return this.command("debate_orchestrator", {
        errors: this.addError(state, "No symbols provided for bear research"),
      });
    }

    const bearCases: BearCase[] = [];

    for (const symbol of symbols) {
      try {
        const bearCase = await this.buildBearCase(symbol, state);
        bearCases.push(bearCase);
        
        // Store significant bear thesis in memory
        await this.storeMemory(
          `BEAR CASE ${symbol}: ${bearCase.thesis}. Key risks: ${bearCase.keyRisks.slice(0, 2).join(", ")}`,
          "episodic",
          0.6,
          { symbol, confidence: bearCase.overallConfidence }
        );
      } catch (error) {
        this.logError(`Failed to build bear case for ${symbol}`, error);
      }
    }

    // Generate summary
    const summary = this.generateBearSummary(bearCases);

    return this.command("debate_orchestrator", {
      debateState: {
        ...state.debateState,
        bearCases,
        bearSummary: summary,
      },
      messages: this.addMessage(state, "assistant", summary),
    });
  }

  private async buildBearCase(symbol: string, state: TradingState): Promise<BearCase> {
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
    const memories = await this.getRelevantMemories(`bearish ${symbol} risks warnings downside`);

    // Build context for LLM
    const context = this.buildContext(symbol, {
      marketData,
      news: news.slice(0, 10),
      technical: technicalAnalysis,
      fundamental: fundamentalAnalysis,
      sentiment: sentimentAnalysis,
      memories,
    });

    // Generate bear case using LLM
    const prompt = `${this.systemPrompt}

## Current Data for ${symbol}:
${context}

## Your Task:
Analyze this data and build the strongest possible BEAR CASE for ${symbol}.
Focus on risks, red flags, and reasons for caution.

Respond in this JSON format:
{
  "thesis": "A compelling 1-2 sentence bear thesis",
  "keyRisks": ["Risk 1", "Risk 2", "Risk 3"],
  "downwardCatalysts": ["Catalyst 1", "Catalyst 2"],
  "counterToBullish": ["Why bullish argument X is wrong", "Why bullish argument Y is flawed"],
  "priceTarget": {
    "target": <downside target number or null>,
    "timeframe": "3-6 months",
    "confidence": <0-1>
  },
  "warningSignals": ["Warning sign 1", "Warning sign 2"],
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
          thesis: parsed.thesis || `${symbol} faces significant downside risks`,
          keyRisks: parsed.keyRisks || [],
          downwardCatalysts: parsed.downwardCatalysts || [],
          counterToBullish: parsed.counterToBullish || [],
          priceTarget: parsed.priceTarget,
          warningSignals: parsed.warningSignals || [],
          overallConfidence: parsed.overallConfidence || 0.5,
        };
      }
    } catch (error) {
      this.logError(`LLM failed for ${symbol} bear case`, error);
    }

    // Fallback: build bear case from available data
    return this.buildFallbackBearCase(symbol, marketData, technicalAnalysis, fundamentalAnalysis);
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
        if (m.debtToEquity) lines.push(`Debt/Equity: ${m.debtToEquity.toFixed(2)}`);
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

  private buildFallbackBearCase(
    symbol: string,
    marketData?: TradingState["marketData"][0],
    technical?: TradingState["analysis"]["technical"][0],
    fundamental?: TradingState["analysis"]["fundamental"][0],
  ): BearCase {
    const keyRisks: string[] = [];
    const downwardCatalysts: string[] = [];
    const warningSignals: string[] = [];
    let confidence = 0.5;

    // Extract bearish signals from technical
    if (technical?.signal === 'bearish' || technical?.signal === 'strong_sell') {
      keyRisks.push(`Technical indicators show ${technical.signal} signal`);
      confidence += 0.1;
    }
    if (technical?.indicators?.rsi && technical.indicators.rsi > 70) {
      keyRisks.push(`RSI at ${technical.indicators.rsi.toFixed(0)} indicates overbought conditions`);
      downwardCatalysts.push("Overbought correction likely");
      warningSignals.push("Extreme RSI reading");
    }
    if (technical?.indicators?.macd?.histogram && technical.indicators.macd.histogram < 0) {
      warningSignals.push("Negative MACD histogram");
    }

    // Extract bearish signals from fundamental
    if (fundamental?.quality === 'poor') {
      keyRisks.push("Poor fundamental quality raises long-term concerns");
      confidence += 0.1;
    }
    if (fundamental?.valuation === 'overvalued') {
      keyRisks.push("Stock appears overvalued - vulnerable to correction");
      downwardCatalysts.push("Valuation compression risk");
      confidence += 0.15;
    }
    if (fundamental?.metrics?.debtToEquity && fundamental.metrics.debtToEquity > 2) {
      keyRisks.push(`High debt/equity ratio of ${fundamental.metrics.debtToEquity.toFixed(1)} indicates leverage risk`);
      warningSignals.push("Elevated debt levels");
    }

    // Price momentum
    if (marketData?.change && marketData.change < -2) {
      keyRisks.push(`Negative momentum with ${marketData.change.toFixed(1)}% recent loss`);
    }

    // Near 52-week high = expensive
    if (marketData?.price && marketData?.high52Week) {
      const distanceFromHigh = ((marketData.high52Week - marketData.price) / marketData.high52Week) * 100;
      if (distanceFromHigh < 10) {
        downwardCatalysts.push("Trading near 52-week high - limited upside, profit-taking risk");
        warningSignals.push("Near all-time highs");
      }
    }

    return {
      symbol,
      thesis: `${symbol} faces downside risk based on ${keyRisks.length > 0 ? keyRisks[0].toLowerCase() : 'current market conditions'}`,
      keyRisks: keyRisks.length > 0 ? keyRisks : ["Market conditions may not support current valuation"],
      downwardCatalysts: downwardCatalysts.length > 0 ? downwardCatalysts : ["Potential negative catalyst emergence"],
      counterToBullish: ["Optimism may be priced in", "Growth expectations may be unrealistic"],
      warningSignals: warningSignals.length > 0 ? warningSignals : ["Monitor for deterioration"],
      overallConfidence: Math.min(0.9, Math.max(0.3, confidence)),
    };
  }

  private generateBearSummary(bearCases: BearCase[]): string {
    if (bearCases.length === 0) {
      return "## Bear Research\n\nNo bear cases generated.";
    }

    const lines = ["## Bear Research Summary\n"];

    for (const bc of bearCases) {
      lines.push(`### ${bc.symbol} - BEAR CASE`);
      lines.push(`**Thesis**: ${bc.thesis}`);
      lines.push(`**Confidence**: ${(bc.overallConfidence * 100).toFixed(0)}%\n`);
      
      lines.push("**Key Risks**:");
      for (const risk of bc.keyRisks.slice(0, 3)) {
        lines.push(`- ${risk}`);
      }
      
      lines.push("\n**Downward Catalysts**:");
      for (const catalyst of bc.downwardCatalysts.slice(0, 3)) {
        lines.push(`- ${catalyst}`);
      }

      if (bc.warningSignals.length > 0) {
        lines.push("\n**Warning Signals**:");
        for (const signal of bc.warningSignals.slice(0, 3)) {
          lines.push(`- ${signal}`);
        }
      }

      if (bc.priceTarget) {
        lines.push(`\n**Downside Target**: $${bc.priceTarget.target} (${bc.priceTarget.timeframe})`);
      }
      
      lines.push("");
    }

    return lines.join("\n");
  }
}
