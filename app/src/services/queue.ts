import { sql } from "../core/database";
import { createInitialState, type TradingState } from "../core/state";
import { EventEmitter } from "events";

// ============================================
// Types
// ============================================

export type JobStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "cancelled"
  | "stalled";

export type JobPriority = "critical" | "high" | "normal" | "low";

export interface Job {
  id: string;
  /** Job type/name for routing */
  type: string;
  /** Job payload */
  data: unknown;
  /** Job priority */
  priority: JobPriority;
  /** Current status */
  status: JobStatus;
  /** Number of attempts made */
  attempts: number;
  /** Maximum attempts allowed */
  maxAttempts: number;
  /** Delay before first run (ms) */
  delay: number;
  /** Result if completed */
  result?: unknown;
  /** Error if failed */
  error?: string;
  /** Created timestamp */
  createdAt: Date;
  /** Started timestamp */
  startedAt?: Date;
  /** Completed timestamp */
  completedAt?: Date;
  /** Next retry timestamp */
  nextRetryAt?: Date;
  /** Parent job ID (for job chains) */
  parentId?: string;
  /** Custom metadata */
  metadata?: Record<string, unknown>;
}

export interface JobOptions {
  priority?: JobPriority;
  delay?: number;
  maxAttempts?: number;
  parentId?: string;
  metadata?: Record<string, unknown>;
}

export interface QueueConfig {
  /** Queue name */
  name: string;
  /** Max concurrent jobs */
  concurrency: number;
  /** Default max attempts */
  defaultMaxAttempts: number;
  /** Stall check interval (ms) */
  stallInterval: number;
  /** Time before a job is considered stalled (ms) */
  stallTimeout: number;
  /** Enable persistence to database */
  persistent: boolean;
}

export type JobHandler<T = unknown, R = unknown> = (
  job: Job,
  data: T,
) => Promise<R>;

// ============================================
// Priority Values (lower = higher priority)
// ============================================

const PRIORITY_VALUES: Record<JobPriority, number> = {
  critical: 0,
  high: 1,
  normal: 2,
  low: 3,
};

// ============================================
// Queue Class
// ============================================

export class WorkflowQueue extends EventEmitter {
  private config: QueueConfig;
  private handlers: Map<string, JobHandler> = new Map();
  private jobs: Map<string, Job> = new Map();
  private pendingQueue: string[] = []; // Job IDs sorted by priority
  private runningJobs: Set<string> = new Set();
  private processing = false;
  private stallChecker?: NodeJS.Timer;

  constructor(config: Partial<QueueConfig> = {}) {
    super();
    this.config = {
      name: config.name || "default",
      concurrency: config.concurrency ?? 5,
      defaultMaxAttempts: config.defaultMaxAttempts ?? 3,
      stallInterval: config.stallInterval ?? 30000,
      stallTimeout: config.stallTimeout ?? 300000, // 5 minutes
      persistent: config.persistent ?? false,
    };
  }

  /**
   * Register a job handler
   */
  process<T = unknown, R = unknown>(
    jobType: string,
    handler: JobHandler<T, R>,
  ): void {
    this.handlers.set(jobType, handler as JobHandler);
    console.log(`[Queue:${this.config.name}] Registered handler: ${jobType}`);
  }

  /**
   * Add a job to the queue
   */
  async add<T = unknown>(
    type: string,
    data: T,
    options: JobOptions = {},
  ): Promise<Job> {
    const job: Job = {
      id: crypto.randomUUID(),
      type,
      data,
      priority: options.priority || "normal",
      status: "pending",
      attempts: 0,
      maxAttempts: options.maxAttempts ?? this.config.defaultMaxAttempts,
      delay: options.delay ?? 0,
      createdAt: new Date(),
      parentId: options.parentId,
      metadata: options.metadata,
    };

    // Apply delay if specified
    if (job.delay > 0) {
      job.nextRetryAt = new Date(Date.now() + job.delay);
    }

    this.jobs.set(job.id, job);
    this.insertIntoQueue(job.id);

    // Persist to database if enabled
    if (this.config.persistent) {
      await this.persistJob(job);
    }

    this.emit("added", job);
    console.log(
      `[Queue:${this.config.name}] Job added: ${job.id} (${type}, ${job.priority})`,
    );

    // Trigger processing
    this.processNext();

    return job;
  }

