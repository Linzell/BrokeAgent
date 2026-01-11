import type { TradingState } from "../core/state";
import { sql } from "../core/database";

// ============================================
// Types
// ============================================

export interface Checkpoint {
  id: string;
  workflowExecutionId: string;
  threadId: string;
  stepName: string;
  state: TradingState;
  createdAt: Date;
  metadata?: CheckpointMetadata;
}

export interface CheckpointMetadata {
  /** Duration of this step in ms */
  stepDurationMs?: number;
  /** Cumulative duration up to this step */
  totalDurationMs?: number;
  /** Number of retries for this step */
  retryCount?: number;
  /** Any errors that occurred (non-fatal) */
  warnings?: string[];
  /** Custom tags for filtering */
  tags?: string[];
}

export interface CheckpointQuery {
  workflowExecutionId?: string;
  threadId?: string;
  stepName?: string;
  /** Only return checkpoints after this date */
  after?: Date;
  /** Only return checkpoints before this date */
  before?: Date;
  /** Limit results */
  limit?: number;
  /** Order by created_at */
  order?: "asc" | "desc";
}

export interface CheckpointStats {
  totalCheckpoints: number;
  oldestCheckpoint: Date | null;
  newestCheckpoint: Date | null;
  uniqueWorkflows: number;
  uniqueThreads: number;
}

// ============================================
// Checkpointer Class
// ============================================

export class Checkpointer {
  /**
   * Save a checkpoint for a workflow step
   */
  async save(
    workflowExecutionId: string,
    state: TradingState,
    metadata?: CheckpointMetadata,
  ): Promise<string> {
    const result = await sql`
      INSERT INTO workflow_checkpoints (
        workflow_execution_id, 
        thread_id, 
        step_name, 
        state,
        metadata
      )
      VALUES (
        ${workflowExecutionId}::uuid,
        ${state.threadId},
        ${state.currentStep},
        ${JSON.stringify(state)}::jsonb,
        ${metadata ? JSON.stringify(metadata) : null}::jsonb
      )
      ON CONFLICT (workflow_execution_id, thread_id, step_name)
      DO UPDATE SET 
        state = ${JSON.stringify(state)}::jsonb,
        metadata = COALESCE(${metadata ? JSON.stringify(metadata) : null}::jsonb, workflow_checkpoints.metadata),
        created_at = NOW()
      RETURNING id
    `;

    return result[0].id;
  }

  /**
   * Get the latest checkpoint for a workflow execution
   */
  async getLatest(workflowExecutionId: string): Promise<Checkpoint | null> {
    const result = await sql`
      SELECT 
        id,
        workflow_execution_id,
        thread_id,
        step_name,
        state,
        metadata,
        created_at
      FROM workflow_checkpoints
      WHERE workflow_execution_id = ${workflowExecutionId}::uuid
      ORDER BY created_at DESC
      LIMIT 1
    `;

    if (result.length === 0) {
      return null;
    }

    return this.mapCheckpoint(result[0]);
  }

  /**
   * Get checkpoint by specific step
   */
  async getByStep(
    workflowExecutionId: string,
    stepName: string,
  ): Promise<Checkpoint | null> {
    const result = await sql`
      SELECT 
        id,
        workflow_execution_id,
        thread_id,
        step_name,
        state,
        metadata,
        created_at
      FROM workflow_checkpoints
      WHERE workflow_execution_id = ${workflowExecutionId}::uuid
        AND step_name = ${stepName}
      ORDER BY created_at DESC
      LIMIT 1
    `;

    if (result.length === 0) {
      return null;
    }

    return this.mapCheckpoint(result[0]);
  }

  /**
   * Get all checkpoints for a workflow execution
   */
  async getAll(workflowExecutionId: string): Promise<Checkpoint[]> {
    const result = await sql`
      SELECT 
        id,
        workflow_execution_id,
        thread_id,
        step_name,
        state,
        metadata,
        created_at
      FROM workflow_checkpoints
      WHERE workflow_execution_id = ${workflowExecutionId}::uuid
      ORDER BY created_at ASC
    `;

    return result.map((row) => this.mapCheckpoint(row));
  }

  /**
   * Query checkpoints with filters
   */
  async query(query: CheckpointQuery): Promise<Checkpoint[]> {
    const conditions: string[] = ["1=1"];
    const values: unknown[] = [];
    let paramIndex = 1;

    if (query.workflowExecutionId) {
      conditions.push(`workflow_execution_id = $${paramIndex}::uuid`);
      values.push(query.workflowExecutionId);
      paramIndex++;
    }

    if (query.threadId) {
      conditions.push(`thread_id = $${paramIndex}`);
      values.push(query.threadId);
      paramIndex++;
    }

    if (query.stepName) {
      conditions.push(`step_name = $${paramIndex}`);
      values.push(query.stepName);
      paramIndex++;
    }

    if (query.after) {
      conditions.push(`created_at > $${paramIndex}`);
      values.push(query.after);
      paramIndex++;
    }

    if (query.before) {
      conditions.push(`created_at < $${paramIndex}`);
      values.push(query.before);
      paramIndex++;
    }

    const order = query.order === "asc" ? "ASC" : "DESC";
    const limit = query.limit || 100;

    // Use tagged template for the base query structure
    const result = await sql`
      SELECT 
        id,
        workflow_execution_id,
        thread_id,
        step_name,
        state,
        metadata,
        created_at
      FROM workflow_checkpoints
      WHERE ${sql.unsafe(conditions.join(" AND "))}
      ORDER BY created_at ${sql.unsafe(order)}
      LIMIT ${limit}
    `;

    return result.map((row) => this.mapCheckpoint(row));
  }

