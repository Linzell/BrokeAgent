import { Cron } from "croner";
import { sql } from "../core/database";
import { createInitialState, type TradingState } from "../core/state";
import type { CompiledGraph } from "../core/graph";

// ============================================
// Types
// ============================================

export type ScheduleTrigger =
  | { type: "cron"; expression: string }
  | { type: "interval"; intervalMs: number }
  | { type: "event"; eventType: string };

export interface ScheduledWorkflow {
  id: string;
  name: string;
  description?: string;
  trigger: ScheduleTrigger;
  /** Request to execute */
  request: TradingState["request"];
  /** Whether the schedule is active */
  enabled: boolean;
  /** Maximum concurrent executions (default: 1) */
  maxConcurrent: number;
  /** Retry on failure */
  retryOnFail: boolean;
  /** Custom tags for filtering */
  tags?: string[];
  /** Created timestamp */
  createdAt: Date;
  /** Last execution timestamp */
  lastRunAt?: Date;
  /** Next scheduled run */
  nextRunAt?: Date;
}

export interface ScheduleExecution {
  id: string;
  scheduleId: string;
  status: "pending" | "running" | "completed" | "failed";
  startedAt: Date;
  completedAt?: Date;
  error?: string;
  workflowExecutionId?: string;
}

export interface SchedulerConfig {
  /** Timezone for cron expressions (default: UTC) */
  timezone?: string;
  /** Maximum concurrent workflows across all schedules */
  maxGlobalConcurrent?: number;
  /** Default retry on failure */
  defaultRetryOnFail?: boolean;
}

export type WorkflowRunner = (
  request: TradingState["request"],
) => Promise<TradingState>;

// ============================================
// Scheduler Class
// ============================================

export class Scheduler {
  private cronJobs: Map<string, Cron> = new Map();
  private intervalJobs: Map<string, NodeJS.Timer> = new Map();
  private schedules: Map<string, ScheduledWorkflow> = new Map();
  private runningCount: Map<string, number> = new Map();
  private globalRunning = 0;
  private workflowRunner?: WorkflowRunner;
  private config: SchedulerConfig;
  private eventHandlers: Map<string, Set<string>> = new Map();

  constructor(config: SchedulerConfig = {}) {
    this.config = {
      timezone: "UTC",
      maxGlobalConcurrent: 10,
      defaultRetryOnFail: false,
      ...config,
    };
  }

  /**
   * Set the workflow runner function
   */
  setWorkflowRunner(runner: WorkflowRunner): void {
    this.workflowRunner = runner;
  }

  /**
   * Register a scheduled workflow
   */
  async register(schedule: Omit<ScheduledWorkflow, "id" | "createdAt">): Promise<string> {
    const id = crypto.randomUUID();
    const now = new Date();

    const scheduledWorkflow: ScheduledWorkflow = {
      ...schedule,
      id,
      createdAt: now,
      enabled: schedule.enabled ?? true,
      maxConcurrent: schedule.maxConcurrent ?? 1,
      retryOnFail: schedule.retryOnFail ?? this.config.defaultRetryOnFail ?? false,
    };

    // Save to database
    await sql`
      INSERT INTO scheduled_workflows (
        id, name, description, trigger_type, trigger_config, 
        request, enabled, max_concurrent, retry_on_fail, tags
      )
      VALUES (
        ${id}::uuid,
        ${scheduledWorkflow.name},
        ${scheduledWorkflow.description || null},
        ${schedule.trigger.type},
        ${JSON.stringify(schedule.trigger)}::jsonb,
        ${JSON.stringify(schedule.request)}::jsonb,
        ${scheduledWorkflow.enabled},
        ${scheduledWorkflow.maxConcurrent},
        ${scheduledWorkflow.retryOnFail},
        ${scheduledWorkflow.tags || []}
      )
    `;

    this.schedules.set(id, scheduledWorkflow);
    this.runningCount.set(id, 0);

    if (scheduledWorkflow.enabled) {
      this.startSchedule(scheduledWorkflow);
    }

    console.log(`[Scheduler] Registered schedule: ${schedule.name} (${id})`);
    return id;
  }

