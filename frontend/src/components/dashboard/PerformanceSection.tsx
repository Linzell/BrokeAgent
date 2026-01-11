import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Calendar } from "lucide-react";
import PerformanceMetrics from "./PerformanceMetrics";
import PnLChart from "./PnLChart";

// ============================================
// Types
// ============================================

export type TimePeriod = "7d" | "30d" | "90d" | "all";

export const timePeriodLabels: Record<TimePeriod, string> = {
  "7d": "Last 7 Days",
  "30d": "Last 30 Days",
  "90d": "Last 90 Days",
  "all": "All Time",
};

// ============================================
// Time Period Selector Component
// ============================================

interface TimePeriodSelectorProps {
  value: TimePeriod;
  onChange: (period: TimePeriod) => void;
  dateRange?: { start: string; end: string } | null;
}

export function TimePeriodSelector({ value, onChange, dateRange }: TimePeriodSelectorProps) {
  return (
    <div className="flex items-center justify-between mb-6">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Calendar className="h-4 w-4" />
        {dateRange ? (
          <span>
            {value === "all" ? "All data" : timePeriodLabels[value]}: {dateRange.start} - {dateRange.end}
          </span>
        ) : (
          <span>{timePeriodLabels[value]}</span>
        )}
      </div>
      <div className="flex gap-1">
        {(Object.keys(timePeriodLabels) as TimePeriod[]).map((period) => (
          <Button
            key={period}
            variant={value === period ? "default" : "outline"}
            size="sm"
            onClick={() => onChange(period)}
          >
            {period === "all" ? "All" : period}
          </Button>
        ))}
      </div>
    </div>
  );
}

// ============================================
// Performance Section Component
// Wraps PerformanceMetrics and PnLChart with shared time period state
// ============================================

export function PerformanceSection() {
  const [timePeriod, setTimePeriod] = useState<TimePeriod>("30d");
  const [dateRange, setDateRange] = useState<{ start: string; end: string } | null>(null);

  return (
    <div className="space-y-6">
      {/* Shared Time Period Selector */}
      <TimePeriodSelector 
        value={timePeriod} 
        onChange={setTimePeriod}
        dateRange={dateRange}
      />

      {/* Performance Metrics - passes time period down */}
      <PerformanceMetrics 
        timePeriod={timePeriod} 
        onDateRangeChange={setDateRange}
        hideTimePeriodSelector
      />

      {/* P&L Chart - passes time period down */}
      <PnLChart 
        timePeriod={timePeriod}
        hideTimePeriodSelector
      />
    </div>
  );
}

export default PerformanceSection;
