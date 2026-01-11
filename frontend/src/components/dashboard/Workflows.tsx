import { useState, useEffect, useRef, useCallback } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { api, createWebSocketClient } from "@/lib/api";
import { Play, Clock, CheckCircle, XCircle, Loader2, RefreshCw, Wifi, WifiOff } from "lucide-react";

interface Workflow {
  id: string;
  name: string;
  description?: string;
  trigger_type: string;
  enabled: boolean;
  created_at?: string;
}

interface Execution {
  id: string;
  workflow_id: string;
  thread_id: string;
  trigger_type: string;
  status: string;
  current_step?: string;
  started_at: string;
  completed_at?: string;
  error?: string;
}

interface WorkflowEvent {
  type: "workflow:started" | "workflow:step" | "workflow:completed" | "workflow:error";
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
    [key: string]: unknown;
  };
}

interface ActiveWorkflow {
  workflowId: string;
  startedAt: string;
  currentStep?: string;
  iteration?: number;
  status: "running" | "completed" | "error";
  symbols?: string[];
  requestType?: string;
  error?: string;
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleString();
}

function formatDuration(start: string, end?: string): string {
  const startDate = new Date(start);
  const endDate = end ? new Date(end) : new Date();
  const diff = endDate.getTime() - startDate.getTime();
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  
  if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  }
  return `${seconds}s`;
}

function StatusBadge({ status }: { status: string }) {
  const variants: Record<string, "success" | "warning" | "destructive" | "secondary"> = {
    completed: "success",
    running: "warning",
    failed: "destructive",
    pending: "secondary",
  };

  const icons: Record<string, React.ReactNode> = {
    completed: <CheckCircle className="h-3 w-3" />,
    running: <Loader2 className="h-3 w-3 animate-spin" />,
    failed: <XCircle className="h-3 w-3" />,
    pending: <Clock className="h-3 w-3" />,
  };

  return (
    <Badge variant={variants[status] || "secondary"}>
      {icons[status]}
      {status}
    </Badge>
  );
}

