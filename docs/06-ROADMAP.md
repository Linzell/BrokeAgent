# BrokeAgent - Development Roadmap

## Project Vision

Build a production-ready AI trading simulation system using multi-agent orchestration with LangGraph-style patterns, long-term memory, and comprehensive tool integration.

---

## Phase 1: Foundation (Week 1-2)

### Goals
- Core infrastructure setup
- Basic agent framework
- Database schema implementation

### Tasks

#### 1.1 Project Structure
- [x] Initialize monorepo structure
- [x] Setup shared schemas (Zod)
- [x] Configure TypeScript, ESLint, Prettier
- [x] Setup testing framework (Vitest)
- [x] Configure Docker Compose

#### 1.2 Database Setup
- [x] PostgreSQL + pgvector extension
- [x] Complete database schema (from 05-DATABASE.md)
- [x] Database migrations system
- [ ] Seed data for development
- [x] Database connection pooling

#### 1.3 Core Agent Framework
- [x] BaseAgent class implementation
- [x] StateGraph implementation (TypeScript port of LangGraph concepts)
- [x] Command pattern for agent routing
- [x] Agent registry and factory
- [x] Error handling and retry logic

#### 1.4 Memory System (Basic)
- [x] MemoryStore class
- [x] Embedding generation (OpenAI ada-002)
- [x] Vector similarity search
- [x] Conversation message storage
- [x] Checkpoint system for workflow state

### Deliverables
- Working database with all tables
- Basic agent that can execute and store results
- Memory storage and retrieval working

---

## Phase 2: Research Team (Week 3-4)

### Goals
- Implement data collection agents
- Integrate external APIs
- Build caching layer

### Tasks

#### 2.1 News Agent
- [x] FinnHub news integration
- [ ] Google News RSS parsing
- [x] News article storage
- [x] Deduplication logic
- [x] Basic sentiment extraction

#### 2.2 Social Agent
- [x] Reddit API integration (r/wallstreetbets, r/stocks)
- [ ] Twitter/X API integration (optional - requires API access)
- [x] Symbol mention extraction
- [x] Engagement metrics collection

#### 2.3 Market Data Agent
- [x] Yahoo Finance integration
- [x] Real-time quotes
- [x] Historical OHLCV data
- [x] Data caching (Redis)
- [x] Rate limiting

#### 2.4 Research Team Orchestration
- [x] Research team subgraph
- [x] Parallel agent execution
- [x] Result aggregation
- [x] Error handling per agent

### Deliverables
- [x] News feed updating automatically
- [x] Social sentiment collection working
- [x] Market data available in database
- [x] Research team can run as a unit

---

## Phase 3: Analysis Team (Week 5-6) ✅ COMPLETE

### Goals
- Implement analysis agents
- LLM integration for reasoning
- Technical indicator calculations

### Tasks

#### 3.1 Technical Analyst
- [x] Technical indicator calculations (SMA, EMA, RSI, MACD, Bollinger)
- [x] Pattern recognition prompts
- [x] Support/resistance detection
- [x] Trend analysis
- [x] Signal generation

#### 3.2 Fundamental Analyst
- [x] Company profile fetching (FinnHub)
- [x] Financial metrics calculation
- [x] Valuation assessment (P/E, P/B, EV/EBITDA)
- [x] Quality assessment (ROE, margins, debt)
- [x] Analyst recommendations aggregation

#### 3.3 Sentiment Analyst
- [x] Aggregate news sentiment
- [x] Aggregate social sentiment
- [x] Sentiment scoring model
- [x] Trend detection (trending symbols)
- [x] Key driver identification

#### 3.4 Analysis Team
- [x] Analysis team subgraph (parallel execution)
- [x] Combined rating calculation
- [x] Result aggregation
- [x] Error handling per agent
- [x] Tests for all agents (36 tests)

### Deliverables
- [x] Complete analysis pipeline
- [x] Technical signals generated
- [x] Sentiment scores computed
- [x] Fundamental ratings provided
- [x] Analysis stored in memory
- [x] 119 total tests passing

---

## Phase 4: Decision Team (Week 7-8) ✅ COMPLETE

### Goals
- Trading decision logic
- Risk management
- Paper trading execution

### Tasks

#### 4.1 Portfolio Manager
- [x] Decision synthesis from all inputs
- [x] Opportunity ranking
- [x] Position recommendation
- [x] Confidence scoring
- [x] Reasoning generation

