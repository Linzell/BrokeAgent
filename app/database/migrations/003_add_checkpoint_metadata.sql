-- Migration: Add metadata column to workflow_checkpoints
-- This adds support for storing checkpoint metadata like timing, retry counts, etc.

ALTER TABLE workflow_checkpoints 
ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT NULL;

-- Add index for querying by metadata tags
CREATE INDEX IF NOT EXISTS idx_checkpoints_metadata 
ON workflow_checkpoints USING GIN (metadata) 
WHERE metadata IS NOT NULL;

-- Comment for documentation
COMMENT ON COLUMN workflow_checkpoints.metadata IS 'Optional metadata including step duration, retry count, warnings, and tags';