  /**
   * Unregister a scheduled workflow
   */
  async unregister(scheduleId: string): Promise<boolean> {
    const schedule = this.schedules.get(scheduleId);
    if (!schedule) {
      return false;
    }

    this.stopSchedule(scheduleId);
    this.schedules.delete(scheduleId);
    this.runningCount.delete(scheduleId);

    await sql`
      DELETE FROM scheduled_workflows
      WHERE id = ${scheduleId}::uuid
    `;

    console.log(`[Scheduler] Unregistered schedule: ${schedule.name}`);
    return true;
  }

  /**
   * Enable a schedule
   */
  async enable(scheduleId: string): Promise<boolean> {
    const schedule = this.schedules.get(scheduleId);
    if (!schedule) {
      return false;
    }

    schedule.enabled = true;
    this.startSchedule(schedule);

    await sql`
      UPDATE scheduled_workflows
      SET enabled = true
      WHERE id = ${scheduleId}::uuid
    `;

    return true;
  }

  /**
   * Disable a schedule
   */
  async disable(scheduleId: string): Promise<boolean> {
    const schedule = this.schedules.get(scheduleId);
    if (!schedule) {
      return false;
    }

    schedule.enabled = false;
    this.stopSchedule(scheduleId);

    await sql`
      UPDATE scheduled_workflows
      SET enabled = false
      WHERE id = ${scheduleId}::uuid
    `;

    return true;
  }

  /**
   * Trigger an event (for event-based schedules)
   */
  async triggerEvent(eventType: string, payload?: unknown): Promise<void> {
    const scheduleIds = this.eventHandlers.get(eventType);
    if (!scheduleIds || scheduleIds.size === 0) {
      return;
    }

    console.log(`[Scheduler] Event triggered: ${eventType}`);

    // Log event
    await sql`
      INSERT INTO events (type, payload, source_type)
      VALUES (${eventType}, ${JSON.stringify(payload || {})}::jsonb, 'scheduler')
    `;

    // Execute all registered schedules for this event
    for (const scheduleId of scheduleIds) {
      const schedule = this.schedules.get(scheduleId);
      if (schedule && schedule.enabled) {
        this.executeSchedule(schedule);
      }
    }
  }

  /**
   * Get all registered schedules
   */
  getSchedules(): ScheduledWorkflow[] {
    return Array.from(this.schedules.values());
  }

  /**
   * Get a specific schedule
   */
  getSchedule(scheduleId: string): ScheduledWorkflow | undefined {
    return this.schedules.get(scheduleId);
  }

  /**
   * Get schedule execution history
   */
  async getExecutionHistory(
    scheduleId: string,
    limit = 20,
  ): Promise<ScheduleExecution[]> {
    const result = await sql`
      SELECT 
        id, schedule_id, status, started_at, completed_at, error, workflow_execution_id
      FROM schedule_executions
      WHERE schedule_id = ${scheduleId}::uuid
      ORDER BY started_at DESC
      LIMIT ${limit}
    `;

    return result.map((row) => ({
      id: row.id as string,
      scheduleId: row.schedule_id as string,
      status: row.status as ScheduleExecution["status"],
      startedAt: row.started_at as Date,
      completedAt: row.completed_at as Date | undefined,
      error: row.error as string | undefined,
      workflowExecutionId: row.workflow_execution_id as string | undefined,
    }));
  }

