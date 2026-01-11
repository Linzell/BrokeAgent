import { useState } from "react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { 
  CheckCircle, 
  XCircle, 
  Loader2, 
  Clock, 
  TrendingUp,
  Search,
  BarChart3,
  Swords
} from "lucide-react";
import type { Execution, ActiveWorkflow } from "./types";

interface ExecutionListProps {
  executions: Execution[];
  activeWorkflows: Map<string, ActiveWorkflow>;
  selectedId: string | null;
  onSelect: (id: string) => void;
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

function formatTime(dateStr: string): string {
  return new Date(dateStr).toLocaleTimeString([], { 
    hour: "2-digit", 
    minute: "2-digit" 
  });
}

function getWorkflowIcon(type: string) {
  switch (type?.toLowerCase()) {
    case "research":
      return <Search className="h-3.5 w-3.5" />;
    case "analyze":
    case "analysis":
      return <BarChart3 className="h-3.5 w-3.5" />;
    case "trade":
    case "decision":
      return <TrendingUp className="h-3.5 w-3.5" />;
    case "debate":
    case "tiered_debate":
    case "smart_debate":
      return <Swords className="h-3.5 w-3.5" />;
    default:
      return <Clock className="h-3.5 w-3.5" />;
  }
}

function StatusIcon({ status }: { status: string }) {
  switch (status) {
    case "completed":
      return <CheckCircle className="h-4 w-4 text-green-500" />;
    case "failed":
    case "error":
      return <XCircle className="h-4 w-4 text-red-500" />;
    case "running":
      return <Loader2 className="h-4 w-4 text-blue-500 animate-spin" />;
    default:
      return <Clock className="h-4 w-4 text-slate-400" />;
  }
}

export function ExecutionList({ 
  executions, 
  activeWorkflows, 
  selectedId, 
  onSelect
}: ExecutionListProps) {
  // Combine active workflows with historical executions
  const activeList = Array.from(activeWorkflows.values());
  
  // Helper to get display type - "debate" type is now always tiered/smart debate
  const getDisplayType = (exec: Execution): string => {
    const type = exec.trigger_type?.toUpperCase() || "WORKFLOW";
    return type;
  };
  
  return (
    <div className="flex flex-col h-full">
      <div className="px-3 py-2 border-b bg-slate-50/50">
        <h3 className="font-semibold text-sm text-slate-700">Executions</h3>
        <p className="text-xs text-slate-500">
          {activeList.length > 0 && (
            <span className="text-blue-600">{activeList.length} active, </span>
          )}
          {executions.length} total
        </p>
      </div>
      
      <div className="flex-1 overflow-y-auto">
        {/* Active Workflows - Real-time */}
        {activeList.length > 0 && (
          <div className="border-b">
            {activeList.map((workflow) => (
              <button
                key={workflow.workflowId}
                onClick={() => onSelect(workflow.workflowId)}
                className={cn(
                  "w-full px-3 py-2.5 text-left transition-colors border-b last:border-b-0",
                  "hover:bg-blue-50",
                  selectedId === workflow.workflowId
                    ? "bg-blue-100 border-l-2 border-l-blue-500"
                    : "bg-blue-50/30"
                )}
              >
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-1.5">
                    <Loader2 className="h-3.5 w-3.5 text-blue-500 animate-spin" />
                    <span className="font-medium text-sm text-blue-700">
                      {workflow.requestType?.toUpperCase() || "WORKFLOW"}
                    </span>
                  </div>
                  <Badge variant="secondary" className="text-xs bg-blue-100 text-blue-700">
                    Live
                  </Badge>
                </div>
                
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-600 truncate max-w-[120px]">
                    {workflow.symbols?.join(", ") || "..."}
                  </span>
                  <span className="text-blue-600 font-medium">
                    {workflow.currentStep || "starting"}
                  </span>
                </div>
                
                <div className="flex items-center justify-between mt-1 text-xs text-slate-400">
                  <span>{formatTime(workflow.startedAt)}</span>
                  <span>{formatDuration(workflow.startedAt)}</span>
                </div>
              </button>
            ))}
          </div>
        )}
        
        {/* Historical Executions */}
        {executions.length > 0 ? (
          executions.map((exec) => {
            const displayType = getDisplayType(exec);
            const isDebate = displayType === "DEBATE";
            return (
            <button
              key={exec.id}
              onClick={() => onSelect(exec.id)}
              className={cn(
                "w-full px-3 py-2.5 text-left transition-colors border-b",
                "hover:bg-slate-50",
                selectedId === exec.id
                  ? "bg-slate-100 border-l-2 border-l-slate-500"
                  : ""
              )}
            >
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-1.5">
                  <StatusIcon status={exec.status} />
                  <span className={cn("font-medium text-sm", isDebate && "text-orange-600")}>
                    {displayType}
                  </span>
                </div>
                <Badge 
                  variant={
                    exec.status === "completed" ? "default" :
                    exec.status === "failed" ? "destructive" :
                    "secondary"
                  }
                  className="text-xs"
                >
                  {exec.status}
                </Badge>
              </div>
              
              <div className="flex items-center gap-1.5 text-xs text-slate-500">
                {getWorkflowIcon(isDebate ? "debate" : exec.trigger_type)}
                <span className="truncate max-w-[140px]">
                  {exec.symbols?.join(", ") || exec.thread_id.slice(0, 8)}
                </span>
              </div>
              
              <div className="flex items-center justify-between mt-1 text-xs text-slate-400">
                <span>{formatTime(exec.started_at)}</span>
                <span>{formatDuration(exec.started_at, exec.completed_at)}</span>
              </div>
              
              {exec.error && (
                <p className="mt-1 text-xs text-red-500 truncate">
                  {exec.error}
                </p>
              )}
            </button>
          )})
        ) : (
          <div className="px-3 py-8 text-center text-sm text-slate-400">
            No executions yet.
            <br />
            Run a workflow to get started.
          </div>
        )}
      </div>
    </div>
  );
}

export default ExecutionList;