export function Workflows() {
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [executions, setExecutions] = useState<Execution[]>([]);
  const [loading, setLoading] = useState(true);
  const [executing, setExecuting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [wsConnected, setWsConnected] = useState(false);
  const [activeWorkflows, setActiveWorkflows] = useState<Map<string, ActiveWorkflow>>(new Map());
  
  const wsRef = useRef<ReturnType<typeof createWebSocketClient> | null>(null);
  const reconnectTimeoutRef = useRef<number | null>(null);

  // Handle incoming WebSocket messages
  const handleWsMessage = useCallback((data: unknown) => {
    const event = data as { type: string; workflowId?: string; [key: string]: unknown };
    
    // Handle workflow events
    if (event.type?.startsWith("workflow:") && event.workflowId) {
      const workflowEvent = event as WorkflowEvent;
      
      setActiveWorkflows((prev) => {
        const updated = new Map(prev);
        const existing = updated.get(workflowEvent.workflowId);
        
        switch (workflowEvent.type) {
          case "workflow:started":
            updated.set(workflowEvent.workflowId, {
              workflowId: workflowEvent.workflowId,
              startedAt: workflowEvent.timestamp,
              currentStep: workflowEvent.data.entryPoint,
              status: "running",
              symbols: workflowEvent.data.symbols,
              requestType: workflowEvent.data.requestType,
            });
            break;
            
          case "workflow:step":
            if (existing) {
              updated.set(workflowEvent.workflowId, {
                ...existing,
                currentStep: workflowEvent.data.step,
                iteration: workflowEvent.data.iteration,
              });
            }
            break;
            
          case "workflow:completed":
            if (existing) {
              updated.set(workflowEvent.workflowId, {
                ...existing,
                status: "completed",
              });
            }
            // Refresh executions list after completion
            fetchData();
            // Remove from active after a delay
            setTimeout(() => {
              setActiveWorkflows((p) => {
                const u = new Map(p);
                u.delete(workflowEvent.workflowId);
                return u;
              });
            }, 5000);
            break;
            
          case "workflow:error":
            if (existing) {
              updated.set(workflowEvent.workflowId, {
                ...existing,
                status: "error",
                error: workflowEvent.data.error,
              });
            }
            // Refresh executions list after error
            fetchData();
            // Remove from active after a delay
            setTimeout(() => {
              setActiveWorkflows((p) => {
                const u = new Map(p);
                u.delete(workflowEvent.workflowId);
                return u;
              });
            }, 10000);
            break;
        }
        
        return updated;
      });
    }
    
    // Handle connection events
    if (event.type === "connected") {
      setWsConnected(true);
      wsRef.current?.subscribe("workflows");
    }
  }, []);

  // Connect to WebSocket
  const connectWs = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.close();
    }

    const client = createWebSocketClient(handleWsMessage);
    wsRef.current = client;

    client.ws.onopen = () => {
      setWsConnected(true);
    };

    client.ws.onclose = () => {
      setWsConnected(false);
      // Attempt to reconnect after 5 seconds
      reconnectTimeoutRef.current = window.setTimeout(() => {
        connectWs();
      }, 5000);
    };

    client.ws.onerror = () => {
      setWsConnected(false);
    };
  }, [handleWsMessage]);

  async function fetchData() {
    setLoading(true);
    setError(null);

    const [workflowsRes, executionsRes] = await Promise.all([
      api.workflows.list(),
      api.workflows.executions(20),
    ]);

    if (workflowsRes.error) {
      setError(workflowsRes.error);
    } else {
      setWorkflows(workflowsRes.data?.workflows || []);
    }

    if (executionsRes.data) {
      setExecutions(Array.isArray(executionsRes.data.executions) ? executionsRes.data.executions : []);
    } else {
      setExecutions([]);
    }

    setLoading(false);
  }

  useEffect(() => {
    fetchData();
    connectWs();

    // No more polling - we use WebSocket for real-time updates
    // Only refresh on manual request or after workflow completion

    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      wsRef.current?.close();
    };
  }, [connectWs]);

  async function runWorkflow(type: "research" | "analyze" | "trade") {
    setExecuting(type);
    setError(null);
    
    // For demo, use some default symbols
    const symbols = ["AAPL", "MSFT", "GOOGL"];
    
    try {
      const result = await api.execute[type](symbols);
      if (result.error) {
        setError(`Workflow failed: ${result.error}`);
        console.error("Workflow failed:", result.error);
      }
      // Refresh executions
      await fetchData();
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : "Unknown error";
      if (errorMsg.includes("NetworkError") || errorMsg.includes("fetch")) {
        setError("Cannot connect to backend API. Make sure the server is running: cd app && bun run dev");
      } else {
        setError(`Workflow error: ${errorMsg}`);
      }
      console.error("Workflow error:", e);
    } finally {
      setExecuting(null);
    }
  }

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
              {[...Array(3)].map((_, i) => (
                <Skeleton key={i} className="h-16 w-full" />
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Quick Actions */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Quick Actions</CardTitle>
              <CardDescription>Run workflows manually with default symbols (AAPL, MSFT, GOOGL)</CardDescription>
            </div>
            <div className="flex items-center gap-2">
              {wsConnected ? (
                <Badge variant="outline" className="text-green-600 border-green-300">
                  <Wifi className="h-3 w-3 mr-1" />
                  Live
                </Badge>
              ) : (
                <Badge variant="outline" className="text-amber-600 border-amber-300">
                  <WifiOff className="h-3 w-3 mr-1" />
                  Reconnecting...
                </Badge>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-3">
            <Button 
              onClick={() => runWorkflow("research")} 
              disabled={executing !== null}
            >
              {executing === "research" ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Play className="h-4 w-4" />
              )}
              Research
            </Button>
            <Button 
              variant="secondary"
              onClick={() => runWorkflow("analyze")} 
              disabled={executing !== null}
            >
              {executing === "analyze" ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Play className="h-4 w-4" />
              )}
              Analyze
            </Button>
            <Button 
              variant="outline"
              onClick={() => runWorkflow("trade")} 
              disabled={executing !== null}
            >
              {executing === "trade" ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Play className="h-4 w-4" />
              )}
              Trade
            </Button>
            <Button variant="ghost" onClick={fetchData} disabled={loading}>
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </Button>
          </div>
          {error && (
            <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
              <p className="font-medium">Error</p>
              <p>{error}</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Active Workflows - Real-time Progress */}
      {activeWorkflows.size > 0 && (
        <Card className="border-blue-200 bg-blue-50/30">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin text-blue-500" />
                Active Workflows
              </CardTitle>
              <Badge variant="secondary">{activeWorkflows.size} running</Badge>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {Array.from(activeWorkflows.entries()).map(([id, workflow]) => (
                <div
                  key={id}
                  className={`p-4 rounded-lg border ${
                    workflow.status === "completed"
                      ? "border-green-300 bg-green-50"
                      : workflow.status === "error"
                        ? "border-red-300 bg-red-50"
                        : "border-blue-300 bg-white"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm">
                          {workflow.requestType?.toUpperCase() || "Workflow"}
                        </span>
                        {workflow.symbols && workflow.symbols.length > 0 && (
                          <span className="text-xs text-slate-500">
                            ({workflow.symbols.join(", ")})
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 text-xs">
                        {workflow.status === "running" && (
                          <>
                            <Loader2 className="h-3 w-3 animate-spin text-blue-500" />
                            <span className="text-blue-600">
                              Step: <span className="font-medium">{workflow.currentStep || "initializing"}</span>
                              {workflow.iteration && ` (iteration ${workflow.iteration})`}
                            </span>
                          </>
                        )}
                        {workflow.status === "completed" && (
                          <>
                            <CheckCircle className="h-3 w-3 text-green-500" />
                            <span className="text-green-600">Completed successfully</span>
                          </>
                        )}
                        {workflow.status === "error" && (
                          <>
                            <XCircle className="h-3 w-3 text-red-500" />
                            <span className="text-red-600">{workflow.error || "Failed"}</span>
                          </>
                        )}
                      </div>
                    </div>
                    <div className="text-right">
                      <Badge
                        variant={
                          workflow.status === "completed"
                            ? "success"
                            : workflow.status === "error"
                              ? "destructive"
                              : "secondary"
                        }
                      >
                        {workflow.status}
                      </Badge>
                      <p className="text-xs text-slate-400 mt-1 font-mono">
                        {id.slice(0, 8)}...
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Registered Workflows */}
      <Card>
        <CardHeader>
          <CardTitle>Registered Workflows</CardTitle>
          <CardDescription>Configured workflows in the system</CardDescription>
        </CardHeader>
        <CardContent>
          {workflows.length > 0 ? (
            <div className="space-y-4">
              {workflows.map((workflow) => (
                <div
                  key={workflow.id}
                  className="flex items-center justify-between p-4 border rounded-lg"
                >
                  <div>
                    <h4 className="font-medium">{workflow.name}</h4>
                    <p className="text-sm text-muted-foreground">
                      {workflow.description || "No description"}
                    </p>
                    <div className="flex gap-2 mt-2">
                      <Badge variant="outline">{workflow.trigger_type}</Badge>
                      <Badge variant={workflow.enabled ? "success" : "secondary"}>
                        {workflow.enabled ? "enabled" : "disabled"}
                      </Badge>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-muted-foreground text-center py-8">
              No workflows registered yet.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Recent Executions */}
      <Card>
        <CardHeader>
          <CardTitle>Recent Executions</CardTitle>
          <CardDescription>Latest workflow execution history</CardDescription>
        </CardHeader>
        <CardContent>
          {executions.length > 0 ? (
            <div className="space-y-4">
              {executions.map((exec) => (
                <div
                  key={exec.id}
                  className="flex items-center justify-between p-4 border rounded-lg"
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <StatusBadge status={exec.status} />
                      <span className="text-sm font-medium">{exec.trigger_type}</span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Started: {formatDate(exec.started_at)}
                    </p>
                    {exec.current_step && (
                      <p className="text-xs text-muted-foreground">
                        Current: {exec.current_step}
                      </p>
                    )}
                    {exec.error && (
                      <p className="text-xs text-red-500">{exec.error}</p>
                    )}
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-medium">
                      {formatDuration(exec.started_at, exec.completed_at)}
                    </p>
                    <p className="text-xs text-muted-foreground font-mono">
                      {exec.thread_id.slice(0, 8)}...
                    </p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-muted-foreground text-center py-8">
              No executions yet. Run a workflow to get started.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default Workflows;
