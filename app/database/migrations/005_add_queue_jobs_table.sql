-- Migration: Add queue jobs table
-- Support for persistent job queue with priority and retry

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

-- Index for fetching pending jobs by queue and priority
CREATE INDEX IF NOT EXISTS idx_queue_jobs_pending 
ON queue_jobs(queue_name, priority, created_at) 
WHERE status = 'pending';

-- Index for queue stats
CREATE INDEX IF NOT EXISTS idx_queue_jobs_status 
ON queue_jobs(queue_name, status);

-- Index for job chains (parent-child relationships)
CREATE INDEX IF NOT EXISTS idx_queue_jobs_parent 
ON queue_jobs(parent_id) 
WHERE parent_id IS NOT NULL;

-- Index for cleanup queries
CREATE INDEX IF NOT EXISTS idx_queue_jobs_completed 
ON queue_jobs(completed_at) 
WHERE status IN ('completed', 'failed');

COMMENT ON TABLE queue_jobs IS 'Persistent job queue with priority and retry support';
