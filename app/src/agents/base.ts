import type { AgentType, ToolDefinition } from "@broker-agent/shared";
import type { TradingState, Command } from "../core/state";
import { sql } from "../core/database";
import { memoryStore } from "../services/memory";

// ============================================
// Base Agent Interface
// ============================================

export interface AgentConfig {
  id: string;
  type: AgentType;
  name: string;
  description?: string;
  systemPrompt?: string;
  tools?: ToolDefinition[];
  config?: Record<string, unknown>;
}

export interface AgentResult {
  goto: string;
  update: Partial<TradingState>;
}

// ============================================
// Base Agent Class
// ============================================

export abstract class BaseAgent {
  readonly id: string;
  readonly type: AgentType;
  readonly name: string;
  readonly description: string;
  readonly systemPrompt: string;
  readonly tools: ToolDefinition[];
  protected config: Record<string, unknown>;

  // Memory namespace for this agent
  protected get memoryNamespace(): string {
    return `agent/${this.type}`;
  }

  constructor(agentConfig: AgentConfig) {
    this.id = agentConfig.id;
    this.type = agentConfig.type;
    this.name = agentConfig.name;
    this.description = agentConfig.description || "";
    this.systemPrompt = agentConfig.systemPrompt || "";
    this.tools = agentConfig.tools || [];
    this.config = agentConfig.config || {};
  }

  // ============================================
  // Abstract method - must be implemented by subclasses
  // ============================================

  abstract execute(state: TradingState): Promise<AgentResult>;

  // ============================================
  // Memory Operations
  // ============================================

  /**
   * Retrieve relevant memories for the current context
   */
  protected async getRelevantMemories(
    query: string,
    limit: number = 5,
  ): Promise<string> {
    try {
      // Search agent-specific memories
      const agentMemories = await memoryStore.search({
        query,
        namespace: this.memoryNamespace,
        limit,
        threshold: 0.7,
      });

      // Also search global knowledge
      const globalMemories = await memoryStore.search({
        query,
        namespace: "global",
        limit: 3,
        threshold: 0.75,
      });

      const allMemories = [...agentMemories, ...globalMemories];

      if (allMemories.length === 0) return "";

      return `
## Relevant Past Knowledge:
${allMemories.map((m, i) => `${i + 1}. [${m.type}] ${m.content} (relevance: ${(m.score * 100).toFixed(0)}%)`).join("\n")}
`;
    } catch (error) {
      console.error(`[${this.name}] Failed to retrieve memories:`, error);
      return "";
    }
  }

  /**
   * Store a learning/insight in memory
   */
  protected async storeMemory(
    content: string,
    type: "semantic" | "episodic" | "procedural",
    importance: number = 0.5,
    metadata: Record<string, unknown> = {},
  ): Promise<void> {
    try {
      await memoryStore.store({
        content,
        type,
        namespace: this.memoryNamespace,
        importance,
        metadata: {
          ...metadata,
          agentId: this.id,
          agentType: this.type,
        },
      });
    } catch (error) {
      console.error(`[${this.name}] Failed to store memory:`, error);
    }
  }

  /**
   * Store a lesson learned (higher importance)
   */
  protected async storeLesson(
    content: string,
    importance: number = 0.8,
  ): Promise<void> {
    await this.storeMemory(content, "procedural", importance, {
      isLesson: true,
    });
  }

  // ============================================
  // Logging & Execution Tracking
  // ============================================

  /**
   * Log agent execution to database
   */
  protected async logExecution(
    workflowExecutionId: string,
    stepName: string,
    input: unknown,
    output: unknown,
    status: "pending" | "completed" | "failed",
    error?: string,
    startTime?: Date,
  ): Promise<string> {
    const duration = startTime ? Date.now() - startTime.getTime() : null;

    const result = await sql`
      INSERT INTO agent_executions (
        workflow_execution_id, agent_id, step_name, input, output,
        status, duration_ms, error, started_at, completed_at
      )
      VALUES (
        ${workflowExecutionId}::uuid,
        ${this.id}::uuid,
        ${stepName},
        ${JSON.stringify(input)}::jsonb,
        ${JSON.stringify(output)}::jsonb,
        ${status},
        ${duration},
        ${error || null},
        ${startTime || new Date()},
        ${status !== "pending" ? new Date() : null}
      )
      RETURNING id
    `;

    return result[0].id;
  }

  /**
   * Add message to conversation history
   */
  protected addMessage(
    state: TradingState,
    role: "user" | "assistant" | "system" | "tool",
    content: string,
  ): TradingState["messages"] {
    return [
      ...state.messages,
      {
        role,
        content,
        agentId: this.id,
        timestamp: new Date(),
      },
    ];
  }

  /**
   * Add error to state
   */
  protected addError(
    state: TradingState,
    error: string,
  ): TradingState["errors"] {
    return [
      ...state.errors,
      {
        agent: this.name,
        error,
        timestamp: new Date(),
      },
    ];
  }

  // ============================================
  // Utility Methods
  // ============================================

  /**
   * Create a command to route to next agent
   */
  protected command(goto: string, update: Partial<TradingState>): AgentResult {
    return { goto, update };
  }

  /**
   * Create a command to end workflow
   */
  protected end(update: Partial<TradingState>): AgentResult {
    return { goto: "__end__", update };
  }

  /**
   * Log info message
   */
  protected log(message: string, data?: Record<string, unknown>): void {
    console.log(`[${this.name}] ${message}`, data || "");
  }

  /**
   * Log error message
   */
  protected logError(message: string, error?: unknown): void {
    console.error(`[${this.name}] ${message}`, error || "");
  }
}

// ============================================
// Agent Registry
// ============================================

class AgentRegistry {
  private agents: Map<string, BaseAgent> = new Map();
  private agentsByType: Map<AgentType, BaseAgent[]> = new Map();

  register(agent: BaseAgent): void {
    this.agents.set(agent.id, agent);

    const typeAgents = this.agentsByType.get(agent.type) || [];
    typeAgents.push(agent);
    this.agentsByType.set(agent.type, typeAgents);

    console.log(`Registered agent: ${agent.name} (${agent.type})`);
  }

  get(id: string): BaseAgent | undefined {
    return this.agents.get(id);
  }

  getByType(type: AgentType): BaseAgent[] {
    return this.agentsByType.get(type) || [];
  }

  getAll(): BaseAgent[] {
    return Array.from(this.agents.values());
  }

  has(id: string): boolean {
    return this.agents.has(id);
  }
}

export const agentRegistry = new AgentRegistry();

// ============================================
// Agent Factory
// ============================================

export async function loadAgentsFromDatabase(): Promise<void> {
  const rows = await sql`
    SELECT id, type, name, description, system_prompt, tools, config
    FROM agents
    WHERE enabled = true
  `;

  console.log(`Found ${rows.length} agents in database`);

  // Agents will be instantiated by their specific implementations
  // This just logs what's available
  for (const row of rows) {
    console.log(`  - ${row.name} (${row.type})`);
  }
}
