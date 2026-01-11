import { describe, it, expect, beforeEach, vi } from "vitest";
import { StateGraph, CompiledGraph, START, END, type NodeFunction } from "../../app/src/core/graph";
import type { TradingState } from "../../app/src/core/state";
import { createInitialState } from "../../app/src/core/state";
import type { AgentResult } from "../../app/src/agents/base";

// Mock database
vi.mock("../../app/src/core/database", () => ({
  sql: vi.fn().mockImplementation(() => Promise.resolve([{ id: "mock-id" }])),
}));

describe("StateGraph", () => {
  let graph: StateGraph;

  beforeEach(() => {
    graph = new StateGraph();
  });

  describe("addNode", () => {
    it("should add a node to the graph", () => {
      const mockFn: NodeFunction = async (state) => ({
        goto: END,
        update: {},
      });

      const result = graph.addNode("test_node", mockFn);

      // Should return the graph for chaining
      expect(result).toBe(graph);
    });

    it("should support method chaining", () => {
      const mockFn: NodeFunction = async () => ({ goto: END, update: {} });

      const result = graph
        .addNode("node1", mockFn)
        .addNode("node2", mockFn)
        .addNode("node3", mockFn);

      expect(result).toBe(graph);
    });
  });

  describe("addEdge", () => {
    it("should add an edge between nodes", () => {
      const mockFn: NodeFunction = async () => ({ goto: "", update: {} });

      const result = graph
        .addNode("node1", mockFn)
        .addNode("node2", mockFn)
        .addEdge("node1", "node2");

      expect(result).toBe(graph);
    });
  });

  describe("addConditionalEdges", () => {
    it("should add conditional edges", () => {
      const mockFn: NodeFunction = async () => ({ goto: "", update: {} });
      const condition = (state: TradingState) =>
        state.request.type === "trade" ? "executor" : "analyst";

      const result = graph
        .addNode("router", mockFn)
        .addNode("executor", mockFn)
        .addNode("analyst", mockFn)
        .addConditionalEdges("router", condition, {
          trade: "executor",
          analysis: "analyst",
        });

      expect(result).toBe(graph);
    });
  });

  describe("setEntryPoint", () => {
    it("should set the entry point", () => {
      const mockFn: NodeFunction = async () => ({ goto: END, update: {} });

      const result = graph.addNode("start_node", mockFn).setEntryPoint("start_node");

      expect(result).toBe(graph);
    });
  });

  describe("compile", () => {
    it("should throw error if no entry point is set", () => {
      const mockFn: NodeFunction = async () => ({ goto: END, update: {} });
      graph.addNode("test", mockFn);

      expect(() => graph.compile()).toThrow("No entry point set for graph");
    });

    it("should return a CompiledGraph when entry point is set", () => {
      const mockFn: NodeFunction = async () => ({ goto: END, update: {} });

      const compiled = graph
        .addNode("start", mockFn)
        .setEntryPoint("start")
        .compile();

      expect(compiled).toBeInstanceOf(CompiledGraph);
    });

    it("should accept config options", () => {
      const mockFn: NodeFunction = async () => ({ goto: END, update: {} });

      const compiled = graph.addNode("start", mockFn).setEntryPoint("start").compile({
        threadId: "test-thread",
        checkpointer: true,
      });

      expect(compiled).toBeInstanceOf(CompiledGraph);
    });
  });
});

