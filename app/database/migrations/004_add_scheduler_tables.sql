-- Migration: Add scheduler tables
-- Support for cron-based and event-based workflow scheduling

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

CREATE INDEX IF NOT EXISTS idx_scheduled_workflows_enabled 
ON scheduled_workflows(enabled) WHERE enabled = true;

CREATE INDEX IF NOT EXISTS idx_scheduled_workflows_trigger 
ON scheduled_workflows(trigger_type);

CREATE INDEX IF NOT EXISTS idx_scheduled_workflows_tags
ON scheduled_workflows USING GIN(tags);

COMMENT ON TABLE scheduled_workflows IS 'Scheduled workflow definitions with cron, interval, or event triggers';

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

CREATE INDEX IF NOT EXISTS idx_schedule_executions_schedule 
ON schedule_executions(schedule_id);

CREATE INDEX IF NOT EXISTS idx_schedule_executions_status 
ON schedule_executions(status);

CREATE INDEX IF NOT EXISTS idx_schedule_executions_started 
ON schedule_executions(started_at DESC);

COMMENT ON TABLE schedule_executions IS 'Execution history for scheduled workflows';
