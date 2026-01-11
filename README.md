# BrokeAgent

AI-powered trading simulation system using multi-agent orchestration with LangGraph-style patterns. Analyzes market data, news, and social sentiment to make informed trading decisions.

## Features

- **Multi-Agent Architecture**: Specialized agents for research, analysis, and decision-making
- **Real-time WebSocket Updates**: Live workflow execution monitoring
- **LangGraph-style State Graphs**: Composable workflow orchestration with checkpointing
- **Memory System**: Vector-based semantic memory with PostgreSQL + pgvector
- **Paper Trading**: Simulated trading with portfolio tracking and P&L analysis
- **Modern Dashboard**: Real-time React frontend with Astro

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         Frontend (Astro + React)                │
│  Dashboard │ Workflows │ Agents │ P&L Charts │ Live Status      │
└─────────────────────────────┬───────────────────────────────────┘
                              │ WebSocket / REST API
┌─────────────────────────────▼───────────────────────────────────┐
│                      Backend (Elysia + Bun)                     │
├─────────────────────────────────────────────────────────────────┤
│  ┌─────────────────┐  ┌──────────────────┐  ┌───────────────┐   │
│  │   Orchestrator  │──│  Research Team   │──│ Analysis Team │   │
│  │                 │  │  - News Analyst  │  │ - Technical   │   │
│  │  Routes tasks   │  │  - Social        │  │ - Fundamental │   │
│  │  to teams       │  │  - Market Data   │  │ - Sentiment   │   │
│  └────────┬────────┘  └──────────────────┘  └───────────────┘   │
│           │                                                      │
│  ┌────────▼────────┐                                            │
│  │  Decision Team  │                                            │
│  │  - PM Agent     │                                            │
│  │  - Risk Manager │                                            │
│  │  - Executor     │                                            │
│  └─────────────────┘                                            │
├─────────────────────────────────────────────────────────────────┤
│  Memory Store │ Checkpointer │ LLM Service │ Embedding Provider │
└─────────────────────────────┬───────────────────────────────────┘
                              │
┌─────────────────────────────▼───────────────────────────────────┐
│              PostgreSQL + pgvector │ Ollama (local LLM)         │
└─────────────────────────────────────────────────────────────────┘
```

## Agent Teams

### Research Team
- **News Analyst**: Fetches and analyzes financial news from multiple sources
- **Social Analyst**: Monitors Reddit, StockTwits for market sentiment
- **Market Data Agent**: Retrieves real-time quotes and historical data

### Analysis Team
- **Technical Analyst**: Chart patterns, indicators (RSI, MACD, Bollinger Bands)
- **Fundamental Analyst**: Financial metrics, valuations, growth analysis
- **Sentiment Analyst**: Aggregates sentiment from news and social media

### Decision Team
- **Portfolio Manager**: Makes buy/sell/hold decisions with confidence scores
- **Risk Manager**: Position sizing, portfolio risk assessment
- **Order Executor**: Generates and executes paper trade orders

## Quick Start

### Prerequisites

- [Bun](https://bun.sh/) v1.0+
- [Docker](https://docker.com/) (for PostgreSQL)
- [Ollama](https://ollama.ai/) (for local LLM)

### Setup

```bash
# Clone the repository
git clone https://github.com/your-repo/brokeagent.git
cd brokeagent

# Start PostgreSQL with pgvector
docker compose up -d

# Install dependencies
bun install

# Pull required Ollama models
ollama pull llama3.2
ollama pull nomic-embed-text

# Initialize database
cd app && bun run db:migrate

# Start backend
bun run dev