#### 4.2 Risk Manager
- [x] Position sizing calculation
- [x] Portfolio exposure limits
- [x] Stop-loss recommendations
- [x] Risk/reward analysis
- [ ] Correlation checking (future enhancement)

#### 4.3 Order Executor
- [x] Paper trading simulation
- [x] Order validation
- [x] Portfolio updates
- [x] Transaction logging
- [x] P&L tracking

#### 4.4 Decision Learning
- [x] Outcome recording (memory storage)
- [x] Decision evaluation (risk scoring)
- [x] Memory storage of lessons
- [ ] Pattern recognition from history (future enhancement)

### Deliverables
- [x] Complete trading workflow end-to-end
- [x] Paper trading functional
- [x] Decisions logged with reasoning
- [x] Basic learning from outcomes
- [x] 59 tests for decision agents (178 total tests)

---

## Phase 5: Orchestration (Week 9-10) ✅ MOSTLY COMPLETE

### Goals
- Supervisor agent
- Complete workflow execution
- Scheduling system

### Tasks

#### 5.1 Enhanced Executor
- [x] Retry logic with exponential backoff
- [x] Error recovery strategies (skip/retry/fallback/abort)
- [x] Node-level timeout handling
- [x] Integration with CompiledGraph
- [x] 18 executor tests

#### 5.2 Checkpoint System
- [x] Enhanced Checkpointer service
- [x] Checkpoint metadata (timing, retries, warnings)
- [x] Query/filter checkpoints
- [x] Cleanup old checkpoints
- [x] Execution history with timing
- [x] 17 checkpointer tests

#### 5.3 Workflow Scheduling
- [x] Cron-based scheduling (croner)
- [x] Interval triggers
- [x] Event-triggered workflows
- [x] Concurrency control (per-schedule and global)
- [x] Retry on failure option
- [x] Database persistence

#### 5.4 Workflow Queue
- [x] Priority queue (critical/high/normal/low)
- [x] Concurrent job processing
- [x] Job retry with backoff
- [x] Stall detection
- [x] Database persistence
- [x] Event emitter for job lifecycle

#### 5.5 Ollama/Local LLM Integration ✅ NEW
- [x] Install `@langchain/ollama` package
- [x] Update `OllamaEmbeddingProvider` to use LangChain
- [x] Create `LLMProvider` abstraction (Ollama, OpenAI, Mock)
- [x] Auto-detection logic (OpenAI -> Ollama -> Mock)
- [x] Async Ollama availability detection
- [x] Environment variable configuration

#### 5.6 Testing & Validation
- [x] Unit tests for executor
- [x] Unit tests for checkpointer
- [x] Integration tests for workflows (21 tests)
- [x] Backtesting framework (27 tests)
- [ ] Performance benchmarks

### Deliverables
- [x] Full orchestrated workflows with retry/recovery
- [x] Scheduled execution working
- [x] Job queue for concurrent execution
- [x] Ollama integration for local development
- [x] Backtesting framework functional
- [x] 261 total tests passing
- [ ] Performance benchmarks (pending)

---

## Phase 6: Frontend & API (Week 11-12) ✅ MOSTLY COMPLETE

### Goals
- REST/WebSocket API
- React dashboard
- Real-time monitoring

### Tasks

#### 6.1 Backend API
- [x] REST endpoints (Elysia) - already existed
- [x] OpenAPI documentation (`@elysiajs/openapi`)
- [x] WebSocket for real-time updates
- [ ] Authentication (optional - future)
- [x] Rate limiting (per-endpoint with configurable limits)
- [x] API documentation (Scalar UI at /openapi)

#### 6.2 Dashboard
- [x] Astro + React integration (`@astrojs/react`)
- [x] shadcn-style UI components (Card, Button, Badge, Table, Skeleton)
- [x] Portfolio overview with positions table
- [x] Workflows status with execution history
- [x] Decisions list with confidence indicators
- [x] API client (`src/lib/api.ts`)
- [x] P&L charts (Recharts - realized vs unrealized P&L)
- [x] Execution graph visualization (React Flow)

#### 6.3 Configuration UI
- [x] Agent management (view agents by team, details panel)
- [ ] Workflow builder (basic)
- [ ] API key management
- [x] Trading mode toggle (TradingModeToggle component)

