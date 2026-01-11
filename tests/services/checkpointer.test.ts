import { describe, it, expect, vi, beforeEach } from "vitest";
import type { TradingState } from "../../app/src/core/state";

// Must mock before importing the module
vi.mock("../../app/src/core/database", () => ({
  sql: Object.assign(vi.fn(), {
    unsafe: (str: string) => str,
  }),
}));

// Import after mock setup
import {
  Checkpointer,
  checkpointer,
  createCheckpointer,
  type CheckpointMetadata,
} from "../../app/src/services/checkpointer";
import { sql } from "../../app/src/core/database";

const mockSql = sql as unknown as ReturnType<typeof vi.fn>;

describe("Checkpointer", () => {
  let cp: Checkpointer;
  let mockState: TradingState;

  beforeEach(() => {
    cp = new Checkpointer();
    mockState = {
      workflowId: "wf-123",
      threadId: "thread-456",
      startedAt: new Date(),
      currentStep: "research_team",
      request: { type: "analysis", symbols: ["AAPL"] },
      messages: [],
      errors: [],
    };
    mockSql.mockReset();
  });

  describe("save", () => {
    it("should save a checkpoint", async () => {
      mockSql.mockResolvedValue([{ id: "cp-1" }]);

      const id = await cp.save("exec-123", mockState);

      expect(id).toBe("cp-1");
      expect(mockSql).toHaveBeenCalledTimes(1);
    });

    it("should save checkpoint with metadata", async () => {
      mockSql.mockResolvedValue([{ id: "cp-2" }]);

      const metadata: CheckpointMetadata = {
        stepDurationMs: 1500,
        retryCount: 2,
        warnings: ["Rate limited once"],
        tags: ["slow", "retried"],
      };

      const id = await cp.save("exec-123", mockState, metadata);

      expect(id).toBe("cp-2");
    });
  });

  describe("getLatest", () => {
    it("should return the latest checkpoint", async () => {
      const mockDate = new Date();
      mockSql.mockResolvedValue([
        {
          id: "cp-1",
          workflow_execution_id: "exec-123",
          thread_id: "thread-456",
          step_name: "analysis_team",
          state: mockState,
          metadata: { stepDurationMs: 100 },
          created_at: mockDate,
        },
      ]);

      const checkpoint = await cp.getLatest("exec-123");

      expect(checkpoint).not.toBeNull();
      expect(checkpoint!.id).toBe("cp-1");
      expect(checkpoint!.stepName).toBe("analysis_team");
      expect(checkpoint!.metadata?.stepDurationMs).toBe(100);
    });

    it("should return null if no checkpoint found", async () => {
      mockSql.mockResolvedValue([]);

      const checkpoint = await cp.getLatest("nonexistent");

      expect(checkpoint).toBeNull();
    });
  });

  describe("getByStep", () => {
    it("should return checkpoint for specific step", async () => {
      const mockDate = new Date();
      mockSql.mockResolvedValue([
        {
          id: "cp-1",
          workflow_execution_id: "exec-123",
          thread_id: "thread-456",
          step_name: "research_team",
          state: mockState,
          metadata: null,
          created_at: mockDate,
        },
      ]);

      const checkpoint = await cp.getByStep("exec-123", "research_team");

      expect(checkpoint).not.toBeNull();
      expect(checkpoint!.stepName).toBe("research_team");
    });
  });

  describe("getAll", () => {
    it("should return all checkpoints in order", async () => {
      const date1 = new Date("2024-01-01T10:00:00Z");
      const date2 = new Date("2024-01-01T10:01:00Z");
      const date3 = new Date("2024-01-01T10:02:00Z");

      mockSql.mockResolvedValue([
        {
          id: "cp-1",
          workflow_execution_id: "exec-123",
          thread_id: "thread-456",
          step_name: "orchestrator",
          state: mockState,
          metadata: null,
          created_at: date1,
        },
        {
          id: "cp-2",
          workflow_execution_id: "exec-123",
          thread_id: "thread-456",
          step_name: "research_team",
          state: mockState,
          metadata: null,
          created_at: date2,
        },
        {
          id: "cp-3",
          workflow_execution_id: "exec-123",
          thread_id: "thread-456",
          step_name: "analysis_team",
          state: mockState,
          metadata: null,
          created_at: date3,
        },
      ]);

      const checkpoints = await cp.getAll("exec-123");

      expect(checkpoints).toHaveLength(3);
      expect(checkpoints[0].stepName).toBe("orchestrator");
      expect(checkpoints[1].stepName).toBe("research_team");
      expect(checkpoints[2].stepName).toBe("analysis_team");
    });
  });

  describe("delete", () => {
    it("should delete checkpoints and return count", async () => {
      mockSql.mockResolvedValue([{ id: "cp-1" }, { id: "cp-2" }]);

      const count = await cp.delete("exec-123");

      expect(count).toBe(2);
    });
  });

  describe("deleteOlderThan", () => {
    it("should delete old checkpoints", async () => {
      mockSql.mockResolvedValue([{ id: "cp-1" }, { id: "cp-2" }, { id: "cp-3" }]);

      const count = await cp.deleteOlderThan(new Date("2024-01-01"));

      expect(count).toBe(3);
    });
  });

  describe("cleanup", () => {
    it("should cleanup completed workflow checkpoints", async () => {
      mockSql.mockResolvedValue([{ id: "cp-1" }, { id: "cp-2" }]);

      const count = await cp.cleanup({
        olderThan: new Date("2024-01-01"),
        keepFailed: true,
      });

      expect(count).toBe(2);
    });

    it("should cleanup all old checkpoints when keepFailed is false", async () => {
      mockSql.mockResolvedValue([{ id: "cp-1" }]);

      const count = await cp.cleanup({
        olderThan: new Date("2024-01-01"),
        keepFailed: false,
      });

      expect(count).toBe(1);
    });
  });

  describe("getStats", () => {
    it("should return checkpoint statistics", async () => {
      mockSql.mockResolvedValue([
        {
          total_checkpoints: 150,
          oldest_checkpoint: new Date("2024-01-01"),
          newest_checkpoint: new Date("2024-06-01"),
          unique_workflows: 25,
          unique_threads: 30,
        },
      ]);

      const stats = await cp.getStats();

      expect(stats.totalCheckpoints).toBe(150);
      expect(stats.uniqueWorkflows).toBe(25);
      expect(stats.uniqueThreads).toBe(30);
    });
  });

  describe("getExecutionHistory", () => {
    it("should calculate step durations", async () => {
      const date1 = new Date("2024-01-01T10:00:00Z");
      const date2 = new Date("2024-01-01T10:00:01Z"); // 1 second later
      const date3 = new Date("2024-01-01T10:00:03Z"); // 2 seconds later

      mockSql.mockResolvedValue([
        {
          id: "cp-1",
          workflow_execution_id: "exec-123",
          thread_id: "thread-456",
          step_name: "orchestrator",
          state: mockState,
          metadata: null,
          created_at: date1,
        },
        {
          id: "cp-2",
          workflow_execution_id: "exec-123",
          thread_id: "thread-456",
          step_name: "research_team",
          state: mockState,
          metadata: null,
          created_at: date2,
        },
        {
          id: "cp-3",
          workflow_execution_id: "exec-123",
          thread_id: "thread-456",
          step_name: "analysis_team",
          state: mockState,
          metadata: null,
          created_at: date3,
        },
      ]);

      const history = await cp.getExecutionHistory("exec-123");

      expect(history.checkpoints).toHaveLength(3);
      expect(history.totalDuration).toBe(3000); // 3 seconds
      expect(history.stepDurations["orchestrator"]).toBe(1000);
      expect(history.stepDurations["research_team"]).toBe(2000);
    });

    it("should handle empty history", async () => {
      mockSql.mockResolvedValue([]);

      const history = await cp.getExecutionHistory("nonexistent");

      expect(history.checkpoints).toHaveLength(0);
      expect(history.totalDuration).toBe(0);
      expect(Object.keys(history.stepDurations)).toHaveLength(0);
    });
  });

  describe("restore", () => {
    it("should restore state from checkpoint", async () => {
      mockSql.mockResolvedValue([{ state: mockState }]);

      const state = await cp.restore("cp-123");

      expect(state).not.toBeNull();
      expect(state!.threadId).toBe("thread-456");
    });

    it("should return null for nonexistent checkpoint", async () => {
      mockSql.mockResolvedValue([]);

      const state = await cp.restore("nonexistent");

      expect(state).toBeNull();
    });
  });

  describe("Factory and Singleton", () => {
    it("should export a singleton checkpointer", () => {
      expect(checkpointer).toBeInstanceOf(Checkpointer);
    });

    it("should create new checkpointer instances", () => {
      const cp1 = createCheckpointer();
      const cp2 = createCheckpointer();

      expect(cp1).toBeInstanceOf(Checkpointer);
      expect(cp2).toBeInstanceOf(Checkpointer);
      expect(cp1).not.toBe(cp2);
    });
  });
});
