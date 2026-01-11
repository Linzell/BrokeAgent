# BrokeAgent - Memory System

## Overview

The memory system provides both short-term (conversation/session) and long-term (cross-session) memory using PostgreSQL with pgvector extension.

## Memory Types

### 1. Short-Term Memory (Checkpointer)

**Purpose**: Track conversation state within a single workflow execution.

**Characteristics**:
- Thread-scoped (tied to `workflow_id`)
- Preserves message history
- Enables workflow resumption
- Auto-cleanup after completion

**Storage**: `workflow_checkpoints` table

```sql
CREATE TABLE workflow_checkpoints (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workflow_id UUID NOT NULL,
    thread_id VARCHAR(255) NOT NULL,
    step_name VARCHAR(100) NOT NULL,
    state JSONB NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    
    UNIQUE(workflow_id, thread_id, step_name)
);

CREATE INDEX idx_checkpoints_workflow ON workflow_checkpoints(workflow_id);
CREATE INDEX idx_checkpoints_thread ON workflow_checkpoints(thread_id);
```

**Usage**:
```typescript
// Save checkpoint after each step
await checkpointer.save({
  workflowId: state.workflowId,
  threadId: config.threadId,
  stepName: "research_complete",
  state: state,
});

// Resume from checkpoint
const savedState = await checkpointer.load(workflowId, threadId);
```

---

### 2. Long-Term Memory (Vector Store)

**Purpose**: Store learnings, facts, and experiences across sessions.

**Memory Categories**:

| Type | Description | Example |
|------|-------------|---------|
| `semantic` | Facts, knowledge | "AAPL typically drops after iPhone launches" |
| `episodic` | Past experiences | "Bought NVDA at $450, sold at $520 (+15%)" |
| `procedural` | Rules, strategies | "Never hold through earnings without stops" |

**Storage**: `memories` table with pgvector

```sql
CREATE TABLE memories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- Scoping
    namespace VARCHAR(255) NOT NULL,  -- 'global', 'agent/news', 'user/123'
    memory_type VARCHAR(50) NOT NULL, -- 'semantic', 'episodic', 'procedural'
    
    -- Content
    content TEXT NOT NULL,
    embedding vector(1536),           -- OpenAI ada-002 dimensions
    
    -- Metadata
    metadata JSONB DEFAULT '{}',
    importance FLOAT DEFAULT 0.5,     -- 0-1, affects retrieval ranking
    access_count INT DEFAULT 0,       -- Track usage
    
    -- Relationships
    agent_id UUID REFERENCES agents(id),
    user_id UUID,
    conversation_id UUID,
    
    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    last_accessed_at TIMESTAMPTZ
);

-- Vector similarity search index (HNSW for speed)
CREATE INDEX memories_embedding_hnsw_idx 
ON memories USING hnsw (embedding vector_cosine_ops)
WITH (m = 16, ef_construction = 64);

-- Filtering indexes
CREATE INDEX idx_memories_namespace ON memories(namespace);
CREATE INDEX idx_memories_type ON memories(memory_type);
CREATE INDEX idx_memories_agent ON memories(agent_id);
CREATE INDEX idx_memories_importance ON memories(importance DESC);
```

---

## Memory Namespaces

Hierarchical namespacing for scoped access:

```
memories/
├── global/                          # Shared across all agents
│   ├── market_knowledge             # General market facts
│   └── trading_rules                # Universal trading rules
│
├── agent/{agent_type}/              # Agent-specific learnings
│   ├── news_analyst/
│   │   └── source_reliability       # Which sources are trustworthy
│   ├── technical_analyst/
│   │   └── pattern_accuracy         # Which patterns work
│   └── portfolio_manager/
│       └── decision_outcomes        # Past decision results
│
├── symbol/{symbol}/                 # Stock-specific knowledge
│   ├── AAPL/
│   │   ├── earnings_patterns        # How it reacts to earnings
│   │   └── correlation_notes        # Correlated stocks
│   └── NVDA/
│       └── sector_dynamics          # AI sector insights
│
└── user/{user_id}/                  # User-specific preferences
    └── risk_tolerance               # User's risk preferences
```