  /**
   * Add multiple jobs as a batch
   */
  async addBulk<T = unknown>(
    jobs: Array<{ type: string; data: T; options?: JobOptions }>,
  ): Promise<Job[]> {
    const addedJobs: Job[] = [];
    for (const { type, data, options } of jobs) {
      const job = await this.add(type, data, options);
      addedJobs.push(job);
    }
    return addedJobs;
  }

  /**
   * Get a job by ID
   */
  getJob(jobId: string): Job | undefined {
    return this.jobs.get(jobId);
  }

  /**
   * Get all jobs with optional status filter
   */
  getJobs(status?: JobStatus): Job[] {
    const allJobs = Array.from(this.jobs.values());
    if (status) {
      return allJobs.filter((j) => j.status === status);
    }
    return allJobs;
  }

  /**
   * Cancel a pending job
   */
  async cancel(jobId: string): Promise<boolean> {
    const job = this.jobs.get(jobId);
    if (!job || job.status !== "pending") {
      return false;
    }

    job.status = "cancelled";
    job.completedAt = new Date();

    // Remove from pending queue
    const idx = this.pendingQueue.indexOf(jobId);
    if (idx !== -1) {
      this.pendingQueue.splice(idx, 1);
    }

    if (this.config.persistent) {
      await this.updateJobStatus(job);
    }

    this.emit("cancelled", job);
    return true;
  }

  /**
   * Retry a failed job
   */
  async retry(jobId: string): Promise<boolean> {
    const job = this.jobs.get(jobId);
    if (!job || job.status !== "failed") {
      return false;
    }

    job.status = "pending";
    job.attempts = 0;
    job.error = undefined;
    job.startedAt = undefined;
    job.completedAt = undefined;

    this.insertIntoQueue(job.id);

    if (this.config.persistent) {
      await this.updateJobStatus(job);
    }

    this.emit("retried", job);
    this.processNext();

    return true;
  }

  /**
   * Start the queue processor
   */
  start(): void {
    if (this.processing) return;

    this.processing = true;
    console.log(`[Queue:${this.config.name}] Started`);

    // Start stall checker
    this.stallChecker = setInterval(
      () => this.checkStalledJobs(),
      this.config.stallInterval,
    );

    // Begin processing
    this.processNext();
  }

  /**
   * Stop the queue processor
   */
  stop(): void {
    this.processing = false;

    if (this.stallChecker) {
      clearInterval(this.stallChecker);
      this.stallChecker = undefined;
    }

    console.log(`[Queue:${this.config.name}] Stopped`);
  }

  /**
   * Wait for all jobs to complete
   */
  async drain(): Promise<void> {
    return new Promise((resolve) => {
      const check = () => {
        if (this.runningJobs.size === 0 && this.pendingQueue.length === 0) {
          resolve();
        } else {
          setTimeout(check, 100);
        }
      };
      check();
    });
  }

  /**
   * Get queue statistics
   */
  getStats(): {
    pending: number;
    running: number;
    completed: number;
    failed: number;
    total: number;
  } {
    const jobs = Array.from(this.jobs.values());
    return {
      pending: jobs.filter((j) => j.status === "pending").length,
      running: jobs.filter((j) => j.status === "running").length,
      completed: jobs.filter((j) => j.status === "completed").length,
      failed: jobs.filter((j) => j.status === "failed").length,
      total: jobs.length,
    };
  }

  /**
   * Clear completed and failed jobs from memory
   */
  clean(): number {
    let cleaned = 0;
    for (const [id, job] of this.jobs) {
      if (job.status === "completed" || job.status === "failed") {
        this.jobs.delete(id);
        cleaned++;
      }
    }
    return cleaned;
  }

  /**
   * Load pending jobs from database
   */
  async loadFromDatabase(): Promise<number> {
    if (!this.config.persistent) return 0;

    const result = await sql`
      SELECT * FROM queue_jobs
      WHERE queue_name = ${this.config.name}
        AND status IN ('pending', 'running')
      ORDER BY 
        CASE priority 
          WHEN 'critical' THEN 0
          WHEN 'high' THEN 1
          WHEN 'normal' THEN 2
          WHEN 'low' THEN 3
        END,
        created_at ASC
    `;

    for (const row of result) {
      const job: Job = {
        id: row.id as string,
        type: row.job_type as string,
        data: row.data,
        priority: row.priority as JobPriority,
        status: row.status === "running" ? "pending" : (row.status as JobStatus), // Reset running to pending
        attempts: row.attempts as number,
        maxAttempts: row.max_attempts as number,
        delay: 0,
        createdAt: row.created_at as Date,
        startedAt: row.started_at as Date | undefined,
        parentId: row.parent_id as string | undefined,
        metadata: row.metadata as Record<string, unknown> | undefined,
      };

      this.jobs.set(job.id, job);
      if (job.status === "pending") {
        this.insertIntoQueue(job.id);
      }
    }

    console.log(
      `[Queue:${this.config.name}] Loaded ${result.length} jobs from database`,
    );
    return result.length;
  }

