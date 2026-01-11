import type { TradingState } from "./state";
import type { BaseAgent, AgentResult } from "../agents/base";
import { sql } from "./database";
import {
  WorkflowExecutor,
  defaultExecutor,
  type ExecutorConfig,
  type ExecutionContext,
  type ExecutionAttempt,
} from "./executor";

// ============================================
// Types
// ============================================

export type NodeFunction = (state: TradingState) => Promise<AgentResult>;

export type ConditionFunction = (state: TradingState) => string;

interface Node {
  name: string;
  fn: NodeFunction;
  /** Optional: disable retry for this specific node */
  noRetry?: boolean;
}

interface Edge {
  from: string;
  to: string;
}

interface ConditionalEdge {
  from: string;
  condition: ConditionFunction;
  destinations: string[];
}

export interface GraphConfig {
  threadId?: string;
  checkpointer?: boolean;
  /** Executor configuration for retry/recovery */
  executor?: Partial<ExecutorConfig>;
  /** Use custom executor instance */
  executorInstance?: WorkflowExecutor;
  /** Callback for emitting workflow events */
  onEvent?: (event: WorkflowEvent) => void;
}

export interface WorkflowEvent {
  type: "workflow:started" | "workflow:step" | "workflow:completed" | "workflow:error" | "workflow:llm";
  workflowId: string;
  data: Record<string, unknown>;
  timestamp: string;
}

export const START = "__start__";
export const END = "__end__";

// ============================================
// StateGraph Class
// ============================================

export class StateGraph {
  private nodes: Map<string, Node> = new Map();
  private edges: Map<string, string> = new Map();
  private conditionalEdges: Map<string, ConditionalEdge> = new Map();
  private entryPoint: string | null = null;

  /**
   * Add a node to the graph
   */
  addNode(name: string, fn: NodeFunction, options?: { noRetry?: boolean }): StateGraph {
    this.nodes.set(name, { name, fn, noRetry: options?.noRetry });
    return this;
  }

  /**
   * Add an agent as a node
   */
  addAgentNode(agent: BaseAgent, options?: { noRetry?: boolean }): StateGraph {
    return this.addNode(agent.type, async (state) => agent.execute(state), options);
  }

  /**
   * Add a fixed edge between nodes
   */
  addEdge(from: string, to: string): StateGraph {
    this.edges.set(from, to);
    return this;
  }

  /**
   * Add conditional edges from a node
   */
  addConditionalEdges(
    from: string,
    condition: ConditionFunction,
    destinations: Record<string, string>,
  ): StateGraph {
    this.conditionalEdges.set(from, {
      from,
      condition,
      destinations: Object.values(destinations),
    });
    // Store the condition mapping
    this.edges.set(`${from}:conditional`, JSON.stringify(destinations));
    return this;
  }

  /**
   * Set the entry point of the graph
   */
  setEntryPoint(nodeName: string): StateGraph {
    this.entryPoint = nodeName;
    return this;
  }

  /**
   * Compile the graph into an executable
   */
  compile(config?: GraphConfig): CompiledGraph {
    if (!this.entryPoint) {
      throw new Error("No entry point set for graph");
    }

    return new CompiledGraph(
      this.nodes,
      this.edges,
      this.conditionalEdges,
      this.entryPoint,
      config,
    );
  }
}

// ============================================
// Compiled Graph (Executable)
// ============================================

export class CompiledGraph {
  private executor: WorkflowExecutor;

  constructor(
    private nodes: Map<string, Node>,
    private edges: Map<string, string>,
    private conditionalEdges: Map<string, ConditionalEdge>,
    private entryPoint: string,
    private config?: GraphConfig,
  ) {
    // Use provided executor instance, create from config, or use default
    this.executor =
      config?.executorInstance ||
      (config?.executor
        ? new WorkflowExecutor(config.executor)
        : defaultExecutor);
  }

