import { useState, useEffect, useMemo } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { 
  TrendingUp, 
  TrendingDown, 
  BarChart3, 
  Target, 
  AlertTriangle,
  DollarSign,
  Percent,
  Activity,
  Calendar
} from "lucide-react";

// ============================================
// Types
// ============================================

interface Decision {
  id: string;
  symbol: string;
  action: string;
  confidence: number;
  executed: boolean;
  outcome_pnl?: number;
  created_at: string;
}

interface PerformanceStats {
  totalDecisions: number;
  executedDecisions: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;
  totalPnL: number;
  avgWin: number;
  avgLoss: number;
  profitFactor: number;
  avgConfidence: number;
  bestTrade: { symbol: string; pnl: number } | null;
  worstTrade: { symbol: string; pnl: number } | null;
  bySymbol: Record<string, { trades: number; pnl: number; winRate: number }>;
  byAction: Record<string, { count: number; avgConfidence: number }>;
  dateRange: { start: string; end: string } | null;
}

export type TimePeriod = "7d" | "30d" | "90d" | "all";

export const timePeriodLabels: Record<TimePeriod, string> = {
  "7d": "Last 7 Days",
  "30d": "Last 30 Days",
  "90d": "Last 90 Days",
  "all": "All Time",
};

// ============================================
// Performance Metrics Component
// ============================================

interface PerformanceMetricsProps {
  timePeriod?: TimePeriod;
  onDateRangeChange?: (dateRange: { start: string; end: string } | null) => void;
  hideTimePeriodSelector?: boolean;
}