  // ============================================
  // Private Methods
  // ============================================

  private insertIntoQueue(jobId: string): void {
    const job = this.jobs.get(jobId);
    if (!job) return;

    const jobPriority = PRIORITY_VALUES[job.priority];

    // Find insertion point (maintain priority order)
    let insertIdx = this.pendingQueue.length;
    for (let i = 0; i < this.pendingQueue.length; i++) {
      const existingJob = this.jobs.get(this.pendingQueue[i]);
      if (existingJob && PRIORITY_VALUES[existingJob.priority] > jobPriority) {
        insertIdx = i;
        break;
      }
    }

    this.pendingQueue.splice(insertIdx, 0, jobId);
  }

  private async processNext(): Promise<void> {
    if (!this.processing) return;
    if (this.runningJobs.size >= this.config.concurrency) return;
    if (this.pendingQueue.length === 0) return;

    // Find next job that's ready to run
    let jobId: string | undefined;
    let jobIndex = -1;

    for (let i = 0; i < this.pendingQueue.length; i++) {
      const id = this.pendingQueue[i];
      const job = this.jobs.get(id);
      if (!job) continue;

      // Check if job has delay that hasn't elapsed
      if (job.nextRetryAt && job.nextRetryAt > new Date()) {
        continue;
      }

      jobId = id;
      jobIndex = i;
      break;
    }

    if (!jobId || jobIndex === -1) {
      // Schedule check for delayed jobs
      const nextDelayed = this.getNextDelayedTime();
      if (nextDelayed) {
        setTimeout(() => this.processNext(), nextDelayed - Date.now());
      }
      return;
    }

    // Remove from pending queue
    this.pendingQueue.splice(jobIndex, 1);

    const job = this.jobs.get(jobId)!;
    this.runningJobs.add(jobId);

    // Execute job
    this.executeJob(job);

    // Try to process more jobs
    setImmediate(() => this.processNext());
  }

