# BrokeAgent - Database Schema

## Overview

PostgreSQL with pgvector extension for vector similarity search.

## Extensions

```sql
-- Required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "vector";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";  -- For text search
```

---

## Core Tables

### Agents

```sql
CREATE TABLE agents (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    type VARCHAR(50) NOT NULL,           -- 'orchestrator', 'news_analyst', etc.
    name VARCHAR(255) NOT NULL,
    description TEXT,
    system_prompt TEXT,
    
    -- Configuration
    config JSONB DEFAULT '{}',           -- Model settings, parameters
    tools TEXT[] DEFAULT '{}',           -- Allowed tools
    
    -- Status
    enabled BOOLEAN DEFAULT true,
    
    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_agents_type ON agents(type);
CREATE INDEX idx_agents_enabled ON agents(enabled) WHERE enabled = true;
```

### Workflows

```sql
CREATE TABLE workflows (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    description TEXT,
    
    -- Trigger configuration
    trigger_type VARCHAR(50) NOT NULL,   -- 'manual', 'schedule', 'event'
    schedule JSONB,                      -- Cron expression if scheduled
    
    -- Graph definition
    entry_agent_id UUID REFERENCES agents(id),
    graph_definition JSONB NOT NULL,     -- Nodes, edges, conditions
    
    -- Status
    enabled BOOLEAN DEFAULT true,
    
    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_workflows_enabled ON workflows(enabled) WHERE enabled = true;
CREATE INDEX idx_workflows_trigger ON workflows(trigger_type);
```

### Workflow Executions

```sql
CREATE TABLE workflow_executions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workflow_id UUID REFERENCES workflows(id),
    
    -- Execution context
    thread_id VARCHAR(255) NOT NULL,
    trigger_type VARCHAR(50) NOT NULL,
    triggered_by VARCHAR(255),           -- 'user:123', 'scheduler', 'event:xyz'
    
    -- Input/Output
    input JSONB,
    output JSONB,
    
    -- Status
    status VARCHAR(50) NOT NULL DEFAULT 'pending',  -- 'pending', 'running', 'completed', 'failed', 'cancelled'
    current_step VARCHAR(100),
    
    -- Timing
    started_at TIMESTAMPTZ DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    
    -- Error handling
    error TEXT,
    retry_count INT DEFAULT 0
);

CREATE INDEX idx_executions_workflow ON workflow_executions(workflow_id);
CREATE INDEX idx_executions_status ON workflow_executions(status);
CREATE INDEX idx_executions_thread ON workflow_executions(thread_id);
CREATE INDEX idx_executions_started ON workflow_executions(started_at DESC);
```

### Agent Executions

```sql
CREATE TABLE agent_executions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workflow_execution_id UUID REFERENCES workflow_executions(id),
    agent_id UUID REFERENCES agents(id),
    
    -- Execution details
    step_name VARCHAR(100) NOT NULL,
    input JSONB,
    output JSONB,
    
    -- Tool calls
    tool_calls JSONB DEFAULT '[]',       -- [{name, input, output, duration}]
    
    -- Status
    status VARCHAR(50) NOT NULL DEFAULT 'pending',
    
    -- Timing
    started_at TIMESTAMPTZ DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    duration_ms INT,
    
    -- Tokens used
    tokens_input INT,
    tokens_output INT,
    
    -- Error
    error TEXT
);

CREATE INDEX idx_agent_exec_workflow ON agent_executions(workflow_execution_id);
CREATE INDEX idx_agent_exec_agent ON agent_executions(agent_id);
CREATE INDEX idx_agent_exec_status ON agent_executions(status);
```

---

## Memory Tables

### Long-term Memory (Vector Store)

