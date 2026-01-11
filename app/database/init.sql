-- BrokerAgent Database Schema
-- Complete schema for multi-agent trading system

-- ============================================
-- EXTENSIONS
-- ============================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "vector";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- ============================================
-- CORE TABLES
-- ============================================

-- Agents table
CREATE TABLE IF NOT EXISTS agents (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    type VARCHAR(50) NOT NULL,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    system_prompt TEXT,
    config JSONB DEFAULT '{}',
    tools TEXT[] DEFAULT '{}',
    enabled BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agents_type ON agents(type);
CREATE INDEX IF NOT EXISTS idx_agents_enabled ON agents(enabled) WHERE enabled = true;

-- Workflows table
CREATE TABLE IF NOT EXISTS workflows (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    description TEXT,
    trigger_type VARCHAR(50) NOT NULL,
    schedule JSONB,
    entry_agent_id UUID REFERENCES agents(id),
    graph_definition JSONB NOT NULL DEFAULT '{}',
    enabled BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_workflows_enabled ON workflows(enabled) WHERE enabled = true;
CREATE INDEX IF NOT EXISTS idx_workflows_trigger ON workflows(trigger_type);

-- Workflow executions table
CREATE TABLE IF NOT EXISTS workflow_executions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workflow_id UUID REFERENCES workflows(id),
    thread_id VARCHAR(255) NOT NULL,
    trigger_type VARCHAR(50) NOT NULL,
    triggered_by VARCHAR(255),
    input JSONB,
    output JSONB,
    status VARCHAR(50) NOT NULL DEFAULT 'pending',
    current_step VARCHAR(100),
    started_at TIMESTAMPTZ DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    error TEXT,
    retry_count INT DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_executions_workflow ON workflow_executions(workflow_id);
CREATE INDEX IF NOT EXISTS idx_executions_status ON workflow_executions(status);
CREATE INDEX IF NOT EXISTS idx_executions_thread ON workflow_executions(thread_id);
CREATE INDEX IF NOT EXISTS idx_executions_started ON workflow_executions(started_at DESC);

-- Agent executions table
CREATE TABLE IF NOT EXISTS agent_executions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workflow_execution_id UUID REFERENCES workflow_executions(id),
    agent_id UUID REFERENCES agents(id),
    step_name VARCHAR(100) NOT NULL,
    input JSONB,
    output JSONB,
    tool_calls JSONB DEFAULT '[]',
    status VARCHAR(50) NOT NULL DEFAULT 'pending',
    started_at TIMESTAMPTZ DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    duration_ms INT,
    tokens_input INT,
    tokens_output INT,
    error TEXT
);

CREATE INDEX IF NOT EXISTS idx_agent_exec_workflow ON agent_executions(workflow_execution_id);
CREATE INDEX IF NOT EXISTS idx_agent_exec_agent ON agent_executions(agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_exec_status ON agent_executions(status);

-- ============================================
-- MEMORY TABLES
-- ============================================

-- Long-term memory with vector embeddings
CREATE TABLE IF NOT EXISTS memories (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    namespace VARCHAR(255) NOT NULL,
    memory_type VARCHAR(50) NOT NULL,
    content TEXT NOT NULL,
    embedding vector(1536),
    metadata JSONB DEFAULT '{}',
    importance FLOAT DEFAULT 0.5,
    access_count INT DEFAULT 0,
    agent_id UUID REFERENCES agents(id),
    user_id UUID,
    workflow_execution_id UUID REFERENCES workflow_executions(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    last_accessed_at TIMESTAMPTZ
);

-- HNSW index for fast similarity search
CREATE INDEX IF NOT EXISTS memories_embedding_hnsw_idx
ON memories USING hnsw (embedding vector_cosine_ops)
WITH (m = 16, ef_construction = 64);

CREATE INDEX IF NOT EXISTS idx_memories_namespace ON memories(namespace);
CREATE INDEX IF NOT EXISTS idx_memories_type ON memories(memory_type);
CREATE INDEX IF NOT EXISTS idx_memories_agent ON memories(agent_id);
CREATE INDEX IF NOT EXISTS idx_memories_importance ON memories(importance DESC);
CREATE INDEX IF NOT EXISTS idx_memories_namespace_prefix ON memories(namespace varchar_pattern_ops);

-- Conversation messages
CREATE TABLE IF NOT EXISTS conversation_messages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workflow_execution_id UUID REFERENCES workflow_executions(id),
    thread_id VARCHAR(255) NOT NULL,
    role VARCHAR(50) NOT NULL,
    content TEXT NOT NULL,
    agent_id UUID REFERENCES agents(id),
    tool_call_id VARCHAR(255),
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_messages_workflow ON conversation_messages(workflow_execution_id, created_at);
CREATE INDEX IF NOT EXISTS idx_messages_thread ON conversation_messages(thread_id, created_at);
CREATE INDEX IF NOT EXISTS idx_messages_agent ON conversation_messages(agent_id);

-- Workflow checkpoints
CREATE TABLE IF NOT EXISTS workflow_checkpoints (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workflow_execution_id UUID REFERENCES workflow_executions(id),
    thread_id VARCHAR(255) NOT NULL,
    step_name VARCHAR(100) NOT NULL,
    state JSONB NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(workflow_execution_id, thread_id, step_name)
);

CREATE INDEX IF NOT EXISTS idx_checkpoints_workflow ON workflow_checkpoints(workflow_execution_id);
CREATE INDEX IF NOT EXISTS idx_checkpoints_thread ON workflow_checkpoints(thread_id);

-- ============================================
-- MARKET DATA TABLES
-- ============================================

-- Real-time market data cache
CREATE TABLE IF NOT EXISTS market_data (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    symbol VARCHAR(20) NOT NULL,
    price DECIMAL(15, 4) NOT NULL,
    open_price DECIMAL(15, 4),
    high DECIMAL(15, 4),
    low DECIMAL(15, 4),
    previous_close DECIMAL(15, 4),
    change DECIMAL(15, 4),
    change_percent DECIMAL(8, 4),
    volume BIGINT,
    avg_volume BIGINT,
    market_cap BIGINT,
    pe_ratio DECIMAL(10, 2),
    quote_time TIMESTAMPTZ NOT NULL,
    fetched_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_market_data_symbol ON market_data(symbol);
CREATE INDEX IF NOT EXISTS idx_market_data_time ON market_data(quote_time DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_market_data_symbol_time ON market_data(symbol, quote_time);

-- Historical OHLCV data
CREATE TABLE IF NOT EXISTS historical_data (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    symbol VARCHAR(20) NOT NULL,
    interval VARCHAR(10) NOT NULL,
    timestamp TIMESTAMPTZ NOT NULL,
    open DECIMAL(15, 4) NOT NULL,
    high DECIMAL(15, 4) NOT NULL,
    low DECIMAL(15, 4) NOT NULL,
    close DECIMAL(15, 4) NOT NULL,
    volume BIGINT NOT NULL,
    adj_close DECIMAL(15, 4),
    UNIQUE(symbol, interval, timestamp)
);

CREATE INDEX IF NOT EXISTS idx_historical_symbol ON historical_data(symbol, interval);
CREATE INDEX IF NOT EXISTS idx_historical_timestamp ON historical_data(timestamp DESC);

-- News articles
CREATE TABLE IF NOT EXISTS news_articles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    external_id VARCHAR(255),
    headline TEXT NOT NULL,
    summary TEXT,
    content TEXT,
    url TEXT,
    image_url TEXT,
    source VARCHAR(100) NOT NULL,
    symbols TEXT[] DEFAULT '{}',
    sentiment_score DECIMAL(4, 3),
    sentiment_label VARCHAR(20),
    published_at TIMESTAMPTZ NOT NULL,
    fetched_at TIMESTAMPTZ DEFAULT NOW(),
    analyzed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_news_symbols ON news_articles USING GIN(symbols);
CREATE INDEX IF NOT EXISTS idx_news_published ON news_articles(published_at DESC);
CREATE INDEX IF NOT EXISTS idx_news_source ON news_articles(source);
CREATE INDEX IF NOT EXISTS idx_news_sentiment ON news_articles(sentiment_score) WHERE sentiment_score IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_news_external ON news_articles(source, external_id) WHERE external_id IS NOT NULL;

-- Social media mentions
CREATE TABLE IF NOT EXISTS social_mentions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    external_id VARCHAR(255),
    platform VARCHAR(50) NOT NULL,
    content TEXT NOT NULL,
    url TEXT,
    score INT DEFAULT 0,
    comments INT DEFAULT 0,
    symbols TEXT[] DEFAULT '{}',
    sentiment_score DECIMAL(4, 3),
    author_hash VARCHAR(64),
    posted_at TIMESTAMPTZ NOT NULL,
    fetched_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_social_platform ON social_mentions(platform);
CREATE INDEX IF NOT EXISTS idx_social_symbols ON social_mentions USING GIN(symbols);
CREATE INDEX IF NOT EXISTS idx_social_posted ON social_mentions(posted_at DESC);

-- ============================================
-- TRADING TABLES
-- ============================================

-- Account
CREATE TABLE IF NOT EXISTS accounts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(100) NOT NULL DEFAULT 'default',
    cash DECIMAL(15, 2) NOT NULL DEFAULT 100000,
    total_value DECIMAL(15, 2),
    total_pnl DECIMAL(15, 2) DEFAULT 0,
    total_pnl_percent DECIMAL(8, 4) DEFAULT 0,
    mode VARCHAR(20) DEFAULT 'paper',
    currency VARCHAR(3) DEFAULT 'USD',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Portfolio positions
CREATE TABLE IF NOT EXISTS portfolio (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    symbol VARCHAR(20) NOT NULL UNIQUE,
    quantity DECIMAL(15, 6) NOT NULL,
    avg_cost DECIMAL(15, 4) NOT NULL,
    current_price DECIMAL(15, 4),
    market_value DECIMAL(15, 2),
    unrealized_pnl DECIMAL(15, 2),
    unrealized_pnl_percent DECIMAL(8, 4),
    sector VARCHAR(100),
    first_bought_at TIMESTAMPTZ,
    last_trade_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_portfolio_symbol ON portfolio(symbol);

-- Orders
CREATE TABLE IF NOT EXISTS orders (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    symbol VARCHAR(20) NOT NULL,
    action VARCHAR(10) NOT NULL,
    quantity DECIMAL(15, 6) NOT NULL,
    order_type VARCHAR(20) NOT NULL,
    limit_price DECIMAL(15, 4),
    stop_price DECIMAL(15, 4),
    time_in_force VARCHAR(10) DEFAULT 'day',
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    filled_quantity DECIMAL(15, 6) DEFAULT 0,
    avg_fill_price DECIMAL(15, 4),
    commission DECIMAL(10, 4) DEFAULT 0,
    mode VARCHAR(20) NOT NULL,
    workflow_execution_id UUID REFERENCES workflow_executions(id),
    decision_id UUID,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    filled_at TIMESTAMPTZ,
    cancelled_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_orders_symbol ON orders(symbol);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_created ON orders(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_workflow ON orders(workflow_execution_id);

-- Trading decisions
CREATE TABLE IF NOT EXISTS trading_decisions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workflow_execution_id UUID REFERENCES workflow_executions(id),
    symbol VARCHAR(20) NOT NULL,
    action VARCHAR(20) NOT NULL,
    quantity DECIMAL(15, 6),
    target_price DECIMAL(15, 4),
    stop_loss DECIMAL(15, 4),
    take_profit DECIMAL(15, 4),
    confidence DECIMAL(4, 3) NOT NULL,
    reasoning TEXT NOT NULL,
    technical_summary TEXT,
    fundamental_summary TEXT,
    sentiment_summary TEXT,
    executed BOOLEAN DEFAULT false,
    order_id UUID REFERENCES orders(id),
    outcome_pnl DECIMAL(15, 2),
    outcome_pnl_percent DECIMAL(8, 4),
    outcome_notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    executed_at TIMESTAMPTZ,
    closed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_decisions_symbol ON trading_decisions(symbol);
CREATE INDEX IF NOT EXISTS idx_decisions_workflow ON trading_decisions(workflow_execution_id);
CREATE INDEX IF NOT EXISTS idx_decisions_executed ON trading_decisions(executed);
CREATE INDEX IF NOT EXISTS idx_decisions_created ON trading_decisions(created_at DESC);

-- ============================================
-- UTILITY TABLES
-- ============================================

-- MCP Servers
CREATE TABLE IF NOT EXISTS mcp_servers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    url TEXT NOT NULL,
    tools JSONB DEFAULT '[]',
    enabled BOOLEAN DEFAULT true,
    last_health_check TIMESTAMPTZ,
    health_status VARCHAR(20),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Events log
CREATE TABLE IF NOT EXISTS events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    type VARCHAR(100) NOT NULL,
    payload JSONB NOT NULL,
    source_type VARCHAR(50),
    source_id UUID,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_events_type ON events(type);
CREATE INDEX IF NOT EXISTS idx_events_created ON events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_source ON events(source_type, source_id);

-- ============================================
-- FUNCTIONS
-- ============================================

-- Update portfolio values trigger function
CREATE OR REPLACE FUNCTION update_portfolio_values()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.current_price IS NOT NULL AND NEW.quantity > 0 THEN
        NEW.market_value := NEW.quantity * NEW.current_price;
        NEW.unrealized_pnl := NEW.market_value - (NEW.quantity * NEW.avg_cost);
        NEW.unrealized_pnl_percent := (NEW.unrealized_pnl / (NEW.quantity * NEW.avg_cost)) * 100;
    END IF;
    NEW.updated_at := NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for portfolio updates
DROP TRIGGER IF EXISTS portfolio_values_trigger ON portfolio;
CREATE TRIGGER portfolio_values_trigger
BEFORE UPDATE ON portfolio
FOR EACH ROW
EXECUTE FUNCTION update_portfolio_values();

-- Memory similarity search function
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

-- Update timestamps function
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at := NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply updated_at triggers to relevant tables
DROP TRIGGER IF EXISTS agents_updated_at ON agents;
CREATE TRIGGER agents_updated_at BEFORE UPDATE ON agents FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS workflows_updated_at ON workflows;
CREATE TRIGGER workflows_updated_at BEFORE UPDATE ON workflows FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS memories_updated_at ON memories;
CREATE TRIGGER memories_updated_at BEFORE UPDATE ON memories FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS accounts_updated_at ON accounts;
CREATE TRIGGER accounts_updated_at BEFORE UPDATE ON accounts FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS mcp_servers_updated_at ON mcp_servers;
CREATE TRIGGER mcp_servers_updated_at BEFORE UPDATE ON mcp_servers FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================
-- VIEWS
-- ============================================

-- Portfolio summary view
CREATE OR REPLACE VIEW portfolio_summary AS
SELECT
    p.symbol,
    p.quantity,
    p.avg_cost,
    p.current_price,
    p.market_value,
    p.unrealized_pnl,
    p.unrealized_pnl_percent,
    CASE WHEN a.total_value > 0 THEN (p.market_value / a.total_value * 100) ELSE 0 END as portfolio_weight
FROM portfolio p
CROSS JOIN accounts a
WHERE p.quantity > 0
ORDER BY p.market_value DESC;

-- Recent decisions view
CREATE OR REPLACE VIEW recent_decisions AS
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

-- ============================================
-- SEED DATA
-- ============================================

-- Create default account if not exists
INSERT INTO accounts (name, cash, mode)
SELECT 'default', 100000, 'paper'
WHERE NOT EXISTS (SELECT 1 FROM accounts WHERE name = 'default');

-- Create base agents
INSERT INTO agents (type, name, description, system_prompt) VALUES
('orchestrator', 'Orchestrator', 'Central supervisor that routes tasks to appropriate agents', 'You are a supervisor managing a team of trading agents. Route tasks to the most appropriate team.'),
('news_analyst', 'News Analyst', 'Fetches and analyzes financial news', 'You are an expert financial news analyst. Analyze news for trading signals.'),
('social_analyst', 'Social Analyst', 'Monitors social media sentiment', 'You are a social media sentiment analyst for financial markets.'),
('market_data_agent', 'Market Data Agent', 'Fetches real-time market data', 'You fetch and process real-time market data.'),
('technical_analyst', 'Technical Analyst', 'Analyzes price charts and indicators', 'You are a technical analysis expert. Analyze charts and indicators.'),
('fundamental_analyst', 'Fundamental Analyst', 'Analyzes company financials', 'You are a fundamental analysis expert. Analyze company financials and valuations.'),
('sentiment_analyst', 'Sentiment Analyst', 'Aggregates sentiment from all sources', 'You aggregate and score sentiment from news and social media.'),
('portfolio_manager', 'Portfolio Manager', 'Makes final trading decisions', 'You are the portfolio manager. Make final buy/sell/hold decisions.'),
('risk_manager', 'Risk Manager', 'Assesses and limits portfolio risk', 'You are the risk manager. Assess position sizes and portfolio risk.')
ON CONFLICT DO NOTHING;
