import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { toast } from "@/components/ui/sonner";
import { cn } from "@/lib/utils";
import { Brain, Database, Search, BookOpen, Lightbulb, History, Users, FolderTree } from "lucide-react";

// ============================================
// Types
// ============================================

interface MemoryStats {
  total: number;
  byType: Record<string, number>;
  byNamespace: Record<string, number>;
  byAgent: Record<string, number>;
}

interface MemoryEntry {
  id: string;
  content: string;
  type: string;
  namespace: string;
  importance?: number;
  score?: number;
  metadata?: Record<string, unknown>;
}

// ============================================
// Memory Type Icons & Colors
// ============================================

const memoryTypeConfig: Record<string, { icon: typeof Brain; color: string; bgColor: string; description: string }> = {
  semantic: {
    icon: BookOpen,
    color: "text-blue-500",
    bgColor: "bg-blue-500/10",
    description: "Facts and knowledge",
  },
  episodic: {
    icon: History,
    color: "text-purple-500",
    bgColor: "bg-purple-500/10",
    description: "Past experiences",
  },
  procedural: {
    icon: Lightbulb,
    color: "text-amber-500",
    bgColor: "bg-amber-500/10",
    description: "Rules and strategies",
  },
};

// Helper to parse namespace into readable name
function formatNamespace(namespace: string): string {
  // "agent/portfolio_manager" -> "Portfolio Manager"
  const parts = namespace.split("/");
  const name = parts[parts.length - 1];
  return name
    .split("_")
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

// ============================================
// Memory Explorer Component
// ============================================

export function MemoryExplorer() {
  const [stats, setStats] = useState<MemoryStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<MemoryEntry[]>([]);
  const [searching, setSearching] = useState(false);
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);
  const [agentMemories, setAgentMemories] = useState<MemoryEntry[]>([]);
  const [loadingAgent, setLoadingAgent] = useState(false);

  // Fetch stats on mount
  useEffect(() => {
    async function fetchStats() {
      setLoading(true);
      const response = await api.memory.stats();
      
      if (response.error) {
        setError(response.error);
        toast.error("Failed to load memory stats", { description: response.error });
      } else if (response.data) {
        setStats(response.data.stats);
      }
      setLoading(false);
    }

    fetchStats();
    // Refresh every 60 seconds
    const interval = setInterval(fetchStats, 60000);
    return () => clearInterval(interval);
  }, []);

  // Search memories
  const handleSearch = async () => {
    if (!searchQuery.trim()) return;
    
    setSearching(true);
    const response = await api.memory.search(searchQuery, { limit: 20 });
    
    if (response.error) {
      toast.error("Search failed", { description: response.error });
    } else if (response.data) {
      setSearchResults(response.data.results);
      if (response.data.results.length === 0) {
        toast.info("No results found", { description: "Try a different search query" });
      }
    }
    setSearching(false);
  };

  // Load memories by agent namespace
  const loadAgentMemories = async (namespace: string) => {
    if (selectedAgent === namespace) {
      setSelectedAgent(null);
      setAgentMemories([]);
      return;
    }

    setSelectedAgent(namespace);
    setLoadingAgent(true);
    
    const response = await api.memory.byNamespace(namespace);
    
    if (response.error) {
      toast.error("Failed to load memories", { description: response.error });
    } else if (response.data) {
      setAgentMemories(response.data.memories);
    }
    setLoadingAgent(false);
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <Card>
          <CardHeader>
            <Skeleton className="h-6 w-48" />
            <Skeleton className="h-4 w-64" />
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {[...Array(4)].map((_, i) => (
                <Skeleton key={i} className="h-20" />
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
            <Database className="h-5 w-5" />
            Memory System Error
          </CardTitle>
          <CardDescription>{error}</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Stats Overview */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Brain className="h-5 w-5" />
                Memory System
              </CardTitle>
              <CardDescription>
                Long-term knowledge and experiences stored by agents
              </CardDescription>
            </div>
            <Badge variant="outline" className="text-lg px-3 py-1">
              {stats?.total || 0} memories
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Memory Type Stats */}
          <div>
            <h4 className="text-sm font-medium mb-3 flex items-center gap-2">
              <FolderTree className="h-4 w-4" />
              By Type
            </h4>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {Object.entries(memoryTypeConfig).map(([type, config]) => {
                const Icon = config.icon;
                const count = stats?.byType[type] || 0;
                
                return (
                  <div
                    key={type}
                    className={cn(
                      "p-4 rounded-lg border",
                      config.bgColor
                    )}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <Icon className={cn("h-5 w-5", config.color)} />
                        <div>
                          <p className="font-medium capitalize">{type}</p>
                          <p className="text-xs text-muted-foreground">{config.description}</p>
                        </div>
                      </div>
                      <span className="text-2xl font-bold">{count}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Agent Breakdown */}
          {stats?.byAgent && Object.keys(stats.byAgent).length > 0 && (
            <div className="border-t pt-4">
              <h4 className="text-sm font-medium mb-3 flex items-center gap-2">
                <Users className="h-4 w-4" />
                By Agent / Source
              </h4>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
                {Object.entries(stats.byAgent)
                  .sort((a, b) => b[1] - a[1])
                  .map(([namespace, count]) => (
                    <Button
                      key={namespace}
                      variant={selectedAgent === namespace ? "default" : "outline"}
                      size="sm"
                      onClick={() => loadAgentMemories(namespace)}
                      className="justify-between h-auto py-2"
                    >
                      <span className="truncate text-left">
                        {formatNamespace(namespace)}
                      </span>
                      <Badge variant="secondary" className="ml-2 shrink-0">
                        {count}
                      </Badge>
                    </Button>
                  ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Agent Memories */}
      {selectedAgent && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>{formatNamespace(selectedAgent)}</CardTitle>
                <CardDescription>
                  {agentMemories.length} memories from {selectedAgent}
                </CardDescription>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setSelectedAgent(null)}>
                Close
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {loadingAgent ? (
              <div className="space-y-2">
                {[...Array(3)].map((_, i) => (
                  <Skeleton key={i} className="h-20" />
                ))}
              </div>
            ) : agentMemories.length === 0 ? (
              <p className="text-muted-foreground text-center py-8">
                No memories from this agent
              </p>
            ) : (
              <div className="space-y-2 max-h-96 overflow-y-auto">
                {agentMemories.map((memory) => (
                  <MemoryCard key={memory.id} memory={memory} showImportance />
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Search */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Search className="h-5 w-5" />
            Search Memories
          </CardTitle>
          <CardDescription>
            Semantic search across all stored knowledge
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex gap-2 mb-4">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSearch()}
              placeholder="Search for knowledge, experiences, or rules..."
              className="flex-1 px-3 py-2 border rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-ring"
            />
            <Button onClick={handleSearch} disabled={searching || !searchQuery.trim()}>
              {searching ? "Searching..." : "Search"}
            </Button>
          </div>

          {/* Search Results */}
          {searchResults.length > 0 && (
            <div className="space-y-2">
              <h4 className="text-sm font-medium text-muted-foreground">
                {searchResults.length} results found
              </h4>
              <div className="space-y-2 max-h-96 overflow-y-auto">
                {searchResults.map((memory) => (
                  <MemoryCard key={memory.id} memory={memory} showScore />
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Empty State */}
      {stats?.total === 0 && (
        <Card>
          <CardContent className="py-12 text-center">
            <Brain className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium mb-2">No Memories Yet</h3>
            <p className="text-muted-foreground max-w-md mx-auto">
              Run some trading workflows to start building the system's memory.
              Agents will store learned knowledge, experiences, and trading rules.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ============================================
// Memory Card Component
// ============================================

function MemoryCard({ 
  memory, 
  showScore = false,
  showImportance = false,
}: { 
  memory: MemoryEntry; 
  showScore?: boolean;
  showImportance?: boolean;
}) {
  const config = memoryTypeConfig[memory.type] || memoryTypeConfig.semantic;
  const Icon = config.icon;

  return (
    <div className={cn("p-3 rounded-lg border", config.bgColor)}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-2 flex-1 min-w-0">
          <Icon className={cn("h-4 w-4 mt-0.5 shrink-0", config.color)} />
          <div className="min-w-0 flex-1">
            <p className="text-sm leading-relaxed">{memory.content}</p>
            <div className="flex items-center gap-2 mt-2 text-xs text-muted-foreground">
              <Badge variant="outline" className="text-xs">
                {memory.type}
              </Badge>
              <span className="truncate">{formatNamespace(memory.namespace)}</span>
            </div>
          </div>
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          {showScore && memory.score !== undefined && (
            <Badge variant="secondary" className="text-xs">
              {(memory.score * 100).toFixed(0)}% match
            </Badge>
          )}
          {showImportance && memory.importance !== undefined && (
            <Badge 
              variant="secondary" 
              className={cn(
                "text-xs",
                memory.importance >= 0.7 && "bg-amber-500/20 text-amber-700",
                memory.importance >= 0.9 && "bg-red-500/20 text-red-700"
              )}
            >
              {(memory.importance * 100).toFixed(0)}% importance
            </Badge>
          )}
        </div>
      </div>
    </div>
  );
}

export default MemoryExplorer;
