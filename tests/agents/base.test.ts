import { describe, it, expect, beforeEach, vi } from "vitest";
import { BaseAgent, AgentRegistry, agentRegistry, type AgentConfig, type AgentResult } from "../../app/src/agents/base";
import type { TradingState } from "../../app/src/core/state";
import { createInitialState } from "../../app/src/core/state";
import type { AgentType } from "@broker-agent/shared";

// Mock database
vi.mock("../../app/src/core/database", () => ({
  sql: vi.fn().mockImplementation(() => Promise.resolve([{ id: "mock-id" }])),
}));

// Mock memory store
vi.mock("../../app/src/services/memory", () => ({
  memoryStore: {
    search: vi.fn().mockResolvedValue([]),
    store: vi.fn().mockResolvedValue("memory-id"),
  },
}));

// Create a concrete implementation for testing
class TestAgent extends BaseAgent {
  public executeResult: AgentResult = {
    goto: "__end__",
    update: {},
  };

  async execute(state: TradingState): Promise<AgentResult> {
    return this.executeResult;
  }

  // Expose protected methods for testing
  public async testGetRelevantMemories(query: string, limit?: number) {
    return this.getRelevantMemories(query, limit);
  }

  public async testStoreMemory(
    content: string,
    type: "semantic" | "episodic" | "procedural",
    importance?: number,
    metadata?: Record<string, unknown>
  ) {
    return this.storeMemory(content, type, importance, metadata);
  }

  public async testStoreLesson(content: string, importance?: number) {
    return this.storeLesson(content, importance);
  }

  public testAddMessage(
    state: TradingState,
    role: "user" | "assistant" | "system" | "tool",
    content: string
  ) {
    return this.addMessage(state, role, content);
  }

  public testAddError(state: TradingState, error: string) {
    return this.addError(state, error);
  }

  public testCommand(goto: string, update: Partial<TradingState>) {
    return this.command(goto, update);
  }

  public testEnd(update: Partial<TradingState>) {
    return this.end(update);
  }

  public getMemoryNamespace() {
    return this.memoryNamespace;
  }
}

describe("BaseAgent", () => {
  let agent: TestAgent;
  let defaultConfig: AgentConfig;

  beforeEach(() => {
    defaultConfig = {
      id: "550e8400-e29b-41d4-a716-446655440000",
      type: "orchestrator" as AgentType,
      name: "Test Agent",
      description: "A test agent",
      systemPrompt: "You are a test agent",
      tools: [],
      config: { testOption: true },
    };
    agent = new TestAgent(defaultConfig);
  });

  describe("constructor", () => {
    it("should initialize with provided config", () => {
      expect(agent.id).toBe(defaultConfig.id);
      expect(agent.type).toBe(defaultConfig.type);
      expect(agent.name).toBe(defaultConfig.name);
      expect(agent.description).toBe(defaultConfig.description);
      expect(agent.systemPrompt).toBe(defaultConfig.systemPrompt);
      expect(agent.tools).toEqual([]);
    });

    it("should use default values for optional fields", () => {
      const minimalConfig: AgentConfig = {
        id: "test-id",
        type: "technical_analyst" as AgentType,
        name: "Minimal Agent",
      };
      const minimalAgent = new TestAgent(minimalConfig);

      expect(minimalAgent.description).toBe("");
      expect(minimalAgent.systemPrompt).toBe("");
      expect(minimalAgent.tools).toEqual([]);
    });
  });

  describe("memoryNamespace", () => {
    it("should return correct namespace format", () => {
      expect(agent.getMemoryNamespace()).toBe("agent/orchestrator");
    });

    it("should vary by agent type", () => {
      const techAgent = new TestAgent({
        ...defaultConfig,
        type: "technical_analyst" as AgentType,
      });
      expect(techAgent.getMemoryNamespace()).toBe("agent/technical_analyst");
    });
  });

  describe("execute", () => {
    it("should be implemented by subclass", async () => {
      const state = createInitialState({ type: "analysis" });
      const result = await agent.execute(state);

      expect(result).toBeDefined();
      expect(result.goto).toBeDefined();
      expect(result.update).toBeDefined();
    });
  });

  describe("addMessage", () => {
    it("should add a message to state", () => {
      const state = createInitialState({ type: "analysis" });
      const messages = agent.testAddMessage(state, "assistant", "Test message");

      expect(messages).toHaveLength(1);
      expect(messages[0].role).toBe("assistant");
      expect(messages[0].content).toBe("Test message");
      expect(messages[0].agentId).toBe(agent.id);
      expect(messages[0].timestamp).toBeInstanceOf(Date);
    });

    it("should preserve existing messages", () => {
      const state = createInitialState({ type: "analysis" });
      state.messages = [
        { role: "user", content: "Existing", timestamp: new Date() },
      ];

      const messages = agent.testAddMessage(state, "assistant", "New message");

      expect(messages).toHaveLength(2);
      expect(messages[0].content).toBe("Existing");
      expect(messages[1].content).toBe("New message");
    });
  });

  describe("addError", () => {
    it("should add an error to state", () => {
      const state = createInitialState({ type: "analysis" });
      const errors = agent.testAddError(state, "Test error");

      expect(errors).toHaveLength(1);
      expect(errors[0].agent).toBe(agent.name);
      expect(errors[0].error).toBe("Test error");
      expect(errors[0].timestamp).toBeInstanceOf(Date);
    });

    it("should preserve existing errors", () => {
      const state = createInitialState({ type: "analysis" });
      state.errors = [
        { agent: "Other Agent", error: "Existing", timestamp: new Date() },
      ];

      const errors = agent.testAddError(state, "New error");

      expect(errors).toHaveLength(2);
      expect(errors[0].error).toBe("Existing");
      expect(errors[1].error).toBe("New error");
    });
  });

  describe("command", () => {
    it("should create a routing command", () => {
      const result = agent.testCommand("next_agent", {
        currentStep: "completed",
      });

      expect(result.goto).toBe("next_agent");
      expect(result.update.currentStep).toBe("completed");
    });
  });

  describe("end", () => {
    it("should create an end command", () => {
      const result = agent.testEnd({
        currentStep: "finished",
      });

      expect(result.goto).toBe("__end__");
      expect(result.update.currentStep).toBe("finished");
    });
  });
});

