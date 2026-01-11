// Shared types for execution viewer components

// LLM Usage tracking types
export interface LLMUsage {
  provider: string;
  model: string;
  latencyMs?: number;
  tokens?: number;
  error?: string;
  fallbackFrom?: { provider: string; model: string };
  timestamp: string;
  workflowId?: string;
}

export interface LLMUsageEvent {
  type: "llm:call" | "llm:success" | "llm:error" | "llm:fallback";
  provider: string;
  model: string;
  latencyMs?: number;
  tokens?: number;
  error?: string;
  fallbackFrom?: { provider: string; model: string };
  timestamp: string;
  workflowId?: string;
}

export interface Execution {
  id: string;
  workflow_id: string;
  thread_id: string;
  trigger_type: string;
  status: "pending" | "running" | "completed" | "failed";
  current_step?: string;
  started_at: string;
  completed_at?: string;
  error?: string;
  // Extended data from API
  symbols?: string[];
  results?: ExecutionResults;
}

export interface ExecutionResults {
  marketData?: MarketDataResult[];
  news?: NewsResult[];
  socialMentions?: SocialMention[];
  technicalAnalysis?: TechnicalAnalysis[];
  sentimentAnalysis?: SentimentAnalysis[];
  fundamentalAnalysis?: FundamentalAnalysis[];
  decisions?: Decision[];
  orders?: Order[];
  riskAssessment?: RiskAssessment;
  portfolio?: PortfolioState;
  debateResults?: DebateResult[];
  tieredDebateResults?: TieredDebateResults;
  llmUsage?: LLMUsage[];
}

export interface DebateResult {
  symbol: string;
  verdict: "bullish" | "bearish" | "neutral";
  confidence: number;
  summary: string;
  recommendation: string;
  bullCase: {
    thesis: string;
    confidence: number;
    keyPoints: string[];
  };
  bearCase: {
    thesis: string;
    confidence: number;
    keyRisks: string[];
  };
  strongestBullPoints: string[];
  strongestBearPoints: string[];
  riskRewardRatio?: number;
}

// Tiered Debate Types
export type SymbolTier = "holdings" | "watchlist" | "discovery";

export interface TieredDebateSymbol {
  symbol: string;
  tier: SymbolTier;
}

export interface QuickScore {
  symbol: string;
  tier: "discovery";
  score: number;
  technicalScore: number;
  sentimentScore: number;
  fundamentalScore: number;
  momentumScore: number;
  signals: string[];
  recommendation: "strong_buy" | "buy" | "hold" | "sell" | "strong_sell";
}

export interface BatchDebateResult {
  tier: SymbolTier;
  symbols: string[];
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

export interface TieredDebateResults {
  holdingsDebates: Array<DebateResult & { tier: "holdings" }>;
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
    estimatedNonTieredLlmCalls: number;
    llmSavings: string;
  };
}

export interface MarketDataResult {
  symbol: string;
  price: number;
  change: number;
  changePercent: number;
  volume: number;
  high?: number;
  low?: number;
  open?: number;
  previousClose?: number;
  marketCap?: number;
}

export interface NewsResult {
  id: string;
  headline: string;
  summary?: string;
  source: string;
  symbols: string[];
  sentiment: number;
  publishedAt: string;
  url?: string;
}

export interface SocialMention {
  platform: string;
  symbol: string;
  content: string;
  sentiment: number;
  engagement?: number;
  timestamp: string;
}

export interface TechnicalAnalysis {
  symbol: string;
  signal: "bullish" | "bearish" | "neutral";
  strength: number;
  indicators: {
    rsi?: number;
    macd?: { value: number; signal: number; histogram: number };
    sma20?: number;
    sma50?: number;
    bollingerBands?: { upper: number; middle: number; lower: number };
  };
  supportLevels?: number[];
  resistanceLevels?: number[];
}

export interface SentimentAnalysis {
  symbol: string;
  overall: "bullish" | "bearish" | "neutral";
  score: number;
  newsScore?: number;
  socialScore?: number;
  sources?: number;
}

export interface FundamentalAnalysis {
  symbol: string;
  recommendation: "buy" | "sell" | "hold";
  valuation: "undervalued" | "overvalued" | "fair";
  quality: "excellent" | "good" | "average" | "poor";
  metrics?: {
    peRatio?: number;
    pbRatio?: number;
    debtToEquity?: number;
    currentRatio?: number;
    roe?: number;
  };
}

export interface Decision {
  id: string;
  symbol: string;
  action: "BUY" | "SELL" | "HOLD";
  confidence: number;
  reasoning: string;
  quantity?: number;
  targetPrice?: number;
  stopLoss?: number;
}

export interface Order {
  id: string;
  symbol: string;
  side: "buy" | "sell";
  quantity: number;
  price?: number;
  type: "market" | "limit";
  status: "pending" | "filled" | "cancelled" | "rejected";
  filledAt?: string;
  filledPrice?: number;
}

export interface RiskAssessment {
  approved: boolean;
  riskScore: number;
  maxRisk: number;
  concerns?: string[];
  mitigations?: string[];
}

export interface PortfolioState {
  totalValue: number;
  cash: number;
  invested: number;
  dailyPnl?: number;
  dailyPnlPercent?: number;
}

// Workflow step definition for graph visualization
export interface WorkflowStep {
  id: string;
  name: string;
  type: "research" | "analysis" | "decision" | "execution" | "debate";
  status: "pending" | "active" | "completed" | "error" | "skipped";
  duration?: number;
  agents?: string[];
}

// Active workflow tracking via WebSocket
export interface ActiveWorkflow {
  workflowId: string;
  startedAt: string;
  currentStep?: string;
  iteration?: number;
  status: "running" | "completed" | "error";
  symbols?: string[];
  requestType?: string;
  error?: string;
  completedAt?: string;
  steps: WorkflowStep[];
  llmUsage?: LLMUsage[];
}

// WebSocket event types
export interface WorkflowEvent {
  type: "workflow:started" | "workflow:step" | "workflow:completed" | "workflow:error" | "workflow:llm";
  workflowId: string;
  timestamp: string;
  data: {
    step?: string;
    entryPoint?: string;
    symbols?: string[];
    requestType?: string;
    iteration?: number;
    error?: string;
    iterations?: number;
    totalRetries?: number;
    messagesCount?: number;
    errorsCount?: number;
    // LLM event fields
    llmEvent?: LLMUsageEvent;
    [key: string]: unknown;
  };
}