describe("CompiledGraph", () => {
  describe("invoke", () => {
    it("should execute a simple single-node graph", async () => {
      const graph = new StateGraph();
      let executed = false;

      const nodeFn: NodeFunction = async (state) => {
        executed = true;
        return {
          goto: END,
          update: {
            currentStep: "completed",
          },
        };
      };

      const compiled = graph.addNode("process", nodeFn).setEntryPoint("process").compile();

      const initialState = createInitialState({
        type: "analysis",
        symbols: ["AAPL"],
      });

      const result = await compiled.invoke(initialState);

      expect(executed).toBe(true);
      expect(result.currentStep).toBe("completed");
    });

    it("should execute a multi-node graph with fixed edges", async () => {
      const graph = new StateGraph();
      const executionOrder: string[] = [];

      const node1Fn: NodeFunction = async (state) => {
        executionOrder.push("node1");
        return { goto: "node2", update: {} };
      };

      const node2Fn: NodeFunction = async (state) => {
        executionOrder.push("node2");
        return { goto: "node3", update: {} };
      };

      const node3Fn: NodeFunction = async (state) => {
        executionOrder.push("node3");
        return { goto: END, update: {} };
      };

      const compiled = graph
        .addNode("node1", node1Fn)
        .addNode("node2", node2Fn)
        .addNode("node3", node3Fn)
        .addEdge("node1", "node2")
        .addEdge("node2", "node3")
        .setEntryPoint("node1")
        .compile();

      const initialState = createInitialState({ type: "analysis" });
      await compiled.invoke(initialState);

      expect(executionOrder).toEqual(["node1", "node2", "node3"]);
    });

    it("should handle conditional routing", async () => {
      const graph = new StateGraph();
      const executionOrder: string[] = [];

      const routerFn: NodeFunction = async (state) => {
        executionOrder.push("router");
        // Route based on request type
        const next = state.request.type === "trade" ? "executor" : "analyst";
        return { goto: next, update: {} };
      };

      const analystFn: NodeFunction = async (state) => {
        executionOrder.push("analyst");
        return { goto: END, update: {} };
      };

      const executorFn: NodeFunction = async (state) => {
        executionOrder.push("executor");
        return { goto: END, update: {} };
      };

      const compiled = graph
        .addNode("router", routerFn)
        .addNode("analyst", analystFn)
        .addNode("executor", executorFn)
        .setEntryPoint("router")
        .compile();

      // Test analysis path
      const analysisState = createInitialState({ type: "analysis" });
      await compiled.invoke(analysisState);
      expect(executionOrder).toEqual(["router", "analyst"]);

      // Reset and test trade path
      executionOrder.length = 0;
      const tradeState = createInitialState({ type: "trade" });
      await compiled.invoke(tradeState);
      expect(executionOrder).toEqual(["router", "executor"]);
    });

    it("should accumulate state updates through nodes", async () => {
      const graph = new StateGraph();

      const node1Fn: NodeFunction = async (state) => {
        return {
          goto: "node2",
          update: {
            marketData: [
              {
                symbol: "AAPL",
                price: 185,
                change: 2,
                changePercent: 1.1,
                volume: 50000000,
                high: 186,
                low: 183,
                open: 184,
                previousClose: 183,
              },
            ],
          },
        };
      };

      const node2Fn: NodeFunction = async (state) => {
        return {
          goto: END,
          update: {
            technical: {
              symbol: "AAPL",
              trend: "bullish" as const,
              trendStrength: 0.75,
              signals: [],
              supportLevels: [180],
              resistanceLevels: [190],
              recommendation: "Buy",
            },
          },
        };
      };

      const compiled = graph
        .addNode("node1", node1Fn)
        .addNode("node2", node2Fn)
        .setEntryPoint("node1")
        .compile();

      const initialState = createInitialState({ type: "analysis" });
      const result = await compiled.invoke(initialState);

      expect(result.marketData).toBeDefined();
      expect(result.marketData![0].symbol).toBe("AAPL");
      expect(result.technical).toBeDefined();
      expect(result.technical!.trend).toBe("bullish");
    });

    it("should append messages through workflow", async () => {
      const graph = new StateGraph();

      const node1Fn: NodeFunction = async (state) => {
        return {
          goto: "node2",
          update: {
            messages: [
              {
                role: "assistant" as const,
                content: "Starting analysis",
                timestamp: new Date(),
              },
            ],
          },
        };
      };

      const node2Fn: NodeFunction = async (state) => {
        return {
          goto: END,
          update: {
            messages: [
              {
                role: "assistant" as const,
                content: "Analysis complete",
                timestamp: new Date(),
              },
            ],
          },
        };
      };

      const compiled = graph
        .addNode("node1", node1Fn)
        .addNode("node2", node2Fn)
        .setEntryPoint("node1")
        .compile();

      const initialState = createInitialState({ type: "analysis" });
      const result = await compiled.invoke(initialState);

      expect(result.messages).toHaveLength(2);
      expect(result.messages[0].content).toBe("Starting analysis");
      expect(result.messages[1].content).toBe("Analysis complete");
    });

    it("should throw error for non-existent node", async () => {
      const graph = new StateGraph();

      const nodeFn: NodeFunction = async (state) => {
        return { goto: "non_existent_node", update: {} };
      };

      const compiled = graph.addNode("start", nodeFn).setEntryPoint("start").compile();

      const initialState = createInitialState({ type: "analysis" });

      await expect(compiled.invoke(initialState)).rejects.toThrow(
        "Node not found: non_existent_node"
      );
    });

    it("should protect against infinite loops with max iterations", async () => {
      const graph = new StateGraph();
      let iterations = 0;

      const loopingFn: NodeFunction = async (state) => {
        iterations++;
        // Always loop back to itself
        return { goto: "loop", update: {} };
      };

      const compiled = graph.addNode("loop", loopingFn).setEntryPoint("loop").compile();

      const initialState = createInitialState({ type: "analysis" });

      await expect(compiled.invoke(initialState)).rejects.toThrow("Max iterations exceeded");
      expect(iterations).toBe(100); // Default max iterations
    });
  });

  describe("stream", () => {
    it("should yield state after each step", async () => {
      const graph = new StateGraph();

      const node1Fn: NodeFunction = async () => ({
        goto: "node2",
        update: { currentStep: "node1_done" },
      });

      const node2Fn: NodeFunction = async () => ({
        goto: END,
        update: { currentStep: "node2_done" },
      });

      const compiled = graph
        .addNode("node1", node1Fn)
        .addNode("node2", node2Fn)
        .setEntryPoint("node1")
        .compile();

      const initialState = createInitialState({ type: "analysis" });
      const steps: { node: string; state: TradingState }[] = [];

      for await (const step of compiled.stream(initialState)) {
        steps.push(step);
      }

      expect(steps).toHaveLength(2);
      expect(steps[0].node).toBe("node1");
      expect(steps[1].node).toBe("node2");
    });
  });
});

describe("Graph Constants", () => {
  it("should export START constant", () => {
    expect(START).toBe("__start__");
  });

  it("should export END constant", () => {
    expect(END).toBe("__end__");
  });
});