# In another terminal, start frontend
cd frontend && bun run dev
```

### Access

- **Dashboard**: http://localhost:4321
- **API**: http://localhost:3050
- **OpenAPI Docs**: http://localhost:3050/openapi
- **WebSocket**: ws://localhost:3050/ws

## Project Structure

```
brokeagent/
├── app/                    # Backend application
│   ├── src/
│   │   ├── agents/        # Agent implementations
│   │   │   ├── analysis/  # Analysis team agents
│   │   │   ├── decision/  # Decision team agents
│   │   │   ├── research/  # Research team agents
│   │   │   ├── base.ts    # Base agent class
│   │   │   └── orchestrator.ts
│   │   ├── core/          # Core framework
│   │   │   ├── database.ts
│   │   │   ├── executor.ts  # Retry/recovery logic
│   │   │   ├── graph.ts     # StateGraph implementation
│   │   │   ├── state.ts     # TradingState definition
│   │   │   └── workflows.ts # Workflow factories
│   │   ├── services/      # Shared services
│   │   │   ├── memory.ts    # Vector memory store
│   │   │   ├── embeddings.ts
│   │   │   ├── llm.ts
│   │   │   └── checkpointer.ts
│   │   ├── tools/         # Agent tools
│   │   └── index.ts       # Elysia server
│   └── database/          # SQL migrations
├── frontend/              # Astro + React dashboard
│   └── src/
│       ├── components/
│       │   └── dashboard/
│       │       ├── Dashboard.tsx
│       │       ├── Workflows.tsx
│       │       ├── LiveStatus.tsx
│       │       ├── PnLChart.tsx
│       │       └── ...
│       └── lib/
│           └── api.ts     # API client + WebSocket
├── shared/                # Shared types and schemas
├── tests/                 # Test suites
└── docs/                  # Documentation
```

## API Endpoints

### Workflow Execution

```bash
# Run research workflow
curl -X POST http://localhost:3050/api/research \
  -H "Content-Type: application/json" \
  -d '{"symbols": ["AAPL", "MSFT"]}'

# Run analysis workflow
curl -X POST http://localhost:3050/api/analyze \
  -H "Content-Type: application/json" \
  -d '{"symbols": ["NVDA"]}'

# Run trading workflow (full pipeline)
curl -X POST http://localhost:3050/api/trade \
  -H "Content-Type: application/json" \
  -d '{"symbols": ["GOOGL"]}'
```

### Data Endpoints

```bash
# Get portfolio
curl http://localhost:3050/api/portfolio

# Get market quotes
curl http://localhost:3050/api/market/quotes

# Get trading decisions
curl http://localhost:3050/api/portfolio/decisions

# Search memory
curl -X POST http://localhost:3050/api/memory/search \
  -H "Content-Type: application/json" \
  -d '{"query": "AAPL earnings"}'
```

## WebSocket Events

Connect to `ws://localhost:3050/ws` for real-time updates:

```javascript
const ws = new WebSocket('ws://localhost:3050/ws');

ws.onopen = () => {
  // Subscribe to all workflow events
  ws.send(JSON.stringify({ type: 'subscribe', channel: 'workflows' }));
};

ws.onmessage = (event) => {
  const data = JSON.parse(event.data);
  // Event types: workflow:started, workflow:step, workflow:completed, workflow:error
  console.log(data.type, data.workflowId, data.data);
};
```

## Configuration

### Environment Variables

Create a `.env` file in the `app` directory:

```bash
# Database
DATABASE_URL=postgres://postgres:postgres@localhost:5432/brokeagent

# LLM Provider (ollama or openai)
LLM_PROVIDER=ollama
OLLAMA_HOST=http://localhost:11434

# Optional: OpenAI (if using cloud LLM)
# OPENAI_API_KEY=sk-...

# Optional: External APIs
# FINNHUB_API_KEY=...
# ALPHA_VANTAGE_API_KEY=...
```

### Ollama Models

The system uses Ollama for local LLM inference:

```bash
# Main model for agent reasoning
ollama pull llama3.2

# Embedding model for memory
ollama pull nomic-embed-text
```

## Testing

```bash
# Run all tests
bun test

# Run specific test file
bun test tests/agents/analysis-team.test.ts

# Run with coverage
bun test --coverage
```

## Development

### Adding a New Agent

1. Create agent class in `app/src/agents/`:

```typescript
import { BaseAgent, type AgentResult } from "../base";
import type { TradingState } from "../../core/state";

export class MyAgent extends BaseAgent {
  constructor() {
    super("my_agent", "My Agent", "Description of what this agent does");
  }

  async execute(state: TradingState): Promise<AgentResult> {
    // Agent logic here
    return {
      goto: "next_agent", // or END
      update: {
        // State updates
      }
    };
  }
}
```

2. Add to appropriate team or create new workflow

### Adding a New Tool

1. Create tool in `app/src/tools/`:

```typescript
export async function myTool(params: MyParams): Promise<MyResult> {
  // Tool implementation
}
```

2. Register in agent's tools array

## License

MIT

## Contributing

Contributions are welcome! Please read the contributing guidelines before submitting a PR.