  /**
   * Load schedules from database and start them
   */
  async start(): Promise<void> {
    console.log("[Scheduler] Starting scheduler...");

    const result = await sql`
      SELECT 
        id, name, description, trigger_type, trigger_config,
        request, enabled, max_concurrent, retry_on_fail, tags,
        created_at, last_run_at
      FROM scheduled_workflows
    `;

    for (const row of result) {
      const schedule: ScheduledWorkflow = {
        id: row.id as string,
        name: row.name as string,
        description: row.description as string | undefined,
        trigger: row.trigger_config as ScheduleTrigger,
        request: row.request as TradingState["request"],
        enabled: row.enabled as boolean,
        maxConcurrent: row.max_concurrent as number,
        retryOnFail: row.retry_on_fail as boolean,
        tags: row.tags as string[] | undefined,
        createdAt: row.created_at as Date,
        lastRunAt: row.last_run_at as Date | undefined,
      };

      this.schedules.set(schedule.id, schedule);
      this.runningCount.set(schedule.id, 0);

      if (schedule.enabled) {
        this.startSchedule(schedule);
      }
    }

    console.log(`[Scheduler] Loaded ${this.schedules.size} schedules`);
  }

  /**
   * Stop all schedules
   */
  stop(): void {
    console.log("[Scheduler] Stopping scheduler...");

    for (const [id] of this.cronJobs) {
      this.stopSchedule(id);
    }

    for (const [id] of this.intervalJobs) {
      this.stopSchedule(id);
    }

    this.eventHandlers.clear();
  }

  /**
   * Manually run a schedule now (bypassing trigger)
   */
  async runNow(scheduleId: string): Promise<string | null> {
    const schedule = this.schedules.get(scheduleId);
    if (!schedule) {
      return null;
    }

    return this.executeSchedule(schedule);
  }

  // ============================================
  // Private Methods
  // ============================================

  private startSchedule(schedule: ScheduledWorkflow): void {
    const { id, trigger } = schedule;

    switch (trigger.type) {
      case "cron":
        const job = new Cron(
          trigger.expression,
          { timezone: this.config.timezone },
          () => {
            // Fire and forget - don't await the promise
            void this.executeSchedule(schedule);
          },
        );
        this.cronJobs.set(id, job);

        // Calculate next run
        const nextRun = job.nextRun();
        if (nextRun) {
          schedule.nextRunAt = nextRun;
        }
        console.log(
          `[Scheduler] Started cron schedule: ${schedule.name} (${trigger.expression})`,
        );
        break;

      case "interval":
        const interval = setInterval(
          () => this.executeSchedule(schedule),
          trigger.intervalMs,
        );
        this.intervalJobs.set(id, interval);
        schedule.nextRunAt = new Date(Date.now() + trigger.intervalMs);
        console.log(
          `[Scheduler] Started interval schedule: ${schedule.name} (${trigger.intervalMs}ms)`,
        );
        break;

      case "event":
        if (!this.eventHandlers.has(trigger.eventType)) {
          this.eventHandlers.set(trigger.eventType, new Set());
        }
        this.eventHandlers.get(trigger.eventType)!.add(id);
        console.log(
          `[Scheduler] Registered event handler: ${schedule.name} -> ${trigger.eventType}`,
        );
        break;
    }
  }

  private stopSchedule(scheduleId: string): void {
    // Stop cron job
    const cronJob = this.cronJobs.get(scheduleId);
    if (cronJob) {
      cronJob.stop();
      this.cronJobs.delete(scheduleId);
    }

    // Stop interval job
    const intervalJob = this.intervalJobs.get(scheduleId);
    if (intervalJob) {
      clearInterval(intervalJob);
      this.intervalJobs.delete(scheduleId);
    }

    // Remove event handlers
    for (const [eventType, handlers] of this.eventHandlers) {
      handlers.delete(scheduleId);
      if (handlers.size === 0) {
        this.eventHandlers.delete(eventType);
      }
    }
  }

