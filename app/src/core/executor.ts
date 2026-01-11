import type { TradingState } from "./state";
import type { AgentResult } from "../agents/base";
import { sql } from "./database";

// ============================================
// Types
// ============================================

/**
 * Error recovery strategies
 */
export type RecoveryStrategy =
  | "retry" // Retry the failed node with backoff
  | "skip" // Skip the node and continue to next
  | "fallback" // Use fallback value and continue
  | "abort"; // Stop execution immediately

/**
 * Configuration for retry behavior
 */
export interface RetryConfig {
  /** Maximum number of retry attempts (default: 3) */
  maxAttempts: number;
  /** Initial delay in ms before first retry (default: 1000) */
  initialDelayMs: number;
  /** Maximum delay in ms between retries (default: 30000) */
  maxDelayMs: number;
  /** Multiplier for exponential backoff (default: 2) */
  backoffMultiplier: number;
  /** Add random jitter to prevent thundering herd (default: true) */
  jitter: boolean;
}

/**
 * Configuration for error recovery
 */
export interface RecoveryConfig {
  /** Default strategy for unhandled errors */
  defaultStrategy: RecoveryStrategy;
  /** Strategy per error type */
  strategies: Record<string, RecoveryStrategy>;
  /** Fallback values for nodes when using 'fallback' strategy */
  fallbacks: Record<string, Partial<TradingState>>;
  /** Errors that should never be retried */
  nonRetryableErrors: string[];
}

/**
 * Full executor configuration
 */
export interface ExecutorConfig {
  retry: RetryConfig;
  recovery: RecoveryConfig;
  /** Timeout per node execution in ms (default: 60000) */
  nodeTimeoutMs: number;
  /** Total workflow timeout in ms (default: 300000) */
  workflowTimeoutMs: number;
  /** Enable detailed logging */
  verbose: boolean;
}

/**
 * Result of a node execution attempt
 */
export interface ExecutionAttempt {
  node: string;
  attempt: number;
  success: boolean;
  result?: AgentResult;
  error?: Error;
  durationMs: number;
  recoveryAction?: RecoveryStrategy;
}

/**
 * Execution context passed through the workflow
 */
export interface ExecutionContext {
  workflowExecutionId: string;
  attempts: ExecutionAttempt[];
  totalRetries: number;
  startedAt: Date;
  currentNode: string;
}

// ============================================
// Default Configuration
// ============================================

export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxAttempts: 3,
  initialDelayMs: 1000,
  maxDelayMs: 30000,
  backoffMultiplier: 2,
  jitter: true,
};

export const DEFAULT_RECOVERY_CONFIG: RecoveryConfig = {
  defaultStrategy: "retry",
  strategies: {
    // Network errors should be retried
    ECONNREFUSED: "retry",
    ETIMEDOUT: "retry",
    ENOTFOUND: "retry",
    // Rate limiting should retry with backoff
    RateLimitError: "retry",
    TooManyRequestsError: "retry",
    // API errors might be transient
    APIError: "retry",
    // Validation errors should not be retried
    ValidationError: "abort",
    ZodError: "abort",
    // Missing data can be skipped
    NoDataError: "skip",
    // Auth errors should abort
    AuthenticationError: "abort",
    UnauthorizedError: "abort",
  },
  fallbacks: {
    // Fallback for research team - empty data
    research_team: {
      marketData: [],
      news: [],
      social: {
        mentions: [],
        trendingSymbols: [],
        overallSentiment: 0,
      },
    },
    // Fallback for analysis team - neutral analysis
    analysis_team: {
      technical: {
        symbol: "UNKNOWN",
        trend: "neutral",
        trendStrength: 0,
        signals: [],
        supportLevels: [],
        resistanceLevels: [],
        recommendation: "Analysis unavailable - using neutral fallback",
      },
      sentiment: {
        symbol: "UNKNOWN",
        overallScore: 0,
        confidence: 0,
        sentiment: "neutral",
        keyDrivers: ["Sentiment analysis unavailable"],
      },
    },
  },
  nonRetryableErrors: [
    "ValidationError",
    "ZodError",
    "AuthenticationError",
    "UnauthorizedError",
    "InsufficientFundsError",
  ],
};

export const DEFAULT_EXECUTOR_CONFIG: ExecutorConfig = {
  retry: DEFAULT_RETRY_CONFIG,
  recovery: DEFAULT_RECOVERY_CONFIG,
  nodeTimeoutMs: 180000, // 3 minutes per node (needed for debate with multiple LLM calls)
  workflowTimeoutMs: 600000, // 10 minutes total workflow timeout
  verbose: false,
};

