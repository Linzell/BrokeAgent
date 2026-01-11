import { useState, useEffect, useRef, useCallback } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { api, createWebSocketClient } from "@/lib/api";
import { Wifi, WifiOff, Play, Loader2, RefreshCw, Swords } from "lucide-react";

import { ExecutionList } from "./ExecutionList";
import { ExecutionGraph } from "./ExecutionGraph";
import { ResultsPanel } from "./ResultsPanel";
import type { 
  Execution, 
  ActiveWorkflow, 
  WorkflowEvent, 
  ExecutionResults,
  MarketDataResult,
  NewsResult,
  Decision,
  TechnicalAnalysis,
  SentimentAnalysis,
  DebateResult,
  TieredDebateResults,
  LLMUsage,
  LLMUsageEvent
} from "./types";

// Transform API response to our types
function transformResults(data: Record<string, unknown>): ExecutionResults {
  const results: ExecutionResults = {};
  
  // Market data
  if (data.marketData && Array.isArray(data.marketData)) {
    results.marketData = data.marketData.map((item: Record<string, unknown>) => ({
      symbol: item.symbol as string,
      price: item.price as number,
      change: item.change as number,
      changePercent: item.changePercent as number,
      volume: item.volume as number,
      high: item.high as number | undefined,
      low: item.low as number | undefined,
      open: item.open as number | undefined,
      previousClose: item.previousClose as number | undefined,
      marketCap: item.marketCap as number | undefined,
    })) as MarketDataResult[];
  }
  
  // News
  if (data.news && Array.isArray(data.news)) {
    results.news = data.news.map((item: Record<string, unknown>) => ({
      id: item.id as string,
      headline: item.headline as string,
      summary: item.summary as string | undefined,
      source: item.source as string,
      symbols: (item.symbols as string[]) || [],
      sentiment: (item.sentiment as number) || 0,
      publishedAt: item.publishedAt as string,
      url: item.url as string | undefined,
    })) as NewsResult[];
  }
  
  // Social mentions (field is 'social' in the API)
  if (data.social && typeof data.social === "object") {
    const social = data.social as Record<string, unknown>;
    if (social.mentions && Array.isArray(social.mentions)) {
      results.socialMentions = social.mentions;
    }
  }
  if (data.socialMentions && Array.isArray(data.socialMentions)) {
    results.socialMentions = data.socialMentions;
  }
  
  // Technical analysis (field is 'technical' in the API)
  if (data.technical && Array.isArray(data.technical)) {
    results.technicalAnalysis = data.technical as TechnicalAnalysis[];
  }
  if (data.technicalAnalysis && Array.isArray(data.technicalAnalysis)) {
    results.technicalAnalysis = data.technicalAnalysis as TechnicalAnalysis[];
  }
  
  // Sentiment analysis (field is 'sentiment' in the API)
  if (data.sentiment && Array.isArray(data.sentiment)) {
    results.sentimentAnalysis = data.sentiment as SentimentAnalysis[];
  }
  if (data.sentimentAnalysis && Array.isArray(data.sentimentAnalysis)) {
    results.sentimentAnalysis = data.sentimentAnalysis as SentimentAnalysis[];
  }
  
  // Fundamental analysis (field is 'fundamental' in the API)
  if (data.fundamental && Array.isArray(data.fundamental)) {
    results.fundamentalAnalysis = data.fundamental;
  }
  if (data.fundamentalAnalysis && Array.isArray(data.fundamentalAnalysis)) {
    results.fundamentalAnalysis = data.fundamentalAnalysis;
  }
  
  // Decisions
  if (data.decisions && Array.isArray(data.decisions)) {
    results.decisions = data.decisions as Decision[];
  }
  
  // Orders
  if (data.orders && Array.isArray(data.orders)) {
    results.orders = data.orders;
  }
  
  // Risk
  if (data.riskAssessment) {
    results.riskAssessment = data.riskAssessment as ExecutionResults["riskAssessment"];
  }
  if (data.risk) {
    results.riskAssessment = data.risk as ExecutionResults["riskAssessment"];
  }
  
  // Portfolio
  if (data.portfolio) {
    results.portfolio = data.portfolio as ExecutionResults["portfolio"];
  }
  
  // Debate results
  if (data.debates && Array.isArray(data.debates)) {
    results.debateResults = data.debates as DebateResult[];
  }
  if (data.debateResults && Array.isArray(data.debateResults)) {
    results.debateResults = data.debateResults as DebateResult[];
  }
  
  // Tiered debate results
  if (data.tieredDebateResults && typeof data.tieredDebateResults === "object") {
    results.tieredDebateResults = data.tieredDebateResults as TieredDebateResults;
  }
  
  return results;
}

