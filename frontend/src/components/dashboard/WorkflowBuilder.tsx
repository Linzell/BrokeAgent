import { useState, useCallback } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { 
  Play, 
  Search, 
  BarChart3, 
  TrendingUp,
  Loader2,
  CheckCircle,
  XCircle,
  ArrowRight,
  Workflow,
  X,
  Swords
} from "lucide-react";

// ============================================
// Types
// ============================================

type WorkflowType = "research" | "analysis" | "decision" | "debate";

interface WorkflowConfig {
  type: WorkflowType;
  name: string;
  description: string;
  icon: React.ReactNode;
  steps: string[];
  color: string;
}

interface ExecutionState {
  status: "idle" | "running" | "success" | "error";
  workflowType: WorkflowType | null;
  threadId: string | null;
  startedAt: Date | null;
  completedAt: Date | null;
  error: string | null;
  summary: Record<string, unknown> | null;
}

// ============================================
// Workflow Configurations
// ============================================

const WORKFLOW_CONFIGS: Record<WorkflowType, WorkflowConfig> = {
  research: {
    type: "research",
    name: "Research",
    description: "Gather news, social sentiment, and market data for symbols",
    icon: <Search className="h-5 w-5" />,
    steps: ["News Agent", "Social Agent", "Market Data Agent"],
    color: "blue",
  },
  analysis: {
    type: "analysis",
    name: "Analysis",
    description: "Research + Technical, Sentiment, and Fundamental analysis",
    icon: <BarChart3 className="h-5 w-5" />,
    steps: ["Research Team", "Technical Analyst", "Sentiment Analyst", "Fundamental Analyst"],
    color: "purple",
  },
  decision: {
    type: "decision",
    name: "Full Trade",
    description: "Complete pipeline: Research → Analysis → Trading Decision",
    icon: <TrendingUp className="h-5 w-5" />,
    steps: ["Research Team", "Analysis Team", "Portfolio Manager", "Risk Manager", "Order Executor"],
    color: "emerald",
  },
  debate: {
    type: "debate",
    name: "Bull vs Bear",
    description: "Adversarial debate with bull and bear perspectives",
    icon: <Swords className="h-5 w-5" />,
    steps: ["Research", "Bull Case", "Bear Case", "Synthesis"],
    color: "orange",
  },
};

// Popular symbols for quick selection
const POPULAR_SYMBOLS = ["AAPL", "MSFT", "GOOGL", "AMZN", "NVDA", "TSLA", "META", "BTC-USD"];

// ============================================
// Workflow Builder Component
// ============================================