// ============================================
// Executor Class
// ============================================

export class WorkflowExecutor {
  private config: ExecutorConfig;

  constructor(config: Partial<ExecutorConfig> = {}) {
    this.config = {
      ...DEFAULT_EXECUTOR_CONFIG,
      ...config,
      retry: { ...DEFAULT_RETRY_CONFIG, ...config.retry },
      recovery: {
        ...DEFAULT_RECOVERY_CONFIG,
        ...config.recovery,
        strategies: {
          ...DEFAULT_RECOVERY_CONFIG.strategies,
          ...config.recovery?.strategies,
        },
        fallbacks: {
          ...DEFAULT_RECOVERY_CONFIG.fallbacks,
          ...config.recovery?.fallbacks,
        },
      },
    };
  }

  /**
   * Execute a node with retry logic
   */
  async executeWithRetry(
    nodeName: string,
    nodeFn: (state: TradingState) => Promise<AgentResult>,
    state: TradingState,
    context: ExecutionContext,
  ): Promise<{ result: AgentResult; attempts: ExecutionAttempt[] }> {
    const attempts: ExecutionAttempt[] = [];
    let lastError: Error | undefined;

    for (let attempt = 1; attempt <= this.config.retry.maxAttempts; attempt++) {
      const attemptStart = Date.now();

      try {
        // Execute with timeout
        const result = await this.executeWithTimeout(
          nodeFn,
          state,
          this.config.nodeTimeoutMs,
        );

        const attemptRecord: ExecutionAttempt = {
          node: nodeName,
          attempt,
          success: true,
          result,
          durationMs: Date.now() - attemptStart,
        };
        attempts.push(attemptRecord);

        this.log(
          `[Executor] ${nodeName} succeeded on attempt ${attempt}`,
          attemptRecord,
        );

        return { result, attempts };
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        const attemptRecord: ExecutionAttempt = {
          node: nodeName,
          attempt,
          success: false,
          error: lastError,
          durationMs: Date.now() - attemptStart,
        };
        attempts.push(attemptRecord);

        this.log(
          `[Executor] ${nodeName} failed on attempt ${attempt}: ${lastError.message}`,
          attemptRecord,
        );

        // Check if error is retryable
        if (!this.isRetryable(lastError)) {
          this.log(
            `[Executor] ${nodeName} error is non-retryable, applying recovery strategy`,
          );
          break;
        }

        // Wait before retry (if not last attempt)
        if (attempt < this.config.retry.maxAttempts) {
          const delay = this.calculateBackoff(attempt);
          this.log(`[Executor] Waiting ${delay}ms before retry...`);
          await this.sleep(delay);
        }
      }
    }

    // All retries exhausted, apply recovery strategy
    const strategy = this.getRecoveryStrategy(nodeName, lastError!);
    this.log(`[Executor] Applying recovery strategy: ${strategy}`);

    return this.applyRecoveryStrategy(
      nodeName,
      strategy,
      state,
      attempts,
      lastError!,
    );
  }

