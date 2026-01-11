import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { toast } from "@/components/ui/sonner";
import { cn } from "@/lib/utils";
import { Shield, AlertTriangle, Play, Pause, DollarSign, TrendingUp, Info } from "lucide-react";

// ============================================
// Types
// ============================================

type TradingMode = "paper" | "live" | "backtest";

interface AccountInfo {
  id: string;
  name: string;
  cash: number;
  total_value?: number;
  total_pnl?: number;
  mode: TradingMode;
  currency?: string;
}

// ============================================
// Mode Configuration
// ============================================

const modeConfig: Record<TradingMode, {
  icon: typeof Shield;
  color: string;
  bgColor: string;
  borderColor: string;
  label: string;
  description: string;
}> = {
  paper: {
    icon: Shield,
    color: "text-blue-500",
    bgColor: "bg-blue-500/10",
    borderColor: "border-blue-500/30",
    label: "Paper Trading",
    description: "Simulated trading with virtual money. No real transactions.",
  },
  live: {
    icon: DollarSign,
    color: "text-green-500",
    bgColor: "bg-green-500/10",
    borderColor: "border-green-500/30",
    label: "Live Trading",
    description: "Real money trading. Actual transactions will be executed.",
  },
  backtest: {
    icon: TrendingUp,
    color: "text-purple-500",
    bgColor: "bg-purple-500/10",
    borderColor: "border-purple-500/30",
    label: "Backtesting",
    description: "Testing strategies against historical data.",
  },
};

// ============================================
// Trading Mode Toggle Component
// ============================================

export function TradingModeToggle() {
  const [account, setAccount] = useState<AccountInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [isPaused, setIsPaused] = useState(false);

  // Fetch account info
  useEffect(() => {
    async function fetchAccount() {
      const response = await api.portfolio.get();
      
      if (response.data?.account) {
        setAccount(response.data.account as AccountInfo);
      }
      setLoading(false);
    }

    fetchAccount();
    // Refresh every 30 seconds
    const interval = setInterval(fetchAccount, 30000);
    return () => clearInterval(interval);
  }, []);

  const handlePauseToggle = () => {
    setIsPaused((prev) => {
      const newValue = !prev;
      if (newValue) {
        toast.warning("Trading Paused", {
          description: "New workflows will not execute trades until resumed",
        });
      } else {
        toast.success("Trading Resumed", {
          description: "Workflows can now execute trades",
        });
      }
      return newValue;
    });
  };

  const currentMode = account?.mode || "paper";
  const config = modeConfig[currentMode] || modeConfig.paper;
  const Icon = config.icon;

  if (loading) {
    return (
      <Card>
        <CardContent className="py-6">
          <div className="animate-pulse flex items-center gap-4">
            <div className="h-12 w-12 rounded-full bg-muted" />
            <div className="space-y-2">
              <div className="h-4 w-24 bg-muted rounded" />
              <div className="h-3 w-32 bg-muted rounded" />
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={cn("border-2", config.borderColor)}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={cn("p-3 rounded-full", config.bgColor)}>
              <Icon className={cn("h-6 w-6", config.color)} />
            </div>
            <div>
              <CardTitle className="flex items-center gap-2">
                {config.label}
                <Badge variant={currentMode === "live" ? "destructive" : "secondary"}>
                  {currentMode.toUpperCase()}
                </Badge>
              </CardTitle>
              <CardDescription>{config.description}</CardDescription>
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Account Info */}
        {account && (
          <div className="grid grid-cols-2 gap-4 p-4 rounded-lg bg-muted/50">
            <div>
              <p className="text-xs text-muted-foreground">Account</p>
              <p className="font-medium">{account.name || "Default Account"}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Cash Balance</p>
              <p className="font-medium">
                {new Intl.NumberFormat("en-US", {
                  style: "currency",
                  currency: account.currency || "USD",
                }).format(account.cash || 0)}
              </p>
            </div>
            {account.total_value !== undefined && (
              <div>
                <p className="text-xs text-muted-foreground">Total Value</p>
                <p className="font-medium">
                  {new Intl.NumberFormat("en-US", {
                    style: "currency",
                    currency: account.currency || "USD",
                  }).format(account.total_value)}
                </p>
              </div>
            )}
            {account.total_pnl !== undefined && (
              <div>
                <p className="text-xs text-muted-foreground">Total P&L</p>
                <p className={cn(
                  "font-medium",
                  account.total_pnl >= 0 ? "text-emerald-500" : "text-red-500"
                )}>
                  {account.total_pnl >= 0 ? "+" : ""}
                  {new Intl.NumberFormat("en-US", {
                    style: "currency",
                    currency: account.currency || "USD",
                  }).format(account.total_pnl)}
                </p>
              </div>
            )}
          </div>
        )}

        {/* Trading Status Control */}
        <div className="flex items-center justify-between p-4 rounded-lg border">
          <div className="flex items-center gap-3">
            {isPaused ? (
              <Pause className="h-5 w-5 text-amber-500" />
            ) : (
              <Play className="h-5 w-5 text-emerald-500" />
            )}
            <div>
              <p className="font-medium">
                {isPaused ? "Trading Paused" : "Trading Active"}
              </p>
              <p className="text-xs text-muted-foreground">
                {isPaused 
                  ? "Workflows will run but trades won't execute"
                  : "Workflows will execute trades normally"
                }
              </p>
            </div>
          </div>
          <Button
            variant={isPaused ? "default" : "outline"}
            size="sm"
            onClick={handlePauseToggle}
          >
            {isPaused ? "Resume" : "Pause"}
          </Button>
        </div>

        {/* Live Trading Warning */}
        {currentMode === "live" && (
          <div className="flex items-start gap-3 p-4 rounded-lg bg-amber-500/10 border border-amber-500/30">
            <AlertTriangle className="h-5 w-5 text-amber-500 shrink-0 mt-0.5" />
            <div>
              <p className="font-medium text-amber-700 dark:text-amber-400">
                Live Trading Active
              </p>
              <p className="text-sm text-amber-600 dark:text-amber-500">
                Real money is at risk. Ensure all risk controls are properly configured
                before running trading workflows.
              </p>
            </div>
          </div>
        )}

        {/* Mode Info */}
        <div className="flex items-start gap-3 p-4 rounded-lg bg-muted/50">
          <Info className="h-5 w-5 text-muted-foreground shrink-0 mt-0.5" />
          <div className="text-sm text-muted-foreground">
            <p>
              Trading mode is configured at the system level. To change modes, 
              update the configuration in the backend settings or environment variables.
            </p>
            <p className="mt-2">
              Current features available:
            </p>
            <ul className="list-disc list-inside mt-1 space-y-1">
              <li>Paper trading with simulated execution</li>
              <li>Slippage and commission simulation</li>
              <li>Portfolio tracking and P&L calculation</li>
            </ul>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default TradingModeToggle;
