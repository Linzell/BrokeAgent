import { useState } from "react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { 
  ChevronDown, 
  ChevronRight,
  TrendingUp,
  TrendingDown,
  Minus,
  Newspaper,
  MessageSquare,
  BarChart3,
  Brain,
  ShieldCheck,
  ShoppingCart,
  Wallet,
  AlertTriangle,
  CheckCircle,
  XCircle,
  Swords,
  Zap,
  Target,
  Layers,
  Cpu,
  ArrowRight,
  Clock
} from "lucide-react";
import type { 
  ExecutionResults, 
  MarketDataResult, 
  NewsResult, 
  TechnicalAnalysis,
  SentimentAnalysis,
  FundamentalAnalysis,
  Decision,
  Order,
  RiskAssessment,
  DebateResult,
  TieredDebateResults,
  QuickScore,
  BatchDebateResult,
  LLMUsage
} from "./types";

interface ResultsPanelProps {
  results: ExecutionResults | null;
  loading?: boolean;
}

// Collapsible section component
function Section({ 
  title, 
  icon: Icon, 
  count, 
  children,
  defaultOpen = false,
  variant = "default"
}: { 
  title: string; 
  icon: React.ElementType;
  count?: number;
  children: React.ReactNode;
  defaultOpen?: boolean;
  variant?: "default" | "success" | "warning" | "error";
}) {
  const [open, setOpen] = useState(defaultOpen);
  
  const variants = {
    default: "border-slate-200 bg-white",
    success: "border-green-200 bg-green-50/50",
    warning: "border-amber-200 bg-amber-50/50",
    error: "border-red-200 bg-red-50/50",
  };

  return (
    <div className={cn("border rounded-lg overflow-hidden", variants[variant])}>
      <button
        onClick={() => setOpen(!open)}
        className="w-full px-3 py-2 flex items-center justify-between hover:bg-slate-50/50 transition-colors"
      >
        <div className="flex items-center gap-2">
          <Icon className="h-4 w-4 text-slate-500" />
          <span className="font-medium text-sm">{title}</span>
          {count !== undefined && (
            <Badge variant="secondary" className="text-xs">
              {count}
            </Badge>
          )}
        </div>
        {open ? (
          <ChevronDown className="h-4 w-4 text-slate-400" />
        ) : (
          <ChevronRight className="h-4 w-4 text-slate-400" />
        )}
      </button>
      {open && (
        <div className="px-3 pb-3 pt-1 border-t bg-white/50">
          {children}
        </div>
      )}
    </div>
  );
}

// Market data display
function MarketDataSection({ data }: { data: MarketDataResult[] }) {
  if (!data?.length) return <p className="text-sm text-slate-400">No market data</p>;
  
  return (
    <div className="space-y-2">
      {data.map((item) => (
        <div key={item.symbol} className="flex items-center justify-between p-2 bg-slate-50 rounded">
          <div>
            <span className="font-semibold">{item.symbol}</span>
            <span className="ml-2 text-slate-600">${item.price.toFixed(2)}</span>
          </div>
          <div className={cn(
            "flex items-center gap-1 text-sm font-medium",
            item.changePercent >= 0 ? "text-green-600" : "text-red-600"
          )}>
            {item.changePercent >= 0 ? (
              <TrendingUp className="h-3.5 w-3.5" />
            ) : (
              <TrendingDown className="h-3.5 w-3.5" />
            )}
            {item.changePercent >= 0 ? "+" : ""}{item.changePercent.toFixed(2)}%
          </div>
        </div>
      ))}
    </div>
  );
}