export function ExecutionViewer() {
  // State
  const [executions, setExecutions] = useState<Execution[]>([]);
  const [activeWorkflows, setActiveWorkflows] = useState<Map<string, ActiveWorkflow>>(new Map());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedResults, setSelectedResults] = useState<ExecutionResults | null>(null);
  const [loading, setLoading] = useState(true);
  const [resultsLoading, setResultsLoading] = useState(false);
  const [wsConnected, setWsConnected] = useState(false);
  const [executing, setExecuting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  
  // Refs
  const wsRef = useRef<ReturnType<typeof createWebSocketClient> | null>(null);
  const reconnectTimeoutRef = useRef<number | null>(null);
  const resultsCache = useRef<Map<string, ExecutionResults>>(new Map());
  const selectedIdRef = useRef<string | null>(null);
  const reconnectAttemptRef = useRef(0);
  const mountedRef = useRef(true);
  const llmUsageCache = useRef<Map<string, LLMUsage[]>>(new Map());

  // Keep ref in sync with state
  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);

  // Fetch executions list
  const fetchExecutions = useCallback(async () => {
    const result = await api.workflows.executions(30);
    if (result.data?.executions) {
      setExecutions(result.data.executions as Execution[]);
    }
    setLoading(false);
  }, []);

  // Fetch execution details - parse the output JSON string
  const fetchExecutionDetails = useCallback(async (id: string) => {
    // Check cache first
    if (resultsCache.current.has(id)) {
      console.log("[ExecutionViewer] Using cached results for:", id);
      setSelectedResults(resultsCache.current.get(id) || null);
      return;
    }
    
    setResultsLoading(true);
    try {
      console.log("[ExecutionViewer] Fetching execution details for:", id);
      const result = await api.workflows.execution(id);
      console.log("[ExecutionViewer] API response:", result);
      
      if (result.data?.execution) {
        const exec = result.data.execution as Record<string, unknown>;
        console.log("[ExecutionViewer] Execution data:", exec);
        
        // The output is a JSON string - parse it
        let outputData: Record<string, unknown> = {};
        if (exec.output) {
          try {
            outputData = typeof exec.output === "string" 
              ? JSON.parse(exec.output) 
              : exec.output as Record<string, unknown>;
          } catch (e) {
            console.error("[ExecutionViewer] Failed to parse execution output:", e);
          }
        }
        
        const results = transformResults(outputData);
        console.log("[ExecutionViewer] Transformed results:", results);
        resultsCache.current.set(id, results);
        setSelectedResults(results);
      } else {
        console.log("[ExecutionViewer] No execution in response");
      }
    } catch (e) {
      console.error("[ExecutionViewer] Failed to fetch execution details:", e);
    }
    setResultsLoading(false);
  }, []);

  // Handle WebSocket messages - no dependencies that change frequently
  const handleWsMessage = useCallback((data: unknown) => {
    const event = data as { type: string; workflowId?: string; [key: string]: unknown };
    
    if (event.type?.startsWith("workflow:") && event.workflowId) {
      const workflowEvent = event as WorkflowEvent;
      
      // Handle LLM events separately
      if (workflowEvent.type === "workflow:llm") {
        const llmEvent = workflowEvent.data.llmEvent as LLMUsageEvent | undefined;
        if (llmEvent) {
          const llmUsage: LLMUsage = {
            provider: llmEvent.provider,
            model: llmEvent.model,
            latencyMs: llmEvent.latencyMs,
            tokens: llmEvent.tokens,
            error: llmEvent.error,
            fallbackFrom: llmEvent.fallbackFrom,
            timestamp: llmEvent.timestamp || workflowEvent.timestamp,
            workflowId: workflowEvent.workflowId,
          };
          
          // Add to cache
          const existing = llmUsageCache.current.get(workflowEvent.workflowId) || [];
          llmUsageCache.current.set(workflowEvent.workflowId, [...existing, llmUsage]);
          
          // Update active workflow with LLM usage
          setActiveWorkflows((prev) => {
            const updated = new Map(prev);
            const existing = updated.get(workflowEvent.workflowId);
            if (existing) {
              const existingLlmUsage = existing.llmUsage || [];
              updated.set(workflowEvent.workflowId, {
                ...existing,
                llmUsage: [...existingLlmUsage, llmUsage],
              });
            }
            return updated;
          });
          
          // Update results cache to include LLM usage
          const cachedResults = resultsCache.current.get(workflowEvent.workflowId);
          if (cachedResults) {
            const updatedResults = {
              ...cachedResults,
              llmUsage: llmUsageCache.current.get(workflowEvent.workflowId) || [],
            };
            resultsCache.current.set(workflowEvent.workflowId, updatedResults);
            
            // If this workflow is selected, update the displayed results
            if (selectedIdRef.current === workflowEvent.workflowId) {
              setSelectedResults(updatedResults);
            }
          }
        }
        return;
      }
      
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
              steps: [],
              llmUsage: [],
            });
            // Clear LLM usage cache for new workflow
            llmUsageCache.current.set(workflowEvent.workflowId, []);
            // Auto-select new workflow
            setSelectedId(workflowEvent.workflowId);
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
                completedAt: workflowEvent.timestamp,
              });
            }
            // Store results from completed workflow
            if (workflowEvent.data) {
              const results = transformResults(workflowEvent.data as Record<string, unknown>);
              // Include LLM usage from cache
              const llmUsage = llmUsageCache.current.get(workflowEvent.workflowId) || [];
              results.llmUsage = llmUsage;
              resultsCache.current.set(workflowEvent.workflowId, results);
              // Use ref to check current selected id
              if (selectedIdRef.current === workflowEvent.workflowId) {
                setSelectedResults(results);
              }
            }
            // Remove from active after delay
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
    
    if (event.type === "connected") {
      setWsConnected(true);
      wsRef.current?.subscribe("workflows");
    }
  }, []); // Empty deps - uses refs for changing values

  // Connect WebSocket with proper reconnection
  useEffect(() => {
    mountedRef.current = true;
    
    function connect() {
      // Don't connect if unmounted or already connected
      if (!mountedRef.current || wsRef.current?.ws.readyState === WebSocket.OPEN) {
        return;
      }
      
      // Clean up existing connection
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      
      console.log("[ExecutionViewer] Connecting to WebSocket...");
      const client = createWebSocketClient(handleWsMessage);
      wsRef.current = client;

      client.ws.onopen = () => {
        if (!mountedRef.current) return;
        console.log("[ExecutionViewer] WebSocket connected");
        setWsConnected(true);
        reconnectAttemptRef.current = 0; // Reset retry counter on success
      };
      
      client.ws.onclose = (event) => {
        if (!mountedRef.current) return;
        console.log("[ExecutionViewer] WebSocket closed, code:", event.code);
        setWsConnected(false);
        wsRef.current = null;
        
        // Only reconnect if not a normal close and component is still mounted
        if (event.code !== 1000 && mountedRef.current) {
          const delay = Math.min(1000 * Math.pow(2, reconnectAttemptRef.current), 30000);
          reconnectAttemptRef.current++;
          console.log(`[ExecutionViewer] Reconnecting in ${delay}ms (attempt ${reconnectAttemptRef.current})`);
          
          reconnectTimeoutRef.current = window.setTimeout(() => {
            if (mountedRef.current) {
              connect();
            }
          }, delay);
        }
      };
      
      client.ws.onerror = () => {
        if (!mountedRef.current) return;
        console.log("[ExecutionViewer] WebSocket error");
        setWsConnected(false);
      };
    }
    
    connect();

    return () => {
      mountedRef.current = false;
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [handleWsMessage]);

  // Fetch initial data
  useEffect(() => {
    fetchExecutions();
  }, [fetchExecutions]);

  // Refresh executions when workflows complete
  useEffect(() => {
    // Check if any active workflow just completed
    const hasCompleted = Array.from(activeWorkflows.values()).some(
      w => w.status === "completed" || w.status === "error"
    );
    if (hasCompleted) {
      fetchExecutions();
    }
  }, [activeWorkflows, fetchExecutions]);

  // Handle selection change
  const handleSelect = useCallback((id: string) => {
    setSelectedId(id);
    setSelectedResults(null); // Clear previous results
    
    // If it's an active workflow, check cache
    if (activeWorkflows.has(id)) {
      const cached = resultsCache.current.get(id);
      if (cached) {
        setSelectedResults(cached);
      }
      return;
    }
    
    // Fetch details for historical execution
    fetchExecutionDetails(id);
  }, [activeWorkflows, fetchExecutionDetails]);

  // Run workflow
  async function runWorkflow(type: "research" | "analyze" | "trade" | "tieredDebate") {
    setExecuting(type);
    setError(null);
    
    // Demo symbols - in real app these would come from portfolio/watchlist
    const symbols = ["AAPL", "MSFT", "GOOGL"];
    
    // For tiered debate: simulate holdings, watchlist, discovery
    const holdings = ["AAPL"]; // Stocks you own
    const watchlist = ["MSFT", "GOOGL"]; // Stocks you're watching
    const discovery = ["NVDA", "META", "AMZN", "TSLA", "AMD", "INTC"]; // Scan for opportunities
    
    try {
      console.log(`[ExecutionViewer] Running ${type} workflow`);
      let result;
      
      if (type === "tieredDebate") {
        console.log(`[ExecutionViewer] Tiered debate: holdings=${holdings.length}, watchlist=${watchlist.length}, discovery=${discovery.length}`);
        result = await api.execute.tieredDebate(holdings, watchlist, discovery);
      } else {
        result = await api.execute[type](symbols);
      }
      
      console.log(`[ExecutionViewer] ${type} workflow response:`, result);
      
      if (result.error) {
        setError(`Workflow failed: ${result.error}`);
      } else if (result.data) {
        const workflowId = (result.data as any).workflowId;
        const threadId = (result.data as any).threadId;
        console.log("[ExecutionViewer] Workflow ID:", workflowId, "Thread ID:", threadId);
        
        // Handle different response structures
        let responseData: Record<string, unknown> = {};
        if (type === "tieredDebate") {
          // Tiered debate response structure
          const tieredData = result.data as any;
          responseData = {
            tieredDebateResults: {
              holdingsDebates: tieredData.holdingsDebates || [],
              watchlistDebates: tieredData.watchlistDebates || [],
              discoveryScores: tieredData.discoveryScores || [],
              discoveryDebates: tieredData.discoveryDebates || [],
              summary: tieredData.summary || {},
            }
          };
          console.log("[ExecutionViewer] Tiered debate response data:", responseData);
        } else {
          // Other workflows have data nested
          responseData = (result.data as any).data as Record<string, unknown> || {};
          console.log("[ExecutionViewer] Response data object:", responseData);
        }
        
        const results = transformResults(responseData);
        console.log("[ExecutionViewer] Transformed results:", results);
        
        // Cache results by workflowId (which is the execution ID in DB)
        if (workflowId) {
          resultsCache.current.set(workflowId, results);
        }
        
        // Refresh execution list first
        const execResult = await api.workflows.executions(30);
        if (execResult.data?.executions) {
          const newExecutions = execResult.data.executions as Execution[];
          setExecutions(newExecutions);
          
          // Find the newly created execution (most recent one matching our thread)
          // The workflowId from API response IS the execution ID in the database
          const newExecution = workflowId 
            ? (newExecutions.find(e => e.id === workflowId) 
              || newExecutions.find(e => e.thread_id === threadId)
              || newExecutions[0])
            : newExecutions[0]; // Fallback to most recent
          
          if (newExecution) {
            console.log("[ExecutionViewer] Auto-selecting execution:", newExecution.id);
            // Also cache by the execution ID if different
            if (workflowId && newExecution.id !== workflowId) {
              resultsCache.current.set(newExecution.id, results);
            }
            setSelectedId(newExecution.id);
            setSelectedResults(results);
          }
        } else {
          // No execution list, just show results
          setSelectedResults(results);
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setExecuting(null);
    }
  }

  // Get selected execution or active workflow
  const selectedExecution = executions.find(e => e.id === selectedId) || null;
  const selectedActiveWorkflow = activeWorkflows.get(selectedId || "") || null;
  
  console.log("[ExecutionViewer] Selected state:", {
    selectedId,
    selectedExecution: selectedExecution ? { id: selectedExecution.id, trigger_type: selectedExecution.trigger_type } : null,
    selectedActiveWorkflow: selectedActiveWorkflow ? { workflowId: selectedActiveWorkflow.workflowId } : null
  });

  return (
    <div className="space-y-4">
      {/* Quick Actions Bar */}
      <Card>
        <CardContent className="py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Button 
                size="sm"
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
                size="sm"
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
                size="sm"
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
              <Button 
                size="sm"
                variant="outline"
                onClick={() => runWorkflow("tieredDebate")} 
                disabled={executing !== null}
                className="border-orange-300 text-orange-600 hover:bg-orange-50"
                title="Tiered debate: Holdings (full analysis) → Watchlist (batch) → Discovery (quick score + top batch)"
              >
                {executing === "tieredDebate" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Swords className="h-4 w-4" />
                )}
                Debate
              </Button>
            </div>
            
            <div className="flex items-center gap-3">
              <Button variant="ghost" size="sm" onClick={fetchExecutions}>
                <RefreshCw className="h-4 w-4" />
              </Button>
              {wsConnected ? (
                <Badge variant="outline" className="text-green-600 border-green-300">
                  <Wifi className="h-3 w-3 mr-1" />
                  Live
                </Badge>
              ) : (
                <Badge variant="outline" className="text-amber-600 border-amber-300">
                  <WifiOff className="h-3 w-3 mr-1" />
                  Reconnecting
                </Badge>
              )}
            </div>
          </div>
          
          {error && (
            <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded text-red-700 text-sm">
              {error}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Main 3-Panel Layout */}
      <Card className="overflow-hidden !p-0 !gap-0">
        <div className="grid grid-cols-12 h-[600px]">
          {/* Left Panel - Execution List */}
          <div className="col-span-3 border-r bg-slate-50/30 h-full overflow-hidden">
            <ExecutionList
              executions={executions}
              activeWorkflows={activeWorkflows}
              selectedId={selectedId}
              onSelect={handleSelect}
            />
          </div>
          
          {/* Center Panel - Graph - explicit height required for ReactFlow */}
          <div className="col-span-4 border-r relative h-full overflow-hidden">
            <ExecutionGraph
              execution={selectedExecution}
              activeWorkflow={selectedActiveWorkflow}
              results={selectedResults}
            />
          </div>
          
          {/* Right Panel - Results */}
          <div className="col-span-5 bg-slate-50/30 h-full overflow-hidden">
            <ResultsPanel
              results={selectedResults}
              loading={resultsLoading}
            />
          </div>
        </div>
      </Card>
    </div>
  );
}

export default ExecutionViewer;
