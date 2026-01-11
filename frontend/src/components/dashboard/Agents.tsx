import { useState, useEffect } from "react";
import { api } from "../../lib/api";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "../ui/card";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { cn } from "../../lib/utils";

// ============================================
// Types
// ============================================

interface Agent {
  id: string;
  type: string;
  name: string;
  description?: string;
  enabled: boolean;
  created_at?: string;
}

interface AgentDetails extends Agent {
  system_prompt?: string;
  tools?: string[];
  config?: Record<string, unknown>;
}

// Agent type icons and colors (matching database types)
const agentTypeConfig: Record<string, { color: string; icon: string }> = {
  market_data_agent: { color: "bg-blue-100 text-blue-800", icon: "chart-bar" },
  news_analyst: { color: "bg-purple-100 text-purple-800", icon: "newspaper" },
  social_analyst: { color: "bg-pink-100 text-pink-800", icon: "users" },
  technical_analyst: { color: "bg-indigo-100 text-indigo-800", icon: "trending-up" },
  fundamental_analyst: { color: "bg-green-100 text-green-800", icon: "building" },
  sentiment_analyst: { color: "bg-yellow-100 text-yellow-800", icon: "smile" },
  portfolio_manager: { color: "bg-emerald-100 text-emerald-800", icon: "briefcase" },
  risk_manager: { color: "bg-red-100 text-red-800", icon: "shield" },
  order_executor: { color: "bg-orange-100 text-orange-800", icon: "play" },
  orchestrator: { color: "bg-slate-700 text-slate-100", icon: "workflow" },
};

// ============================================
// Agents Component
// ============================================