```sql
CREATE TABLE memories (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    -- Scoping
    namespace VARCHAR(255) NOT NULL,      -- 'global', 'agent/news', 'symbol/AAPL'
    memory_type VARCHAR(50) NOT NULL,     -- 'semantic', 'episodic', 'procedural'
    
    -- Content
    content TEXT NOT NULL,
    embedding vector(1536),               -- OpenAI ada-002 dimensions
    
    -- Metadata
    metadata JSONB DEFAULT '{}',
    importance FLOAT DEFAULT 0.5,         -- 0-1, affects retrieval ranking
    access_count INT DEFAULT 0,
    
    -- Relationships
    agent_id UUID REFERENCES agents(id),
    user_id UUID,
    workflow_execution_id UUID REFERENCES workflow_executions(id),
    
    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    last_accessed_at TIMESTAMPTZ
);

-- HNSW index for fast similarity search
CREATE INDEX memories_embedding_hnsw_idx 
ON memories USING hnsw (embedding vector_cosine_ops)
WITH (m = 16, ef_construction = 64);

-- Filtering indexes
CREATE INDEX idx_memories_namespace ON memories(namespace);
CREATE INDEX idx_memories_type ON memories(memory_type);
CREATE INDEX idx_memories_agent ON memories(agent_id);
CREATE INDEX idx_memories_importance ON memories(importance DESC);
CREATE INDEX idx_memories_namespace_prefix ON memories(namespace varchar_pattern_ops);
```

### Conversation Messages

```sql
CREATE TABLE conversation_messages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workflow_execution_id UUID REFERENCES workflow_executions(id),
    thread_id VARCHAR(255) NOT NULL,
    
    -- Message content
    role VARCHAR(50) NOT NULL,            -- 'user', 'assistant', 'system', 'tool'
    content TEXT NOT NULL,
    
    -- Source
    agent_id UUID REFERENCES agents(id),
    tool_call_id VARCHAR(255),            -- If tool response
    
    -- Metadata
    metadata JSONB DEFAULT '{}',
    
    -- Timestamp
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_messages_workflow ON conversation_messages(workflow_execution_id, created_at);
CREATE INDEX idx_messages_thread ON conversation_messages(thread_id, created_at);
CREATE INDEX idx_messages_agent ON conversation_messages(agent_id);
```

### Workflow Checkpoints

```sql
CREATE TABLE workflow_checkpoints (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workflow_execution_id UUID REFERENCES workflow_executions(id),
    thread_id VARCHAR(255) NOT NULL,
    
    -- Checkpoint data
    step_name VARCHAR(100) NOT NULL,
    state JSONB NOT NULL,
    
    -- Timestamp
    created_at TIMESTAMPTZ DEFAULT NOW(),
    
    UNIQUE(workflow_execution_id, thread_id, step_name)
);

CREATE INDEX idx_checkpoints_workflow ON workflow_checkpoints(workflow_execution_id);
CREATE INDEX idx_checkpoints_thread ON workflow_checkpoints(thread_id);
```

---

## Market Data Tables

### Market Data Cache

```sql
CREATE TABLE market_data (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    symbol VARCHAR(20) NOT NULL,
    
    -- Price data
    price DECIMAL(15, 4) NOT NULL,
    open_price DECIMAL(15, 4),
    high DECIMAL(15, 4),
    low DECIMAL(15, 4),
    previous_close DECIMAL(15, 4),
    
    -- Change
    change DECIMAL(15, 4),
    change_percent DECIMAL(8, 4),
    
    -- Volume
    volume BIGINT,
    avg_volume BIGINT,
    
    -- Metadata
    market_cap BIGINT,
    pe_ratio DECIMAL(10, 2),
    
    -- Timing
    quote_time TIMESTAMPTZ NOT NULL,
    fetched_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_market_data_symbol ON market_data(symbol);
CREATE INDEX idx_market_data_time ON market_data(quote_time DESC);
CREATE UNIQUE INDEX idx_market_data_symbol_time ON market_data(symbol, quote_time);
```

### Historical OHLCV