// News display
function NewsSection({ data }: { data: NewsResult[] }) {
  if (!data?.length) return <p className="text-sm text-slate-400">No news articles</p>;
  
  return (
    <div className="space-y-2 max-h-48 overflow-y-auto">
      {data.slice(0, 5).map((item, index) => (
        <div key={item.id || `news-${index}`} className="p-2 bg-slate-50 rounded text-sm">
          <div className="flex items-start justify-between gap-2">
            <p className="font-medium line-clamp-2">{item.headline}</p>
            <Badge 
              variant={item.sentiment > 0.1 ? "default" : item.sentiment < -0.1 ? "destructive" : "secondary"}
              className="shrink-0 text-xs"
            >
              {item.sentiment > 0.1 ? "+" : ""}{(item.sentiment * 100).toFixed(0)}%
            </Badge>
          </div>
          <div className="flex items-center gap-2 mt-1 text-xs text-slate-400">
            <span>{item.source}</span>
            <span>|</span>
            <span>{item.symbols.join(", ")}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

// Technical analysis display
function TechnicalSection({ data }: { data: TechnicalAnalysis[] }) {
  if (!data?.length) return <p className="text-sm text-slate-400">No technical analysis</p>;
  
  return (
    <div className="space-y-2">
      {data.map((item) => (
        <div key={item.symbol} className="p-2 bg-slate-50 rounded">
          <div className="flex items-center justify-between mb-2">
            <span className="font-semibold">{item.symbol}</span>
            <Badge 
              variant={item.signal === "bullish" ? "default" : item.signal === "bearish" ? "destructive" : "secondary"}
            >
              {item.signal.toUpperCase()}
            </Badge>
          </div>
          <div className="grid grid-cols-2 gap-2 text-xs">
            {item.indicators.rsi && (
              <div>
                <span className="text-slate-400">RSI:</span>{" "}
                <span className={cn(
                  item.indicators.rsi > 70 ? "text-red-600" : 
                  item.indicators.rsi < 30 ? "text-green-600" : "text-slate-600"
                )}>
                  {item.indicators.rsi.toFixed(1)}
                </span>
              </div>
            )}
            <div>
              <span className="text-slate-400">Strength:</span>{" "}
              <span>{(item.strength * 100).toFixed(0)}%</span>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// Sentiment display
function SentimentSection({ data }: { data: SentimentAnalysis[] }) {
  if (!data?.length) return <p className="text-sm text-slate-400">No sentiment analysis</p>;
  
  return (
    <div className="space-y-2">
      {data.map((item) => (
        <div key={item.symbol} className="p-2 bg-slate-50 rounded">
          <div className="flex items-center justify-between">
            <span className="font-semibold">{item.symbol}</span>
            <div className="flex items-center gap-2">
              {item.overall === "bullish" && <TrendingUp className="h-4 w-4 text-green-500" />}
              {item.overall === "bearish" && <TrendingDown className="h-4 w-4 text-red-500" />}
              {item.overall === "neutral" && <Minus className="h-4 w-4 text-slate-400" />}
              <Badge 
                variant={item.overall === "bullish" ? "default" : item.overall === "bearish" ? "destructive" : "secondary"}
              >
                {(item.score * 100).toFixed(0)}%
              </Badge>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// Decisions display
function DecisionsSection({ data }: { data: Decision[] }) {
  if (!data?.length) return <p className="text-sm text-slate-400">No decisions made</p>;
  
  return (
    <div className="space-y-2">
      {data.map((item, index) => (
        <div key={item.id || `decision-${item.symbol}-${index}`} className={cn(
          "p-3 rounded border-l-4",
          item.action === "BUY" ? "border-l-green-500 bg-green-50" :
          item.action === "SELL" ? "border-l-red-500 bg-red-50" :
          "border-l-slate-300 bg-slate-50"
        )}>
          <div className="flex items-center justify-between mb-1">
            <div className="flex items-center gap-2">
              <span className="font-bold">{item.symbol}</span>
              <Badge 
                variant={item.action === "BUY" ? "default" : item.action === "SELL" ? "destructive" : "secondary"}
              >
                {item.action}
              </Badge>
            </div>
            <span className="text-sm font-medium">
              {(item.confidence * 100).toFixed(0)}% confident
            </span>
          </div>
          <p className="text-sm text-slate-600 line-clamp-2">{item.reasoning}</p>
          {item.quantity && (
            <p className="text-xs text-slate-400 mt-1">Quantity: {item.quantity}</p>
          )}
        </div>
      ))}
    </div>
  );
}

// Orders display
function OrdersSection({ data }: { data: Order[] }) {
  if (!data?.length) return <p className="text-sm text-slate-400">No orders executed</p>;
  
  return (
    <div className="space-y-2">
      {data.map((item, index) => (
        <div key={item.id || `order-${item.symbol}-${index}`} className="flex items-center justify-between p-2 bg-slate-50 rounded">
          <div className="flex items-center gap-2">
            <Badge variant={item.side === "buy" ? "default" : "destructive"} className="text-xs">
              {item.side.toUpperCase()}
            </Badge>
            <span className="font-medium">{item.symbol}</span>
            <span className="text-sm text-slate-500">x{item.quantity}</span>
          </div>
          <div className="flex items-center gap-2">
            {item.price && <span className="text-sm">${item.price.toFixed(2)}</span>}
            <Badge 
              variant={item.status === "filled" ? "default" : item.status === "rejected" ? "destructive" : "secondary"}
              className="text-xs"
            >
              {item.status}
            </Badge>
          </div>
        </div>
      ))}
    </div>
  );
}

// Risk assessment display
function RiskSection({ data }: { data: RiskAssessment }) {
  return (
    <div className={cn(
      "p-3 rounded-lg border",
      data.approved ? "border-green-200 bg-green-50" : "border-red-200 bg-red-50"
    )}>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          {data.approved ? (
            <CheckCircle className="h-5 w-5 text-green-500" />
          ) : (
            <XCircle className="h-5 w-5 text-red-500" />
          )}
          <span className="font-semibold">
            {data.approved ? "Approved" : "Rejected"}
          </span>
        </div>
        <Badge variant={data.riskScore > 50 ? "destructive" : data.riskScore > 25 ? "warning" : "default"}>
          Risk: {data.riskScore}%
        </Badge>
      </div>
      
      {data.concerns && data.concerns.length > 0 && (
        <div className="mt-2">
          <p className="text-xs text-slate-500 mb-1">Concerns:</p>
          <ul className="text-sm space-y-1">
            {data.concerns.map((concern, i) => (
              <li key={i} className="flex items-start gap-1 text-amber-700">
                <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                {concern}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// Debate results display
function DebateSection({ data }: { data: DebateResult[] }) {
  if (!data?.length) return <p className="text-sm text-slate-400">No debate results</p>;
  
  return (
    <div className="space-y-4">
      {data.map((debate) => (
        <div key={debate.symbol} className="space-y-3">
          {/* Header with verdict */}
          <div className={cn(
            "p-3 rounded-lg border-l-4",
            debate.verdict === "bullish" ? "border-l-green-500 bg-green-50" :
            debate.verdict === "bearish" ? "border-l-red-500 bg-red-50" :
            "border-l-slate-400 bg-slate-50"
          )}>
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <span className="font-bold text-lg">{debate.symbol}</span>
                <Badge 
                  variant={debate.verdict === "bullish" ? "default" : debate.verdict === "bearish" ? "destructive" : "secondary"}
                  className="uppercase"
                >
                  {debate.verdict}
                </Badge>
              </div>
              <span className="text-sm font-medium">
                {(debate.confidence * 100).toFixed(0)}% confident
              </span>
            </div>
            <p className="text-sm text-slate-600">{debate.summary}</p>
            {debate.recommendation && (
              <p className="text-sm font-medium mt-2 text-slate-700">
                Recommendation: {debate.recommendation}
              </p>
            )}
            {debate.riskRewardRatio && (
              <p className="text-xs text-slate-500 mt-1">
                Risk/Reward: {debate.riskRewardRatio.toFixed(2)}
              </p>
            )}
          </div>
          
          {/* Bull vs Bear comparison */}
          <div className="grid grid-cols-2 gap-2">
            {/* Bull Case */}
            <div className="p-2 bg-green-50 rounded border border-green-200">
              <div className="flex items-center gap-1 mb-2">
                <TrendingUp className="h-4 w-4 text-green-600" />
                <span className="font-semibold text-sm text-green-700">Bull Case</span>
                <Badge variant="outline" className="ml-auto text-xs text-green-600 border-green-300">
                  {(debate.bullCase.confidence * 100).toFixed(0)}%
                </Badge>
              </div>
              <p className="text-xs text-green-800 mb-2">{debate.bullCase.thesis}</p>
              {debate.bullCase.keyPoints && debate.bullCase.keyPoints.length > 0 && (
                <ul className="text-xs space-y-1">
                  {debate.bullCase.keyPoints.slice(0, 3).map((point, i) => (
                    <li key={i} className="text-green-700 flex items-start gap-1">
                      <span className="text-green-500">+</span>
                      <span className="line-clamp-2">{point}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            
            {/* Bear Case */}
            <div className="p-2 bg-red-50 rounded border border-red-200">
              <div className="flex items-center gap-1 mb-2">
                <TrendingDown className="h-4 w-4 text-red-600" />
                <span className="font-semibold text-sm text-red-700">Bear Case</span>
                <Badge variant="outline" className="ml-auto text-xs text-red-600 border-red-300">
                  {(debate.bearCase.confidence * 100).toFixed(0)}%
                </Badge>
              </div>
              <p className="text-xs text-red-800 mb-2">{debate.bearCase.thesis}</p>
              {debate.bearCase.keyRisks && debate.bearCase.keyRisks.length > 0 && (
                <ul className="text-xs space-y-1">
                  {debate.bearCase.keyRisks.slice(0, 3).map((risk, i) => (
                    <li key={i} className="text-red-700 flex items-start gap-1">
                      <span className="text-red-500">-</span>
                      <span className="line-clamp-2">{risk}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
          
          {/* Strongest points summary */}
          {(debate.strongestBullPoints?.length > 0 || debate.strongestBearPoints?.length > 0) && (
            <div className="p-2 bg-slate-50 rounded text-xs">
              <p className="font-medium text-slate-600 mb-1">Key Takeaways:</p>
              <div className="grid grid-cols-2 gap-2">
                {debate.strongestBullPoints?.length > 0 && (
                  <div>
                    <p className="text-green-600 font-medium">Strongest Bull:</p>
                    <p className="text-slate-600 line-clamp-2">{debate.strongestBullPoints[0]}</p>
                  </div>
                )}
                {debate.strongestBearPoints?.length > 0 && (
                  <div>
                    <p className="text-red-600 font-medium">Strongest Bear:</p>
                    <p className="text-slate-600 line-clamp-2">{debate.strongestBearPoints[0]}</p>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// LLM Usage display
function LLMUsageSection({ data }: { data: LLMUsage[] }) {
  if (!data?.length) return <p className="text-sm text-slate-400">No LLM calls recorded</p>;
  
  // Group by model for summary
  const modelStats = data.reduce((acc, usage) => {
    const key = `${usage.provider}/${usage.model}`;
    if (!acc[key]) {
      acc[key] = { count: 0, totalLatency: 0, errors: 0, fallbacks: 0 };
    }
    acc[key].count++;
    if (usage.latencyMs) acc[key].totalLatency += usage.latencyMs;
    if (usage.error) acc[key].errors++;
    if (usage.fallbackFrom) acc[key].fallbacks++;
    return acc;
  }, {} as Record<string, { count: number; totalLatency: number; errors: number; fallbacks: number }>);
  
  const totalCalls = data.length;
  const totalFallbacks = data.filter(u => u.fallbackFrom).length;
  const totalErrors = data.filter(u => u.error).length;
  const avgLatency = data.reduce((sum, u) => sum + (u.latencyMs || 0), 0) / data.filter(u => u.latencyMs).length || 0;
  
  return (
    <div className="space-y-3">
      {/* Summary stats */}
      <div className="grid grid-cols-4 gap-2 text-xs">
        <div className="text-center p-2 bg-slate-50 rounded">
          <div className="text-slate-400">Total Calls</div>
          <div className="font-bold text-lg">{totalCalls}</div>
        </div>
        <div className="text-center p-2 bg-slate-50 rounded">
          <div className="text-slate-400">Avg Latency</div>
          <div className="font-bold text-lg">{avgLatency > 0 ? `${(avgLatency / 1000).toFixed(1)}s` : "-"}</div>
        </div>
        <div className="text-center p-2 bg-amber-50 rounded">
          <div className="text-amber-600">Fallbacks</div>
          <div className="font-bold text-lg text-amber-700">{totalFallbacks}</div>
        </div>
        <div className="text-center p-2 bg-red-50 rounded">
          <div className="text-red-400">Errors</div>
          <div className="font-bold text-lg text-red-600">{totalErrors}</div>
        </div>
      </div>
      
      {/* Models used */}
      <div className="space-y-1">
        <p className="text-xs font-medium text-slate-500">Models Used:</p>
        {Object.entries(modelStats).map(([model, stats]) => (
          <div key={model} className="flex items-center justify-between p-2 bg-slate-50 rounded text-xs">
            <div className="flex items-center gap-2">
              <Cpu className="h-3.5 w-3.5 text-slate-400" />
              <span className="font-medium">{model}</span>
            </div>
            <div className="flex items-center gap-3 text-slate-500">
              <span>{stats.count} calls</span>
              {stats.totalLatency > 0 && (
                <span className="flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  {(stats.totalLatency / stats.count / 1000).toFixed(1)}s avg
                </span>
              )}
              {stats.fallbacks > 0 && (
                <span className="text-amber-600">{stats.fallbacks} fallback</span>
              )}
              {stats.errors > 0 && (
                <span className="text-red-600">{stats.errors} error</span>
              )}
            </div>
          </div>
        ))}
      </div>
      
      {/* Recent calls with fallback info */}
      {totalFallbacks > 0 && (
        <div className="space-y-1">
          <p className="text-xs font-medium text-slate-500">Fallback Events:</p>
          <div className="max-h-32 overflow-y-auto space-y-1">
            {data.filter(u => u.fallbackFrom).map((usage, i) => (
              <div key={i} className="p-2 bg-amber-50 rounded text-xs border border-amber-200">
                <div className="flex items-center gap-1 text-amber-700">
                  <span className="font-medium">{usage.fallbackFrom?.provider}/{usage.fallbackFrom?.model}</span>
                  <ArrowRight className="h-3 w-3" />
                  <span className="font-medium text-green-700">{usage.provider}/{usage.model}</span>
                </div>
                {usage.latencyMs && (
                  <span className="text-amber-600 text-xs">Completed in {(usage.latencyMs / 1000).toFixed(1)}s</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
      
      {/* Errors */}
      {totalErrors > 0 && (
        <div className="space-y-1">
          <p className="text-xs font-medium text-slate-500">Errors:</p>
          <div className="max-h-32 overflow-y-auto space-y-1">
            {data.filter(u => u.error).slice(-5).map((usage, i) => (
              <div key={i} className="p-2 bg-red-50 rounded text-xs border border-red-200">
                <div className="flex items-center gap-1 text-red-700">
                  <XCircle className="h-3 w-3" />
                  <span className="font-medium">{usage.provider}/{usage.model}</span>
                </div>
                <p className="text-red-600 mt-1 line-clamp-2">{usage.error}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// Quick Score display for discovery tier
function QuickScoreCard({ score }: { score: QuickScore }) {
  const getRecommendationColor = (rec: string) => {
    switch (rec) {
      case "strong_buy": return "text-green-700 bg-green-100";
      case "buy": return "text-green-600 bg-green-50";
      case "hold": return "text-slate-600 bg-slate-100";
      case "sell": return "text-red-600 bg-red-50";
      case "strong_sell": return "text-red-700 bg-red-100";
      default: return "text-slate-500 bg-slate-50";
    }
  };
  
  return (
    <div className="p-2 bg-slate-50 rounded border border-slate-200">
      <div className="flex items-center justify-between mb-2">
        <span className="font-semibold">{score.symbol}</span>
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">{score.score}/100</span>
          <Badge className={cn("text-xs", getRecommendationColor(score.recommendation))}>
            {score.recommendation.replace("_", " ").toUpperCase()}
          </Badge>
        </div>
      </div>
      <div className="grid grid-cols-4 gap-1 text-xs">
        <div className="text-center p-1 bg-white rounded">
          <div className="text-slate-400">Tech</div>
          <div className="font-medium">{score.technicalScore}</div>
        </div>
        <div className="text-center p-1 bg-white rounded">
          <div className="text-slate-400">Sent</div>
          <div className="font-medium">{score.sentimentScore}</div>
        </div>
        <div className="text-center p-1 bg-white rounded">
          <div className="text-slate-400">Fund</div>
          <div className="font-medium">{score.fundamentalScore}</div>
        </div>
        <div className="text-center p-1 bg-white rounded">
          <div className="text-slate-400">Mom</div>
          <div className="font-medium">{score.momentumScore}</div>
        </div>
      </div>
      {score.signals.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {score.signals.slice(0, 3).map((signal, i) => (
            <span key={i} className="text-xs px-1.5 py-0.5 bg-amber-50 text-amber-700 rounded">
              {signal}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// Batch debate result display
function BatchDebateCard({ batch }: { batch: BatchDebateResult }) {
  return (
    <div className={cn(
      "p-3 rounded-lg border-l-4",
      batch.verdict === "bullish" ? "border-l-green-500 bg-green-50/50" :
      batch.verdict === "bearish" ? "border-l-red-500 bg-red-50/50" :
      batch.verdict === "mixed" ? "border-l-amber-500 bg-amber-50/50" :
      "border-l-slate-400 bg-slate-50/50"
    )}>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-xs">
            {batch.tier.toUpperCase()}
          </Badge>
          <span className="text-sm font-medium">{batch.symbols.join(", ")}</span>
        </div>
        <Badge 
          variant={batch.verdict === "bullish" ? "default" : batch.verdict === "bearish" ? "destructive" : "secondary"}
        >
          {batch.verdict.toUpperCase()} ({(batch.confidence * 100).toFixed(0)}%)
        </Badge>
      </div>
      <p className="text-sm text-slate-600 mb-2">{batch.summary}</p>
      
      {/* Symbol-level analysis */}
      {batch.symbolAnalysis && batch.symbolAnalysis.length > 0 && (
        <div className="space-y-1 mb-2">
          {batch.symbolAnalysis.map((sym) => (
            <div key={sym.symbol} className="flex items-center justify-between text-xs p-1.5 bg-white/50 rounded">
              <div className="flex items-center gap-2">
                <span className="font-medium">{sym.symbol}</span>
                <span className="text-slate-500">{sym.keyPoint}</span>
              </div>
              <Badge 
                variant={sym.verdict === "bullish" ? "default" : sym.verdict === "bearish" ? "destructive" : "secondary"}
                className="text-xs"
              >
                {sym.recommendation}
              </Badge>
            </div>
          ))}
        </div>
      )}
      
      {/* Top opportunities and risks */}
      <div className="grid grid-cols-2 gap-2 text-xs">
        {batch.topOpportunities?.length > 0 && (
          <div className="p-1.5 bg-green-50 rounded">
            <p className="font-medium text-green-700 mb-1">Opportunities</p>
            <ul className="space-y-0.5">
              {batch.topOpportunities.slice(0, 2).map((opp, i) => (
                <li key={i} className="text-green-600 flex items-start gap-1">
                  <span>+</span>
                  <span className="line-clamp-1">{opp}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {batch.topRisks?.length > 0 && (
          <div className="p-1.5 bg-red-50 rounded">
            <p className="font-medium text-red-700 mb-1">Risks</p>
            <ul className="space-y-0.5">
              {batch.topRisks.slice(0, 2).map((risk, i) => (
                <li key={i} className="text-red-600 flex items-start gap-1">
                  <span>-</span>
                  <span className="line-clamp-1">{risk}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

// Tiered debate results display
function TieredDebateSection({ data }: { data: TieredDebateResults }) {
  const [activeTab, setActiveTab] = useState<"holdings" | "watchlist" | "discovery">("holdings");
  
  return (
    <div className="space-y-3">
      {/* Summary stats */}
      <div className="p-3 bg-emerald-50 rounded-lg border border-emerald-200">
        <div className="flex items-center gap-2 mb-2">
          <Zap className="h-4 w-4 text-emerald-600" />
          <span className="font-semibold text-emerald-700">Smart Debate Summary</span>
        </div>
        <div className="grid grid-cols-3 gap-2 text-xs">
          <div className="text-center p-2 bg-white rounded">
            <div className="text-slate-400">Total Symbols</div>
            <div className="font-bold text-lg">{data.summary.totalSymbols}</div>
          </div>
          <div className="text-center p-2 bg-white rounded">
            <div className="text-slate-400">LLM Calls</div>
            <div className="font-bold text-lg">{data.summary.llmCalls}</div>
          </div>
          <div className="text-center p-2 bg-white rounded">
            <div className="text-slate-400">Savings</div>
            <div className="font-bold text-lg text-emerald-600">{data.summary.llmSavings}</div>
          </div>
        </div>
        <div className="mt-2 text-xs text-emerald-600 text-center">
          Completed in {(data.summary.durationMs / 1000).toFixed(1)}s 
          (vs ~{data.summary.estimatedNonTieredLlmCalls} calls traditional)
        </div>
      </div>
      
      {/* Tier tabs */}
      <div className="flex gap-1 p-1 bg-slate-100 rounded-lg">
        <button
          onClick={() => setActiveTab("holdings")}
          className={cn(
            "flex-1 py-1.5 px-2 rounded text-xs font-medium transition-colors",
            activeTab === "holdings" 
              ? "bg-white shadow text-slate-800" 
              : "text-slate-500 hover:text-slate-700"
          )}
        >
          <Target className="h-3 w-3 inline mr-1" />
          Holdings ({data.holdingsDebates?.length || 0})
        </button>
        <button
          onClick={() => setActiveTab("watchlist")}
          className={cn(
            "flex-1 py-1.5 px-2 rounded text-xs font-medium transition-colors",
            activeTab === "watchlist" 
              ? "bg-white shadow text-slate-800" 
              : "text-slate-500 hover:text-slate-700"
          )}
        >
          <Layers className="h-3 w-3 inline mr-1" />
          Watchlist ({data.summary.watchlistAnalyzed || 0})
        </button>
        <button
          onClick={() => setActiveTab("discovery")}
          className={cn(
            "flex-1 py-1.5 px-2 rounded text-xs font-medium transition-colors",
            activeTab === "discovery" 
              ? "bg-white shadow text-slate-800" 
              : "text-slate-500 hover:text-slate-700"
          )}
        >
          <Zap className="h-3 w-3 inline mr-1" />
          Discovery ({data.summary.discoveryScored || 0})
        </button>
      </div>
      
      {/* Tab content */}
      <div className="space-y-2">
        {activeTab === "holdings" && (
          <>
            <p className="text-xs text-slate-500 px-1">
              Full individual bull/bear debate for each holding
            </p>
            {data.holdingsDebates && data.holdingsDebates.length > 0 ? (
              <DebateSection data={data.holdingsDebates} />
            ) : (
              <p className="text-sm text-slate-400 text-center py-4">No holdings analyzed</p>
            )}
          </>
        )}
        
        {activeTab === "watchlist" && (
          <>
            <p className="text-xs text-slate-500 px-1">
              Batch analysis for watched symbols
            </p>
            {data.watchlistDebates && data.watchlistDebates.length > 0 ? (
              <div className="space-y-2">
                {data.watchlistDebates.map((batch, i) => (
                  <BatchDebateCard key={i} batch={batch} />
                ))}
              </div>
            ) : (
              <p className="text-sm text-slate-400 text-center py-4">No watchlist analyzed</p>
            )}
          </>
        )}
        
        {activeTab === "discovery" && (
          <>
            <p className="text-xs text-slate-500 px-1">
              Quick scores (no LLM) + batch debate for top candidates
            </p>
            
            {/* Discovery batch debates */}
            {data.discoveryDebates && data.discoveryDebates.length > 0 && (
              <div className="space-y-2 mb-3">
                <p className="text-xs font-medium text-slate-600 px-1">Top Candidates Debated:</p>
                {data.discoveryDebates.map((batch, i) => (
                  <BatchDebateCard key={i} batch={batch} />
                ))}
              </div>
            )}
            
            {/* Quick scores */}
            {data.discoveryScores && data.discoveryScores.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-medium text-slate-600 px-1">All Discovery Scores:</p>
                <div className="max-h-64 overflow-y-auto space-y-2">
                  {data.discoveryScores
                    .sort((a, b) => b.score - a.score)
                    .map((score) => (
                      <QuickScoreCard key={score.symbol} score={score} />
                    ))}
                </div>
              </div>
            )}
            
            {(!data.discoveryScores || data.discoveryScores.length === 0) && 
             (!data.discoveryDebates || data.discoveryDebates.length === 0) && (
              <p className="text-sm text-slate-400 text-center py-4">No discovery symbols analyzed</p>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export function ResultsPanel({ results, loading }: ResultsPanelProps) {
  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="animate-pulse text-slate-400">Loading results...</div>
      </div>
    );
  }

  if (!results) {
    return (
      <div className="flex items-center justify-center h-full text-center text-slate-400">
        <div>
          <Wallet className="h-12 w-12 mx-auto mb-3 opacity-50" />
          <p className="font-medium">No results</p>
          <p className="text-sm">Select an execution to view results</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      <div className="px-3 py-2 border-b bg-slate-50/50 shrink-0">
        <h3 className="font-semibold text-sm text-slate-700">Execution Results</h3>
      </div>
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
      
      {/* Tiered Debate Results - Show FIRST when present (primary result for debates) */}
      {results.tieredDebateResults && (
        <Section 
          title="Smart Tiered Debate" 
          icon={Zap} 
          count={results.tieredDebateResults.summary?.totalSymbols}
          variant="success"
          defaultOpen
        >
          <TieredDebateSection data={results.tieredDebateResults} />
        </Section>
      )}
      
      {/* Debate Results - Show first when present (primary result for single debates) */}
      {results.debateResults && results.debateResults.length > 0 && (
        <Section 
          title="Bull vs Bear Debate" 
          icon={Swords} 
          count={results.debateResults.length}
          variant="success"
          defaultOpen
        >
          <DebateSection data={results.debateResults} />
        </Section>
      )}
      
      {/* Decisions - Important results */}
      {results.decisions && results.decisions.length > 0 && (
        <Section 
          title="Decisions" 
          icon={Brain} 
          count={results.decisions.length}
          variant="success"
          defaultOpen
        >
          <DecisionsSection data={results.decisions} />
        </Section>
      )}
      
      {/* Risk Assessment */}
      {results.riskAssessment && (
        <Section 
          title="Risk Assessment" 
          icon={ShieldCheck}
          variant={results.riskAssessment.approved ? "success" : "error"}
          defaultOpen
        >
          <RiskSection data={results.riskAssessment} />
        </Section>
      )}
      
      {/* Orders */}
      {results.orders && results.orders.length > 0 && (
        <Section 
          title="Orders" 
          icon={ShoppingCart} 
          count={results.orders.length}
          defaultOpen
        >
          <OrdersSection data={results.orders} />
        </Section>
      )}
      
      {/* Market Data - Supporting data, collapsed by default if debate results exist */}
      {results.marketData && results.marketData.length > 0 && (
        <Section 
          title="Market Data" 
          icon={TrendingUp} 
          count={results.marketData.length}
          defaultOpen={!results.tieredDebateResults && !results.debateResults?.length && !results.decisions?.length}
        >
          <MarketDataSection data={results.marketData} />
        </Section>
      )}
      
      {/* News */}
      {results.news && results.news.length > 0 && (
        <Section title="News" icon={Newspaper} count={results.news.length}>
          <NewsSection data={results.news} />
        </Section>
      )}
      
      {/* Social */}
      {results.socialMentions && results.socialMentions.length > 0 && (
        <Section title="Social" icon={MessageSquare} count={results.socialMentions.length}>
          <p className="text-sm text-slate-500">
            {results.socialMentions.length} mentions tracked
          </p>
        </Section>
      )}
      
      {/* Technical Analysis */}
      {results.technicalAnalysis && results.technicalAnalysis.length > 0 && (
        <Section title="Technical" icon={BarChart3} count={results.technicalAnalysis.length}>
          <TechnicalSection data={results.technicalAnalysis} />
        </Section>
      )}
      
      {/* Sentiment */}
      {results.sentimentAnalysis && results.sentimentAnalysis.length > 0 && (
        <Section title="Sentiment" icon={Brain} count={results.sentimentAnalysis.length}>
          <SentimentSection data={results.sentimentAnalysis} />
        </Section>
      )}
      
      {/* Fundamental */}
      {results.fundamentalAnalysis && results.fundamentalAnalysis.length > 0 && (
        <Section title="Fundamentals" icon={BarChart3} count={results.fundamentalAnalysis.length}>
          {results.fundamentalAnalysis.map((item) => (
            <div key={item.symbol} className="p-2 bg-slate-50 rounded flex items-center justify-between">
              <span className="font-medium">{item.symbol}</span>
              <div className="flex gap-2">
                <Badge variant={item.recommendation === "buy" ? "default" : item.recommendation === "sell" ? "destructive" : "secondary"}>
                  {item.recommendation.toUpperCase()}
                </Badge>
                <Badge variant="outline">{item.valuation}</Badge>
              </div>
            </div>
          ))}
        </Section>
      )}
      
      {/* Portfolio */}
      {results.portfolio && (
        <Section title="Portfolio" icon={Wallet}>
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div className="p-2 bg-slate-50 rounded">
              <p className="text-slate-400 text-xs">Total Value</p>
              <p className="font-semibold">${results.portfolio.totalValue.toLocaleString()}</p>
            </div>
            <div className="p-2 bg-slate-50 rounded">
              <p className="text-slate-400 text-xs">Cash</p>
              <p className="font-semibold">${results.portfolio.cash.toLocaleString()}</p>
            </div>
            {results.portfolio.dailyPnl !== undefined && (
              <div className="col-span-2 p-2 bg-slate-50 rounded">
                <p className="text-slate-400 text-xs">Daily P&L</p>
                <p className={cn(
                  "font-semibold",
                  results.portfolio.dailyPnl >= 0 ? "text-green-600" : "text-red-600"
                )}>
                  {results.portfolio.dailyPnl >= 0 ? "+" : ""}
                  ${results.portfolio.dailyPnl.toLocaleString()}
                  {results.portfolio.dailyPnlPercent !== undefined && (
                    <span className="text-sm ml-1">
                      ({results.portfolio.dailyPnlPercent >= 0 ? "+" : ""}
                      {results.portfolio.dailyPnlPercent.toFixed(2)}%)
                    </span>
                  )}
                </p>
              </div>
            )}
          </div>
        </Section>
      )}
      
      {/* LLM Usage - Shows which models were used, fallbacks, and performance */}
      {results.llmUsage && results.llmUsage.length > 0 && (
        <Section 
          title="LLM Usage" 
          icon={Cpu} 
          count={results.llmUsage.length}
        >
          <LLMUsageSection data={results.llmUsage} />
        </Section>
      )}
      </div>
    </div>
  );
}

export default ResultsPanel;
