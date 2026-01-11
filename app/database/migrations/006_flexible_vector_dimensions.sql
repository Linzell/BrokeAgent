-- Migration: Support flexible embedding dimensions
-- This migration changes the vector column to support different embedding models:
-- - OpenAI text-embedding-3-small: 1536 dimensions
-- - Ollama nomic-embed-text: 768 dimensions
-- - Other models may vary

-- First, drop the existing HNSW index (it's dimension-specific)
DROP INDEX IF EXISTS memories_embedding_hnsw_idx;

-- Drop the search function that references the old dimension
DROP FUNCTION IF EXISTS search_memories(vector(1536), TEXT, TEXT, INT, FLOAT);

-- Alter the embedding column to be dimension-agnostic
-- Note: PostgreSQL vector extension supports variable dimensions when not specified
-- But for better compatibility, we'll use 768 (Ollama default) as it's the smaller common size
-- If you need OpenAI, either:
-- 1. Use text-embedding-3-small with dimensions=768 parameter
-- 2. Or manually alter this to vector(1536) and re-run init

ALTER TABLE memories 
ALTER COLUMN embedding TYPE vector(768) 
USING embedding::vector(768);

-- Recreate the HNSW index for 768 dimensions
CREATE INDEX IF NOT EXISTS memories_embedding_hnsw_idx
ON memories USING hnsw (embedding vector_cosine_ops)
WITH (m = 16, ef_construction = 64);

-- Recreate the search function with 768 dimensions
CREATE OR REPLACE FUNCTION search_memories(
    query_embedding vector(768),
    namespace_filter TEXT DEFAULT NULL,
    type_filter TEXT DEFAULT NULL,
    limit_count INT DEFAULT 10,
    min_similarity FLOAT DEFAULT 0.7
)
RETURNS TABLE (
    id UUID,
    content TEXT,
    memory_type VARCHAR(50),
    namespace VARCHAR(255),
    metadata JSONB,
    similarity FLOAT
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        m.id,
        m.content,
        m.memory_type,
        m.namespace,
        m.metadata,
        (1 - (m.embedding <=> query_embedding))::FLOAT as similarity
    FROM memories m
    WHERE
        (namespace_filter IS NULL OR m.namespace LIKE namespace_filter || '%')
        AND (type_filter IS NULL OR m.memory_type = type_filter)
        AND (1 - (m.embedding <=> query_embedding)) >= min_similarity
    ORDER BY
        m.embedding <=> query_embedding,
        m.importance DESC
    LIMIT limit_count;
END;
$$ LANGUAGE plpgsql;