```sql
CREATE TABLE historical_data (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    symbol VARCHAR(20) NOT NULL,
    interval VARCHAR(10) NOT NULL,       -- '1m', '5m', '1h', '1d'
    
    -- OHLCV
    timestamp TIMESTAMPTZ NOT NULL,
    open DECIMAL(15, 4) NOT NULL,
    high DECIMAL(15, 4) NOT NULL,
    low DECIMAL(15, 4) NOT NULL,
    close DECIMAL(15, 4) NOT NULL,
    volume BIGINT NOT NULL,
    
    -- Adjusted (for splits/dividends)
    adj_close DECIMAL(15, 4),
    
    UNIQUE(symbol, interval, timestamp)
);

CREATE INDEX idx_historical_symbol ON historical_data(symbol, interval);
CREATE INDEX idx_historical_timestamp ON historical_data(timestamp DESC);
```

### News Articles

```sql
CREATE TABLE news_articles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    external_id VARCHAR(255),            -- ID from source API
    
    -- Content
    headline TEXT NOT NULL,
    summary TEXT,
    content TEXT,
    url TEXT,
    image_url TEXT,
    
    -- Source
    source VARCHAR(100) NOT NULL,
    
    -- Symbols
    symbols TEXT[] DEFAULT '{}',
    
    -- Sentiment (from analysis)
    sentiment_score DECIMAL(4, 3),       -- -1 to +1
    sentiment_label VARCHAR(20),         -- 'bullish', 'bearish', 'neutral'
    
    -- Timing
    published_at TIMESTAMPTZ NOT NULL,
    fetched_at TIMESTAMPTZ DEFAULT NOW(),
    analyzed_at TIMESTAMPTZ
);

CREATE INDEX idx_news_symbols ON news_articles USING GIN(symbols);
CREATE INDEX idx_news_published ON news_articles(published_at DESC);
CREATE INDEX idx_news_source ON news_articles(source);
CREATE INDEX idx_news_sentiment ON news_articles(sentiment_score) WHERE sentiment_score IS NOT NULL;
CREATE UNIQUE INDEX idx_news_external ON news_articles(source, external_id) WHERE external_id IS NOT NULL;
```

### Social Mentions

```sql
CREATE TABLE social_mentions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    external_id VARCHAR(255),
    
    -- Platform
    platform VARCHAR(50) NOT NULL,       -- 'reddit', 'twitter', 'telegram'
    
    -- Content
    content TEXT NOT NULL,
    url TEXT,
    
    -- Engagement
    score INT DEFAULT 0,                 -- Upvotes, likes
    comments INT DEFAULT 0,
    
    -- Symbols
    symbols TEXT[] DEFAULT '{}',
    
    -- Sentiment
    sentiment_score DECIMAL(4, 3),
    
    -- Author (anonymized)
    author_hash VARCHAR(64),
    
    -- Timing
    posted_at TIMESTAMPTZ NOT NULL,
    fetched_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_social_platform ON social_mentions(platform);
CREATE INDEX idx_social_symbols ON social_mentions USING GIN(symbols);
CREATE INDEX idx_social_posted ON social_mentions(posted_at DESC);
```

---

## Trading Tables

### Portfolio

```sql
CREATE TABLE portfolio (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    -- Position
    symbol VARCHAR(20) NOT NULL UNIQUE,
    quantity DECIMAL(15, 6) NOT NULL,
    avg_cost DECIMAL(15, 4) NOT NULL,
    
    -- Current values
    current_price DECIMAL(15, 4),
    market_value DECIMAL(15, 2),
    
    -- P&L
    unrealized_pnl DECIMAL(15, 2),
    unrealized_pnl_percent DECIMAL(8, 4),
    
    -- Metadata
    sector VARCHAR(100),
    first_bought_at TIMESTAMPTZ,
    last_trade_at TIMESTAMPTZ,
    
    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_portfolio_symbol ON portfolio(symbol);
```

### Account