  /**
   * Execute the graph with given initial state
   */
  async invoke(initialState: TradingState): Promise<TradingState> {
    let state = { ...initialState };
    let currentNode = this.entryPoint;
    let iterations = 0;
    const maxIterations = 100; // Safety limit

    console.log(`[Graph] Starting execution from: ${currentNode}`);
    console.log(`[Graph] State threadId: ${state.threadId}`);

    // Create workflow execution record
    console.log(`[Graph] Creating workflow execution record...`);
    const workflowExecId = await this.createWorkflowExecution(state);
    console.log(`[Graph] Workflow execution ID: ${workflowExecId}`);

    // Emit workflow started event
    this.emitEvent({
      type: "workflow:started",
      workflowId: workflowExecId,
      data: {
        entryPoint: currentNode,
        symbols: state.request.symbols,
        requestType: state.request.type,
      },
      timestamp: new Date().toISOString(),
    });

    // Create execution context for tracking
    const context: ExecutionContext = {
      workflowExecutionId: workflowExecId,
      attempts: [],
      totalRetries: 0,
      startedAt: new Date(),
      currentNode,
    };

    try {
      while (currentNode !== END && iterations < maxIterations) {
        iterations++;
        console.log(`[Graph] Step ${iterations}: ${currentNode}`);

        // Update state with current step
        state = { ...state, currentStep: currentNode };
        context.currentNode = currentNode;

        // Emit step event
        this.emitEvent({
          type: "workflow:step",
          workflowId: workflowExecId,
          data: {
            step: currentNode,
            iteration: iterations,
          },
          timestamp: new Date().toISOString(),
        });

        // Save checkpoint if enabled
        if (this.config?.checkpointer) {
          await this.saveCheckpoint(workflowExecId, state);
        }

        // Get the node
        const node = this.nodes.get(currentNode);
        if (!node) {
          throw new Error(`Node not found: ${currentNode}`);
        }

        // Execute the node with retry logic (unless noRetry is set)
        const startTime = Date.now();
        let result: AgentResult;
        let attempts: ExecutionAttempt[] = [];

        if (node.noRetry) {
          // Direct execution without retry
          result = await node.fn(state);
        } else {
          // Execute with retry logic
          const execResult = await this.executor.executeWithRetry(
            currentNode,
            node.fn,
            state,
            context,
          );
          result = execResult.result;
          attempts = execResult.attempts;

          // Track retries
          const retryCount = attempts.length - 1;
          if (retryCount > 0) {
            context.totalRetries += retryCount;
            await this.executor.updateRetryCount(
              workflowExecId,
              context.totalRetries,
            );
          }

          // Record attempts to database
          for (const attempt of attempts) {
            await this.executor.recordAttempt(workflowExecId, attempt);
            context.attempts.push(attempt);
          }
        }

        const duration = Date.now() - startTime;
        console.log(
          `[Graph] ${currentNode} completed in ${duration}ms, goto: ${result.goto}`,
        );

        // Apply state updates
        state = {
          ...state,
          ...result.update,
          messages: [...state.messages, ...(result.update.messages || [])],
          errors: [...state.errors, ...(result.update.errors || [])],
        };

        // Determine next node
        if (result.goto) {
          currentNode = result.goto;
        } else {
          // Check for conditional edge
          const conditional = this.conditionalEdges.get(currentNode);
          if (conditional) {
            currentNode = conditional.condition(state);
          } else {
            // Check for fixed edge
            const nextNode = this.edges.get(currentNode);
            currentNode = nextNode || END;
          }
        }
      }

      if (iterations >= maxIterations) {
        throw new Error("Max iterations exceeded");
      }

      // Update workflow execution as completed
      await this.completeWorkflowExecution(workflowExecId, state, "completed");

      // Emit completed event
      this.emitEvent({
        type: "workflow:completed",
        workflowId: workflowExecId,
        data: {
          iterations,
          totalRetries: context.totalRetries,
          messagesCount: state.messages.length,
          errorsCount: state.errors.length,
        },
        timestamp: new Date().toISOString(),
      });

      console.log(
        `[Graph] Execution completed in ${iterations} steps (${context.totalRetries} total retries)`,
      );
      
      // Return state with the database workflow execution ID
      return { ...state, workflowId: workflowExecId };
    } catch (error) {
      // Update workflow execution as failed
      await this.completeWorkflowExecution(
        workflowExecId,
        state,
        "failed",
        error instanceof Error ? error.message : String(error),
      );

      // Emit error event
      this.emitEvent({
        type: "workflow:error",
        workflowId: workflowExecId,
        data: {
          error: error instanceof Error ? error.message : String(error),
          step: currentNode,
          iteration: iterations,
        },
        timestamp: new Date().toISOString(),
      });

      throw error;
    }
  }