---

## Memory Operations

### Store Memory

```typescript
interface MemoryEntry {
  content: string;
  type: "semantic" | "episodic" | "procedural";
  namespace: string;
  metadata?: Record<string, unknown>;
  importance?: number;
  agentId?: string;
}

async function storeMemory(entry: MemoryEntry): Promise<string> {
  // 1. Generate embedding
  const embedding = await embedder.embed(entry.content);
  
  // 2. Check for duplicates (similarity > 0.95)
  const existing = await searchMemories({
    query: entry.content,
    namespace: entry.namespace,
    threshold: 0.95,
    limit: 1,
  });
  
  if (existing.length > 0) {
    // Update existing instead of duplicate
    return updateMemory(existing[0].id, entry);
  }
  
  // 3. Insert new memory
  const result = await db.query(`
    INSERT INTO memories (content, embedding, memory_type, namespace, metadata, importance, agent_id)
    VALUES ($1, $2, $3, $4, $5, $6, $7)
    RETURNING id
  `, [entry.content, embedding, entry.type, entry.namespace, entry.metadata, entry.importance, entry.agentId]);
  
  return result.rows[0].id;
}
```

### Search Memory

```typescript
interface MemorySearchRequest {
  query: string;
  namespace?: string;           // Filter by namespace (supports wildcards)
  type?: MemoryType;
  agentId?: string;
  limit?: number;
  threshold?: number;           // Minimum similarity (0-1)
  includeMetadata?: boolean;
}

interface MemorySearchResult {
  id: string;
  content: string;
  type: MemoryType;
  namespace: string;
  score: number;                // Similarity score
  metadata?: Record<string, unknown>;
}

async function searchMemories(request: MemorySearchRequest): Promise<MemorySearchResult[]> {
  const embedding = await embedder.embed(request.query);
  
  const result = await db.query(`
    SELECT 
      id, content, memory_type, namespace, metadata,
      1 - (embedding <=> $1) as score
    FROM memories
    WHERE 
      ($2::varchar IS NULL OR namespace LIKE $2)
      AND ($3::varchar IS NULL OR memory_type = $3)
      AND ($4::uuid IS NULL OR agent_id = $4)
      AND 1 - (embedding <=> $1) >= $5
    ORDER BY 
      score DESC,
      importance DESC,
      access_count DESC
    LIMIT $6
  `, [
    JSON.stringify(embedding),
    request.namespace?.replace('*', '%'),
    request.type,
    request.agentId,
    request.threshold || 0.7,
    request.limit || 10,
  ]);
  
  // Update access counts
  const ids = result.rows.map(r => r.id);
  await db.query(`
    UPDATE memories 
    SET access_count = access_count + 1, last_accessed_at = NOW()
    WHERE id = ANY($1)
  `, [ids]);
  
  return result.rows;
}
```

### Memory Consolidation

Periodically merge similar memories to reduce noise:

```typescript
async function consolidateMemories(namespace: string): Promise<number> {
  // Find clusters of similar memories
  const clusters = await db.query(`
    WITH similar_pairs AS (
      SELECT 
        m1.id as id1, m2.id as id2,
        1 - (m1.embedding <=> m2.embedding) as similarity
      FROM memories m1
      JOIN memories m2 ON m1.id < m2.id
      WHERE 
        m1.namespace = $1 
        AND m2.namespace = $1
        AND 1 - (m1.embedding <=> m2.embedding) > 0.90
    )
    SELECT * FROM similar_pairs
  `, [namespace]);
  
  let merged = 0;
  for (const pair of clusters.rows) {
    // Merge into single memory with combined content
    await mergeMemories(pair.id1, pair.id2);
    merged++;
  }
  
  return merged;
}
```

---

## Memory Integration with Agents

### Agent Memory Access Pattern