export function WorkflowBuilder() {
  const [selectedWorkflow, setSelectedWorkflow] = useState<WorkflowType>("research");
  const [symbolInput, setSymbolInput] = useState("");
  const [selectedSymbols, setSelectedSymbols] = useState<string[]>(["AAPL"]);
  const [execution, setExecution] = useState<ExecutionState>({
    status: "idle",
    workflowType: null,
    threadId: null,
    startedAt: null,
    completedAt: null,
    error: null,
    summary: null,
  });

  // Add a symbol to the list
  const addSymbol = useCallback((symbol: string) => {
    const normalized = symbol.toUpperCase().trim();
    if (normalized && !selectedSymbols.includes(normalized) && selectedSymbols.length < 5) {
      setSelectedSymbols(prev => [...prev, normalized]);
      setSymbolInput("");
    }
  }, [selectedSymbols]);

  // Remove a symbol
  const removeSymbol = useCallback((symbol: string) => {
    setSelectedSymbols(prev => prev.filter(s => s !== symbol));
  }, []);

  // Handle symbol input
  const handleSymbolKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      addSymbol(symbolInput);
    }
  }, [symbolInput, addSymbol]);

  // Execute the workflow
  const executeWorkflow = async () => {
    if (selectedSymbols.length === 0) {
      toast.error("Please select at least one symbol");
      return;
    }

    setExecution({
      status: "running",
      workflowType: selectedWorkflow,
      threadId: null,
      startedAt: new Date(),
      completedAt: null,
      error: null,
      summary: null,
    });

    toast.info(`Starting ${WORKFLOW_CONFIGS[selectedWorkflow].name} workflow...`, {
      description: `Symbols: ${selectedSymbols.join(", ")}`,
    });

    try {
      let response;
      switch (selectedWorkflow) {
        case "research":
          response = await api.execute.research(selectedSymbols);
          break;
        case "analysis":
          response = await api.execute.analyze(selectedSymbols);
          break;
        case "decision":
          response = await api.execute.trade(selectedSymbols);
          break;
        case "debate":
          response = await api.execute.debate(selectedSymbols);
          break;
      }

      if (response.error) {
        throw new Error(response.error);
      }

      setExecution(prev => ({
        ...prev,
        status: "success",
        threadId: response.data?.threadId || null,
        completedAt: new Date(),
        summary: response.data?.summary || null,
      }));

      toast.success(`${WORKFLOW_CONFIGS[selectedWorkflow].name} workflow completed!`, {
        description: `Thread ID: ${response.data?.threadId}`,
      });

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      setExecution(prev => ({
        ...prev,
        status: "error",
        completedAt: new Date(),
        error: errorMessage,
      }));

      toast.error(`Workflow failed: ${errorMessage}`);
    }
  };

  // Reset execution state
  const resetExecution = () => {
    setExecution({
      status: "idle",
      workflowType: null,
      threadId: null,
      startedAt: null,
      completedAt: null,
      error: null,
      summary: null,
    });
  };

  const config = WORKFLOW_CONFIGS[selectedWorkflow];

  return (
    <div className="space-y-6">
      {/* Workflow Type Selection */}
      <div className="grid gap-4 md:grid-cols-3">
        {Object.values(WORKFLOW_CONFIGS).map((wf) => (
          <Card
            key={wf.type}
            className={cn(
              "cursor-pointer transition-all hover:shadow-md",
              selectedWorkflow === wf.type 
                ? `ring-2 ring-${wf.color}-500 bg-${wf.color}-50/50` 
                : "hover:bg-muted/50"
            )}
            onClick={() => setSelectedWorkflow(wf.type)}
          >
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <div className={cn(
                  "p-2 rounded-lg",
                  wf.color === "blue" && "bg-blue-100 text-blue-600",
                  wf.color === "purple" && "bg-purple-100 text-purple-600",
                  wf.color === "emerald" && "bg-emerald-100 text-emerald-600",
                  wf.color === "orange" && "bg-orange-100 text-orange-600",
                )}>
                  {wf.icon}
                </div>
                {selectedWorkflow === wf.type && (
                  <Badge variant="default" className="text-xs">Selected</Badge>
                )}
              </div>
              <CardTitle className="text-lg mt-2">{wf.name}</CardTitle>
              <CardDescription className="text-xs">{wf.description}</CardDescription>
            </CardHeader>
          </Card>
        ))}
      </div>

      {/* Configuration Panel */}
      <div className="grid gap-6 md:grid-cols-2">
        {/* Symbol Selection */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Symbols</CardTitle>
            <CardDescription>Select up to 5 symbols to analyze</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Symbol Input */}
            <div className="flex gap-2">
              <input
                type="text"
                value={symbolInput}
                onChange={(e) => setSymbolInput(e.target.value.toUpperCase())}
                onKeyDown={handleSymbolKeyDown}
                placeholder="Enter symbol (e.g., AAPL)"
                className="flex-1 px-3 py-2 border rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                disabled={selectedSymbols.length >= 5 || execution.status === "running"}
              />
              <Button
                size="sm"
                onClick={() => addSymbol(symbolInput)}
                disabled={!symbolInput || selectedSymbols.length >= 5 || execution.status === "running"}
              >
                Add
              </Button>
            </div>

            {/* Selected Symbols */}
            <div className="flex flex-wrap gap-2">
              {selectedSymbols.map((symbol) => (
                <Badge 
                  key={symbol} 
                  variant="secondary"
                  className="px-3 py-1 flex items-center gap-1"
                >
                  {symbol}
                  <button
                    onClick={() => removeSymbol(symbol)}
                    className="ml-1 hover:text-destructive"
                    disabled={execution.status === "running"}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              ))}
              {selectedSymbols.length === 0 && (
                <span className="text-sm text-muted-foreground">No symbols selected</span>
              )}
            </div>

            {/* Quick Selection */}
            <div className="pt-2 border-t">
              <p className="text-xs text-muted-foreground mb-2">Popular symbols:</p>
              <div className="flex flex-wrap gap-1">
                {POPULAR_SYMBOLS.map((symbol) => (
                  <Button
                    key={symbol}
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => addSymbol(symbol)}
                    disabled={
                      selectedSymbols.includes(symbol) || 
                      selectedSymbols.length >= 5 ||
                      execution.status === "running"
                    }
                  >
                    {symbol}
                  </Button>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Workflow Steps Preview */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Workflow className="h-4 w-4" />
              Workflow Steps
            </CardTitle>
            <CardDescription>
              {config.name} pipeline visualization
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {config.steps.map((step, index) => (
                <div key={step} className="flex items-center gap-2">
                  <div className={cn(
                    "w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium",
                    config.color === "blue" && "bg-blue-100 text-blue-700",
                    config.color === "purple" && "bg-purple-100 text-purple-700",
                    config.color === "emerald" && "bg-emerald-100 text-emerald-700",
                    config.color === "orange" && "bg-orange-100 text-orange-700",
                  )}>
                    {index + 1}
                  </div>
                  <span className="text-sm">{step}</span>
                  {index < config.steps.length - 1 && (
                    <ArrowRight className="h-3 w-3 text-muted-foreground ml-auto" />
                  )}
                </div>
              ))}
            </div>

            {/* Execute Button */}
            <div className="mt-6 pt-4 border-t">
              <Button
                className="w-full"
                size="lg"
                onClick={executeWorkflow}
                disabled={selectedSymbols.length === 0 || execution.status === "running"}
              >
                {execution.status === "running" ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Running...
                  </>
                ) : (
                  <>
                    <Play className="h-4 w-4 mr-2" />
                    Run {config.name} Workflow
                  </>
                )}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Execution Results */}
      {execution.status !== "idle" && (
        <Card className={cn(
          execution.status === "success" && "border-emerald-500/50",
          execution.status === "error" && "border-red-500/50",
          execution.status === "running" && "border-blue-500/50",
        )}>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2">
                {execution.status === "running" && (
                  <Loader2 className="h-4 w-4 animate-spin text-blue-500" />
                )}
                {execution.status === "success" && (
                  <CheckCircle className="h-4 w-4 text-emerald-500" />
                )}
                {execution.status === "error" && (
                  <XCircle className="h-4 w-4 text-red-500" />
                )}
                Execution {execution.status === "running" ? "In Progress" : execution.status === "success" ? "Complete" : "Failed"}
              </CardTitle>
              {execution.status !== "running" && (
                <Button variant="outline" size="sm" onClick={resetExecution}>
                  Clear
                </Button>
              )}
            </div>
            {execution.workflowType && (
              <CardDescription>
                {WORKFLOW_CONFIGS[execution.workflowType].name} workflow
                {execution.threadId && ` • Thread: ${execution.threadId.slice(0, 8)}...`}
              </CardDescription>
            )}
          </CardHeader>
          <CardContent>
            {/* Timing info */}
            <div className="flex gap-4 text-sm text-muted-foreground mb-4">
              {execution.startedAt && (
                <span>Started: {execution.startedAt.toLocaleTimeString()}</span>
              )}
              {execution.completedAt && (
                <span>Completed: {execution.completedAt.toLocaleTimeString()}</span>
              )}
              {execution.startedAt && execution.completedAt && (
                <span>
                  Duration: {((execution.completedAt.getTime() - execution.startedAt.getTime()) / 1000).toFixed(1)}s
                </span>
              )}
            </div>

            {/* Error display */}
            {execution.error && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-md text-sm text-red-700">
                {execution.error}
              </div>
            )}

            {/* Summary display */}
            {execution.summary && Object.keys(execution.summary).length > 0 && (
              <div className="space-y-2">
                <p className="text-sm font-medium">Results Summary:</p>
                <div className="p-3 bg-muted rounded-md">
                  <pre className="text-xs overflow-auto max-h-48">
                    {JSON.stringify(execution.summary, null, 2)}
                  </pre>
                </div>
              </div>
            )}

            {/* Running indicator */}
            {execution.status === "running" && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <div className="flex gap-1">
                  <span className="w-2 h-2 bg-blue-500 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                  <span className="w-2 h-2 bg-blue-500 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                  <span className="w-2 h-2 bg-blue-500 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
                </div>
                Processing workflow... This may take a minute.
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

export default WorkflowBuilder;
