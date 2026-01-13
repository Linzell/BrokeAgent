import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { toast } from "@/components/ui/sonner";
import {
  Clock,
  Calendar,
  Play,
  Pause,
  Trash2,
  RefreshCw,
  Plus,
  Zap,
  Timer,
  AlertCircle,
  CheckCircle,
  XCircle,
  Loader2,
  ChevronDown,
  ChevronUp,
} from "lucide-react";

interface Schedule {
  id: string;
  name: string;
  description?: string;
  trigger: {
    type: "cron" | "interval" | "event";
    expression?: string;
    intervalMs?: number;
    eventType?: string;
  };
  request: {
    type: string;
    symbols: string[];
  };
  enabled: boolean;
  maxConcurrent: number;
  retryOnFail: boolean;
  tags?: string[];
  createdAt: string;
  lastRunAt?: string;
  nextRunAt?: string;
}

interface Preset {
  key: string;
  name: string;
  description: string;
  trigger: {
    type: "cron" | "interval" | "event";
    expression?: string;
    intervalMs?: number;
    eventType?: string;
  };
  requestType: string;
}

interface ScheduleExecution {
  id: string;
  scheduleId: string;
  status: "pending" | "running" | "completed" | "failed";
  startedAt: string;
  completedAt?: string;
  error?: string;
  workflowExecutionId?: string;
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleString();
}

function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diff = date.getTime() - now.getTime();
  const absDiff = Math.abs(diff);

  if (absDiff < 60000) return diff > 0 ? "in <1 min" : "<1 min ago";
  if (absDiff < 3600000) {
    const mins = Math.round(absDiff / 60000);
    return diff > 0 ? `in ${mins} min` : `${mins} min ago`;
  }
  if (absDiff < 86400000) {
    const hours = Math.round(absDiff / 3600000);
    return diff > 0 ? `in ${hours}h` : `${hours}h ago`;
  }
  const days = Math.round(absDiff / 86400000);
  return diff > 0 ? `in ${days}d` : `${days}d ago`;
}

function getTriggerIcon(type: string) {
  switch (type) {
    case "cron":
      return <Calendar className="h-4 w-4" />;
    case "interval":
      return <Timer className="h-4 w-4" />;
    case "event":
      return <Zap className="h-4 w-4" />;
    default:
      return <Clock className="h-4 w-4" />;
  }
}

function formatTrigger(trigger: Schedule["trigger"]): string {
  switch (trigger.type) {
    case "cron":
      return trigger.expression || "Unknown cron";
    case "interval":
      if (!trigger.intervalMs) return "Unknown interval";
      const mins = trigger.intervalMs / 60000;
      if (mins < 60) return `Every ${mins} min`;
      const hours = mins / 60;
      return `Every ${hours}h`;
    case "event":
      return trigger.eventType || "Unknown event";
    default:
      return "Unknown";
  }
}

function StatusBadge({ status }: { status: ScheduleExecution["status"] }) {
  const config: Record<string, { variant: "success" | "warning" | "destructive" | "secondary"; icon: React.ReactNode }> = {
    completed: { variant: "success", icon: <CheckCircle className="h-3 w-3" /> },
    running: { variant: "warning", icon: <Loader2 className="h-3 w-3 animate-spin" /> },
    failed: { variant: "destructive", icon: <XCircle className="h-3 w-3" /> },
    pending: { variant: "secondary", icon: <Clock className="h-3 w-3" /> },
  };

  const { variant, icon } = config[status] || config.pending;

  return (
    <Badge variant={variant} className="gap-1">
      {icon}
      {status}
    </Badge>
  );
}