```sql
CREATE TABLE accounts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(100) NOT NULL DEFAULT 'default',
    
    -- Balances
    cash DECIMAL(15, 2) NOT NULL DEFAULT 100000,  -- Starting cash
    total_value DECIMAL(15, 2),
    
    -- P&L
    total_pnl DECIMAL(15, 2) DEFAULT 0,
    total_pnl_percent DECIMAL(8, 4) DEFAULT 0,
    
    -- Settings
    mode VARCHAR(20) DEFAULT 'paper',    -- 'test', 'paper', 'live'
    currency VARCHAR(3) DEFAULT 'USD',
    
    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

### Orders

```sql
CREATE TABLE orders (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    -- Order details
    symbol VARCHAR(20) NOT NULL,
    action VARCHAR(10) NOT NULL,         -- 'buy', 'sell'
    quantity DECIMAL(15, 6) NOT NULL,
    
    -- Order type
    order_type VARCHAR(20) NOT NULL,     -- 'market', 'limit', 'stop', 'stop_limit'
    limit_price DECIMAL(15, 4),
    stop_price DECIMAL(15, 4),
    time_in_force VARCHAR(10) DEFAULT 'day',  -- 'day', 'gtc', 'ioc'
    
    -- Execution
    status VARCHAR(20) NOT NULL DEFAULT 'pending',  -- 'pending', 'filled', 'partial', 'cancelled', 'rejected'
    filled_quantity DECIMAL(15, 6) DEFAULT 0,
    avg_fill_price DECIMAL(15, 4),
    commission DECIMAL(10, 4) DEFAULT 0,
    
    -- Mode
    mode VARCHAR(20) NOT NULL,           -- 'test', 'paper', 'live'
    
    -- Reference
    workflow_execution_id UUID REFERENCES workflow_executions(id),
    decision_id UUID,                    -- Link to trading decision
    
    -- Timing
    created_at TIMESTAMPTZ DEFAULT NOW(),
    filled_at TIMESTAMPTZ,
    cancelled_at TIMESTAMPTZ
);

CREATE INDEX idx_orders_symbol ON orders(symbol);
CREATE INDEX idx_orders_status ON orders(status);
CREATE INDEX idx_orders_created ON orders(created_at DESC);
CREATE INDEX idx_orders_workflow ON orders(workflow_execution_id);
```

### Trading Decisions

```sql
CREATE TABLE trading_decisions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workflow_execution_id UUID REFERENCES workflow_executions(id),
    
    -- Decision
    symbol VARCHAR(20) NOT NULL,
    action VARCHAR(20) NOT NULL,         -- 'buy', 'sell', 'hold', 'short', 'cover'
    quantity DECIMAL(15, 6),
    
    -- Targets
    target_price DECIMAL(15, 4),
    stop_loss DECIMAL(15, 4),
    take_profit DECIMAL(15, 4),
    
    -- Confidence
    confidence DECIMAL(4, 3) NOT NULL,   -- 0 to 1
    
    -- Reasoning
    reasoning TEXT NOT NULL,
    
    -- Input summary
    technical_summary TEXT,
    fundamental_summary TEXT,
    sentiment_summary TEXT,
    
    -- Execution
    executed BOOLEAN DEFAULT false,
    order_id UUID REFERENCES orders(id),
    
    -- Outcome (filled after trade closes)
    outcome_pnl DECIMAL(15, 2),
    outcome_pnl_percent DECIMAL(8, 4),
    outcome_notes TEXT,
    
    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    executed_at TIMESTAMPTZ,
    closed_at TIMESTAMPTZ
);

