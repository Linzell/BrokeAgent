import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { toast } from "@/components/ui/sonner";
import { Activity, Wallet, TrendingUp, TrendingDown, CircleDollarSign, AlertCircle } from "lucide-react";

interface HealthData {
  status: "healthy" | "unhealthy";
  timestamp: string;
  services: {
    database: "connected" | "disconnected";
    memory: { totalMemories: number; byType: Record<string, number> };
  };
}

interface Portfolio {
  account: {
    id: string;
    name: string;
    cash: number;
    total_value?: number;
    total_pnl?: number;
    mode: string;
  } | null;
  positions: Array<{
    symbol: string;
    quantity: number;
    avg_cost: number;
    current_price?: number;
    market_value?: number;
    unrealized_pnl?: number;
    unrealized_pnl_percent?: number;
    portfolio_weight?: number;
  }>;
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(value);
}

function formatPercent(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "percent",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value / 100);
}

export function Dashboard() {
  const [health, setHealth] = useState<HealthData | null>(null);
  const [portfolio, setPortfolio] = useState<Portfolio | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchData() {
      setLoading(true);
      setError(null);

      const [healthRes, portfolioRes] = await Promise.all([
        api.health(),
        api.portfolio.get(),
      ]);

      if (healthRes.error) {
        setError(healthRes.error);
        toast.error("Connection Error", {
          description: "Unable to connect to BrokeAgent API",
        });
      } else {
        setHealth(healthRes.data || null);
      }

      if (portfolioRes.data) {
        // Ensure positions is always an array
        setPortfolio({
          account: portfolioRes.data.account,
          positions: Array.isArray(portfolioRes.data.positions) ? portfolioRes.data.positions : [],
        });
      } else {
        // Set empty portfolio if no data
        setPortfolio({ account: null, positions: [] });
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
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {[...Array(4)].map((_, i) => (
          <Card key={i}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-4 w-4" />
            </CardHeader>
            <CardContent>
              <Skeleton className="h-8 w-32 mb-2" />
              <Skeleton className="h-3 w-20" />
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
            <AlertCircle className="h-5 w-5" />
            Connection Error
          </CardTitle>
          <CardDescription>
            Unable to connect to BrokeAgent API
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">{error}</p>
          <p className="text-sm text-muted-foreground mt-2">
            Make sure the backend is running at http://localhost:3050
          </p>
        </CardContent>
      </Card>
    );
  }

  const totalValue = portfolio?.positions.reduce(
    (sum, pos) => {
      const marketVal = Number(pos.market_value) || 0;
      const qty = Number(pos.quantity) || 0;
      const price = Number(pos.current_price) || Number(pos.avg_cost) || 0;
      return sum + (marketVal > 0 ? marketVal : qty * price);
    },
    0
  ) || 0;

  const totalPnL = portfolio?.positions.reduce(
    (sum, pos) => sum + (Number(pos.unrealized_pnl) || 0),
    0
  ) || 0;

  const pnlPercent = totalValue > 0 && !isNaN(totalPnL) ? (totalPnL / (totalValue - totalPnL)) * 100 : 0;

  return (
    <div className="space-y-6">
      {/* Status Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">System Status</CardTitle>
            <Activity className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              <Badge variant={health?.status === "healthy" ? "success" : "destructive"}>
                {health?.status || "unknown"}
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              DB: {health?.services.database || "unknown"} | 
              Memories: {health?.services.memory.totalMemories || 0}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Account Balance</CardTitle>
            <Wallet className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {portfolio?.account ? formatCurrency(portfolio.account.cash) : "$0.00"}
            </div>
            <p className="text-xs text-muted-foreground">
              Mode: {portfolio?.account?.mode || "paper"}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Portfolio Value</CardTitle>
            <CircleDollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatCurrency(totalValue)}</div>
            <p className="text-xs text-muted-foreground">
              {portfolio?.positions.length || 0} positions
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Unrealized P&L</CardTitle>
            {totalPnL >= 0 ? (
              <TrendingUp className="h-4 w-4 text-emerald-500" />
            ) : (
              <TrendingDown className="h-4 w-4 text-red-500" />
            )}
          </CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold ${totalPnL >= 0 ? "text-emerald-500" : "text-red-500"}`}>
              {totalPnL >= 0 ? "+" : ""}{formatCurrency(totalPnL)}
            </div>
            <p className="text-xs text-muted-foreground">
              {pnlPercent >= 0 ? "+" : ""}{formatPercent(pnlPercent)} on open positions
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Positions Table */}
      <Card>
        <CardHeader>
          <CardTitle>Positions</CardTitle>
          <CardDescription>Your current portfolio holdings</CardDescription>
        </CardHeader>
        <CardContent>
          {portfolio?.positions && portfolio.positions.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left">
                    <th className="pb-2 font-medium">Symbol</th>
                    <th className="pb-2 font-medium text-right">Quantity</th>
                    <th className="pb-2 font-medium text-right">Avg Price</th>
                    <th className="pb-2 font-medium text-right">Current</th>
                    <th className="pb-2 font-medium text-right">Value</th>
                    <th className="pb-2 font-medium text-right">P&L</th>
                  </tr>
                </thead>
                <tbody>
                  {portfolio.positions.map((pos) => {
                    const avgCost = Number(pos.avg_cost) || 0;
                    const currentPrice = Number(pos.current_price) || avgCost;
                    const quantity = Number(pos.quantity) || 0;
                    const marketValue = Number(pos.market_value) || quantity * currentPrice;
                    const pnl = Number(pos.unrealized_pnl) || (avgCost > 0 ? (currentPrice - avgCost) * quantity : 0);
                    const pnlPct = Number(pos.unrealized_pnl_percent) || (avgCost > 0 ? ((currentPrice - avgCost) / avgCost) * 100 : 0);

                    return (
                      <tr key={pos.symbol} className="border-b last:border-0">
                        <td className="py-2 font-medium">{pos.symbol}</td>
                        <td className="py-2 text-right">{quantity.toFixed(2)}</td>
                        <td className="py-2 text-right">{formatCurrency(avgCost)}</td>
                        <td className="py-2 text-right">{formatCurrency(currentPrice)}</td>
                        <td className="py-2 text-right">{formatCurrency(marketValue)}</td>
                        <td className={`py-2 text-right ${pnl >= 0 ? "text-emerald-500" : "text-red-500"}`}>
                          {pnl >= 0 ? "+" : ""}{formatCurrency(pnl)} ({pnlPct >= 0 ? "+" : ""}{Number(pnlPct).toFixed(2)}%)
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-muted-foreground text-center py-8">
              No positions yet. Run a trading workflow to get started.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default Dashboard;
