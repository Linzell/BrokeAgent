import { useMemo, useCallback } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  type Node,
  type Edge,
  Position,
  type NodeProps,
  Handle,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { cn } from "@/lib/utils";
import { 
  Search, 
  BarChart3, 
  Brain, 
  CheckCircle,
  Loader2,
  Circle,
  XCircle,
  Swords,
  Zap,
  Target,
  Layers,
} from "lucide-react";
import type { ActiveWorkflow, Execution, ExecutionResults } from "./types";

type StepStatus = "pending" | "active" | "completed" | "error" | "skipped";

interface StepNodeData {
  label: string;
  type: "research" | "analysis" | "decision" | "debate" | "smart_debate";
  status: StepStatus;
  agents?: string[];
}

// Custom node component
function StepNode({ data }: NodeProps<Node<StepNodeData>>) {
  const statusColors: Record<StepStatus, string> = {
    pending: "bg-slate-100 border-slate-300 text-slate-600",
    active: "bg-blue-100 border-blue-400 text-blue-700 shadow-lg shadow-blue-200",
    completed: "bg-green-100 border-green-400 text-green-700",
    error: "bg-red-100 border-red-400 text-red-700",
    skipped: "bg-slate-50 border-slate-200 text-slate-400",
  };

  const icons: Record<string, typeof Circle> = {
    research: Search,
    analysis: BarChart3,
    decision: Brain,
    debate: Swords,
    smart_debate: Zap,
    holdings: Target,
    watchlist: Layers,
    discovery: Zap,
  };

  const Icon = icons[data.type] || Circle;
  const StatusIcon = data.status === "active" ? Loader2 : 
                     data.status === "completed" ? CheckCircle :
                     data.status === "error" ? XCircle : Circle;

  return (
    <>
      <Handle type="target" position={Position.Top} className="!bg-slate-400" />
      <div
        className={cn(
          "px-4 py-3 rounded-lg border-2 min-w-[140px] transition-all",
          statusColors[data.status]
        )}
      >
        <div className="flex items-center gap-2 mb-1">
          <Icon className={cn("h-4 w-4", data.status === "active" && "animate-pulse")} />
          <span className="font-semibold text-sm">{data.label}</span>
        </div>
        
        <div className="flex items-center gap-1 text-xs">
          <StatusIcon className={cn(
            "h-3 w-3",
            data.status === "active" && "animate-spin"
          )} />
          <span className="capitalize">{data.status}</span>
        </div>
        
        {data.agents && data.agents.length > 0 && (
          <div className="mt-2 pt-2 border-t border-current/20 text-xs opacity-75">
            {data.agents.length} agent{data.agents.length > 1 ? "s" : ""}
          </div>
        )}
      </div>
      <Handle type="source" position={Position.Bottom} className="!bg-slate-400" />
    </>
  );
}

// Must be defined outside component to avoid recreation
const nodeTypes = { step: StepNode };

interface ExecutionGraphProps {
  execution: Execution | null;
  activeWorkflow: ActiveWorkflow | null;
  results?: ExecutionResults | null;
}