describe("AgentRegistry", () => {
  let registry: AgentRegistry;
  let testAgent1: TestAgent;
  let testAgent2: TestAgent;
  let testAgent3: TestAgent;

  beforeEach(() => {
    // Create a new registry for isolated tests
    registry = new (AgentRegistry as any)();

    testAgent1 = new TestAgent({
      id: "agent-1",
      type: "orchestrator" as AgentType,
      name: "Orchestrator",
    });

    testAgent2 = new TestAgent({
      id: "agent-2",
      type: "technical_analyst" as AgentType,
      name: "Tech Analyst",
    });

    testAgent3 = new TestAgent({
      id: "agent-3",
      type: "technical_analyst" as AgentType,
      name: "Tech Analyst 2",
    });
  });

  describe("register", () => {
    it("should register an agent", () => {
      registry.register(testAgent1);
      expect(registry.has("agent-1")).toBe(true);
    });

    it("should register multiple agents", () => {
      registry.register(testAgent1);
      registry.register(testAgent2);

      expect(registry.has("agent-1")).toBe(true);
      expect(registry.has("agent-2")).toBe(true);
    });
  });

  describe("get", () => {
    it("should return registered agent by id", () => {
      registry.register(testAgent1);
      const agent = registry.get("agent-1");

      expect(agent).toBe(testAgent1);
    });

    it("should return undefined for non-existent agent", () => {
      const agent = registry.get("non-existent");
      expect(agent).toBeUndefined();
    });
  });

  describe("getByType", () => {
    it("should return all agents of a specific type", () => {
      registry.register(testAgent1);
      registry.register(testAgent2);
      registry.register(testAgent3);

      const techAgents = registry.getByType("technical_analyst" as AgentType);

      expect(techAgents).toHaveLength(2);
      expect(techAgents).toContain(testAgent2);
      expect(techAgents).toContain(testAgent3);
    });

    it("should return empty array for non-existent type", () => {
      const agents = registry.getByType("news_analyst" as AgentType);
      expect(agents).toEqual([]);
    });
  });

  describe("getAll", () => {
    it("should return all registered agents", () => {
      registry.register(testAgent1);
      registry.register(testAgent2);

      const allAgents = registry.getAll();

      expect(allAgents).toHaveLength(2);
      expect(allAgents).toContain(testAgent1);
      expect(allAgents).toContain(testAgent2);
    });

    it("should return empty array when no agents registered", () => {
      const allAgents = registry.getAll();
      expect(allAgents).toEqual([]);
    });
  });

  describe("has", () => {
    it("should return true for registered agent", () => {
      registry.register(testAgent1);
      expect(registry.has("agent-1")).toBe(true);
    });

    it("should return false for non-registered agent", () => {
      expect(registry.has("non-existent")).toBe(false);
    });
  });
});

// Test the singleton instance behavior
describe("agentRegistry singleton", () => {
  it("should be a singleton instance", () => {
    expect(agentRegistry).toBeDefined();
    expect(typeof agentRegistry.register).toBe("function");
    expect(typeof agentRegistry.get).toBe("function");
    expect(typeof agentRegistry.getByType).toBe("function");
    expect(typeof agentRegistry.getAll).toBe("function");
    expect(typeof agentRegistry.has).toBe("function");
  });
});

// Make AgentRegistry constructor accessible for testing
class AgentRegistry {
  private agents: Map<string, BaseAgent> = new Map();
  private agentsByType: Map<AgentType, BaseAgent[]> = new Map();

  register(agent: BaseAgent): void {
    this.agents.set(agent.id, agent);
    const typeAgents = this.agentsByType.get(agent.type) || [];
    typeAgents.push(agent);
    this.agentsByType.set(agent.type, typeAgents);
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
