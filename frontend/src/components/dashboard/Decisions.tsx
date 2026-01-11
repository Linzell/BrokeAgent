import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { TrendingUp, TrendingDown, Minus, Brain } from "lucide-react";

interface Decision {
  id: string;
  symbol: string;
  action: string;
  confidence: number;
  reasoning?: string;
  executed: boolean;
  outcome_pnl?: number;
  created_at: string;
  workflow_status?: string;
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleString();
}

function ActionBadge({ action }: { action: string }) {
  const variants: Record<string, "success" | "destructive" | "secondary"> = {
    buy: "success",
    sell: "destructive",
    hold: "secondary",
  };

  const icons: Record<string, React.ReactNode> = {
    buy: <TrendingUp className="h-3 w-3" />,
    sell: <TrendingDown className="h-3 w-3" />,
    hold: <Minus className="h-3 w-3" />,
  };

  return (
    <Badge variant={variants[action.toLowerCase()] || "secondary"}>
      {icons[action.toLowerCase()]}
      {action.toUpperCase()}
    </Badge>
  );
}

function ConfidenceBar({ confidence }: { confidence: number }) {
  const safeConfidence = Number(confidence) || 0;
  const percentage = Math.round(safeConfidence * 100);
  const color = 
    percentage >= 80 ? "bg-emerald-500" :
    percentage >= 60 ? "bg-amber-500" :
    "bg-red-500";

  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
        <div 
          className={`h-full ${color} transition-all`}
          style={{ width: `${percentage}%` }}
        />
      </div>
      <span className="text-xs font-medium w-10 text-right">{percentage}%</span>
    </div>
  );
}

export function Decisions() {
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchData() {
      setLoading(true);
      setError(null);

      const result = await api.portfolio.decisions(50);

      if (result.error) {
        setError(result.error);
      } else {
        setDecisions(result.data?.decisions || []);
      }

      setLoading(false);
    }

    fetchData();

    // Refresh every 30 seconds
    const interval = setInterval(fetchData, 30000);
    return () => clearInterval(interval);
  }, []);

  if (loading) {
    return (
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <Skeleton className="h-6 w-32" />
            <Skeleton className="h-4 w-48" />
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {[...Array(5)].map((_, i) => (
                <Skeleton key={i} className="h-24 w-full" />
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Group decisions by symbol
  const bySymbol = decisions.reduce<Record<string, Decision[]>>((acc, dec) => {
    if (!acc[dec.symbol]) acc[dec.symbol] = [];
    acc[dec.symbol].push(dec);
    return acc;
  }, {});

  // Get stats
  const stats = {
    total: decisions.length,
    buy: decisions.filter(d => d.action.toLowerCase() === "buy").length,
    sell: decisions.filter(d => d.action.toLowerCase() === "sell").length,
    hold: decisions.filter(d => d.action.toLowerCase() === "hold").length,
    avgConfidence: decisions.length > 0 
      ? decisions.reduce((sum, d) => sum + (Number(d.confidence) || 0), 0) / decisions.length 
      : 0,
  };

  return (
    <div className="space-y-6">
      {/* Stats */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Total Decisions</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.total}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-emerald-600">Buy Signals</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-emerald-600">{stats.buy}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-red-600">Sell Signals</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-600">{stats.sell}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Avg Confidence</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{Math.round(stats.avgConfidence * 100)}%</div>
          </CardContent>
        </Card>
      </div>

      {/* Decisions List */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Brain className="h-5 w-5" />
            Trading Decisions
          </CardTitle>
          <CardDescription>AI-generated trading recommendations</CardDescription>
        </CardHeader>
        <CardContent>
          {decisions.length > 0 ? (
            <div className="space-y-4">
              {decisions.map((decision) => (
                <div
                  key={decision.id}
                  className="p-4 border rounded-lg space-y-3"
                >
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <span className="text-lg font-bold">{decision.symbol}</span>
                      <ActionBadge action={decision.action} />
                      {decision.executed && (
                        <Badge variant="outline" className="text-xs">
                          Executed
                        </Badge>
                      )}
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {formatDate(decision.created_at)}
                    </span>
                  </div>
                  
                  <div className="space-y-1">
                    <span className="text-xs text-muted-foreground">Confidence</span>
                    <ConfidenceBar confidence={decision.confidence} />
                  </div>

                  {decision.reasoning && (
                    <div className="pt-2 border-t">
                      <p className="text-sm text-muted-foreground">
                        {decision.reasoning}
                      </p>
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-12">
              <Brain className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <p className="text-muted-foreground">
                No trading decisions yet.
              </p>
              <p className="text-sm text-muted-foreground mt-2">
                Run a trading workflow to generate AI recommendations.
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default Decisions;