```typescript
class BaseAgent {
  protected memoryStore: MemoryStore;
  protected namespace: string;
  
  constructor(agentType: string) {
    this.namespace = `agent/${agentType}`;
  }
  
  // Retrieve relevant context before processing
  protected async getRelevantMemories(query: string): Promise<string> {
    const memories = await this.memoryStore.search({
      query,
      namespace: `${this.namespace}/*`,  // Agent's memories
      limit: 5,
      threshold: 0.7,
    });
    
    // Also check global knowledge
    const globalMemories = await this.memoryStore.search({
      query,
      namespace: "global/*",
      limit: 3,
      threshold: 0.75,
    });
    
    const allMemories = [...memories, ...globalMemories];
    
    if (allMemories.length === 0) return "";
    
    return `
## Relevant Past Knowledge:
${allMemories.map((m, i) => `${i + 1}. [${m.type}] ${m.content}`).join("\n")}
`;
  }
  
  // Store learnings after processing
  protected async storeLesson(content: string, type: MemoryType, importance: number = 0.5): Promise<void> {
    await this.memoryStore.store({
      content,
      type,
      namespace: this.namespace,
      importance,
      agentId: this.id,
    });
  }
}
```

### Example: Portfolio Manager with Memory

```typescript
class PortfolioManagerAgent extends BaseAgent {
  async makeDecision(inputs: DecisionInputs): Promise<TradingDecision> {
    // 1. Get relevant memories
    const symbolMemories = await this.memoryStore.search({
      query: `Trading ${inputs.symbol}`,
      namespace: `symbol/${inputs.symbol}/*`,
      limit: 5,
    });
    
    const pastDecisions = await this.memoryStore.search({
      query: `Decision for ${inputs.symbol} in ${inputs.marketCondition}`,
      namespace: `${this.namespace}/decisions`,
      type: "episodic",
      limit: 3,
    });
    
    // 2. Include in LLM context
    const context = this.buildContext(inputs, symbolMemories, pastDecisions);
    
    // 3. Make decision
    const decision = await this.llm.invoke(context);
    
    // 4. Store this decision for future reference
    await this.storeLesson(
      `Decided to ${decision.action} ${inputs.symbol} at $${inputs.price}. ` +
      `Reasoning: ${decision.reasoning}. Market: ${inputs.marketCondition}`,
      "episodic",
      0.6
    );
    
    return decision;
  }
  
  // Called after trade closes
  async recordOutcome(decision: TradingDecision, outcome: TradeOutcome): Promise<void> {
    const isSuccess = outcome.pnlPercent > 0;
    
    // Store outcome as episodic memory
    await this.storeLesson(
      `${decision.action} ${decision.symbol}: ${isSuccess ? "SUCCESS" : "FAILURE"} ` +
      `(${outcome.pnlPercent > 0 ? "+" : ""}${outcome.pnlPercent.toFixed(1)}%). ` +
      `Entry: $${outcome.entryPrice}, Exit: $${outcome.exitPrice}. ` +
      `Duration: ${outcome.holdingPeriod}. Reasoning was: ${decision.reasoning}`,
      "episodic",
      isSuccess ? 0.7 : 0.8  // Failures are more important to remember
    );
    
    // Extract and store lesson
    if (!isSuccess && outcome.pnlPercent < -5) {
      await this.storeLesson(
        `LESSON: Avoid ${decision.action} on ${decision.symbol} when ${this.extractConditions(decision)}. ` +
        `Lost ${Math.abs(outcome.pnlPercent).toFixed(1)}%.`,
        "procedural",
        0.9  // High importance for significant losses
      );
    }
  }
}
```

---

## Conversation Memory (Message History)

For tracking conversation within a workflow:

```sql
CREATE TABLE conversation_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workflow_id UUID NOT NULL,
    thread_id VARCHAR(255) NOT NULL,
    role VARCHAR(50) NOT NULL,        -- 'user', 'assistant', 'system', 'tool'
    content TEXT NOT NULL,
    agent_id UUID,                    -- Which agent sent this
    tool_call_id VARCHAR(255),        -- If this is a tool response
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_messages_workflow ON conversation_messages(workflow_id, created_at);
CREATE INDEX idx_messages_thread ON conversation_messages(thread_id, created_at);
```

### Message Window Management

```typescript
class ConversationMemory {
  private maxMessages: number = 20;
  private summaryThreshold: number = 15;
  
  async getMessages(threadId: string): Promise<Message[]> {
    const messages = await db.query(`
      SELECT role, content, agent_id, created_at
      FROM conversation_messages
      WHERE thread_id = $1
      ORDER BY created_at ASC
    `, [threadId]);
    
    return messages.rows;
  }
  
  async addMessage(threadId: string, message: Message): Promise<void> {
    await db.query(`
      INSERT INTO conversation_messages (thread_id, role, content, agent_id, metadata)
      VALUES ($1, $2, $3, $4, $5)
    `, [threadId, message.role, message.content, message.agentId, message.metadata]);
    
    // Check if summarization needed
    await this.maybeSummarize(threadId);
  }
  
  private async maybeSummarize(threadId: string): Promise<void> {
    const count = await this.getMessageCount(threadId);
    
    if (count > this.maxMessages) {
      // Get oldest messages
      const oldMessages = await db.query(`
        SELECT id, role, content FROM conversation_messages
        WHERE thread_id = $1
        ORDER BY created_at ASC
        LIMIT $2
      `, [threadId, this.summaryThreshold]);
      
      // Summarize with LLM
      const summary = await this.llm.invoke({
        messages: [
          { role: "system", content: "Summarize this conversation concisely:" },
          { role: "user", content: oldMessages.rows.map(m => `${m.role}: ${m.content}`).join("\n") }
        ]
      });
      
      // Replace old messages with summary
      await db.query(`DELETE FROM conversation_messages WHERE id = ANY($1)`, 
        [oldMessages.rows.map(m => m.id)]);
      
      await db.query(`
        INSERT INTO conversation_messages (thread_id, role, content, metadata)
        VALUES ($1, 'system', $2, '{"type": "summary"}')
      `, [threadId, `[Previous conversation summary]: ${summary}`]);
    }
  }
}
```

---

## Memory Maintenance

### Decay & Cleanup

```typescript
// Run daily
async function memoryMaintenance(): Promise<void> {
  // 1. Decay importance of old, unused memories
  await db.query(`
    UPDATE memories
    SET importance = importance * 0.99
    WHERE 
      last_accessed_at < NOW() - INTERVAL '30 days'
      AND importance > 0.1
  `);
  
  // 2. Delete low-importance, old memories
  await db.query(`
    DELETE FROM memories
    WHERE 
      importance < 0.1
      AND created_at < NOW() - INTERVAL '90 days'
      AND access_count < 3
  `);
  
  // 3. Consolidate similar memories
  const namespaces = await db.query(`SELECT DISTINCT namespace FROM memories`);
  for (const ns of namespaces.rows) {
    await consolidateMemories(ns.namespace);
  }
}
```

---

## Configuration

```typescript
interface MemoryConfig {
  // Embedding
  embeddingModel: "openai-ada-002" | "cohere-embed" | "local";
  embeddingDimensions: 1536 | 768 | 384;
  
  // Search
  defaultThreshold: number;      // Default similarity threshold
  defaultLimit: number;          // Default result limit
  
  // Maintenance
  decayRate: number;             // Daily importance decay
  cleanupAfterDays: number;      // Delete old low-importance memories
  consolidationThreshold: number; // Similarity for merging
  
  // Limits
  maxMemoriesPerNamespace: number;
  maxConversationMessages: number;
}

const defaultConfig: MemoryConfig = {
  embeddingModel: "openai-ada-002",
  embeddingDimensions: 1536,
  defaultThreshold: 0.7,
  defaultLimit: 10,
  decayRate: 0.99,
  cleanupAfterDays: 90,
  consolidationThreshold: 0.90,
  maxMemoriesPerNamespace: 10000,
  maxConversationMessages: 50,
};
```

---

## Next Steps

See [04-TOOLS.md](./04-TOOLS.md) for tool integration details.
