import { useState, useEffect, useRef, useCallback } from "react";
import { api, createWebSocketClient } from "../../lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { cn } from "../../lib/utils";
import { toast } from "../ui/sonner";

// ============================================
// Types
// ============================================

interface HealthStatus {
  status: "healthy" | "unhealthy";
  timestamp: string;
  services: {
    database: "connected" | "disconnected";
    memory: { totalMemories: number; byType: Record<string, number> };
  };
}

interface WorkflowEvent {
  type: "workflow:started" | "workflow:step" | "workflow:completed" | "workflow:error" | "workflow:llm";
  workflowId: string;
  timestamp: string;
  data: {
    step?: string;
    status?: string;
    duration?: number;
    error?: string;
    entryPoint?: string;
    symbols?: string[];
    requestType?: string;
    iteration?: number;
    iterations?: number;
    totalRetries?: number;
    messagesCount?: number;
    errorsCount?: number;
    // LLM event data
    llmEvent?: "llm:call" | "llm:success" | "llm:error" | "llm:fallback";
    provider?: string;
    model?: string;
    latencyMs?: number;
    tokens?: number;
    fallbackFrom?: { provider: string; model: string };
    [key: string]: unknown;
  };
}

interface SystemEvent {
  type: "connected" | "subscribed" | "unsubscribed" | "pong";
  clientId?: string;
  channel?: string;
  timestamp: string;
}

type WebSocketEvent = WorkflowEvent | SystemEvent;

// Track workflow state with accumulated info
interface WorkflowState {
  workflowId: string;
  startedAt: string;
  currentStep?: string;
  iteration?: number;
  symbols?: string[];
  requestType?: string;
  status: "running" | "completed" | "error";
  error?: string;
  lastEvent: WorkflowEvent;
  completedAt?: string;
  totalIterations?: number;
  totalRetries?: number;
}

// ============================================
// Live Status Component
// ============================================