export function ExecutionGraph({ execution, activeWorkflow, results }: ExecutionGraphProps) {
  // Detect if this is a tiered debate based on results
  const hasTieredDebateResults = !!results?.tieredDebateResults;
  
  // Determine workflow type and current step
  const rawWorkflowType = activeWorkflow?.requestType || execution?.trigger_type || "research";
  
  // Map "debate" to "smart_debate" since we only use tiered debate now
  // Also check for tiered debate results as a fallback
  let workflowType = rawWorkflowType;
  if (rawWorkflowType === "debate" || hasTieredDebateResults) {
    workflowType = "smart_debate";
  }
  
  const currentStep = activeWorkflow?.currentStep || execution?.current_step;
  const status = activeWorkflow?.status || execution?.status;
  
  // Debug logging
  console.log("[ExecutionGraph] Props:", { 
    hasExecution: !!execution, 
    hasActiveWorkflow: !!activeWorkflow,
    hasTieredDebateResults,
    rawWorkflowType,
    workflowType,
    currentStep,
    status 
  });
  
  // Normalize type name
  const normalizedType = workflowType?.toLowerCase().replace("analysis", "analyze");

  // Generate nodes and edges
  const { nodes, edges } = useMemo(() => {
    const stepDefinitions: Record<string, Array<{ id: string; label: string; type: "research" | "analysis" | "decision" | "debate" | "smart_debate"; agents: string[] }>> = {
      research: [
        { id: "research", label: "Research", type: "research", agents: ["Market Data", "News", "Social"] },
      ],
      analyze: [
        { id: "research", label: "Research", type: "research", agents: ["Market Data", "News", "Social"] },
        { id: "analysis", label: "Analysis", type: "analysis", agents: ["Technical", "Sentiment", "Fundamental"] },
      ],
      trade: [
        { id: "research", label: "Research", type: "research", agents: ["Market Data", "News", "Social"] },
        { id: "analysis", label: "Analysis", type: "analysis", agents: ["Technical", "Sentiment", "Fundamental"] },
        { id: "decision", label: "Decision", type: "decision", agents: ["Portfolio Manager", "Risk Manager"] },
      ],
      decision: [
        { id: "research", label: "Research", type: "research", agents: ["Market Data", "News", "Social"] },
        { id: "analysis", label: "Analysis", type: "analysis", agents: ["Technical", "Sentiment", "Fundamental"] },
        { id: "decision", label: "Decision", type: "decision", agents: ["Portfolio Manager", "Risk Manager"] },
      ],
      debate: [
        { id: "research", label: "Research", type: "research", agents: ["Market Data", "News"] },
        { id: "bull", label: "Bull Case", type: "debate", agents: ["Bull Researcher"] },
        { id: "bear", label: "Bear Case", type: "debate", agents: ["Bear Researcher"] },
        { id: "synthesis", label: "Synthesis", type: "debate", agents: ["Debate Synthesizer"] },
      ],
      smart_debate: [
        { id: "research", label: "Research", type: "research", agents: ["Market Data", "News", "Social"] },
        { id: "holdings", label: "Holdings", type: "smart_debate", agents: ["Bull", "Bear", "Synthesis"] },
        { id: "watchlist", label: "Watchlist", type: "smart_debate", agents: ["Batch Analyst"] },
        { id: "discovery", label: "Discovery", type: "smart_debate", agents: ["Quick Score", "Batch Analyst"] },
      ],
      tiered_debate: [
        { id: "research", label: "Research", type: "research", agents: ["Market Data", "News", "Social"] },
        { id: "holdings", label: "Holdings", type: "smart_debate", agents: ["Bull", "Bear", "Synthesis"] },
        { id: "watchlist", label: "Watchlist", type: "smart_debate", agents: ["Batch Analyst"] },
        { id: "discovery", label: "Discovery", type: "smart_debate", agents: ["Quick Score", "Batch Analyst"] },
      ],
    };

    const steps = stepDefinitions[normalizedType] || stepDefinitions.research;
    
    // Determine status for each step
    const getStepStatus = (stepId: string, index: number): StepStatus => {
      if (status === "completed") return "completed";
      if (status === "error" || status === "failed") {
        // Find current step index
        const currentIndex = steps.findIndex(s => 
          s.id === currentStep || s.label.toLowerCase() === currentStep?.toLowerCase()
        );
        if (index < currentIndex) return "completed";
        if (index === currentIndex) return "error";
        return "pending";
      }
      
      // Running status
      const currentIndex = steps.findIndex(s => 
        s.id === currentStep || s.label.toLowerCase() === currentStep?.toLowerCase()
      );
      if (index < currentIndex) return "completed";
      if (index === currentIndex) return "active";
      return "pending";
    };

    // Create nodes - vertically stacked
    const flowNodes: Node<StepNodeData>[] = steps.map((step, index) => ({
      id: step.id,
      type: "step",
      position: { x: 75, y: index * 120 },
      data: {
        label: step.label,
        type: step.type,
        status: getStepStatus(step.id, index),
        agents: step.agents,
      },
    }));

    // Create edges
    const flowEdges: Edge[] = steps.slice(0, -1).map((step, index) => {
      const nextStep = steps[index + 1];
      const stepStatus = getStepStatus(step.id, index);
      return {
        id: `${step.id}-${nextStep.id}`,
        source: step.id,
        target: nextStep.id,
        animated: stepStatus === "active",
        style: { 
          stroke: stepStatus === "completed" ? "#22c55e" : 
                  stepStatus === "active" ? "#3b82f6" : 
                  stepStatus === "error" ? "#ef4444" : "#cbd5e1",
          strokeWidth: 2,
        },
      };
    });

    return { nodes: flowNodes, edges: flowEdges };
  }, [normalizedType, currentStep, status]);

  // Empty state
  if (!execution && !activeWorkflow) {
    return (
      <div className="h-full flex items-center justify-center bg-slate-50">
        <div className="text-center text-slate-400">
          <Brain className="h-12 w-12 mx-auto mb-3 opacity-50" />
          <p className="font-medium">Select an execution</p>
          <p className="text-sm">to view the workflow graph</p>
        </div>
      </div>
    );
  }

  // Generate a unique key to force ReactFlow re-render
  const flowKey = `${execution?.id || activeWorkflow?.workflowId || "none"}-${status}-${currentStep}`;
  
  console.log("[ExecutionGraph] Generated:", { flowKey, nodeCount: nodes.length, edgeCount: edges.length });

  return (
    <div className="h-full w-full">
      <ReactFlow
        key={flowKey}
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.3 }}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        panOnDrag={false}
        zoomOnScroll={false}
        zoomOnPinch={false}
        zoomOnDoubleClick={false}
        preventScrolling={false}
        proOptions={{ hideAttribution: true }}
      >
        <Background color="#e2e8f0" gap={16} />
        <Controls showInteractive={false} />
      </ReactFlow>
      
      {/* Legend */}
      <div className="absolute bottom-0 left-0 right-0 p-3 border-t bg-white/90">
        <div className="flex items-center justify-center gap-4 text-xs">
          <div className="flex items-center gap-1">
            <div className="w-2.5 h-2.5 rounded-full bg-slate-300" />
            <span className="text-slate-500">Pending</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-2.5 h-2.5 rounded-full bg-blue-500" />
            <span className="text-slate-500">Active</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-2.5 h-2.5 rounded-full bg-green-500" />
            <span className="text-slate-500">Done</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-2.5 h-2.5 rounded-full bg-red-500" />
            <span className="text-slate-500">Error</span>
          </div>
        </div>
      </div>
    </div>
  );
}

export default ExecutionGraph;