export function PerformanceMetrics({ 
  timePeriod: externalTimePeriod, 
  onDateRangeChange,
  hideTimePeriodSelector = false 
}: PerformanceMetricsProps) {
  const [allDecisions, setAllDecisions] = useState<Decision[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [internalTimePeriod, setInternalTimePeriod] = useState<TimePeriod>("30d");
  
  // Use external time period if provided, otherwise use internal state
  const timePeriod = externalTimePeriod ?? internalTimePeriod;
  const setTimePeriod = externalTimePeriod ? undefined : setInternalTimePeriod;

  // Fetch decisions
  useEffect(() => {
    async function fetchData() {
      setLoading(true);
      const response = await api.portfolio.decisions(500);
      
      if (response.error) {
        setError(response.error);
      } else if (response.data) {
        setAllDecisions(response.data.decisions || []);
      }
      setLoading(false);
    }

    fetchData();
    // Refresh every 2 minutes
    const interval = setInterval(fetchData, 120000);
    return () => clearInterval(interval);
  }, []);

  // Filter decisions by time period and calculate stats
  const stats = useMemo(() => {
    if (allDecisions.length === 0) return null;

    // Filter by time period
    const now = new Date();
    let cutoffDate: Date | null = null;
    
    if (timePeriod === "7d") {
      cutoffDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    } else if (timePeriod === "30d") {
      cutoffDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    } else if (timePeriod === "90d") {
      cutoffDate = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
    }

    const filteredDecisions = cutoffDate
      ? allDecisions.filter(d => new Date(d.created_at) >= cutoffDate!)
      : allDecisions;

    return calculateStats(filteredDecisions);
  }, [allDecisions, timePeriod]);

  // Report date range changes to parent
  useEffect(() => {
    if (onDateRangeChange) {
      onDateRangeChange(stats?.dateRange || null);
    }
  }, [stats?.dateRange, onDateRangeChange]);

  // Calculate statistics from decisions
  function calculateStats(decisions: Decision[]): PerformanceStats {
    if (decisions.length === 0) {
      return {
        totalDecisions: 0,
        executedDecisions: 0,
        winningTrades: 0,
        losingTrades: 0,
        winRate: 0,
        totalPnL: 0,
        avgWin: 0,
        avgLoss: 0,
        profitFactor: 0,
        avgConfidence: 0,
        bestTrade: null,
        worstTrade: null,
        bySymbol: {},
        byAction: {},
        dateRange: null,
      };
    }

    const executedDecisions = decisions.filter(d => d.executed);
    const tradesWithOutcome = executedDecisions.filter(d => d.outcome_pnl !== undefined && d.outcome_pnl !== null);
    
    const winningTrades = tradesWithOutcome.filter(d => Number(d.outcome_pnl) > 0);
    const losingTrades = tradesWithOutcome.filter(d => Number(d.outcome_pnl) < 0);
    
    const totalPnL = tradesWithOutcome.reduce((sum, d) => sum + Number(d.outcome_pnl || 0), 0);
    const totalWins = winningTrades.reduce((sum, d) => sum + Number(d.outcome_pnl || 0), 0);
    const totalLosses = Math.abs(losingTrades.reduce((sum, d) => sum + Number(d.outcome_pnl || 0), 0));
    
    const avgWin = winningTrades.length > 0 ? totalWins / winningTrades.length : 0;
    const avgLoss = losingTrades.length > 0 ? totalLosses / losingTrades.length : 0;
    
    const avgConfidence = decisions.length > 0
      ? decisions.reduce((sum, d) => sum + Number(d.confidence || 0), 0) / decisions.length
      : 0;

    // Find best and worst trades
    let bestTrade: { symbol: string; pnl: number } | null = null;
    let worstTrade: { symbol: string; pnl: number } | null = null;
    
    tradesWithOutcome.forEach(d => {
      const pnl = Number(d.outcome_pnl);
      if (!bestTrade || pnl > bestTrade.pnl) {
        bestTrade = { symbol: d.symbol, pnl };
      }
      if (!worstTrade || pnl < worstTrade.pnl) {
        worstTrade = { symbol: d.symbol, pnl };
      }
    });

    // Stats by symbol
    const bySymbol: Record<string, { trades: number; pnl: number; wins: number }> = {};
    tradesWithOutcome.forEach(d => {
      if (!bySymbol[d.symbol]) {
        bySymbol[d.symbol] = { trades: 0, pnl: 0, wins: 0 };
      }
      bySymbol[d.symbol].trades++;
      bySymbol[d.symbol].pnl += Number(d.outcome_pnl || 0);
      if (Number(d.outcome_pnl) > 0) bySymbol[d.symbol].wins++;
    });

    // Stats by action
    const byAction: Record<string, { count: number; totalConfidence: number }> = {};
    decisions.forEach(d => {
      const action = d.action.toLowerCase();
      if (!byAction[action]) {
        byAction[action] = { count: 0, totalConfidence: 0 };
      }
      byAction[action].count++;
      byAction[action].totalConfidence += Number(d.confidence || 0);
    });

    // Date range
    const dates = decisions.map(d => new Date(d.created_at).getTime());
    const dateRange = dates.length > 0 
      ? {
          start: new Date(Math.min(...dates)).toLocaleDateString(),
          end: new Date(Math.max(...dates)).toLocaleDateString(),
        }
      : null;

    return {
      totalDecisions: decisions.length,
      executedDecisions: executedDecisions.length,
      winningTrades: winningTrades.length,
      losingTrades: losingTrades.length,
      winRate: tradesWithOutcome.length > 0 ? (winningTrades.length / tradesWithOutcome.length) * 100 : 0,
      totalPnL,
      avgWin,
      avgLoss,
      profitFactor: totalLosses > 0 ? totalWins / totalLosses : totalWins > 0 ? Infinity : 0,
      avgConfidence,
      bestTrade,
      worstTrade,
      bySymbol: Object.fromEntries(
        Object.entries(bySymbol).map(([symbol, data]) => [
          symbol,
          { trades: data.trades, pnl: data.pnl, winRate: (data.wins / data.trades) * 100 }
        ])
      ),
      byAction: Object.fromEntries(
        Object.entries(byAction).map(([action, data]) => [
          action,
          { count: data.count, avgConfidence: data.totalConfidence / data.count }
        ])
      ),
      dateRange,
    };
  }

  if (loading) {
    return (
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {[...Array(4)].map((_, i) => (
          <Card key={i}>
            <CardHeader className="pb-2">
              <Skeleton className="h-4 w-24" />
            </CardHeader>
            <CardContent>
              <Skeleton className="h-8 w-20" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <Card className="border-destructive">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="h-5 w-5" />
            Error Loading Performance Data
          </CardTitle>
          <CardDescription>{error}</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  if (allDecisions.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <BarChart3 className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
          <h3 className="text-lg font-medium mb-2">No Performance Data Yet</h3>
          <p className="text-muted-foreground max-w-md mx-auto">
            Run some trading workflows to start tracking performance metrics.
            Stats will appear here once you have trading decisions.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Time Period Selector - only show if not hidden */}
      {!hideTimePeriodSelector && (
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Calendar className="h-4 w-4" />
            {stats?.dateRange ? (
              <span>
                {timePeriod === "all" ? "All data" : timePeriodLabels[timePeriod]}: {stats.dateRange.start} - {stats.dateRange.end}
              </span>
            ) : (
              <span>No data in selected period</span>
            )}
          </div>
          <div className="flex gap-1">
            {(Object.keys(timePeriodLabels) as TimePeriod[]).map((period) => (
              <Button
                key={period}
                variant={timePeriod === period ? "default" : "outline"}
                size="sm"
                onClick={() => setTimePeriod && setTimePeriod(period)}
                disabled={!setTimePeriod}
              >
                {period === "all" ? "All" : period}
              </Button>
            ))}
          </div>
        </div>
      )}

      {/* Key Metrics Grid */}
      {stats && stats.totalDecisions > 0 ? (
        <>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            {/* Total P&L */}
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Total P&L</CardTitle>
                <DollarSign className={cn(
                  "h-4 w-4",
                  stats.totalPnL >= 0 ? "text-emerald-500" : "text-red-500"
                )} />
              </CardHeader>
              <CardContent>
                <div className={cn(
                  "text-2xl font-bold",
                  stats.totalPnL >= 0 ? "text-emerald-500" : "text-red-500"
                )}>
                  {stats.totalPnL >= 0 ? "+" : ""}${stats.totalPnL.toFixed(2)}
                </div>
                <p className="text-xs text-muted-foreground">
                  From {stats.winningTrades + stats.losingTrades} closed trades
                </p>
              </CardContent>
            </Card>

            {/* Win Rate */}
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Win Rate</CardTitle>
                <Target className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className={cn(
                  "text-2xl font-bold",
                  stats.winRate >= 50 ? "text-emerald-500" : "text-amber-500"
                )}>
                  {stats.winRate.toFixed(1)}%
                </div>
                <p className="text-xs text-muted-foreground">
                  {stats.winningTrades}W / {stats.losingTrades}L
                </p>
              </CardContent>
            </Card>

            {/* Profit Factor */}
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Profit Factor</CardTitle>
                <Activity className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className={cn(
                  "text-2xl font-bold",
                  stats.profitFactor >= 1 ? "text-emerald-500" : "text-red-500"
                )}>
                  {stats.profitFactor === Infinity ? "∞" : stats.profitFactor.toFixed(2)}
                </div>
                <p className="text-xs text-muted-foreground">
                  {stats.profitFactor >= 1.5 ? "Good" : stats.profitFactor >= 1 ? "Marginal" : "Needs improvement"}
                </p>
              </CardContent>
            </Card>

            {/* Avg Confidence */}
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Avg Confidence</CardTitle>
                <Percent className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {(stats.avgConfidence * 100).toFixed(0)}%
                </div>
                <p className="text-xs text-muted-foreground">
                  Across {stats.totalDecisions} decisions
                </p>
              </CardContent>
            </Card>
          </div>

          {/* Detailed Stats */}
          <div className="grid gap-4 md:grid-cols-2">
            {/* Trade Statistics */}
            <Card>
              <CardHeader>
                <CardTitle>Trade Statistics</CardTitle>
                <CardDescription>Win/loss analysis for {timePeriodLabels[timePeriod].toLowerCase()}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">Average Win</span>
                      <span className="font-medium text-emerald-500">
                        +${stats.avgWin.toFixed(2)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">Average Loss</span>
                      <span className="font-medium text-red-500">
                        -${stats.avgLoss.toFixed(2)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">Risk/Reward</span>
                      <span className="font-medium">
                        {stats.avgLoss > 0 ? (stats.avgWin / stats.avgLoss).toFixed(2) : "N/A"}
                      </span>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">Executed</span>
                      <span className="font-medium">{stats.executedDecisions}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">Pending</span>
                      <span className="font-medium">
                        {stats.totalDecisions - stats.executedDecisions}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">Execution Rate</span>
                      <span className="font-medium">
                        {stats.totalDecisions > 0 
                          ? ((stats.executedDecisions / stats.totalDecisions) * 100).toFixed(0)
                          : 0}%
                      </span>
                    </div>
                  </div>
                </div>

                {/* Best/Worst Trades */}
                {(stats.bestTrade || stats.worstTrade) && (
                  <div className="pt-4 border-t space-y-2">
                    {stats.bestTrade && (
                      <div className="flex items-center justify-between">
                        <span className="text-sm flex items-center gap-2">
                          <TrendingUp className="h-4 w-4 text-emerald-500" />
                          Best Trade
                        </span>
                        <span className="font-medium">
                          <Badge variant="outline" className="mr-2">{stats.bestTrade.symbol}</Badge>
                          <span className="text-emerald-500">+${stats.bestTrade.pnl.toFixed(2)}</span>
                        </span>
                      </div>
                    )}
                    {stats.worstTrade && (
                      <div className="flex items-center justify-between">
                        <span className="text-sm flex items-center gap-2">
                          <TrendingDown className="h-4 w-4 text-red-500" />
                          Worst Trade
                        </span>
                        <span className="font-medium">
                          <Badge variant="outline" className="mr-2">{stats.worstTrade.symbol}</Badge>
                          <span className="text-red-500">${stats.worstTrade.pnl.toFixed(2)}</span>
                        </span>
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* By Symbol */}
            <Card>
              <CardHeader>
                <CardTitle>Performance by Symbol</CardTitle>
                <CardDescription>P&L breakdown by stock</CardDescription>
              </CardHeader>
              <CardContent>
                {Object.keys(stats.bySymbol).length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-4">
                    No closed trades in this period
                  </p>
                ) : (
                  <div className="space-y-3">
                    {Object.entries(stats.bySymbol)
                      .sort((a, b) => b[1].pnl - a[1].pnl)
                      .slice(0, 6)
                      .map(([symbol, data]) => (
                        <div key={symbol} className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <Badge variant="outline">{symbol}</Badge>
                            <span className="text-sm text-muted-foreground">
                              {data.trades} trades - {data.winRate.toFixed(0)}% win
                            </span>
                          </div>
                          <span className={cn(
                            "font-medium",
                            data.pnl >= 0 ? "text-emerald-500" : "text-red-500"
                          )}>
                            {data.pnl >= 0 ? "+" : ""}${data.pnl.toFixed(2)}
                          </span>
                        </div>
                      ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Decision Distribution */}
          {Object.keys(stats.byAction).length > 0 && (
            <Card className="mb-2">
              <CardHeader>
                <CardTitle>Decision Distribution</CardTitle>
                <CardDescription>Breakdown by action type</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-4">
                  {Object.entries(stats.byAction).map(([action, data]) => (
                    <div 
                      key={action} 
                      className={cn(
                        "px-4 py-3 rounded-lg border",
                        action === "buy" && "bg-emerald-500/10 border-emerald-500/30",
                        action === "sell" && "bg-red-500/10 border-red-500/30",
                        action === "hold" && "bg-blue-500/10 border-blue-500/30",
                        action === "short" && "bg-purple-500/10 border-purple-500/30",
                      )}
                    >
                      <p className="font-medium capitalize">{action}</p>
                      <p className="text-sm text-muted-foreground">
                        {data.count} decisions - {(data.avgConfidence * 100).toFixed(0)}% avg confidence
                      </p>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </>
      ) : (
        <Card>
          <CardContent className="py-8 text-center">
            <p className="text-muted-foreground">
              No trading decisions in the selected time period.
            </p>
            <Button 
              variant="link" 
              onClick={() => setTimePeriod("all")}
              className="mt-2"
            >
              View all time data
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

export default PerformanceMetrics;