#### 6.4 Monitoring
- [x] Real-time workflow status (WebSocket LiveStatus component)
- [x] Active workflows tracking with live updates
- [x] Recent events log
- [x] System health display (database, memory, WebSocket)
- [x] Error notifications (toast/alerts - Sonner integration)
- [x] Performance metrics (PerformanceMetrics component)
- [x] Memory usage visualization (MemoryExplorer component)

#### 6.5 Settings Page
- [x] Settings page (`/settings`)
- [x] Agent configuration display
- [x] Live system status sidebar

### Deliverables
- [x] Functional web dashboard (http://localhost:4321)
- [x] API documented (http://localhost:3050/openapi)
- [x] WebSocket real-time updates working
- [x] Settings page with agent management
- [x] P&L performance chart
- [ ] Basic workflow builder (pending)

### Current Progress
- **261 tests passing**
- Frontend builds successfully
- OpenAPI with Scalar UI available
- WebSocket endpoint at ws://localhost:3050/ws
- Real-time monitoring functional

---

## Phase 7: Advanced Features (Week 13-16)

### Goals
- Advanced memory
- Multi-model support
- Production hardening

### Tasks

#### 7.1 Advanced Memory ✅ COMPLETE
- [x] Memory consolidation (finds similar memories via pgvector, merges duplicates)
- [x] Importance decay (decayImportance() with configurable factor and age threshold)
- [x] Cross-agent learning (shareLesson(), promoteToGlobal(), findShareableMemories())
- [x] Memory visualization (stats via getStats(), MemoryExplorer component in frontend)
- [x] Export/import (exportMemories(), importMemories() with optional embeddings)
- [x] Maintenance job (runMaintenance() combines all maintenance tasks)

#### 7.2 Multi-Model Support ✅ COMPLETE
- [x] LLM Provider abstraction (OllamaLLMProvider, OpenAILLMProvider, OpenRouterLLMProvider)
- [x] Model listing API (listOllamaModels, listOpenRouterModels, listModels)
- [x] Provider availability detection (getAvailableProviders)
- [x] Runtime provider/model switching (LLMProviderManager.setProvider)
- [x] REST API endpoints for LLM management:
  - GET /api/llm/providers - List available providers
  - GET /api/llm/models - List available models
  - GET /api/llm/config - Get current configuration
  - POST /api/llm/config - Switch provider/model
- [x] Model comparison mode (compareModels function + POST /api/llm/compare)
- [x] Consensus voting (consensusVote, tradingConsensus functions)
  - POST /api/llm/consensus - Generic consensus voting
  - POST /api/llm/trading-consensus - BUY/HOLD/SELL trading decisions
- [x] Model-specific prompts:
  - detectModelFamily() - Detect model family (claude/gpt/llama/mistral/etc)
  - getModelOptimizations() - Get per-family prompt optimizations
  - optimizePromptForModel() - Apply optimizations to messages
  - Prompt template registry with model-specific variants
  - GET /api/llm/prompts - List prompt templates
  - POST /api/llm/prompts/render - Render template for model
  - POST /api/llm/optimize - Optimize messages for model
- [x] A/B testing framework:
  - createABTest(), getABTest(), listABTests() - Test management
  - selectVariant() - Weighted random variant selection
  - recordABTestResult() - Track test results
  - getABTestSummary() - Statistics and winner determination
  - runABTest() - Execute request through test
  - createModelComparisonTest() - Quick setup helper
  - REST API endpoints:
    - GET /api/llm/ab-tests - List tests
    - POST /api/llm/ab-tests - Create test
    - POST /api/llm/ab-tests/quick - Quick model comparison
    - GET /api/llm/ab-tests/:id - Get test details
    - GET /api/llm/ab-tests/:id/summary - Get statistics
    - PATCH /api/llm/ab-tests/:id - Update status
    - DELETE /api/llm/ab-tests/:id - Delete test
    - POST /api/llm/ab-tests/:id/run - Run request through test
- [x] Smart Auto-Select with Fallback:
  - Model health tracking (available, rate-limited, errors, cooldowns)
  - Performance tracking (latency, success rate, tokens, consensus wins)
  - smartChat() - Auto-fallback on rate limit/error
  - smartChatAuto() - Auto-detect available models from environment
  - Ranking strategies: performance, latency, cost, balanced
  - Automatic cooldown on rate limits (60s) and credits exhausted (1hr)
  - Extended cooldown after consecutive failures
  - REST API endpoints:
    - GET /api/llm/smart/health - View all model health/performance
    - GET /api/llm/smart/candidates - List auto-detected candidates
    - POST /api/llm/smart/chat - Smart chat with auto-fallback
    - POST /api/llm/smart/reset/:provider/:model - Reset model health
    - DELETE /api/llm/smart/stats - Clear all statistics

#### 7.3 Bull/Bear Debate ✅ COMPLETE
- [x] Bull researcher agent (BullResearcherAgent class with thesis generation)
- [x] Bear researcher agent (BearResearcherAgent class with risk identification)
- [x] Debate orchestration (DebateTeam runs Bull/Bear in parallel)
- [x] Synthesis logic (LLM-based synthesis with rule-based fallback)
- [x] Debate state schema added to TradingState

#### 7.4 Production Hardening ✅ MOSTLY COMPLETE
- [ ] Error monitoring (Sentry) - future enhancement
- [x] Logging aggregation (console-based, structured logging)
- [ ] Database backups - infrastructure task
- [x] Health checks (detailed health, readiness probe, liveness probe)
- [x] Graceful shutdown (30s timeout, memory maintenance, connection cleanup)
- [x] Rate limiting (per-endpoint with configurable limits)
- [x] WebSocket client tracking

### Deliverables
- [x] Advanced memory system with consolidation and learning
- [x] Multi-model infrastructure (provider switching, model listing, API endpoints)
- [ ] Multi-model analysis features (comparison, consensus, A/B testing)
- [x] Debate mechanism working (Bull/Bear agents + DebateTeam)
- [x] Health monitoring in place (detailed endpoints + graceful shutdown)

---

## Future Enhancements

### Live Trading (Phase 8+)
- Interactive Brokers integration
- Real money safeguards
- Compliance logging
- Emergency stop

### Advanced Analysis
- Options analysis
- Crypto support
- International markets
- Alternative data sources

### ML Integration
- Custom sentiment models
- Price prediction models
- Reinforcement learning
- Model training pipeline

---

## Technical Debt & Maintenance

### Ongoing
- [ ] Keep dependencies updated
- [ ] Refactor as patterns emerge
- [ ] Improve test coverage
- [ ] Performance optimization
- [ ] Documentation updates

### Monthly
- [ ] Security audit
- [ ] Database optimization
- [ ] Memory cleanup
- [ ] Log rotation

---

## Success Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| Workflow completion | > 95% | Successful executions / Total |
| Decision accuracy | > 60% | Profitable decisions / Total |
| Latency | < 30s | End-to-end workflow time |
| Uptime | > 99% | System availability |
| Memory relevance | > 0.7 | Average retrieval score |

---

## Team & Resources

### Required Skills
- TypeScript/Node.js
- PostgreSQL
- LLM prompting
- Financial markets basics

### External Services
- OpenAI/OpenRouter API (optional if using Ollama)
- Ollama (local LLM - recommended for development)
- FinnHub API
- Tavily API
- Reddit API (optional)

### Infrastructure
- PostgreSQL server
- Redis (caching)
- Node.js runtime (Bun)
- Docker

---

## Getting Started

```bash
# Clone and setup
cd BrokeAgent
bun install

# Start services
docker-compose up -d

# Run migrations
bun run db:migrate

# (Optional) Setup Ollama for local LLM
# Install from https://ollama.ai then:
ollama pull llama3.2
ollama pull nomic-embed-text

# Configure environment
cp app/.env.example app/.env
# Edit app/.env with your API keys (or use Ollama defaults)

# Start development
bun run dev

# Run tests
bun test
```

---

## Document References

| Document | Content |
|----------|---------|
| [01-ARCHITECTURE.md](./01-ARCHITECTURE.md) | System architecture overview |
| [02-AGENTS.md](./02-AGENTS.md) | Agent specifications |
| [03-MEMORY.md](./03-MEMORY.md) | Memory system design |
| [04-TOOLS.md](./04-TOOLS.md) | Tools and integrations |
| [05-DATABASE.md](./05-DATABASE.md) | Database schema |
| [06-ROADMAP.md](./06-ROADMAP.md) | This roadmap |