  /**
   * Delete checkpoints for a workflow execution
   */
  async delete(workflowExecutionId: string): Promise<number> {
    const result = await sql`
      DELETE FROM workflow_checkpoints
      WHERE workflow_execution_id = ${workflowExecutionId}::uuid
      RETURNING id
    `;

    return result.length;
  }

  /**
   * Delete old checkpoints (cleanup)
   */
  async deleteOlderThan(date: Date): Promise<number> {
    const result = await sql`
      DELETE FROM workflow_checkpoints
      WHERE created_at < ${date}
      RETURNING id
    `;

    return result.length;
  }

  /**
   * Delete checkpoints for completed workflows older than a date
   * Keeps checkpoints for failed workflows for debugging
   */
  async cleanup(options: {
    olderThan: Date;
    keepFailed?: boolean;
  }): Promise<number> {
    const { olderThan, keepFailed = true } = options;

    let result;
    if (keepFailed) {
      result = await sql`
        DELETE FROM workflow_checkpoints wc
        USING workflow_executions we
        WHERE wc.workflow_execution_id = we.id
          AND wc.created_at < ${olderThan}
          AND we.status = 'completed'
        RETURNING wc.id
      `;
    } else {
      result = await sql`
        DELETE FROM workflow_checkpoints
        WHERE created_at < ${olderThan}
        RETURNING id
      `;
    }

    return result.length;
  }

  /**
   * Get checkpoint statistics
   */
  async getStats(): Promise<CheckpointStats> {
    const result = await sql`
      SELECT 
        COUNT(*)::int as total_checkpoints,
        MIN(created_at) as oldest_checkpoint,
        MAX(created_at) as newest_checkpoint,
        COUNT(DISTINCT workflow_execution_id)::int as unique_workflows,
        COUNT(DISTINCT thread_id)::int as unique_threads
      FROM workflow_checkpoints
    `;

    const row = result[0];
    return {
      totalCheckpoints: row.total_checkpoints,
      oldestCheckpoint: row.oldest_checkpoint,
      newestCheckpoint: row.newest_checkpoint,
      uniqueWorkflows: row.unique_workflows,
      uniqueThreads: row.unique_threads,
    };
  }

  /**
   * Get workflow execution history (checkpoints with timing)
   */
  async getExecutionHistory(workflowExecutionId: string): Promise<{
    checkpoints: Checkpoint[];
    totalDuration: number;
    stepDurations: Record<string, number>;
  }> {
    const checkpoints = await this.getAll(workflowExecutionId);

    if (checkpoints.length === 0) {
      return {
        checkpoints: [],
        totalDuration: 0,
        stepDurations: {},
      };
    }

    const stepDurations: Record<string, number> = {};
    let prevTime = checkpoints[0].createdAt.getTime();

    for (let i = 1; i < checkpoints.length; i++) {
      const cp = checkpoints[i];
      const duration = cp.createdAt.getTime() - prevTime;
      stepDurations[checkpoints[i - 1].stepName] = duration;
      prevTime = cp.createdAt.getTime();
    }

    const totalDuration =
      checkpoints[checkpoints.length - 1].createdAt.getTime() -
      checkpoints[0].createdAt.getTime();

    return {
      checkpoints,
      totalDuration,
      stepDurations,
    };
  }

  /**
   * Restore state from a specific checkpoint
   */
  async restore(checkpointId: string): Promise<TradingState | null> {
    const result = await sql`
      SELECT state
      FROM workflow_checkpoints
      WHERE id = ${checkpointId}::uuid
    `;

    if (result.length === 0) {
      return null;
    }

    return result[0].state as TradingState;
  }

  /**
   * Map database row to Checkpoint type
   */
  private mapCheckpoint(row: Record<string, unknown>): Checkpoint {
    return {
      id: row.id as string,
      workflowExecutionId: row.workflow_execution_id as string,
      threadId: row.thread_id as string,
      stepName: row.step_name as string,
      state: row.state as TradingState,
      createdAt: row.created_at as Date,
      metadata: row.metadata as CheckpointMetadata | undefined,
    };
  }
}

// ============================================
// Singleton
// ============================================

export const checkpointer = new Checkpointer();

// Export factory
export function createCheckpointer(): Checkpointer {
  return new Checkpointer();
}