  /**
   * Emit a workflow event via the configured callback
   */
  private emitEvent(event: WorkflowEvent): void {
    if (this.config?.onEvent) {
      try {
        this.config.onEvent(event);
      } catch (e) {
        console.error("[Graph] Failed to emit event:", e);
      }
    }
  }

  /**
   * Stream execution (yields state after each step)
   */
  async *stream(
    initialState: TradingState,
  ): AsyncGenerator<{ node: string; state: TradingState }> {
    let state = { ...initialState };
    let currentNode = this.entryPoint;
    let iterations = 0;
    const maxIterations = 100;

    while (currentNode !== END && iterations < maxIterations) {
      iterations++;

      state = { ...state, currentStep: currentNode };

      const node = this.nodes.get(currentNode);
      if (!node) {
        throw new Error(`Node not found: ${currentNode}`);
      }

      const result = await node.fn(state);

      state = {
        ...state,
        ...result.update,
        messages: [...state.messages, ...(result.update.messages || [])],
        errors: [...state.errors, ...(result.update.errors || [])],
      };

      yield { node: currentNode, state };

      if (result.goto) {
        currentNode = result.goto;
      } else {
        const conditional = this.conditionalEdges.get(currentNode);
        if (conditional) {
          currentNode = conditional.condition(state);
        } else {
          const nextNode = this.edges.get(currentNode);
          currentNode = nextNode || END;
        }
      }
    }
  }

  /**
   * Resume from checkpoint
   */
  async resume(workflowExecutionId: string): Promise<TradingState> {
    const checkpoint = await sql`
      SELECT state
      FROM workflow_checkpoints
      WHERE workflow_execution_id = ${workflowExecutionId}::uuid
      ORDER BY created_at DESC
      LIMIT 1
    `;

    if (checkpoint.length === 0) {
      throw new Error("No checkpoint found");
    }

    const state = checkpoint[0].state as TradingState;
    return this.invoke(state);
  }

  // ============================================
  // Private helpers
  // ============================================

  private async createWorkflowExecution(state: TradingState): Promise<string> {
    const result = await sql`
      INSERT INTO workflow_executions (
        thread_id, trigger_type, input, status, current_step
      )
      VALUES (
        ${state.threadId},
        ${state.request.type},
        ${JSON.stringify(state)}::jsonb,
        'running',
        ${state.currentStep}
      )
      RETURNING id
    `;
    return result[0].id;
  }

  private async completeWorkflowExecution(
    id: string,
    state: TradingState,
    status: "completed" | "failed",
    error?: string,
  ): Promise<void> {
    await sql`
      UPDATE workflow_executions
      SET 
        status = ${status},
        output = ${JSON.stringify(state)}::jsonb,
        completed_at = NOW(),
        error = ${error || null}
      WHERE id = ${id}::uuid
    `;
  }

  private async saveCheckpoint(
    workflowExecutionId: string,
    state: TradingState,
  ): Promise<void> {
    await sql`
      INSERT INTO workflow_checkpoints (
        workflow_execution_id, thread_id, step_name, state
      )
      VALUES (
        ${workflowExecutionId}::uuid,
        ${state.threadId},
        ${state.currentStep},
        ${JSON.stringify(state)}::jsonb
      )
      ON CONFLICT (workflow_execution_id, thread_id, step_name)
      DO UPDATE SET state = ${JSON.stringify(state)}::jsonb, created_at = NOW()
    `;
  }
}

// ============================================
// Helper to create subgraphs
// ============================================

export function createSubgraph(
  name: string,
  agents: BaseAgent[],
  routingFn: ConditionFunction,
): NodeFunction {
  const subgraph = new StateGraph();

  // Add supervisor node that routes to agents
  subgraph.addNode("supervisor", async (state) => {
    const nextAgent = routingFn(state);
    return {
      goto: nextAgent,
      update: {},
    };
  });

  // Add all agent nodes
  for (const agent of agents) {
    subgraph.addAgentNode(agent);
    // Each agent returns to supervisor after completion
    subgraph.addEdge(agent.type, "supervisor");
  }

  subgraph.setEntryPoint("supervisor");

  const compiled = subgraph.compile();

  // Return a node function that wraps the subgraph
  return async (state: TradingState): Promise<AgentResult> => {
    const result = await compiled.invoke(state);
    return {
      goto: "", // Will be determined by parent graph
      update: result,
    };
  };
}
