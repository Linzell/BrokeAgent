import { useState, useEffect } from "react";
import {
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Area,
  AreaChart,
} from "recharts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { TrendingUp, TrendingDown, RefreshCw } from "lucide-react";

// ============================================
// Types
// ============================================

export type TimePeriod = "7d" | "30d" | "90d" | "all";

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

interface ChartDataPoint {
  date: string;
  timestamp: number;
  pnl: number;
  cumulativePnl: number;
  decisions: number;
}

// ============================================
// Helper Functions
// ============================================

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

function formatDateTime(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

// ============================================
// Custom Tooltip
// ============================================

interface TooltipProps {
  active?: boolean;
  payload?: Array<{ value: number; dataKey: string }>;
  label?: string;
}

function CustomTooltip({ active, payload, label }: TooltipProps) {
  if (!active || !payload || !payload.length) return null;

  const cumulativePnl = payload.find((p) => p.dataKey === "cumulativePnl")?.value ?? 0;

  return (
    <div className="bg-white p-3 border rounded-lg shadow-lg text-sm">
      <p className="font-medium text-slate-700">{label}</p>
      <p className={`font-bold ${cumulativePnl >= 0 ? "text-emerald-600" : "text-red-600"}`}>
        {cumulativePnl >= 0 ? "+" : ""}{formatCurrency(cumulativePnl)}
      </p>
    </div>
  );
}

// ============================================
// P&L Chart Component
// ============================================

interface PnLChartProps {
  timePeriod?: TimePeriod;
  hideTimePeriodSelector?: boolean;
}

export function PnLChart({ 
  timePeriod: externalTimePeriod,
  hideTimePeriodSelector = false 
}: PnLChartProps) {
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [chartData, setChartData] = useState<ChartDataPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [internalTimeRange, setInternalTimeRange] = useState<TimePeriod>("30d");
  
  // Use external time period if provided, otherwise use internal state
  // Map 90d to 30d for PnLChart since it only supports 7d, 30d, all
  const mapTimePeriod = (period: TimePeriod): "7d" | "30d" | "all" => {
    if (period === "90d") return "all"; // Map 90d to all for chart
    return period;
  };
  
  const timeRange = externalTimePeriod ? mapTimePeriod(externalTimePeriod) : internalTimeRange;
  const setTimeRange = externalTimePeriod ? undefined : setInternalTimeRange;

  async function fetchData() {
    setLoading(true);
    setError(null);

    try {
      const response = await api.portfolio.decisions(100);
      
      if (response.error) {
        setError(response.error);
        return;
      }

      const decisionsData = response.data?.decisions || [];
      setDecisions(decisionsData);

      // Process decisions into chart data
      const processedData = processDecisionsToChartData(decisionsData, timeRange);
      setChartData(processedData);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to fetch data");
    } finally {
      setLoading(false);
    }
  }

  // Process decisions into daily P&L chart data
  function processDecisionsToChartData(
    decisions: Decision[],
    range: "7d" | "30d" | "all"
  ): ChartDataPoint[] {
    if (!decisions.length) {
      // Return empty array when no real data - no fake demo data
      return [];
    }

    // Filter by time range
    const now = new Date();
    const rangeMs = range === "7d" ? 7 * 24 * 60 * 60 * 1000 :
                   range === "30d" ? 30 * 24 * 60 * 60 * 1000 :
                   Infinity;
    
    const filteredDecisions = decisions.filter((d) => {
      const date = new Date(d.created_at);
      return now.getTime() - date.getTime() <= rangeMs;
    });

    // If no decisions in range, return empty
    if (!filteredDecisions.length) {
      return [];
    }

    // Group by date - use ISO date string (YYYY-MM-DD) as key for proper sorting
    const dailyData = new Map<string, { pnl: number; decisions: number; displayDate: string }>();
    
    for (const decision of filteredDecisions) {
      const dateObj = new Date(decision.created_at);
      const isoDate = dateObj.toISOString().split('T')[0]; // YYYY-MM-DD for sorting
      const displayDate = formatDate(decision.created_at); // "Jan 10" for display
      const existing = dailyData.get(isoDate) || { pnl: 0, decisions: 0, displayDate };
      
      existing.pnl += Number(decision.outcome_pnl) || 0;
      existing.decisions += 1;
      
      dailyData.set(isoDate, existing);
    }

    // Convert to array and sort by ISO date key
    const sortedEntries = Array.from(dailyData.entries())
      .sort((a, b) => a[0].localeCompare(b[0])); // ISO dates sort correctly as strings

    let cumulativePnl = 0;
    return sortedEntries.map(([isoDate, data]) => {
      cumulativePnl += data.pnl;
      return {
        date: data.displayDate,
        timestamp: new Date(isoDate).getTime(),
        pnl: data.pnl,
        cumulativePnl,
        decisions: data.decisions,
      };
    });
  }

  useEffect(() => {
    fetchData();
  }, [timeRange]);

  // Check if we have real P&L data or just decisions without outcomes
  const hasRealPnLData = chartData.some(d => d.pnl !== 0);
  const hasNoData = decisions.length === 0;

  // Calculate summary stats
  const totalPnL = chartData.length > 0 ? (Number(chartData[chartData.length - 1].cumulativePnl) || 0) : 0;
  const totalDecisions = chartData.reduce((sum, d) => sum + (Number(d.decisions) || 0), 0);
  const winningDays = chartData.filter((d) => (Number(d.pnl) || 0) > 0).length;
  const losingDays = chartData.filter((d) => (Number(d.pnl) || 0) < 0).length;
  const winRate = chartData.length > 0 ? (winningDays / chartData.length) * 100 : 0;

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-6 w-32" />
          <Skeleton className="h-4 w-48" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-64 w-full" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              Realized P&L
              {totalPnL >= 0 ? (
                <TrendingUp className="h-5 w-5 text-emerald-500" />
              ) : (
                <TrendingDown className="h-5 w-5 text-red-500" />
              )}
            </CardTitle>
            <CardDescription>
              Cumulative profit from closed trades
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            {/* Time Period Selector - only show if not hidden */}
            {!hideTimePeriodSelector && (
              <div className="flex gap-1">
                {(["7d", "30d", "all"] as const).map((range) => (
                  <Button
                    key={range}
                    variant={timeRange === range ? "default" : "outline"}
                    size="sm"
                    onClick={() => setTimeRange && setTimeRange(range)}
                    disabled={!setTimeRange}
                  >
                    {range === "all" ? "All" : range}
                  </Button>
                ))}
              </div>
            )}
            <Button variant="ghost" size="sm" onClick={fetchData}>
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {error ? (
          <div className="text-center py-8 text-red-500">{error}</div>
        ) : (
          <>
            {/* Summary Stats */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
              <div className="text-center p-3 bg-slate-50 rounded-lg">
                <p className="text-xs text-slate-500 mb-1">Realized P&L</p>
                <p className={`text-lg font-bold ${totalPnL >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                  {totalPnL >= 0 ? "+" : ""}{formatCurrency(totalPnL)}
                </p>
                <p className="text-[10px] text-slate-400">Closed trades</p>
              </div>
              <div className="text-center p-3 bg-slate-50 rounded-lg">
                <p className="text-xs text-slate-500 mb-1">Decisions</p>
                <p className="text-lg font-bold text-slate-700">{totalDecisions}</p>
              </div>
              <div className="text-center p-3 bg-slate-50 rounded-lg">
                <p className="text-xs text-slate-500 mb-1">Win Rate</p>
                <p className="text-lg font-bold text-slate-700">{winRate.toFixed(0)}%</p>
              </div>
              <div className="text-center p-3 bg-slate-50 rounded-lg">
                <p className="text-xs text-slate-500 mb-1">Days</p>
                <p className="text-lg font-bold">
                  <span className="text-emerald-600">{winningDays}W</span>
                  {" / "}
                  <span className="text-red-600">{losingDays}L</span>
                </p>
              </div>
            </div>

            {/* Chart */}
            {chartData.length > 0 ? (
              <div className="h-64 w-full" style={{ minHeight: "256px", minWidth: "200px" }}>
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={chartData} margin={{ top: 5, right: 5, left: 5, bottom: 5 }}>
                    <defs>
                      <linearGradient id="pnlGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop 
                          offset="5%" 
                          stopColor={totalPnL >= 0 ? "#10b981" : "#ef4444"} 
                          stopOpacity={0.3}
                        />
                        <stop 
                          offset="95%" 
                          stopColor={totalPnL >= 0 ? "#10b981" : "#ef4444"} 
                          stopOpacity={0}
                        />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis 
                      dataKey="date" 
                      tick={{ fontSize: 12, fill: "#64748b" }}
                      tickLine={false}
                      axisLine={{ stroke: "#e2e8f0" }}
                    />
                    <YAxis 
                      tick={{ fontSize: 12, fill: "#64748b" }}
                      tickLine={false}
                      axisLine={{ stroke: "#e2e8f0" }}
                      tickFormatter={(value) => `$${value >= 1000 ? `${(value / 1000).toFixed(0)}k` : value}`}
                    />
                    <Tooltip content={<CustomTooltip />} />
                    <Area
                      type="monotone"
                      dataKey="cumulativePnl"
                      stroke={totalPnL >= 0 ? "#10b981" : "#ef4444"}
                      strokeWidth={2}
                      fill="url(#pnlGradient)"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="h-64 flex items-center justify-center text-slate-500 bg-slate-50 rounded-lg">
                <div className="text-center">
                  <TrendingUp className="h-12 w-12 mx-auto mb-3 text-slate-300" />
                  <p className="font-medium">No P&L Data Yet</p>
                  <p className="text-sm text-slate-400 mt-1">Run trading workflows to generate performance data</p>
                </div>
              </div>
            )}
            
            {/* No P&L data notice - decisions exist but no outcomes recorded */}
            {!hasNoData && !hasRealPnLData && chartData.length > 0 && (
              <p className="text-xs text-center text-slate-400 mt-4">
                Decisions recorded but no P&L outcomes yet. P&L will appear when trades are closed.
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

export default PnLChart;
