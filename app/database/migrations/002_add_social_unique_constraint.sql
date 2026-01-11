-- Migration: 002_add_social_unique_constraint.sql
-- Description: Add unique constraint for social mentions to prevent duplicates

-- Add unique constraint on platform + external_id
CREATE UNIQUE INDEX IF NOT EXISTS idx_social_platform_external 
ON social_mentions(platform, external_id) 
WHERE external_id IS NOT NULL;

COMMENT ON INDEX idx_social_platform_external IS 'Prevents duplicate social posts from same platform';