function ScheduleCard({
  schedule,
  onToggle,
  onDelete,
  onRunNow,
  onViewHistory,
}: {
  schedule: Schedule;
  onToggle: (id: string, enabled: boolean) => void;
  onDelete: (id: string) => void;
  onRunNow: (id: string) => void;
  onViewHistory: (id: string) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState<ScheduleExecution[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

  const handleToggle = async () => {
    setLoading(true);
    await onToggle(schedule.id, !schedule.enabled);
    setLoading(false);
  };

  const handleRunNow = async () => {
    setLoading(true);
    await onRunNow(schedule.id);
    setLoading(false);
  };

  const handleDelete = async () => {
    if (confirm(`Delete schedule "${schedule.name}"?`)) {
      setLoading(true);
      await onDelete(schedule.id);
      setLoading(false);
    }
  };

  const loadHistory = async () => {
    if (showHistory) {
      setShowHistory(false);
      return;
    }
    setLoadingHistory(true);
    const res = await api.schedules.history(schedule.id, 5);
    if (res.data) {
      setHistory(res.data.history);
    }
    setLoadingHistory(false);
    setShowHistory(true);
  };

  return (
    <Card className={`transition-opacity ${!schedule.enabled ? "opacity-60" : ""}`}>
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between">
          <div className="space-y-1">
            <CardTitle className="text-base flex items-center gap-2">
              {getTriggerIcon(schedule.trigger.type)}
              {schedule.name}
            </CardTitle>
            {schedule.description && (
              <CardDescription className="text-xs">{schedule.description}</CardDescription>
            )}
          </div>
          <Badge variant={schedule.enabled ? "success" : "secondary"}>
            {schedule.enabled ? "Active" : "Disabled"}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Trigger & Request Info */}
        <div className="flex flex-wrap gap-2 text-xs">
          <Badge variant="outline" className="gap-1">
            {getTriggerIcon(schedule.trigger.type)}
            {formatTrigger(schedule.trigger)}
          </Badge>
          <Badge variant="outline">{schedule.request.type}</Badge>
          <Badge variant="outline">{schedule.request.symbols.join(", ")}</Badge>
        </div>

        {/* Timing Info */}
        <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
          <div>
            <span className="font-medium">Last run:</span>{" "}
            {schedule.lastRunAt ? formatRelativeTime(schedule.lastRunAt) : "Never"}
          </div>
          <div>
            <span className="font-medium">Next run:</span>{" "}
            {schedule.trigger.type === "event" 
              ? <span className="text-amber-600">On event trigger</span>
              : schedule.nextRunAt 
                ? formatRelativeTime(schedule.nextRunAt) 
                : "N/A"}
          </div>
        </div>

        {/* Actions */}
        <div className="flex flex-wrap gap-2 pt-2">
          <Button
            size="sm"
            variant={schedule.enabled ? "outline" : "default"}
            onClick={handleToggle}
            disabled={loading}
          >
            {loading ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : schedule.enabled ? (
              <Pause className="h-3 w-3" />
            ) : (
              <Play className="h-3 w-3" />
            )}
            {schedule.enabled ? "Disable" : "Enable"}
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={handleRunNow}
            disabled={loading || !schedule.enabled}
          >
            {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
            Run Now
          </Button>
          <Button size="sm" variant="ghost" onClick={loadHistory} disabled={loadingHistory}>
            {loadingHistory ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : showHistory ? (
              <ChevronUp className="h-3 w-3" />
            ) : (
              <ChevronDown className="h-3 w-3" />
            )}
            History
          </Button>
          <Button size="sm" variant="ghost" className="text-destructive" onClick={handleDelete} disabled={loading}>
            <Trash2 className="h-3 w-3" />
          </Button>
        </div>

        {/* History */}
        {showHistory && (
          <div className="mt-3 space-y-2 border-t pt-3">
            <div className="text-xs font-medium">Recent Executions</div>
            {history.length > 0 ? (
              <div className="space-y-2">
                {history.map((exec) => (
                  <div
                    key={exec.id}
                    className="flex items-center justify-between text-xs p-2 bg-muted/50 rounded"
                  >
                    <div className="flex items-center gap-2">
                      <StatusBadge status={exec.status} />
                      <span className="text-muted-foreground">{formatDate(exec.startedAt)}</span>
                    </div>
                    {exec.error && (
                      <span className="text-destructive text-xs truncate max-w-[200px]" title={exec.error}>
                        {exec.error}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">No executions yet</p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function PresetCard({
  preset,
  onCreateFromPreset,
}: {
  preset: Preset;
  onCreateFromPreset: (presetKey: string) => void;
}) {
  return (
    <div className="flex items-center justify-between p-3 border rounded-lg hover:bg-muted/50 transition-colors">
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          {getTriggerIcon(preset.trigger.type)}
          <span className="font-medium text-sm">{preset.name}</span>
        </div>
        <p className="text-xs text-muted-foreground">{preset.description}</p>
        <div className="flex gap-2">
          <Badge variant="outline" className="text-xs">
            {formatTrigger(preset.trigger)}
          </Badge>
          <Badge variant="outline" className="text-xs">
            {preset.requestType}
          </Badge>
        </div>
      </div>
      <Button size="sm" variant="outline" onClick={() => onCreateFromPreset(preset.key)}>
        <Plus className="h-3 w-3" />
        Add
      </Button>
    </div>
  );
}

export function Schedules() {
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [presets, setPresets] = useState<Preset[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showPresets, setShowPresets] = useState(false);
  const [defaultSymbols] = useState(["AAPL", "MSFT", "GOOGL", "NVDA"]);

  async function fetchData() {
    setLoading(true);
    setError(null);

    const [schedulesRes, presetsRes] = await Promise.all([
      api.schedules.list(),
      api.schedules.presets(),
    ]);

    if (schedulesRes.error) {
      setError(schedulesRes.error);
    } else {
      setSchedules(schedulesRes.data?.schedules || []);
    }

    if (presetsRes.data) {
      setPresets(presetsRes.data.presets || []);
    }

    setLoading(false);
  }

  useEffect(() => {
    fetchData();
    // Refresh every 60 seconds
    const interval = setInterval(fetchData, 60000);
    return () => clearInterval(interval);
  }, []);

  const handleToggle = async (id: string, enabled: boolean) => {
    const res = enabled
      ? await api.schedules.enable(id)
      : await api.schedules.disable(id);

    if (res.error) {
      toast.error("Failed to update schedule", { description: res.error });
    } else {
      toast.success(enabled ? "Schedule enabled" : "Schedule disabled");
      fetchData();
    }
  };

  const handleDelete = async (id: string) => {
    const res = await api.schedules.delete(id);
    if (res.error) {
      toast.error("Failed to delete schedule", { description: res.error });
    } else {
      toast.success("Schedule deleted");
      fetchData();
    }
  };

  const handleRunNow = async (id: string) => {
    const res = await api.schedules.runNow(id);
    if (res.error) {
      toast.error("Failed to run schedule", { description: res.error });
    } else {
      toast.success("Schedule triggered", {
        description: res.data?.executionId
          ? `Execution ID: ${res.data.executionId.slice(0, 8)}...`
          : "Workflow started",
      });
    }
  };

  const handleCreateFromPreset = async (presetKey: string) => {
    const res = await api.schedules.createFromPreset(presetKey, defaultSymbols);
    if (res.error) {
      toast.error("Failed to create schedule", { description: res.error });
    } else {
      toast.success("Schedule created from preset");
      setShowPresets(false);
      fetchData();
    }
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <Card>
          <CardHeader>
            <Skeleton className="h-6 w-32" />
            <Skeleton className="h-4 w-48" />
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 md:grid-cols-2">
              {[...Array(4)].map((_, i) => (
                <Skeleton key={i} className="h-40 w-full" />
              ))}
            </div>
          </CardContent>
        </Card>
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
          <CardDescription>Unable to load schedules</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">{error}</p>
          <Button variant="outline" className="mt-4" onClick={fetchData}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Retry
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header Actions */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold">Scheduled Workflows</h2>
          <p className="text-sm text-muted-foreground">
            {schedules.length} schedule{schedules.length !== 1 ? "s" : ""} configured
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={fetchData}>
            <RefreshCw className="h-4 w-4" />
            Refresh
          </Button>
          <Button size="sm" onClick={() => setShowPresets(!showPresets)}>
            <Plus className="h-4 w-4" />
            Add Schedule
          </Button>
        </div>
      </div>

      {/* Presets Panel */}
      {showPresets && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Schedule Presets</CardTitle>
            <CardDescription>
              Quick-start templates for common trading schedules. Uses symbols: {defaultSymbols.join(", ")}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 md:grid-cols-2">
              {presets.map((preset) => (
                <PresetCard
                  key={preset.key}
                  preset={preset}
                  onCreateFromPreset={handleCreateFromPreset}
                />
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Active Schedules */}
      {schedules.length > 0 ? (
        <div className="grid gap-4 md:grid-cols-2">
          {schedules.map((schedule) => (
            <ScheduleCard
              key={schedule.id}
              schedule={schedule}
              onToggle={handleToggle}
              onDelete={handleDelete}
              onRunNow={handleRunNow}
              onViewHistory={() => {}}
            />
          ))}
        </div>
      ) : (
        <Card>
          <CardContent className="py-12 text-center">
            <Clock className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium mb-2">No Scheduled Workflows</h3>
            <p className="text-muted-foreground mb-4">
              Create schedules to automate your trading workflows
            </p>
            <Button onClick={() => setShowPresets(true)}>
              <Plus className="h-4 w-4" />
              Add Your First Schedule
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Stats Summary */}
      {schedules.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Schedule Summary</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
              <div>
                <div className="text-2xl font-bold">{schedules.length}</div>
                <div className="text-xs text-muted-foreground">Total</div>
              </div>
              <div>
                <div className="text-2xl font-bold text-green-500">
                  {schedules.filter((s) => s.enabled).length}
                </div>
                <div className="text-xs text-muted-foreground">Active</div>
              </div>
              <div>
                <div className="text-2xl font-bold">
                  {schedules.filter((s) => s.trigger.type === "cron").length}
                </div>
                <div className="text-xs text-muted-foreground">Cron</div>
              </div>
              <div>
                <div className="text-2xl font-bold">
                  {schedules.filter((s) => s.trigger.type === "interval").length}
                </div>
                <div className="text-xs text-muted-foreground">Interval</div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

export default Schedules;
