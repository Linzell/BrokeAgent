import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  WorkflowExecutor,
  createExecutor,
  defaultExecutor,
  DEFAULT_RETRY_CONFIG,
  DEFAULT_RECOVERY_CONFIG,
  ExecutorError,
  TimeoutError,
  type RetryConfig,
  type ExecutionContext,
} from "../../app/src/core/executor";
import type { TradingState } from "../../app/src/core/state";
import type { AgentResult } from "../../app/src/agents/base";

// Mock the database
vi.mock("../../app/src/core/database", () => ({
  sql: vi.fn().mockImplementation(() => Promise.resolve([])),
}));

describe("WorkflowExecutor", () => {
  let executor: WorkflowExecutor;
  let mockState: TradingState;
  let mockContext: ExecutionContext;

  beforeEach(() => {
    executor = new WorkflowExecutor({ verbose: false });
    mockState = {
      workflowId: "test-workflow",
      threadId: "test-thread",
      startedAt: new Date(),
      currentStep: "test",
      request: { type: "analysis", symbols: ["AAPL"] },
      messages: [],
      errors: [],
    };
    mockContext = {
      workflowExecutionId: "test-exec",
      attempts: [],
      totalRetries: 0,
      startedAt: new Date(),
      currentNode: "test_node",
    };
  });

  describe("Default Configuration", () => {
    it("should have sensible default retry config", () => {
      expect(DEFAULT_RETRY_CONFIG.maxAttempts).toBe(3);
      expect(DEFAULT_RETRY_CONFIG.initialDelayMs).toBe(1000);
      expect(DEFAULT_RETRY_CONFIG.maxDelayMs).toBe(30000);
      expect(DEFAULT_RETRY_CONFIG.backoffMultiplier).toBe(2);
      expect(DEFAULT_RETRY_CONFIG.jitter).toBe(true);
    });

    it("should have sensible default recovery strategies", () => {
      expect(DEFAULT_RECOVERY_CONFIG.defaultStrategy).toBe("retry");
      expect(DEFAULT_RECOVERY_CONFIG.strategies.ValidationError).toBe("abort");
      expect(DEFAULT_RECOVERY_CONFIG.strategies.ECONNREFUSED).toBe("retry");
      expect(DEFAULT_RECOVERY_CONFIG.strategies.NoDataError).toBe("skip");
    });

    it("should have non-retryable errors defined", () => {
      expect(DEFAULT_RECOVERY_CONFIG.nonRetryableErrors).toContain(
        "ValidationError",
      );
      expect(DEFAULT_RECOVERY_CONFIG.nonRetryableErrors).toContain(
        "AuthenticationError",
      );
    });
  });

  describe("executeWithRetry", () => {
    it("should succeed on first attempt if no error", async () => {
      const mockFn = vi.fn().mockResolvedValue({
        goto: "next_node",
        update: { marketData: [] },
      });

      const { result, attempts } = await executor.executeWithRetry(
        "test_node",
        mockFn,
        mockState,
        mockContext,
      );

      expect(mockFn).toHaveBeenCalledTimes(1);
      expect(attempts.length).toBe(1);
      expect(attempts[0].success).toBe(true);
      expect(result.goto).toBe("next_node");
    });

    it("should retry on transient errors", async () => {
      const error = new Error("ECONNREFUSED");
      error.name = "ECONNREFUSED";

      const mockFn = vi
        .fn()
        .mockRejectedValueOnce(error)
        .mockRejectedValueOnce(error)
        .mockResolvedValue({
          goto: "next_node",
          update: {},
        });

      // Use shorter delays for testing
      const fastExecutor = new WorkflowExecutor({
        retry: { ...DEFAULT_RETRY_CONFIG, initialDelayMs: 10, maxDelayMs: 50 },
        verbose: false,
      });

      const { result, attempts } = await fastExecutor.executeWithRetry(
        "test_node",
        mockFn,
        mockState,
        mockContext,
      );

      expect(mockFn).toHaveBeenCalledTimes(3);
      expect(attempts.length).toBe(3);
      expect(attempts[0].success).toBe(false);
      expect(attempts[1].success).toBe(false);
      expect(attempts[2].success).toBe(true);
      expect(result.goto).toBe("next_node");
    });

    it("should not retry non-retryable errors", async () => {
      const error = new Error("ValidationError: Invalid input");
      error.name = "ValidationError";

      const mockFn = vi.fn().mockRejectedValue(error);

      const fastExecutor = new WorkflowExecutor({
        retry: { ...DEFAULT_RETRY_CONFIG, initialDelayMs: 10 },
        verbose: false,
      });

      await expect(
        fastExecutor.executeWithRetry(
          "test_node",
          mockFn,
          mockState,
          mockContext,
        ),
      ).rejects.toThrow(ExecutorError);

      // Should only be called once - no retries
      expect(mockFn).toHaveBeenCalledTimes(1);
    });

    it("should abort after max retries exceeded", async () => {
      const error = new Error("API Error");

      const mockFn = vi.fn().mockRejectedValue(error);

      const fastExecutor = new WorkflowExecutor({
        retry: {
          ...DEFAULT_RETRY_CONFIG,
          maxAttempts: 2,
          initialDelayMs: 10,
        },
        verbose: false,
      });

      await expect(
        fastExecutor.executeWithRetry(
          "test_node",
          mockFn,
          mockState,
          mockContext,
        ),
      ).rejects.toThrow(ExecutorError);

      expect(mockFn).toHaveBeenCalledTimes(2);
    });

    it("should apply skip strategy and continue", async () => {
      const error = new Error("NoDataError");
      error.name = "NoDataError";

      const mockFn = vi.fn().mockRejectedValue(error);

      const fastExecutor = new WorkflowExecutor({
        retry: {
          ...DEFAULT_RETRY_CONFIG,
          maxAttempts: 1,
          initialDelayMs: 10,
        },
        verbose: false,
      });

      const { result, attempts } = await fastExecutor.executeWithRetry(
        "test_node",
        mockFn,
        mockState,
        mockContext,
      );

      // Should return skip result instead of throwing
      expect(result.goto).toBe("");
      expect(result.update.errors).toHaveLength(1);
      expect(result.update.errors![0].error).toContain("Skipped");
      expect(attempts[0].recoveryAction).toBe("skip");
    });

    it("should apply fallback strategy with fallback data", async () => {
      const error = new Error("Some error");

      const mockFn = vi.fn().mockRejectedValue(error);

      const fastExecutor = new WorkflowExecutor({
        retry: {
          ...DEFAULT_RETRY_CONFIG,
          maxAttempts: 1,
          initialDelayMs: 10,
        },
        recovery: {
          ...DEFAULT_RECOVERY_CONFIG,
          defaultStrategy: "fallback",
          fallbacks: {
            test_node: {
              marketData: [
                {
                  symbol: "FALLBACK",
                  price: 0,
                  change: 0,
                  changePercent: 0,
                  volume: 0,
                  high: 0,
                  low: 0,
                  open: 0,
                  previousClose: 0,
                },
              ],
            },
          },
        },
        verbose: false,
      });

      const { result, attempts } = await fastExecutor.executeWithRetry(
        "test_node",
        mockFn,
        mockState,
        mockContext,
      );

      expect(result.goto).toBe("");
      expect(result.update.marketData).toBeDefined();
      expect(result.update.marketData![0].symbol).toBe("FALLBACK");
      expect(attempts[0].recoveryAction).toBe("fallback");
    });
  });

  describe("Backoff Calculation", () => {
    it("should use exponential backoff pattern", async () => {
      // Test that backoff works by measuring actual timing
      // We use very short delays to keep the test fast
      const error = new Error("Test error");
      let callTimes: number[] = [];

      const mockFn = vi.fn().mockImplementation(() => {
        callTimes.push(Date.now());
        return Promise.reject(error);
      });

      const testExecutor = new WorkflowExecutor({
        retry: {
          maxAttempts: 3,
          initialDelayMs: 20,
          maxDelayMs: 100,
          backoffMultiplier: 2,
          jitter: false,
        },
        verbose: false,
      });

      try {
        await testExecutor.executeWithRetry(
          "test_node",
          mockFn,
          mockState,
          mockContext,
        );
      } catch {
        // Expected to fail
      }

      // Verify we had 3 attempts
      expect(callTimes.length).toBe(3);

      // Second call should be ~20ms after first
      const delay1 = callTimes[1] - callTimes[0];
      expect(delay1).toBeGreaterThanOrEqual(15); // Allow some variance
      expect(delay1).toBeLessThan(50);

      // Third call should be ~40ms after second (exponential)
      const delay2 = callTimes[2] - callTimes[1];
      expect(delay2).toBeGreaterThanOrEqual(30);
      expect(delay2).toBeLessThan(80);
    });

    it("should cap delay at maxDelayMs", async () => {
      const error = new Error("Test error");
      let callTimes: number[] = [];

      const mockFn = vi.fn().mockImplementation(() => {
        callTimes.push(Date.now());
        return Promise.reject(error);
      });

      const testExecutor = new WorkflowExecutor({
        retry: {
          maxAttempts: 4,
          initialDelayMs: 20,
          maxDelayMs: 30, // Very low cap
          backoffMultiplier: 2,
          jitter: false,
        },
        verbose: false,
      });

      try {
        await testExecutor.executeWithRetry(
          "test_node",
          mockFn,
          mockState,
          mockContext,
        );
      } catch {
        // Expected to fail
      }

      // Verify we had 4 attempts
      expect(callTimes.length).toBe(4);

      // Third call: 20 * 2^2 = 80, capped to 30
      const delay3 = callTimes[3] - callTimes[2];
      expect(delay3).toBeLessThanOrEqual(50); // Should be ~30ms, allow variance
    });
  });

  describe("Timeout Handling", () => {
    it("should timeout slow operations", async () => {
      // Create a promise that never resolves
      const mockFn = vi.fn().mockImplementation(
        () =>
          new Promise((resolve) => {
            // This will never resolve within the timeout
            setTimeout(() => resolve({ goto: "done", update: {} }), 10000);
          }),
      );

      const fastExecutor = new WorkflowExecutor({
        nodeTimeoutMs: 50, // Very short timeout
        retry: { ...DEFAULT_RETRY_CONFIG, maxAttempts: 1 },
        recovery: {
          ...DEFAULT_RECOVERY_CONFIG,
          defaultStrategy: "abort", // Make sure it aborts on timeout
        },
        verbose: false,
      });

      await expect(
        fastExecutor.executeWithRetry(
          "slow_node",
          mockFn,
          mockState,
          mockContext,
        ),
      ).rejects.toThrow(); // Should throw either TimeoutError or ExecutorError
    }, 10000); // Increase test timeout
  });

  describe("ExecutorError", () => {
    it("should contain attempt history", async () => {
      const error = new Error("Persistent error");
      const mockFn = vi.fn().mockRejectedValue(error);

      const fastExecutor = new WorkflowExecutor({
        retry: {
          ...DEFAULT_RETRY_CONFIG,
          maxAttempts: 2,
          initialDelayMs: 10,
        },
        verbose: false,
      });

      try {
        await fastExecutor.executeWithRetry(
          "failing_node",
          mockFn,
          mockState,
          mockContext,
        );
        expect.fail("Should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(ExecutorError);
        const execError = err as ExecutorError;
        expect(execError.node).toBe("failing_node");
        expect(execError.attempts).toHaveLength(2);
        expect(execError.originalError).toBe(error);
      }
    });
  });

  describe("Factory Functions", () => {
    it("should create executor with custom config", () => {
      const custom = createExecutor({
        retry: { ...DEFAULT_RETRY_CONFIG, maxAttempts: 5 },
      });

      expect(custom).toBeInstanceOf(WorkflowExecutor);
    });

    it("should have a default executor singleton", () => {
      expect(defaultExecutor).toBeInstanceOf(WorkflowExecutor);
    });
  });

  describe("Error Pattern Matching", () => {
    it("should match error by name", async () => {
      const error = new Error("Connection refused");
      error.name = "ECONNREFUSED";

      const mockFn = vi.fn().mockRejectedValue(error);

      const fastExecutor = new WorkflowExecutor({
        retry: {
          ...DEFAULT_RETRY_CONFIG,
          maxAttempts: 2,
          initialDelayMs: 10,
        },
        verbose: false,
      });

      // ECONNREFUSED should retry, then abort after max attempts
      await expect(
        fastExecutor.executeWithRetry(
          "test_node",
          mockFn,
          mockState,
          mockContext,
        ),
      ).rejects.toThrow();

      // Should have retried
      expect(mockFn).toHaveBeenCalledTimes(2);
    });

    it("should match error by message pattern", async () => {
      const error = new Error("RateLimitError: Too many requests");

      const mockFn = vi.fn().mockRejectedValue(error);

      const fastExecutor = new WorkflowExecutor({
        retry: {
          ...DEFAULT_RETRY_CONFIG,
          maxAttempts: 2,
          initialDelayMs: 10,
        },
        verbose: false,
      });

      await expect(
        fastExecutor.executeWithRetry(
          "test_node",
          mockFn,
          mockState,
          mockContext,
        ),
      ).rejects.toThrow();

      // RateLimitError should retry
      expect(mockFn).toHaveBeenCalledTimes(2);
    });
  });
});

describe("TimeoutError", () => {
  it("should have correct name", () => {
    const error = new TimeoutError("Test timeout");
    expect(error.name).toBe("TimeoutError");
    expect(error.message).toBe("Test timeout");
  });
});