CREATE INDEX idx_decisions_symbol ON trading_decisions(symbol);
CREATE INDEX idx_decisions_workflow ON trading_decisions(workflow_execution_id);
CREATE INDEX idx_decisions_executed ON trading_decisions(executed);
CREATE INDEX idx_decisions_created ON trading_decisions(created_at DESC);
```

---

## Utility Tables

### MCP Servers

```sql
CREATE TABLE mcp_servers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    url TEXT NOT NULL,
    
    -- Tools provided
    tools JSONB DEFAULT '[]',
    
    -- Status
    enabled BOOLEAN DEFAULT true,
    last_health_check TIMESTAMPTZ,
    health_status VARCHAR(20),
    
    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

### Events

```sql
CREATE TABLE events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    -- Event type
    type VARCHAR(100) NOT NULL,          -- 'workflow.started', 'trade.executed', etc.
    
    -- Payload
    payload JSONB NOT NULL,
    
    -- Source
    source_type VARCHAR(50),             -- 'workflow', 'agent', 'system'
    source_id UUID,
    
    -- Timestamp
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_events_type ON events(type);
CREATE INDEX idx_events_created ON events(created_at DESC);
CREATE INDEX idx_events_source ON events(source_type, source_id);

-- Partition by month for performance
-- CREATE TABLE events_2024_01 PARTITION OF events FOR VALUES FROM ('2024-01-01') TO ('2024-02-01');
```

---

## Views

### Portfolio Summary

```sql
CREATE VIEW portfolio_summary AS
SELECT 
    p.symbol,
    p.quantity,
    p.avg_cost,
    p.current_price,
    p.market_value,
    p.unrealized_pnl,
    p.unrealized_pnl_percent,
    (p.market_value / a.total_value * 100) as portfolio_weight
FROM portfolio p
CROSS JOIN accounts a
WHERE p.quantity > 0
ORDER BY p.market_value DESC;
```

### Recent Decisions

```sql
CREATE VIEW recent_decisions AS
SELECT 
    td.id,
    td.symbol,
    td.action,
    td.confidence,
    td.reasoning,
    td.executed,
    td.outcome_pnl,
    td.created_at,
    we.status as workflow_status
FROM trading_decisions td
LEFT JOIN workflow_executions we ON td.workflow_execution_id = we.id
ORDER BY td.created_at DESC
LIMIT 100;
```

---

## Functions

### Update Portfolio Value

```sql
CREATE OR REPLACE FUNCTION update_portfolio_values()
RETURNS TRIGGER AS $$
BEGIN
    -- Update market value and P&L
    NEW.market_value := NEW.quantity * NEW.current_price;
    NEW.unrealized_pnl := NEW.market_value - (NEW.quantity * NEW.avg_cost);
    NEW.unrealized_pnl_percent := (NEW.unrealized_pnl / (NEW.quantity * NEW.avg_cost)) * 100;
    NEW.updated_at := NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER portfolio_values_trigger
BEFORE UPDATE ON portfolio
FOR EACH ROW
EXECUTE FUNCTION update_portfolio_values();
```

### Memory Similarity Search

```sql
CREATE OR REPLACE FUNCTION search_memories(
    query_embedding vector(1536),
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
        1 - (m.embedding <=> query_embedding) as similarity
    FROM memories m
    WHERE 
        (namespace_filter IS NULL OR m.namespace LIKE namespace_filter || '%')
        AND (type_filter IS NULL OR m.memory_type = type_filter)
        AND 1 - (m.embedding <=> query_embedding) >= min_similarity
    ORDER BY 
        m.embedding <=> query_embedding,
        m.importance DESC
    LIMIT limit_count;
END;
$$ LANGUAGE plpgsql;
```

---

## Indexes Summary

| Table | Index | Type | Purpose |
|-------|-------|------|---------|
| memories | embedding | HNSW | Vector similarity search |
| memories | namespace | B-tree | Filter by scope |
| news_articles | symbols | GIN | Filter by stock |
| social_mentions | symbols | GIN | Filter by stock |
| events | created_at | B-tree | Time-based queries |
| orders | status | B-tree | Active orders lookup |

---

## Next Steps

See [06-ROADMAP.md](./06-ROADMAP.md) for development timeline.