  private async executeJob(job: Job): Promise<void> {
    const handler = this.handlers.get(job.type);
    if (!handler) {
      console.error(
        `[Queue:${this.config.name}] No handler for job type: ${job.type}`,
      );
      job.status = "failed";
      job.error = `No handler registered for job type: ${job.type}`;
      job.completedAt = new Date();
      this.runningJobs.delete(job.id);
      this.emit("failed", job, new Error(job.error));
      return;
    }

    job.status = "running";
    job.attempts++;
    job.startedAt = new Date();

    if (this.config.persistent) {
      await this.updateJobStatus(job);
    }

    this.emit("active", job);
    console.log(
      `[Queue:${this.config.name}] Processing: ${job.id} (${job.type}, attempt ${job.attempts}/${job.maxAttempts})`,
    );

    try {
      const result = await handler(job, job.data);

      job.status = "completed";
      job.result = result;
      job.completedAt = new Date();

      if (this.config.persistent) {
        await this.updateJobStatus(job);
      }

      this.emit("completed", job, result);
      console.log(`[Queue:${this.config.name}] Completed: ${job.id}`);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);

      if (job.attempts < job.maxAttempts) {
        // Retry with exponential backoff
        const backoff = Math.min(1000 * Math.pow(2, job.attempts - 1), 60000);
        job.status = "pending";
        job.nextRetryAt = new Date(Date.now() + backoff);

        this.insertIntoQueue(job.id);

        if (this.config.persistent) {
          await this.updateJobStatus(job);
        }

        this.emit("retrying", job, error);
        console.log(
          `[Queue:${this.config.name}] Retrying: ${job.id} in ${backoff}ms`,
        );
      } else {
        job.status = "failed";
        job.error = errorMsg;
        job.completedAt = new Date();

        if (this.config.persistent) {
          await this.updateJobStatus(job);
        }

        this.emit("failed", job, error);
        console.error(`[Queue:${this.config.name}] Failed: ${job.id} - ${errorMsg}`);
      }
    } finally {
      this.runningJobs.delete(job.id);
      this.processNext();
    }
  }

  private getNextDelayedTime(): number | null {
    let earliest: number | null = null;

    for (const jobId of this.pendingQueue) {
      const job = this.jobs.get(jobId);
      if (job?.nextRetryAt) {
        const time = job.nextRetryAt.getTime();
        if (earliest === null || time < earliest) {
          earliest = time;
        }
      }
    }

    return earliest;
  }

  private async checkStalledJobs(): Promise<void> {
    const now = Date.now();
    const stalledThreshold = now - this.config.stallTimeout;

    for (const jobId of this.runningJobs) {
      const job = this.jobs.get(jobId);
      if (!job || !job.startedAt) continue;

      if (job.startedAt.getTime() < stalledThreshold) {
        console.warn(`[Queue:${this.config.name}] Stalled job detected: ${jobId}`);

        job.status = "stalled";
        this.runningJobs.delete(jobId);

        if (job.attempts < job.maxAttempts) {
          job.status = "pending";
          this.insertIntoQueue(jobId);
          this.emit("stalled", job);
        } else {
          job.status = "failed";
          job.error = "Job stalled and exceeded max attempts";
          job.completedAt = new Date();
          this.emit("failed", job, new Error(job.error));
        }

        if (this.config.persistent) {
          await this.updateJobStatus(job);
        }
      }
    }
  }

  private async persistJob(job: Job): Promise<void> {
    await sql`
      INSERT INTO queue_jobs (
        id, queue_name, job_type, data, priority, status,
        attempts, max_attempts, parent_id, metadata, created_at
      )
      VALUES (
        ${job.id}::uuid,
        ${this.config.name},
        ${job.type},
        ${JSON.stringify(job.data)}::jsonb,
        ${job.priority},
        ${job.status},
        ${job.attempts},
        ${job.maxAttempts},
        ${job.parentId || null}::uuid,
        ${job.metadata ? JSON.stringify(job.metadata) : null}::jsonb,
        ${job.createdAt}
      )
    `;
  }

  private async updateJobStatus(job: Job): Promise<void> {
    await sql`
      UPDATE queue_jobs
      SET 
        status = ${job.status},
        attempts = ${job.attempts},
        result = ${job.result ? JSON.stringify(job.result) : null}::jsonb,
        error = ${job.error || null},
        started_at = ${job.startedAt || null},
        completed_at = ${job.completedAt || null},
        next_retry_at = ${job.nextRetryAt || null}
      WHERE id = ${job.id}::uuid
    `;
  }
}

// ============================================
// Database Migration
// ============================================

export const QUEUE_MIGRATION = `
-- Queue jobs table
CREATE TABLE IF NOT EXISTS queue_jobs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    queue_name VARCHAR(100) NOT NULL,
    job_type VARCHAR(100) NOT NULL,
    data JSONB NOT NULL DEFAULT '{}',
    priority VARCHAR(20) NOT NULL DEFAULT 'normal',
    status VARCHAR(50) NOT NULL DEFAULT 'pending',
    attempts INT DEFAULT 0,
    max_attempts INT DEFAULT 3,
    result JSONB,
    error TEXT,
    parent_id UUID REFERENCES queue_jobs(id),
    metadata JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    next_retry_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_queue_jobs_queue ON queue_jobs(queue_name);
CREATE INDEX IF NOT EXISTS idx_queue_jobs_status ON queue_jobs(status);
CREATE INDEX IF NOT EXISTS idx_queue_jobs_priority ON queue_jobs(queue_name, priority, created_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_queue_jobs_parent ON queue_jobs(parent_id) WHERE parent_id IS NOT NULL;
`;

// ============================================
// Factory & Singleton
// ============================================

const queues: Map<string, WorkflowQueue> = new Map();

export function getQueue(name = "default"): WorkflowQueue {
  if (!queues.has(name)) {
    queues.set(name, new WorkflowQueue({ name }));
  }
  return queues.get(name)!;
}

export function createQueue(config: Partial<QueueConfig>): WorkflowQueue {
  const queue = new WorkflowQueue(config);
  if (config.name) {
    queues.set(config.name, queue);
  }
  return queue;
}

// Default workflow queue
export const workflowQueue = getQueue("workflows");