  /**
   * Execute a function with timeout
   */
  private async executeWithTimeout(
    fn: (state: TradingState) => Promise<AgentResult>,
    state: TradingState,
    timeoutMs: number,
  ): Promise<AgentResult> {
    return Promise.race([
      fn(state),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new TimeoutError(`Node execution timed out after ${timeoutMs}ms`)),
          timeoutMs,
        ),
      ),
    ]);
  }

  /**
   * Calculate backoff delay for retry attempt
   */
  private calculateBackoff(attempt: number): number {
    const { initialDelayMs, maxDelayMs, backoffMultiplier, jitter } =
      this.config.retry;

    // Exponential backoff: initialDelay * multiplier^(attempt-1)
    let delay = initialDelayMs * Math.pow(backoffMultiplier, attempt - 1);

    // Cap at max delay
    delay = Math.min(delay, maxDelayMs);

    // Add jitter (0-25% of delay)
    if (jitter) {
      delay = delay + Math.random() * delay * 0.25;
    }

    return Math.round(delay);
  }

  /**
   * Check if an error should be retried
   */
  private isRetryable(error: Error): boolean {
    const errorName = error.name || error.constructor.name;
    const errorMessage = error.message;

    // Check against non-retryable list
    for (const nonRetryable of this.config.recovery.nonRetryableErrors) {
      if (
        errorName.includes(nonRetryable) ||
        errorMessage.includes(nonRetryable)
      ) {
        return false;
      }
    }

    return true;
  }

  /**
   * Get recovery strategy for a node/error combination
   */
  private getRecoveryStrategy(nodeName: string, error: Error): RecoveryStrategy {
    const errorName = error.name || error.constructor.name;

    // Check for specific error strategy
    if (this.config.recovery.strategies[errorName]) {
      return this.config.recovery.strategies[errorName];
    }

    // Check error message for known patterns
    for (const [pattern, strategy] of Object.entries(
      this.config.recovery.strategies,
    )) {
      if (error.message.includes(pattern)) {
        return strategy;
      }
    }

    return this.config.recovery.defaultStrategy;
  }

  /**
   * Apply recovery strategy after retries exhausted
   */
  private async applyRecoveryStrategy(
    nodeName: string,
    strategy: RecoveryStrategy,
    state: TradingState,
    attempts: ExecutionAttempt[],
    error: Error,
  ): Promise<{ result: AgentResult; attempts: ExecutionAttempt[] }> {
    const lastAttempt = attempts[attempts.length - 1];
    lastAttempt.recoveryAction = strategy;

    switch (strategy) {
      case "skip":
        this.log(`[Executor] Skipping ${nodeName}, continuing workflow`);
        return {
          result: {
            goto: "", // Let graph determine next node
            update: {
              errors: [
                {
                  agent: nodeName,
                  error: `Skipped after ${attempts.length} failed attempts: ${error.message}`,
                  timestamp: new Date(),
                },
              ],
            },
          },
          attempts,
        };

      case "fallback":
        const fallbackData = this.config.recovery.fallbacks[nodeName] || {};
        this.log(
          `[Executor] Using fallback for ${nodeName}`,
          Object.keys(fallbackData),
        );
        return {
          result: {
            goto: "", // Let graph determine next node
            update: {
              ...fallbackData,
              errors: [
                {
                  agent: nodeName,
                  error: `Using fallback after ${attempts.length} failed attempts: ${error.message}`,
                  timestamp: new Date(),
                },
              ],
            },
          },
          attempts,
        };

      case "abort":
      default:
        // Throw to abort workflow
        const abortError = new ExecutorError(
          `${nodeName} failed after ${attempts.length} attempts: ${error.message}`,
          {
            node: nodeName,
            attempts,
            originalError: error,
          },
        );
        throw abortError;
    }
  }

  /**
   * Record execution attempt to database
   */
  async recordAttempt(
    workflowExecutionId: string,
    attempt: ExecutionAttempt,
  ): Promise<void> {
    try {
      await sql`
        INSERT INTO agent_executions (
          workflow_execution_id,
          step_name,
          status,
          duration_ms,
          error
        )
        VALUES (
          ${workflowExecutionId}::uuid,
          ${attempt.node},
          ${attempt.success ? "completed" : "failed"},
          ${attempt.durationMs},
          ${attempt.error?.message || null}
        )
      `;
    } catch (dbError) {
      // Don't fail workflow due to logging error
      console.error("[Executor] Failed to record attempt:", dbError);
    }
  }

  /**
   * Update workflow execution retry count
   */
  async updateRetryCount(
    workflowExecutionId: string,
    retryCount: number,
  ): Promise<void> {
    try {
      await sql`
        UPDATE workflow_executions
        SET retry_count = ${retryCount}
        WHERE id = ${workflowExecutionId}::uuid
      `;
    } catch (dbError) {
      console.error("[Executor] Failed to update retry count:", dbError);
    }
  }

  /**
   * Sleep helper
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Logging helper
   */
  private log(message: string, data?: unknown): void {
    if (this.config.verbose) {
      console.log(message, data ? JSON.stringify(data, null, 2) : "");
    } else {
      console.log(message);
    }
  }
}

// ============================================
// Custom Errors
// ============================================

export class ExecutorError extends Error {
  public readonly node: string;
  public readonly attempts: ExecutionAttempt[];
  public readonly originalError: Error;

  constructor(
    message: string,
    details: {
      node: string;
      attempts: ExecutionAttempt[];
      originalError: Error;
    },
  ) {
    super(message);
    this.name = "ExecutorError";
    this.node = details.node;
    this.attempts = details.attempts;
    this.originalError = details.originalError;
  }
}

export class TimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TimeoutError";
  }
}

// ============================================
// Singleton
// ============================================

export const defaultExecutor = new WorkflowExecutor();

// Export factory for custom configs
export function createExecutor(config: Partial<ExecutorConfig>): WorkflowExecutor {
  return new WorkflowExecutor(config);
}