  private async executeSchedule(
    schedule: ScheduledWorkflow,
  ): Promise<string | null> {
    const { id, name, maxConcurrent, request } = schedule;

    // Check concurrency limits
    const currentRunning = this.runningCount.get(id) || 0;
    if (currentRunning >= maxConcurrent) {
      console.log(
        `[Scheduler] Skipping ${name}: max concurrent (${maxConcurrent}) reached`,
      );
      return null;
    }

    if (
      this.config.maxGlobalConcurrent &&
      this.globalRunning >= this.config.maxGlobalConcurrent
    ) {
      console.log(
        `[Scheduler] Skipping ${name}: global max concurrent reached`,
      );
      return null;
    }

    // Create execution record
    const execId = crypto.randomUUID();
    await sql`
      INSERT INTO schedule_executions (id, schedule_id, status, started_at)
      VALUES (${execId}::uuid, ${id}::uuid, 'running', NOW())
    `;

    // Update counters
    this.runningCount.set(id, currentRunning + 1);
    this.globalRunning++;

    console.log(`[Scheduler] Executing: ${name} (${execId})`);

    try {
      if (!this.workflowRunner) {
        throw new Error("No workflow runner configured");
      }

      const result = await this.workflowRunner(request);

      // Update execution as completed
      await sql`
        UPDATE schedule_executions
        SET status = 'completed', completed_at = NOW(), workflow_execution_id = ${result.workflowId}::uuid
        WHERE id = ${execId}::uuid
      `;

      // Update last run
      await sql`
        UPDATE scheduled_workflows
        SET last_run_at = NOW()
        WHERE id = ${id}::uuid
      `;
      schedule.lastRunAt = new Date();

      console.log(`[Scheduler] Completed: ${name}`);
      return execId;
    } catch (error) {
      const errorMsg =
        error instanceof Error ? error.message : String(error);

      await sql`
        UPDATE schedule_executions
        SET status = 'failed', completed_at = NOW(), error = ${errorMsg}
        WHERE id = ${execId}::uuid
      `;

      console.error(`[Scheduler] Failed: ${name} - ${errorMsg}`);

      // Retry if configured
      if (schedule.retryOnFail) {
        console.log(`[Scheduler] Scheduling retry for: ${name}`);
        setTimeout(() => this.executeSchedule(schedule), 60000); // Retry after 1 minute
      }

      return null;
    } finally {
      // Update counters
      this.runningCount.set(id, (this.runningCount.get(id) || 1) - 1);
      this.globalRunning--;

      // Update next run for cron jobs
      const cronJob = this.cronJobs.get(id);
      if (cronJob) {
        const nextRun = cronJob.nextRun();
        if (nextRun) {
          schedule.nextRunAt = nextRun;
        }
      }
    }
  }
}

// ============================================
// Database Migration Helper
// ============================================

export const SCHEDULER_MIGRATION = `
-- Scheduled workflows table
CREATE TABLE IF NOT EXISTS scheduled_workflows (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    description TEXT,
    trigger_type VARCHAR(50) NOT NULL,
    trigger_config JSONB NOT NULL,
    request JSONB NOT NULL,
    enabled BOOLEAN DEFAULT true,
    max_concurrent INT DEFAULT 1,
    retry_on_fail BOOLEAN DEFAULT false,
    tags TEXT[] DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    last_run_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_scheduled_workflows_enabled ON scheduled_workflows(enabled) WHERE enabled = true;
CREATE INDEX IF NOT EXISTS idx_scheduled_workflows_trigger ON scheduled_workflows(trigger_type);

-- Schedule executions table
CREATE TABLE IF NOT EXISTS schedule_executions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    schedule_id UUID REFERENCES scheduled_workflows(id) ON DELETE CASCADE,
    status VARCHAR(50) NOT NULL DEFAULT 'pending',
    started_at TIMESTAMPTZ DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    error TEXT,
    workflow_execution_id UUID REFERENCES workflow_executions(id)
);

CREATE INDEX IF NOT EXISTS idx_schedule_executions_schedule ON schedule_executions(schedule_id);
CREATE INDEX IF NOT EXISTS idx_schedule_executions_status ON schedule_executions(status);
CREATE INDEX IF NOT EXISTS idx_schedule_executions_started ON schedule_executions(started_at DESC);
`;

// ============================================
// Singleton
// ============================================

export const scheduler = new Scheduler();

// Export factory
export function createScheduler(config?: SchedulerConfig): Scheduler {
  return new Scheduler(config);
}