export function LiveStatus() {
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [connected, setConnected] = useState(false);
  const [events, setEvents] = useState<WebSocketEvent[]>([]);
  const [activeWorkflows, setActiveWorkflows] = useState<Map<string, WorkflowState>>(new Map());
  const [mounted, setMounted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const wsRef = useRef<ReturnType<typeof createWebSocketClient> | null>(null);
  const reconnectTimeoutRef = useRef<number | null>(null);

  // Track when component is mounted (client-side only)
  useEffect(() => {
    setMounted(true);
  }, []);

  // Fetch health status
  const fetchHealth = useCallback(async () => {
    try {
      const response = await api.health();
      if (response.data) {
        setHealth(response.data);
        setError(null);
      } else if (response.error) {
        if (response.error.includes("NetworkError") || response.error.includes("fetch")) {
          setError("Cannot connect to backend. Start it with: cd app && bun run dev");
        } else {
          setError(response.error);
        }
      }
    } catch (e) {
      setError("Cannot connect to backend. Start it with: cd app && bun run dev");
    }
  }, []);

  // Handle incoming WebSocket messages
  const handleMessage = useCallback((data: unknown) => {
    const event = data as WebSocketEvent;
    
    // Add to events list (keep last 50)
    setEvents((prev) => [event, ...prev].slice(0, 50));

    // Handle workflow events
    if ("workflowId" in event) {
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
              symbols: workflowEvent.data.symbols,
              requestType: workflowEvent.data.requestType,
              status: "running",
              lastEvent: workflowEvent,
            });
            // Toast notification for workflow start
            toast.info("Workflow Started", {
              description: `${workflowEvent.data.requestType?.toUpperCase() || "Workflow"} started for ${workflowEvent.data.symbols?.join(", ") || "analysis"}`,
            });
            break;
            
          case "workflow:step":
            if (existing) {
              updated.set(workflowEvent.workflowId, {
                ...existing,
                currentStep: workflowEvent.data.step,
                iteration: workflowEvent.data.iteration,
                lastEvent: workflowEvent,
              });
            } else {
              // Started event might have been missed
              updated.set(workflowEvent.workflowId, {
                workflowId: workflowEvent.workflowId,
                startedAt: workflowEvent.timestamp,
                currentStep: workflowEvent.data.step,
                iteration: workflowEvent.data.iteration,
                status: "running",
                lastEvent: workflowEvent,
              });
            }
            break;
            
          case "workflow:completed":
            updated.set(workflowEvent.workflowId, {
              ...(existing || {
                workflowId: workflowEvent.workflowId,
                startedAt: workflowEvent.timestamp,
              }),
              status: "completed",
              completedAt: workflowEvent.timestamp,
              totalIterations: workflowEvent.data.iterations,
              totalRetries: workflowEvent.data.totalRetries,
              lastEvent: workflowEvent,
            });
            // Toast notification for workflow completion
            toast.success("Workflow Completed", {
              description: `Finished in ${workflowEvent.data.iterations || "?"} steps${workflowEvent.data.totalRetries ? ` (${workflowEvent.data.totalRetries} retries)` : ""}`,
            });
            // Remove from active after a delay
            setTimeout(() => {
              setActiveWorkflows((p) => {
                const u = new Map(p);
                u.delete(workflowEvent.workflowId);
                return u;
              });
            }, 8000);
            break;
            
          case "workflow:error":
            updated.set(workflowEvent.workflowId, {
              ...(existing || {
                workflowId: workflowEvent.workflowId,
                startedAt: workflowEvent.timestamp,
              }),
              status: "error",
              error: workflowEvent.data.error,
              lastEvent: workflowEvent,
            });
            // Toast notification for workflow error
            toast.error("Workflow Failed", {
              description: workflowEvent.data.error || "An error occurred during execution",
            });
            // Remove from active after a longer delay for errors
            setTimeout(() => {
              setActiveWorkflows((p) => {
                const u = new Map(p);
                u.delete(workflowEvent.workflowId);
                return u;
              });
            }, 15000);
            break;
        }
        
        return updated;
      });
    }

    // Handle connection event
    if (event.type === "connected") {
      setConnected(true);
      // Subscribe to all workflow updates
      wsRef.current?.subscribe("workflows");
    }
  }, []);

  // Connect to WebSocket
  const connect = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.close();
    }

    const client = createWebSocketClient(handleMessage);
    wsRef.current = client;

    client.ws.onopen = () => {
      setConnected(true);
    };

    client.ws.onclose = () => {
      setConnected(false);
      // Attempt to reconnect after 5 seconds
      reconnectTimeoutRef.current = window.setTimeout(() => {
        connect();
      }, 5000);
    };

    client.ws.onerror = () => {
      setConnected(false);
    };
  }, [handleMessage]);

  // Initialize
  useEffect(() => {
    fetchHealth();
    connect();

    // Poll health every 30 seconds
    const healthInterval = setInterval(fetchHealth, 30000);

    return () => {
      clearInterval(healthInterval);
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      wsRef.current?.close();
    };
  }, [fetchHealth, connect]);

  return (
    <div className="space-y-6">
      {/* Connection Error */}
      {error && (
        <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg text-amber-700">
          <p className="font-medium">Backend Not Connected</p>
          <p className="text-sm mt-1">{error}</p>
        </div>
      )}

      {/* System Status */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg">System Status</CardTitle>
            <div className="flex items-center gap-2">
              <div
                className={cn(
                  "h-2 w-2 rounded-full",
                  connected ? "bg-green-500 animate-pulse" : "bg-red-500"
                )}
              />
              <span className="text-sm text-slate-500">
                {connected ? "Connected" : "Disconnected"}
              </span>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {health ? (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div>
                <p className="text-sm text-slate-500">Health</p>
                <Badge variant={health.status === "healthy" ? "default" : "destructive"}>
                  {health.status}
                </Badge>
              </div>
              <div>
                <p className="text-sm text-slate-500">Database</p>
                <Badge
                  variant={
                    health.services.database === "connected" ? "default" : "destructive"
                  }
                >
                  {health.services.database}
                </Badge>
              </div>
              <div>
                <p className="text-sm text-slate-500">Memories</p>
                <p className="font-medium">{health.services.memory.totalMemories}</p>
              </div>
              <div>
                <p className="text-sm text-slate-500">WebSocket</p>
                <Badge variant={connected ? "default" : "secondary"}>
                  {connected ? "Live" : "Reconnecting..."}
                </Badge>
              </div>
            </div>
          ) : (
            <div className="text-sm text-slate-500">Loading...</div>
          )}
        </CardContent>
      </Card>

      {/* Active Workflows */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg">Active Workflows</CardTitle>
            <Badge variant="outline">{activeWorkflows.size} active</Badge>
          </div>
        </CardHeader>
        <CardContent>
          {activeWorkflows.size === 0 ? (
            <p className="text-sm text-slate-500">No active workflows</p>
          ) : (
            <div className="space-y-3">
              {Array.from(activeWorkflows.entries()).map(([id, workflow]) => (
                <div
                  key={id}
                  className={cn(
                    "p-4 rounded-lg border",
                    workflow.status === "completed"
                      ? "border-green-200 bg-green-50"
                      : workflow.status === "error"
                        ? "border-red-200 bg-red-50"
                        : "border-blue-200 bg-blue-50"
                  )}
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <Badge
                        variant={
                          workflow.status === "completed"
                            ? "default"
                            : workflow.status === "error"
                              ? "destructive"
                              : "secondary"
                        }
                      >
                        {workflow.requestType?.toUpperCase() || "WORKFLOW"}
                      </Badge>
                      {workflow.symbols && workflow.symbols.length > 0 && (
                        <span className="text-xs text-slate-600 font-medium">
                          {workflow.symbols.join(", ")}
                        </span>
                      )}
                    </div>
                    <span className="text-xs text-slate-400 font-mono">
                      {id.slice(0, 8)}...
                    </span>
                  </div>
                  
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      {workflow.status === "running" && (
                        <>
                          <svg className="w-4 h-4 text-blue-500 animate-spin" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                          </svg>
                          <span className="text-sm text-blue-700">
                            <span className="font-medium">{workflow.currentStep || "initializing"}</span>
                            {workflow.iteration && (
                              <span className="text-blue-500 ml-1">(step {workflow.iteration})</span>
                            )}
                          </span>
                        </>
                      )}
                      {workflow.status === "completed" && (
                        <>
                          <svg className="w-4 h-4 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                          </svg>
                          <span className="text-sm text-green-700">
                            Completed in {workflow.totalIterations || "?"} steps
                            {workflow.totalRetries ? ` (${workflow.totalRetries} retries)` : ""}
                          </span>
                        </>
                      )}
                      {workflow.status === "error" && (
                        <>
                          <svg className="w-4 h-4 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                          <span className="text-sm text-red-700 truncate max-w-xs">
                            {workflow.error || "Failed"}
                          </span>
                        </>
                      )}
                    </div>
                    <span className="text-xs text-slate-500">
                      {formatDuration(workflow.startedAt, workflow.completedAt)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Recent Events */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg">Recent Events</CardTitle>
            {mounted && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setEvents([])}
                disabled={events.length === 0}
              >
                Clear
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {events.length === 0 ? (
            <p className="text-sm text-slate-500">No recent events</p>
          ) : (
            <div className="space-y-2 max-h-80 overflow-y-auto">
              {events.map((event, index) => (
                <div
                  key={`${event.timestamp}-${index}`}
                  className={cn(
                    "p-3 rounded border text-sm",
                    event.type.includes("completed") ? "bg-green-50 border-green-200" :
                    event.type.includes("error") ? "bg-red-50 border-red-200" :
                    event.type.includes("started") ? "bg-blue-50 border-blue-200" :
                    event.type.includes("step") ? "bg-slate-50 border-slate-200" :
                    "bg-slate-50 border-slate-200"
                  )}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <EventIcon type={event.type} />
                      <span className="font-medium text-slate-700">{formatEventType(event.type)}</span>
                    </div>
                    <span className="text-slate-400 text-xs">
                      {formatTime(event.timestamp)}
                    </span>
                  </div>
                  
                  {"workflowId" in event && (
                    <div className="mt-2 pl-6 text-xs space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="text-slate-400">ID:</span>
                        <span className="font-mono text-slate-600">{event.workflowId.slice(0, 12)}...</span>
                      </div>
                      
                      {event.data.step && (
                        <div className="flex items-center gap-2">
                          <span className="text-slate-400">Step:</span>
                          <span className="text-slate-700 font-medium">{event.data.step}</span>
                          {event.data.iteration && (
                            <span className="text-slate-500">(iteration {event.data.iteration})</span>
                          )}
                        </div>
                      )}
                      
                      {event.data.symbols && event.data.symbols.length > 0 && (
                        <div className="flex items-center gap-2">
                          <span className="text-slate-400">Symbols:</span>
                          <span className="text-slate-600">{event.data.symbols.join(", ")}</span>
                        </div>
                      )}
                      
                      {event.data.requestType && (
                        <div className="flex items-center gap-2">
                          <span className="text-slate-400">Type:</span>
                          <Badge variant="outline" className="h-5 text-xs">{event.data.requestType}</Badge>
                        </div>
                      )}
                      
                      {event.type === "workflow:completed" && (
                        <div className="flex items-center gap-4 text-slate-600">
                          {event.data.iterations && (
                            <span>{event.data.iterations} steps</span>
                          )}
                          {event.data.totalRetries !== undefined && event.data.totalRetries > 0 && (
                            <span>{event.data.totalRetries} retries</span>
                          )}
                          {event.data.messagesCount !== undefined && (
                            <span>{event.data.messagesCount} messages</span>
                          )}
                        </div>
                      )}
                      
                      {event.data.error && (
                        <div className="flex items-center gap-2 text-red-600">
                          <span className="text-red-400">Error:</span>
                          <span className="truncate max-w-sm">{event.data.error}</span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ============================================
// Helper Components
// ============================================

function EventIcon({ type }: { type: string }) {
  const iconClass = "w-4 h-4";
  
  if (type.includes("completed")) {
    return (
      <svg className={cn(iconClass, "text-green-500")} fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
      </svg>
    );
  }
  
  if (type.includes("error")) {
    return (
      <svg className={cn(iconClass, "text-red-500")} fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
      </svg>
    );
  }
  
  if (type.includes("started") || type.includes("step")) {
    return (
      <svg className={cn(iconClass, "text-blue-500 animate-spin")} fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
      </svg>
    );
  }
  
  return (
    <svg className={cn(iconClass, "text-slate-400")} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  );
}

// ============================================
// Helper Functions
// ============================================

function formatEventType(type: string): string {
  return type
    .replace("workflow:", "Workflow ")
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, (str) => str.toUpperCase())
    .trim();
}

function formatTime(timestamp: string): string {
  const date = new Date(timestamp);
  return date.toLocaleTimeString();
}

function formatDuration(startTime: string, endTime?: string): string {
  const start = new Date(startTime).getTime();
  const end = endTime ? new Date(endTime).getTime() : Date.now();
  const diffMs = end - start;
  
  if (diffMs < 1000) {
    return `${diffMs}ms`;
  }
  
  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) {
    return `${seconds}s`;
  }
  
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}m ${remainingSeconds}s`;
}

export default LiveStatus;