export function Agents() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [selectedAgent, setSelectedAgent] = useState<AgentDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchAgents();
  }, []);

  const fetchAgents = async () => {
    setLoading(true);
    const response = await api.agents.list();
    if (response.error) {
      setError(response.error);
    } else if (response.data) {
      setAgents(response.data.agents);
    }
    setLoading(false);
  };

  const fetchAgentDetails = async (id: string) => {
    const response = await api.agents.get(id);
    if (response.data?.agent) {
      setSelectedAgent(response.data.agent as AgentDetails);
    }
  };

  // Group agents by type
  const agentsByTeam = agents.reduce(
    (acc, agent) => {
      const team = getTeamForType(agent.type);
      if (!acc[team]) acc[team] = [];
      acc[team].push(agent);
      return acc;
    },
    {} as Record<string, Agent[]>
  );

  if (loading) {
    return (
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {[1, 2, 3].map((i) => (
          <Card key={i} className="animate-pulse">
            <CardHeader>
              <div className="h-6 bg-slate-200 rounded w-1/2 mb-2" />
              <div className="h-4 bg-slate-200 rounded w-3/4" />
            </CardHeader>
            <CardContent>
              <div className="h-20 bg-slate-200 rounded" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <Card>
        <CardContent className="pt-6">
          <div className="text-center text-red-500">
            <p className="font-medium">Error loading agents</p>
            <p className="text-sm">{error}</p>
            <Button onClick={fetchAgents} className="mt-4">
              Retry
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-8">
      {/* Agent Teams */}
      {Object.entries(agentsByTeam).map(([team, teamAgents]) => (
        <div key={team}>
          <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <TeamIcon team={team} />
            {team}
            <Badge variant="outline" className="ml-2">
              {teamAgents.length}
            </Badge>
          </h3>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {teamAgents.map((agent) => (
              <AgentCard
                key={agent.id}
                agent={agent}
                isSelected={selectedAgent?.id === agent.id}
                onSelect={() => fetchAgentDetails(agent.id)}
              />
            ))}
          </div>
        </div>
      ))}

      {/* Agent Details Panel */}
      {selectedAgent && (
        <AgentDetailsPanel
          agent={selectedAgent}
          onClose={() => setSelectedAgent(null)}
        />
      )}
    </div>
  );
}

// ============================================
// Agent Card
// ============================================

function AgentCard({
  agent,
  isSelected,
  onSelect,
}: {
  agent: Agent;
  isSelected: boolean;
  onSelect: () => void;
}) {
  const config = agentTypeConfig[agent.type] || {
    color: "bg-slate-100 text-slate-800",
    icon: "cpu",
  };

  return (
    <Card
      className={cn(
        "cursor-pointer transition-all hover:shadow-md",
        isSelected && "ring-2 ring-blue-500"
      )}
      onClick={onSelect}
    >
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <Badge className={config.color}>{agent.type}</Badge>
          <Badge variant={agent.enabled ? "default" : "secondary"}>
            {agent.enabled ? "Enabled" : "Disabled"}
          </Badge>
        </div>
        <CardTitle className="text-lg mt-2">{agent.name}</CardTitle>
        <CardDescription className="line-clamp-2">
          {agent.description || "No description available"}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <p className="text-xs text-slate-500">
          ID: {agent.id.slice(0, 8)}...
        </p>
      </CardContent>
    </Card>
  );
}

// ============================================
// Agent Details Panel
// ============================================

function AgentDetailsPanel({
  agent,
  onClose,
}: {
  agent: AgentDetails;
  onClose: () => void;
}) {
  return (
    <Card className="mt-6 border-2 border-blue-200">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>{agent.name}</CardTitle>
            <CardDescription>{agent.type}</CardDescription>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Description */}
        <div>
          <h4 className="font-medium mb-1">Description</h4>
          <p className="text-sm text-slate-600">
            {agent.description || "No description"}
          </p>
        </div>

        {/* System Prompt */}
        {agent.system_prompt && (
          <div>
            <h4 className="font-medium mb-1">System Prompt</h4>
            <pre className="text-xs bg-slate-100 p-3 rounded-lg overflow-x-auto max-h-48 overflow-y-auto">
              {agent.system_prompt}
            </pre>
          </div>
        )}

        {/* Tools */}
        {agent.tools && agent.tools.length > 0 && (
          <div>
            <h4 className="font-medium mb-2">Tools</h4>
            <div className="flex flex-wrap gap-2">
              {agent.tools.map((tool) => (
                <Badge key={tool} variant="outline">
                  {tool}
                </Badge>
              ))}
            </div>
          </div>
        )}

        {/* Config */}
        {agent.config && Object.keys(agent.config).length > 0 && (
          <div>
            <h4 className="font-medium mb-1">Configuration</h4>
            <pre className="text-xs bg-slate-100 p-3 rounded-lg overflow-x-auto">
              {JSON.stringify(agent.config, null, 2)}
            </pre>
          </div>
        )}

        {/* Meta Info */}
        <div className="flex gap-4 text-sm text-slate-500 pt-4 border-t">
          <span>ID: {agent.id}</span>
          {agent.created_at && (
            <span>
              Created: {new Date(agent.created_at).toLocaleDateString()}
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ============================================
// Helper Components
// ============================================

function TeamIcon({ team }: { team: string }) {
  const iconClass = "w-5 h-5";

  if (team === "Research Team") {
    return (
      <svg className={cn(iconClass, "text-blue-500")} fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
      </svg>
    );
  }

  if (team === "Analysis Team") {
    return (
      <svg className={cn(iconClass, "text-purple-500")} fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
      </svg>
    );
  }

  if (team === "Decision Team") {
    return (
      <svg className={cn(iconClass, "text-green-500")} fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    );
  }

  return (
    <svg className={cn(iconClass, "text-slate-500")} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
    </svg>
  );
}

// ============================================
// Helper Functions
// ============================================

function getTeamForType(type: string): string {
  // Research team - data gathering agents
  const researchTypes = ["market_data_agent", "news_analyst", "social_analyst"];
  // Analysis team - analysis agents
  const analysisTypes = ["technical_analyst", "fundamental_analyst", "sentiment_analyst"];
  // Decision team - decision making agents
  const decisionTypes = ["portfolio_manager", "risk_manager", "order_executor"];

  if (researchTypes.includes(type)) return "Research Team";
  if (analysisTypes.includes(type)) return "Analysis Team";
  if (decisionTypes.includes(type)) return "Decision Team";
  if (type === "orchestrator") return "Orchestration";
  return "Other";
}

export default Agents;
