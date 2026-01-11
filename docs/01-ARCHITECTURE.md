# BrokeAgent Architecture

## Overview

BrokeAgent is an AI-powered trading simulation system using LangGraph-style multi-agent orchestration. The system analyzes market data, news, and social sentiment to make informed trading decisions.

## Core Principles

1. **Multi-Agent Orchestration** - Supervisor pattern routes tasks to specialized agents
2. **Long-term Memory** - Agents learn from past decisions using pgvector
3. **Parallel Processing** - Research agents run concurrently for efficiency
4. **Tool Integration** - Agents have access to APIs, databases, and external services

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                              FRONTEND                                    │
│                         (Astro + React)                                  │
│                    Dashboard / Monitoring / Config                       │
└────────────────────────────────┬────────────────────────────────────────┘
                                 │ REST/WebSocket
                                 ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                              BACKEND                                     │
│                          (Elysia + Bun)                                  │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │                      ORCHESTRATOR (Supervisor)                     │  │
│  │         Routes tasks to agents, manages workflow state             │  │
│  └───────────────────────────┬───────────────────────────────────────┘  │
│                              │                                           │
│         ┌────────────────────┼────────────────────┐                     │
│         ▼                    ▼                    ▼                     │
│  ┌─────────────┐    ┌────────────────┐    ┌───────────────┐            │
│  │  RESEARCH   │    │    ANALYSIS    │    │   DECISION    │            │
│  │    TEAM     │    │      TEAM      │    │     TEAM      │            │
│  ├─────────────┤    ├────────────────┤    ├───────────────┤            │
│  │ News Agent  │    │ Technical      │    │ Portfolio Mgr │            │
│  │ Social Agent│    │ Fundamental    │    │ Risk Manager  │            │
│  │ Market Data │    │ Sentiment      │    │ Order Exec    │            │
│  └─────────────┘    └────────────────┘    └───────────────┘            │
│         │                    │                    │                     │
│         └────────────────────┼────────────────────┘                     │
│                              ▼                                           │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │                        MEMORY LAYER                                │  │
│  │  ┌─────────────┐  ┌─────────────────┐  ┌────────────────────┐     │  │
│  │  │ Short-term  │  │   Long-term     │  │   Shared Store     │     │  │
│  │  │(Checkpoint) │  │  (pgvector)     │  │ (Agent Learning)   │     │  │
│  │  └─────────────┘  └─────────────────┘  └────────────────────┘     │  │
│  └───────────────────────────────────────────────────────────────────┘  │
└────────────────────────────────┬────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                            DATA LAYER                                    │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────────┐     │
│  │   PostgreSQL    │  │     Redis       │  │   External APIs     │     │
│  │   + pgvector    │  │    (Cache)      │  │ (News/Market/Social)│     │
│  └─────────────────┘  └─────────────────┘  └─────────────────────┘     │
└─────────────────────────────────────────────────────────────────────────┘
```

## Workflow Execution

### StateGraph Pattern

Inspired by LangGraph, we use a graph-based workflow where:

1. **State** - Shared data structure passed between nodes
2. **Nodes** - Agent functions that process state
3. **Edges** - Connections between nodes (conditional or fixed)
4. **Checkpointer** - Persists state for recovery/replay

```typescript
// Simplified workflow execution
const workflow = new StateGraph<TradingState>()
  .addNode("orchestrator", orchestratorAgent)
  .addNode("research_team", researchTeamSubgraph)
  .addNode("analysis_team", analysisTeamSubgraph)
  .addNode("decision_team", decisionTeamSubgraph)
  .addEdge(START, "orchestrator")
  .addConditionalEdges("orchestrator", routeToTeam)
  .compile({ checkpointer: postgresCheckpointer });
```

### Execution Flow

1. **Trigger** - Manual, scheduled (cron), or event-based
2. **Orchestrator** - Analyzes request, determines which team(s) needed
3. **Research** - Gathers data (parallel: news, social, market)
4. **Analysis** - Processes data (parallel: technical, fundamental, sentiment)
5. **Decision** - Portfolio manager makes final call with risk assessment
6. **Learning** - Store outcomes in memory for future improvement

## Communication Patterns

### Agent-to-Agent (Command Pattern)

```typescript
// Agent returns Command to route + update state
function newsAgent(state: TradingState): Command {
  const news = await fetchNews(state.ticker);
  return Command({
    goto: "orchestrator",  // Return to supervisor
    update: { news }       // Update state with results
  });
}
```

### Handoffs

- **Same graph**: Direct routing via `goto`
- **Subgraph**: Use `graph: Command.PARENT` for cross-team handoffs
- **Human-in-the-loop**: Pause workflow, await confirmation

## Key Design Decisions

### 1. TypeScript Over Python

- Existing codebase is TypeScript (Elysia, Bun)
- LangChain.js available for LLM interactions
- Custom StateGraph implementation (LangGraph.js is less mature)
- Can add Python microservices later if needed

### 2. Multi-Provider LLM Support

- **LLM Providers**: Ollama (local), OpenAI, Mock
- **Embedding Providers**: Ollama, OpenAI, Mock
- Auto-detection with graceful fallback
- `@langchain/ollama` for local development without API keys
- Consistent interface via `LLMProvider` abstraction

### 3. PostgreSQL as Primary Store

- pgvector for semantic search (memory)
- JSON columns for flexible metadata
- HNSW indexes for fast similarity search
- Single database for simplicity

### 4. Supervisor Pattern Over Swarm

- Explicit control flow (easier to debug)
- Clear responsibility boundaries
- Predictable execution order
- Better for regulated domains (trading)

### 5. Subgraphs for Team Isolation

- Research team can run agents in parallel
- Analysis team isolated from data collection
- Decision team has final authority
- Each team has its own memory namespace

## Scalability Considerations

### Horizontal Scaling

- Stateless agents (state in PostgreSQL)
- Redis for caching market data
- Queue-based job processing (future)

### Performance

- Parallel agent execution within teams
- Cached embeddings for frequent queries
- Batch LLM calls where possible
- Streaming responses for real-time UI

## Security

- API keys in environment variables
- Rate limiting on external API calls
- Audit logging for all trading decisions
- Paper trading mode by default (no real money)

## Related Documents

- [02-AGENTS.md](./02-AGENTS.md) - Agent specifications
- [03-MEMORY.md](./03-MEMORY.md) - Memory system design
- [04-TOOLS.md](./04-TOOLS.md) - Tools and integrations
- [05-DATABASE.md](./05-DATABASE.md) - Database schema
- [06-ROADMAP.md](./06-ROADMAP.md) - Development roadmap
