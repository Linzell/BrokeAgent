import { Elysia, t } from "elysia";
import { cors } from "@elysiajs/cors";
import { openapi } from "@elysiajs/openapi";
import { sql, testConnection, initializeDatabase, closeDatabase } from "./core/database";
import { memoryStore } from "./services/memory";
import { createDefaultEmbeddingProvider } from "./services/embeddings";
import { loadAgentsFromDatabase } from "./agents/base";
import { runResearchWorkflow, runTradingWorkflow, runDebateWorkflow, runTieredDebateWorkflow, setWorkflowEventEmitter, createResearchWorkflow } from "./core/workflows";
import { executeTieredDebate, type TieredDebateInput, type TieredDebateOutput } from "./agents/debate/tiered";
import type { WorkflowEvent } from "./core/graph";
import { llmProvider, type LLMProviderType, compareModels, consensusVote, tradingConsensus, type ModelSpec, detectModelFamily, getModelOptimizations, optimizePromptForModel, getPromptTemplate, listPromptTemplates, createABTest, getABTest, listABTests, updateABTestStatus, deleteABTest, getABTestSummary, runABTest, createModelComparisonTest, smartChat, smartChatAuto, getDefaultCandidateModels, getAllModelHealth, getAllModelPerformance, resetModelHealth, clearModelStats, getModelHealth, getModelPerformance, recordConsensusResult, setLLMEventListener, type LLMUsageEvent } from "./services/llm";
import { cacheService } from "./services/cache";

// ============================================
// Health Check State
// ============================================

interface HealthStatus {
  status: "healthy" | "degraded" | "unhealthy";
  timestamp: string;
  uptime: number; // seconds
  version: string;
  services: {
    database: { status: "up" | "down"; latencyMs?: number; error?: string };
    cache: { status: "up" | "down"; latencyMs?: number; error?: string };
    llm: { status: "up" | "down"; provider?: string; model?: string; error?: string };
    embedding: { status: "up" | "down" | "not_configured"; provider?: string };
    memory: { status: "up" | "down"; totalMemories: number; byType: Record<string, number> };
    websocket: { status: "up" | "down"; connectedClients: number };
  };
  system: {
    nodeVersion: string;
    platform: string;
    cpuUsage?: number;
    memoryUsageMb?: number;
    memoryTotalMb?: number;
  };
}

const startTime = Date.now();

async function getDetailedHealth(): Promise<HealthStatus> {
  const services: HealthStatus["services"] = {
    database: { status: "down" },
    cache: { status: "down" },
    llm: { status: "down" },
    embedding: { status: "not_configured" },
    memory: { status: "down", totalMemories: 0, byType: {} },
    websocket: { status: "down", connectedClients: 0 },
  };

  // Check database
  try {
    const dbStart = Date.now();
    const dbHealthy = await testConnection();
    services.database = {
      status: dbHealthy ? "up" : "down",
      latencyMs: Date.now() - dbStart,
    };
  } catch (error) {
    services.database = { status: "down", error: (error as Error).message };
  }

  // Check cache (Redis)
  try {
    const cacheStart = Date.now();
    // Use a simple ping-like operation
    await cacheService.get("health_check_ping");
    services.cache = {
      status: "up",
      latencyMs: Date.now() - cacheStart,
    };
  } catch (error) {
    services.cache = { status: "down", error: (error as Error).message };
  }

  // Check LLM
  try {
    const llmConfig = llmProvider.getConfig();
    services.llm = {
      status: "up",
      provider: llmConfig.provider,
      model: llmConfig.model,
    };
  } catch (error) {
    services.llm = { status: "down", error: (error as Error).message };
  }

  // Check embedding provider
  try {
    // The memory store has the embedding provider
    services.embedding = {
      status: "up",
      provider: "configured",
    };
  } catch {
    services.embedding = { status: "not_configured" };
  }

  // Check memory store
  try {
    const memoryStats = await memoryStore.getStats();
    services.memory = {
      status: "up",
      totalMemories: memoryStats.total,
      byType: memoryStats.byType,
    };
  } catch (error) {
    services.memory = { status: "down", totalMemories: 0, byType: {}, error: (error as Error).message };
  }

  // WebSocket status
  services.websocket = {
    status: globalApp?.server ? "up" : "down",
    connectedClients: wsClientCount,
  };

  // Determine overall status
  const criticalServices = [services.database, services.memory];
  const allCriticalUp = criticalServices.every(s => s.status === "up");
  const anyCriticalDown = criticalServices.some(s => s.status === "down");
  
  let overallStatus: "healthy" | "degraded" | "unhealthy";
  if (allCriticalUp && services.llm.status === "up") {
    overallStatus = "healthy";
  } else if (anyCriticalDown) {
    overallStatus = "unhealthy";
  } else {
    overallStatus = "degraded";
  }

  // System info
  const memUsage = process.memoryUsage();

  return {
    status: overallStatus,
    timestamp: new Date().toISOString(),
    uptime: Math.floor((Date.now() - startTime) / 1000),
    version: "0.1.0",
    services,
    system: {
      nodeVersion: process.version,
      platform: process.platform,
      memoryUsageMb: Math.round(memUsage.heapUsed / 1024 / 1024),
      memoryTotalMb: Math.round(memUsage.heapTotal / 1024 / 1024),
    },
  };
}

// Track active WebSocket connections
let wsClientCount = 0;

// ============================================
// Rate Limiting
// ============================================

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const rateLimitStore = new Map<string, RateLimitEntry>();

// Clean up expired entries periodically
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of rateLimitStore.entries()) {
    if (entry.resetAt < now) {
      rateLimitStore.delete(key);
    }
  }
}, 60000); // Clean every minute

interface RateLimitConfig {
  maxRequests: number;
  windowMs: number;
}

const rateLimitConfigs: Record<string, RateLimitConfig> = {
  // Workflow execution endpoints - more restrictive
  "/api/research": { maxRequests: 10, windowMs: 60000 },
  "/api/analyze": { maxRequests: 10, windowMs: 60000 },
  "/api/trade": { maxRequests: 5, windowMs: 60000 },
  // Memory search - moderate
  "/api/memory/search": { maxRequests: 30, windowMs: 60000 },
  // Default for other endpoints
  default: { maxRequests: 100, windowMs: 60000 },
};

function getRateLimitConfig(path: string): RateLimitConfig {
  return rateLimitConfigs[path] || rateLimitConfigs.default;
}

function checkRateLimit(ip: string, path: string): { allowed: boolean; remaining: number; resetAt: number } {
  const config = getRateLimitConfig(path);
  const key = `${ip}:${path}`;
  const now = Date.now();
  
  let entry = rateLimitStore.get(key);
  
  // Create new entry or reset if window expired
  if (!entry || entry.resetAt < now) {
    entry = {
      count: 0,
      resetAt: now + config.windowMs,
    };
  }
  
  entry.count++;
  rateLimitStore.set(key, entry);
  
  const remaining = Math.max(0, config.maxRequests - entry.count);
  const allowed = entry.count <= config.maxRequests;
  
  return { allowed, remaining, resetAt: entry.resetAt };
}

// Rate limiting plugin
const rateLimit = new Elysia({ name: "rate-limit" })
  .derive({ as: "global" }, ({ request, headers }) => {
    // Get client IP from headers (for proxied requests) or connection
    const forwarded = headers["x-forwarded-for"];
    const realIp = headers["x-real-ip"];
    const ip = (typeof forwarded === "string" ? forwarded.split(",")[0] : realIp) || "unknown";
    
    return { clientIp: ip.trim() };
  })
  .onBeforeHandle({ as: "global" }, ({ clientIp, path, set }) => {
    // Skip rate limiting for health checks and static routes
    if (path === "/" || path === "/health" || path.startsWith("/openapi")) {
      return;
    }
    
    const { allowed, remaining, resetAt } = checkRateLimit(clientIp, path);
    
    // Add rate limit headers
    set.headers["X-RateLimit-Remaining"] = String(remaining);
    set.headers["X-RateLimit-Reset"] = String(Math.ceil(resetAt / 1000));
    
    if (!allowed) {
      set.status = 429;
      set.headers["Retry-After"] = String(Math.ceil((resetAt - Date.now()) / 1000));
      return {
        error: "Too many requests",
        retryAfter: Math.ceil((resetAt - Date.now()) / 1000),
      };
    }
  });

// ============================================
// WebSocket State Management
// ============================================

interface WebSocketClient {
  id: string;
  subscriptions: Set<string>;
}

const wsClients = new Map<string, WebSocketClient>();
const workflowSubscribers = new Map<string, Set<string>>(); // workflowId -> clientIds

// Broadcast to all clients subscribed to a workflow
function broadcastToWorkflow(workflowId: string, event: object) {
  const subscribers = workflowSubscribers.get(workflowId);
  if (!subscribers) return;

  const message = JSON.stringify(event);
  // Note: actual broadcast happens via ws.publish in Elysia
}

// Export for use in workflows
export function emitWorkflowEvent(workflowId: string, event: {
  type: "workflow:started" | "workflow:step" | "workflow:completed" | "workflow:error";
  data: Record<string, unknown>;
}) {
  const fullEvent = {
    ...event,
    workflowId,
    timestamp: new Date().toISOString(),
  };
  
  // Publish to workflow-specific channel
  if (globalApp?.server) {
    globalApp.server.publish(`workflow:${workflowId}`, JSON.stringify(fullEvent));
    globalApp.server.publish("workflows:all", JSON.stringify(fullEvent));
  }
}

let globalApp: typeof app | null = null;

// ============================================
// Response Models
// ============================================

const ErrorResponse = t.Object({
  error: t.String(),
  code: t.Optional(t.String()),
});

const HealthResponse = t.Object({
  status: t.Union([t.Literal("healthy"), t.Literal("unhealthy")]),
  timestamp: t.String(),
  services: t.Object({
    database: t.Union([t.Literal("connected"), t.Literal("disconnected")]),
    memory: t.Object({
      totalMemories: t.Number(),
      byType: t.Record(t.String(), t.Number()),
    }),
  }),
});

const AgentSchema = t.Object({
  id: t.String(),
  type: t.String(),
  name: t.String(),
  description: t.Optional(t.String()),
  enabled: t.Boolean(),
  created_at: t.Optional(t.String()),
});

const WorkflowSchema = t.Object({
  id: t.String(),
  name: t.String(),
  description: t.Optional(t.String()),
  trigger_type: t.String(),
  enabled: t.Boolean(),
  created_at: t.Optional(t.String()),
});

const WorkflowRequestSchema = t.Object({
  symbols: t.Array(t.String(), { minItems: 1 }),
  threadId: t.Optional(t.String()),
});

// ============================================
// Application Setup
// ============================================

const app = new Elysia()
  .use(cors({
    origin: ["http://localhost:4321", "http://localhost:3050", "http://127.0.0.1:4321", "http://127.0.0.1:3050"],
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  }))
  .use(rateLimit)
  .use(
    openapi({
      documentation: {
        info: {
          title: "BrokeAgent API",
          version: "0.1.0",
          description: "AI-powered trading simulation system with multi-agent orchestration. Analyzes market data, news, and social sentiment to make informed trading decisions.",
          contact: {
            name: "BrokeAgent",
            url: "https://github.com/brokeagent",
          },
        },
        tags: [
          { name: "Health", description: "Health check and status endpoints" },
          { name: "Agents", description: "Agent management endpoints" },
          { name: "Workflows", description: "Workflow management and execution history" },
          { name: "Memory", description: "Memory store operations and search" },
          { name: "Market Data", description: "Market quotes and historical data" },
          { name: "Portfolio", description: "Portfolio positions and decisions" },
          { name: "Orders", description: "Order management" },
          { name: "News", description: "News articles and sentiment" },
          { name: "LLM", description: "LLM provider configuration and model management" },
          { name: "Execution", description: "Workflow execution endpoints" },
          { name: "WebSocket", description: "Real-time updates via WebSocket" },
        ],
        servers: [
          { url: "http://localhost:3050", description: "Local development" },
        ],
      },
    })
  )

  // ============================================
  // Health & Status Endpoints
  // ============================================

  .get("/", () => ({
    name: "BrokeAgent API",
    version: "0.1.0",
    status: "running",
  }), {
    detail: {
      summary: "API Root",
      description: "Returns basic API information and status",
      tags: ["Health"],
    },
  })

  .get("/health", async () => {
    const dbHealthy = await testConnection();
    const memoryStats = await memoryStore.getStats();

    return {
      status: dbHealthy ? "healthy" : "unhealthy",
      timestamp: new Date().toISOString(),
      services: {
        database: dbHealthy ? "connected" : "disconnected",
        memory: {
          totalMemories: memoryStats.total,
          byType: memoryStats.byType,
        },
      },
    };
  }, {
    detail: {
      summary: "Health Check",
      description: "Returns basic health status of the application",
      tags: ["Health"],
    },
  })

  // Detailed health check with all services
  .get("/api/health/detailed", async () => {
    return await getDetailedHealth();
  }, {
    detail: {
      summary: "Detailed Health Check",
      description: "Returns comprehensive health status of all services including database, cache, LLM, and memory",
      tags: ["Health"],
    },
  })

  // Kubernetes-style readiness probe
  .get("/api/health/ready", async ({ set }) => {
    const health = await getDetailedHealth();
    
    if (health.status === "unhealthy") {
      set.status = 503;
      return {
        ready: false,
        reason: "Critical services unavailable",
        services: {
          database: health.services.database.status,
          memory: health.services.memory.status,
        },
      };
    }

    return {
      ready: true,
      status: health.status,
    };
  }, {
    detail: {
      summary: "Readiness Probe",
      description: "Returns 200 if the service is ready to accept traffic, 503 otherwise. Use for Kubernetes readiness probes.",
      tags: ["Health"],
    },
  })

  // Kubernetes-style liveness probe (lightweight)
  .get("/api/health/live", () => {
    return {
      alive: true,
      timestamp: new Date().toISOString(),
      uptime: Math.floor((Date.now() - startTime) / 1000),
    };
  }, {
    detail: {
      summary: "Liveness Probe",
      description: "Returns 200 if the service is alive. Use for Kubernetes liveness probes.",
      tags: ["Health"],
    },
  })

  // ============================================
  // Agent Endpoints
  // ============================================

  .get("/api/agents", async () => {
    const agents = await sql`
      SELECT id, type, name, description, enabled, created_at
      FROM agents
      ORDER BY type, name
    `;
    return { agents };
  }, {
    detail: {
      summary: "List Agents",
      description: "Returns all configured agents with their basic information",
      tags: ["Agents"],
    },
  })

  .get("/api/agents/:id", async ({ params }) => {
    const agents = await sql`
      SELECT id, type, name, description, system_prompt, tools, config, enabled
      FROM agents
      WHERE id = ${params.id}::uuid
    `;

    if (agents.length === 0) {
      return { error: "Agent not found" };
    }

    return { agent: agents[0] };
  }, {
    params: t.Object({
      id: t.String({ description: "Agent UUID" }),
    }),
    detail: {
      summary: "Get Agent",
      description: "Returns detailed information for a specific agent including system prompt and tools",
      tags: ["Agents"],
    },
  })

  // ============================================
  // Workflow Endpoints
  // ============================================

  .get("/api/workflows", async () => {
    const workflows = await sql`
      SELECT id, name, description, trigger_type, enabled, created_at
      FROM workflows
      ORDER BY created_at DESC
    `;
    return { workflows };
  }, {
    detail: {
      summary: "List Workflows",
      description: "Returns all configured workflows",
      tags: ["Workflows"],
    },
  })

  .get("/api/workflows/executions", async ({ query }) => {
    const limit = Number(query.limit) || 20;
    const executions = await sql`
      SELECT
        id, workflow_id, thread_id, trigger_type, status,
        current_step, started_at, completed_at, error
      FROM workflow_executions
      ORDER BY started_at DESC
      LIMIT ${limit}
    `;
    return { executions };
  }, {
    query: t.Object({
      limit: t.Optional(t.Numeric({ description: "Maximum number of results (default: 20)" })),
    }),
    detail: {
      summary: "List Workflow Executions",
      description: "Returns recent workflow execution history",
      tags: ["Workflows"],
    },
  })

  .get("/api/workflows/executions/:id", async ({ params }) => {
    const executions = await sql`
      SELECT *
      FROM workflow_executions
      WHERE id = ${params.id}::uuid
    `;

    if (executions.length === 0) {
      return { error: "Execution not found" };
    }

    // Get agent executions for this workflow
    const agentExecutions = await sql`
      SELECT ae.*, a.name as agent_name, a.type as agent_type
      FROM agent_executions ae
      JOIN agents a ON ae.agent_id = a.id
      WHERE ae.workflow_execution_id = ${params.id}::uuid
      ORDER BY ae.started_at
    `;

    return {
      execution: executions[0],
      agentExecutions,
    };
  }, {
    params: t.Object({
      id: t.String({ description: "Workflow execution UUID" }),
    }),
    detail: {
      summary: "Get Workflow Execution",
      description: "Returns detailed information for a specific workflow execution including all agent executions",
      tags: ["Workflows"],
    },
  })

  // ============================================
  // Memory Endpoints
  // ============================================

  .get("/api/memory/stats", async () => {
    const stats = await memoryStore.getStats();
    return { stats };
  }, {
    detail: {
      summary: "Memory Stats",
      description: "Returns statistics about the memory store including counts by type",
      tags: ["Memory"],
    },
  })

  .post("/api/memory/search", async ({ body }) => {
    const { query, namespace, type, limit } = body as {
      query: string;
      namespace?: string;
      type?: "semantic" | "episodic" | "procedural";
      limit?: number;
    };

    const results = await memoryStore.search({
      query,
      namespace,
      type,
      limit: limit || 10,
    });

    return { results };
  }, {
    body: t.Object({
      query: t.String({ description: "Search query for semantic search" }),
      namespace: t.Optional(t.String({ description: "Filter by namespace" })),
      type: t.Optional(t.Union([
        t.Literal("semantic"),
        t.Literal("episodic"),
        t.Literal("procedural"),
      ], { description: "Filter by memory type" })),
      limit: t.Optional(t.Number({ description: "Maximum results (default: 10)" })),
    }),
    detail: {
      summary: "Search Memory",
      description: "Performs semantic search across the memory store with optional filters",
      tags: ["Memory"],
    },
  })

  .get("/api/memory/namespace/:namespace", async ({ params }) => {
    const memories = await memoryStore.getByNamespace(params.namespace);
    return { memories };
  }, {
    params: t.Object({
      namespace: t.String({ description: "Memory namespace" }),
    }),
    detail: {
      summary: "Get Memories by Namespace",
      description: "Returns all memories in a specific namespace",
      tags: ["Memory"],
    },
  })

  // ============================================
  // Market Data Endpoints
  // ============================================

  .get("/api/market/quotes", async () => {
    const quotes = await sql`
      SELECT DISTINCT ON (symbol)
        symbol, price, change, change_percent, volume, quote_time
      FROM market_data
      ORDER BY symbol, quote_time DESC
    `;
    return { quotes };
  }, {
    detail: {
      summary: "Get Latest Quotes",
      description: "Returns the most recent quote for each symbol",
      tags: ["Market Data"],
    },
  })

  .get("/api/market/quotes/:symbol", async ({ params }) => {
    const quotes = await sql`
      SELECT *
      FROM market_data
      WHERE symbol = ${params.symbol.toUpperCase()}
      ORDER BY quote_time DESC
      LIMIT 100
    `;
    return { symbol: params.symbol.toUpperCase(), quotes };
  }, {
    params: t.Object({
      symbol: t.String({ description: "Stock symbol (e.g., AAPL, MSFT)" }),
    }),
    detail: {
      summary: "Get Symbol Quotes",
      description: "Returns historical quotes for a specific symbol (last 100)",
      tags: ["Market Data"],
    },
  })

  // ============================================
  // Portfolio Endpoints
  // ============================================

  .get("/api/portfolio", async () => {
    const positions = await sql`SELECT * FROM portfolio_summary`;
    const account = await sql`SELECT * FROM accounts LIMIT 1`;

    return {
      account: account[0] || null,
      positions,
    };
  }, {
    detail: {
      summary: "Get Portfolio",
      description: "Returns current portfolio positions and account information",
      tags: ["Portfolio"],
    },
  })

  .get("/api/portfolio/decisions", async ({ query }) => {
    const limit = Number(query.limit) || 50;
    const decisions = await sql`
      SELECT * FROM recent_decisions
      LIMIT ${limit}
    `;
    return { decisions };
  }, {
    query: t.Object({
      limit: t.Optional(t.Numeric({ description: "Maximum number of results (default: 50)" })),
    }),
    detail: {
      summary: "Get Trading Decisions",
      description: "Returns recent trading decisions made by the system",
      tags: ["Portfolio"],
    },
  })

  // ============================================
  // Orders Endpoints
  // ============================================

  .get("/api/orders", async ({ query }) => {
    const status = query.status as string | undefined;
    const limit = Number(query.limit) || 50;

    const orders = await sql`
      SELECT *
      FROM orders
      WHERE (${status || null}::text IS NULL OR status = ${status || ''})
      ORDER BY created_at DESC
      LIMIT ${limit}
    `;

    return { orders };
  }, {
    query: t.Object({
      status: t.Optional(t.String({ description: "Filter by order status (e.g., pending, filled, cancelled)" })),
      limit: t.Optional(t.Numeric({ description: "Maximum number of results (default: 50)" })),
    }),
    detail: {
      summary: "List Orders",
      description: "Returns orders with optional status filter",
      tags: ["Orders"],
    },
  })

  // ============================================
  // News Endpoints
  // ============================================

  .get("/api/news", async ({ query }) => {
    const symbol = query.symbol as string | undefined;
    const limit = Number(query.limit) || 50;

    const news = await sql`
      SELECT id, headline, summary, source, symbols, sentiment_score, published_at
      FROM news_articles
      WHERE (${symbol || null}::text IS NULL OR ${symbol || ''} = ANY(symbols))
      ORDER BY published_at DESC
      LIMIT ${limit}
    `;

    return { news };
  }, {
    query: t.Object({
      symbol: t.Optional(t.String({ description: "Filter by stock symbol" })),
      limit: t.Optional(t.Numeric({ description: "Maximum number of results (default: 50)" })),
    }),
    detail: {
      summary: "Get News",
      description: "Returns recent news articles with optional symbol filter",
      tags: ["News"],
    },
  })

  // ============================================
  // LLM Configuration Endpoints
  // ============================================

  .get("/api/llm/providers", async () => {
    const providers = await llmProvider.getProviders();
    const currentConfig = llmProvider.getConfig();

    return {
      providers,
      current: currentConfig.provider,
    };
  }, {
    detail: {
      summary: "List LLM Providers",
      description: "Returns all available LLM providers and their configuration status",
      tags: ["LLM"],
    },
  })

  .get("/api/llm/models", async ({ query }) => {
    const providerType = query.provider as LLMProviderType | undefined;
    const models = await llmProvider.listModels(providerType);

    return {
      models,
      count: models.length,
      provider: providerType || "all",
    };
  }, {
    query: t.Object({
      provider: t.Optional(t.Union([
        t.Literal("ollama"),
        t.Literal("openai"),
        t.Literal("openrouter"),
        t.Literal("mock"),
      ], { description: "Filter by provider type" })),
    }),
    detail: {
      summary: "List LLM Models",
      description: "Returns available models for the specified provider or all providers",
      tags: ["LLM"],
    },
  })

  .get("/api/llm/config", () => {
    const config = llmProvider.getConfig();
    return {
      config,
      initialized: llmProvider.isInitialized(),
    };
  }, {
    detail: {
      summary: "Get LLM Configuration",
      description: "Returns the current LLM provider configuration",
      tags: ["LLM"],
    },
  })

  .post("/api/llm/config", async ({ body }) => {
    const { provider, model } = body;

    console.log(`[API] Switching LLM provider to: ${provider}${model ? `/${model}` : ''}`);

    try {
      await llmProvider.setProvider(provider as LLMProviderType, model);
      const newConfig = llmProvider.getConfig();

      return {
        success: true,
        config: newConfig,
        message: `Switched to ${newConfig.provider}/${newConfig.model}`,
      };
    } catch (error) {
      console.error("[API] Failed to switch LLM provider:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }, {
    body: t.Object({
      provider: t.Union([
        t.Literal("ollama"),
        t.Literal("openai"),
        t.Literal("openrouter"),
        t.Literal("mock"),
      ], { description: "LLM provider type" }),
      model: t.Optional(t.String({ description: "Model identifier (defaults to provider default)" })),
    }),
    detail: {
      summary: "Set LLM Configuration",
      description: "Switch to a different LLM provider and/or model",
      tags: ["LLM"],
    },
  })

  .post("/api/llm/compare", async ({ body }) => {
    const { messages, models, timeout } = body;

    console.log(`[API] Model comparison request with ${models.length} models`);

    try {
      const modelSpecs: ModelSpec[] = models.map(m => ({
        provider: m.provider as LLMProviderType,
        model: m.model,
      }));

      const result = await compareModels(
        messages.map(m => ({ role: m.role as "system" | "user" | "assistant", content: m.content })),
        modelSpecs,
        { timeout, includeFailures: true }
      );

      return {
        success: true,
        ...result,
      };
    } catch (error) {
      console.error("[API] Model comparison failed:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }, {
    body: t.Object({
      messages: t.Array(t.Object({
        role: t.Union([t.Literal("system"), t.Literal("user"), t.Literal("assistant")]),
        content: t.String(),
      }), { minItems: 1, description: "Chat messages to send to all models" }),
      models: t.Array(t.Object({
        provider: t.Union([
          t.Literal("ollama"),
          t.Literal("openai"),
          t.Literal("openrouter"),
          t.Literal("mock"),
        ]),
        model: t.String(),
      }), { minItems: 1, description: "List of models to compare" }),
      timeout: t.Optional(t.Number({ description: "Timeout per model in ms (default: 60000)" })),
    }),
    detail: {
      summary: "Compare Model Responses",
      description: "Run the same prompt through multiple models and compare their responses side-by-side",
      tags: ["LLM"],
    },
  })

  .post("/api/llm/consensus", async ({ body }) => {
    const { question, options, models, config } = body;

    console.log(`[API] Consensus vote request: "${question.slice(0, 50)}..." with ${models.length} models`);

    try {
      const modelSpecs: ModelSpec[] = models.map(m => ({
        provider: m.provider as LLMProviderType,
        model: m.model,
      }));

      const result = await consensusVote(question, options, modelSpecs, config);

      // Record consensus results for model performance tracking
      for (const vote of result.votes) {
        recordConsensusResult(vote.model, vote.vote === result.consensus.decision);
      }

      return {
        success: true,
        ...result,
      };
    } catch (error) {
      console.error("[API] Consensus vote failed:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }, {
    body: t.Object({
      question: t.String({ description: "The question to vote on" }),
      options: t.Array(t.String(), { minItems: 2, description: "Options to choose from" }),
      models: t.Array(t.Object({
        provider: t.Union([
          t.Literal("ollama"),
          t.Literal("openai"),
          t.Literal("openrouter"),
          t.Literal("mock"),
        ]),
        model: t.String(),
      }), { minItems: 1, description: "List of models to vote" }),
      config: t.Optional(t.Object({
        timeout: t.Optional(t.Number({ description: "Timeout per model in ms (default: 60000)" })),
        minConfidence: t.Optional(t.Number({ description: "Minimum confidence to count vote (0-100, default: 0)" })),
        requireMajority: t.Optional(t.Boolean({ description: "Require >50% agreement (default: false)" })),
      })),
    }),
    detail: {
      summary: "Run Consensus Vote",
      description: "Have multiple models vote on a question and determine consensus",
      tags: ["LLM"],
    },
  })

  .post("/api/llm/trading-consensus", async ({ body }) => {
    const { symbol, context, models } = body;

    console.log(`[API] Trading consensus for ${symbol} with ${models.length} models`);

    try {
      const modelSpecs: ModelSpec[] = models.map(m => ({
        provider: m.provider as LLMProviderType,
        model: m.model,
      }));

      const result = await tradingConsensus(symbol, context, modelSpecs);

      // Record consensus results for model performance tracking
      for (const vote of result.votes) {
        recordConsensusResult(vote.model, vote.vote === result.consensus.decision);
      }

      return {
        success: true,
        symbol,
        ...result,
      };
    } catch (error) {
      console.error("[API] Trading consensus failed:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }, {
    body: t.Object({
      symbol: t.String({ description: "Stock symbol (e.g., AAPL)" }),
      context: t.String({ description: "Analysis context for the trading decision" }),
      models: t.Array(t.Object({
        provider: t.Union([
          t.Literal("ollama"),
          t.Literal("openai"),
          t.Literal("openrouter"),
          t.Literal("mock"),
        ]),
        model: t.String(),
      }), { minItems: 1, description: "List of models to vote" }),
    }),
    detail: {
      summary: "Trading Consensus Vote",
      description: "Quick consensus vote specifically for BUY/HOLD/SELL trading decisions",
      tags: ["LLM"],
    },
  })

  .get("/api/llm/prompts", () => {
    const templates = listPromptTemplates();
    return {
      templates,
      count: templates.length,
    };
  }, {
    detail: {
      summary: "List Prompt Templates",
      description: "Returns all registered model-specific prompt templates",
      tags: ["LLM"],
    },
  })

  .post("/api/llm/prompts/render", ({ body }) => {
    const { templateName, modelId, variables } = body;

    try {
      const family = detectModelFamily(modelId);
      const optimizations = getModelOptimizations(modelId);
      const prompt = getPromptTemplate(templateName, modelId, variables);

      return {
        success: true,
        templateName,
        modelId,
        modelFamily: family,
        optimizations,
        renderedPrompt: prompt,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }, {
    body: t.Object({
      templateName: t.String({ description: "Name of the prompt template" }),
      modelId: t.String({ description: "Model ID to optimize for" }),
      variables: t.Record(t.String(), t.String(), { description: "Variables to substitute in template" }),
    }),
    detail: {
      summary: "Render Prompt Template",
      description: "Render a prompt template with model-specific optimizations",
      tags: ["LLM"],
    },
  })

  .post("/api/llm/optimize", ({ body }) => {
    const { messages, modelId } = body;

    const family = detectModelFamily(modelId);
    const optimizations = getModelOptimizations(modelId);
    const optimizedMessages = optimizePromptForModel(
      messages.map(m => ({ role: m.role as "system" | "user" | "assistant", content: m.content })),
      modelId
    );

    return {
      modelId,
      modelFamily: family,
      optimizations,
      originalMessages: messages,
      optimizedMessages,
    };
  }, {
    body: t.Object({
      messages: t.Array(t.Object({
        role: t.Union([t.Literal("system"), t.Literal("user"), t.Literal("assistant")]),
        content: t.String(),
      })),
      modelId: t.String({ description: "Model ID to optimize for" }),
    }),
    detail: {
      summary: "Optimize Messages for Model",
      description: "Apply model-specific optimizations to chat messages",
      tags: ["LLM"],
    },
  })

  // ============================================
  // A/B Testing Endpoints
  // ============================================

  .get("/api/llm/ab-tests", ({ query }) => {
    const status = query.status as "active" | "paused" | "completed" | undefined;
    const tests = listABTests(status);
    return {
      tests,
      count: tests.length,
    };
  }, {
    query: t.Object({
      status: t.Optional(t.Union([
        t.Literal("active"),
        t.Literal("paused"),
        t.Literal("completed"),
      ], { description: "Filter by test status" })),
    }),
    detail: {
      summary: "List A/B Tests",
      description: "Returns all A/B tests, optionally filtered by status",
      tags: ["LLM"],
    },
  })

  .post("/api/llm/ab-tests", ({ body }) => {
    const { name, description, variants, trafficSplit, metrics } = body;

    try {
      const test = createABTest({
        name,
        description: description || `A/B test: ${name}`,
        variants: variants.map((v, i) => ({
          id: v.id || `variant_${i}`,
          name: v.name,
          model: {
            provider: v.provider as LLMProviderType,
            model: v.model,
          },
          promptTemplate: v.promptTemplate,
        })),
        trafficSplit,
        metrics: metrics || ["latency", "tokens"],
      });

      return {
        success: true,
        test,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }, {
    body: t.Object({
      name: t.String({ description: "Test name" }),
      description: t.Optional(t.String({ description: "Test description" })),
      variants: t.Array(t.Object({
        id: t.Optional(t.String()),
        name: t.String(),
        provider: t.Union([
          t.Literal("ollama"),
          t.Literal("openai"),
          t.Literal("openrouter"),
          t.Literal("mock"),
        ]),
        model: t.String(),
        promptTemplate: t.Optional(t.String()),
      }), { minItems: 2 }),
      trafficSplit: t.Array(t.Number(), { description: "Traffic percentage for each variant (must sum to 100)" }),
      metrics: t.Optional(t.Array(t.String(), { description: "Metrics to track" })),
    }),
    detail: {
      summary: "Create A/B Test",
      description: "Create a new A/B test to compare model performance",
      tags: ["LLM"],
    },
  })

  .post("/api/llm/ab-tests/quick", ({ body }) => {
    const { name, models, trafficSplit } = body;

    try {
      const modelSpecs: ModelSpec[] = models.map(m => ({
        provider: m.provider as LLMProviderType,
        model: m.model,
      }));

      const test = createModelComparisonTest(name, modelSpecs, trafficSplit);

      return {
        success: true,
        test,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }, {
    body: t.Object({
      name: t.String({ description: "Test name" }),
      models: t.Array(t.Object({
        provider: t.Union([
          t.Literal("ollama"),
          t.Literal("openai"),
          t.Literal("openrouter"),
          t.Literal("mock"),
        ]),
        model: t.String(),
      }), { minItems: 2 }),
      trafficSplit: t.Optional(t.Array(t.Number())),
    }),
    detail: {
      summary: "Quick Create Model Comparison Test",
      description: "Quickly create an A/B test comparing multiple models with equal traffic split",
      tags: ["LLM"],
    },
  })

  .get("/api/llm/ab-tests/:id", ({ params }) => {
    const test = getABTest(params.id);
    if (!test) {
      return { error: "Test not found" };
    }
    return { test };
  }, {
    params: t.Object({
      id: t.String({ description: "A/B test ID" }),
    }),
    detail: {
      summary: "Get A/B Test",
      description: "Get details of a specific A/B test",
      tags: ["LLM"],
    },
  })

  .get("/api/llm/ab-tests/:id/summary", ({ params }) => {
    const summary = getABTestSummary(params.id);
    if (!summary) {
      return { error: "Test not found" };
    }
    return { summary };
  }, {
    params: t.Object({
      id: t.String({ description: "A/B test ID" }),
    }),
    detail: {
      summary: "Get A/B Test Summary",
      description: "Get statistics and winner determination for an A/B test",
      tags: ["LLM"],
    },
  })

  .patch("/api/llm/ab-tests/:id", ({ params, body }) => {
    const { status } = body;
    const test = updateABTestStatus(params.id, status);
    if (!test) {
      return { success: false, error: "Test not found" };
    }
    return { success: true, test };
  }, {
    params: t.Object({
      id: t.String({ description: "A/B test ID" }),
    }),
    body: t.Object({
      status: t.Union([
        t.Literal("active"),
        t.Literal("paused"),
        t.Literal("completed"),
      ], { description: "New test status" }),
    }),
    detail: {
      summary: "Update A/B Test Status",
      description: "Update the status of an A/B test (activate, pause, or complete)",
      tags: ["LLM"],
    },
  })

  .delete("/api/llm/ab-tests/:id", ({ params }) => {
    const deleted = deleteABTest(params.id);
    return { success: deleted };
  }, {
    params: t.Object({
      id: t.String({ description: "A/B test ID" }),
    }),
    detail: {
      summary: "Delete A/B Test",
      description: "Delete an A/B test and all its results",
      tags: ["LLM"],
    },
  })

  .post("/api/llm/ab-tests/:id/run", async ({ params, body }) => {
    const { messages, timeout } = body;

    try {
      const result = await runABTest(
        params.id,
        messages.map(m => ({ role: m.role as "system" | "user" | "assistant", content: m.content })),
        { timeout }
      );

      if (!result) {
        return { success: false, error: "Test not found or not active" };
      }

      return {
        success: true,
        testId: result.testId,
        requestId: result.requestId,
        variant: {
          id: result.variant.id,
          name: result.variant.name,
          model: result.variant.model,
        },
        response: result.response,
        latencyMs: result.latencyMs,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }, {
    params: t.Object({
      id: t.String({ description: "A/B test ID" }),
    }),
    body: t.Object({
      messages: t.Array(t.Object({
        role: t.Union([t.Literal("system"), t.Literal("user"), t.Literal("assistant")]),
        content: t.String(),
      }), { minItems: 1 }),
      timeout: t.Optional(t.Number({ description: "Timeout in ms (default: 60000)" })),
    }),
    detail: {
      summary: "Run A/B Test Request",
      description: "Send a request through the A/B test, automatically selecting a variant based on traffic split",
      tags: ["LLM"],
    },
  })

  // ============================================
  // Smart Model Selection Endpoints
  // ============================================

  .get("/api/llm/smart/health", () => {
    const allHealth = getAllModelHealth();
    const allPerformance = getAllModelPerformance();

    return {
      models: allHealth.map(health => {
        const perf = allPerformance.find(
          p => p.model.provider === health.model.provider && p.model.model === health.model.model
        );
        return {
          model: health.model,
          health: {
            available: health.available,
            unavailableReason: health.unavailableReason,
            unavailableUntil: health.unavailableUntil ? new Date(health.unavailableUntil).toISOString() : undefined,
            consecutiveFailures: health.consecutiveFailures,
            lastSuccess: health.lastSuccess ? new Date(health.lastSuccess).toISOString() : undefined,
            lastFailure: health.lastFailure ? new Date(health.lastFailure).toISOString() : undefined,
            lastError: health.lastError,
          },
          performance: perf ? {
            totalRequests: perf.totalRequests,
            successRate: Math.round(perf.successRate * 100) / 100,
            avgLatencyMs: Math.round(perf.avgLatencyMs),
            avgTokens: Math.round(perf.avgTokens),
            consensusWinRate: Math.round(perf.consensusWinRate * 100) / 100,
            rankScore: Math.round(perf.rankScore * 10) / 10,
          } : undefined,
        };
      }),
      timestamp: new Date().toISOString(),
    };
  }, {
    detail: {
      summary: "Get Model Health Status",
      description: "Returns health and performance statistics for all tracked models",
      tags: ["LLM", "Smart Select"],
    },
  })

  .get("/api/llm/smart/candidates", async () => {
    const candidates = await getDefaultCandidateModels();
    
    return {
      candidates: candidates.map(c => ({
        ...c,
        health: getModelHealth(c),
        performance: getModelPerformance(c),
      })),
      count: candidates.length,
    };
  }, {
    detail: {
      summary: "Get Candidate Models",
      description: "Returns the list of candidate models detected from environment configuration",
      tags: ["LLM", "Smart Select"],
    },
  })

  .post("/api/llm/smart/chat", async ({ body }) => {
    const { messages, models, timeout, optimizePrompts, rankingStrategy } = body;

    console.log(`[API] Smart chat request with ${models?.length || 'auto'} models`);

    try {
      let result;

      if (models && models.length > 0) {
        // Use specified models
        const modelSpecs: ModelSpec[] = models.map(m => ({
          provider: m.provider as LLMProviderType,
          model: m.model,
        }));

        result = await smartChat(
          messages.map(m => ({ role: m.role as "system" | "user" | "assistant", content: m.content })),
          {
            candidateModels: modelSpecs,
            timeout,
            optimizePrompts,
            rankingStrategy: rankingStrategy as "performance" | "latency" | "cost" | "balanced" | undefined,
          }
        );
      } else {
        // Auto-detect models
        result = await smartChatAuto(
          messages.map(m => ({ role: m.role as "system" | "user" | "assistant", content: m.content })),
          {
            timeout,
            optimizePrompts,
            rankingStrategy: rankingStrategy as "performance" | "latency" | "cost" | "balanced" | undefined,
          }
        );
      }

      return {
        success: true,
        response: result.response,
        model: result.model,
        latencyMs: result.latencyMs,
        attempts: result.attempts,
        fallbackUsed: result.fallbackUsed,
        failedModels: result.failedModels,
      };
    } catch (error) {
      console.error("[API] Smart chat failed:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }, {
    body: t.Object({
      messages: t.Array(t.Object({
        role: t.Union([t.Literal("system"), t.Literal("user"), t.Literal("assistant")]),
        content: t.String(),
      }), { minItems: 1 }),
      models: t.Optional(t.Array(t.Object({
        provider: t.Union([
          t.Literal("ollama"),
          t.Literal("openai"),
          t.Literal("openrouter"),
        ]),
        model: t.String(),
      }), { description: "Candidate models (if empty, auto-detects from environment)" })),
      timeout: t.Optional(t.Number({ description: "Timeout per model in ms (default: 60000)" })),
      optimizePrompts: t.Optional(t.Boolean({ description: "Optimize prompts for each model family (default: true)" })),
      rankingStrategy: t.Optional(t.Union([
        t.Literal("performance"),
        t.Literal("latency"),
        t.Literal("cost"),
        t.Literal("balanced"),
      ], { description: "Strategy for ranking models (default: balanced)" })),
    }),
    detail: {
      summary: "Smart Chat with Auto-Fallback",
      description: "Send a chat request with automatic model selection and fallback on failure. Models are ranked by performance and automatically switched when rate limited or erroring.",
      tags: ["LLM", "Smart Select"],
    },
  })

  .post("/api/llm/smart/reset/:provider/:model", ({ params }) => {
    const model: ModelSpec = {
      provider: params.provider as LLMProviderType,
      model: params.model,
    };

    try {
      resetModelHealth(model);
      return {
        success: true,
        message: `Reset health for ${params.provider}/${params.model}`,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }, {
    params: t.Object({
      provider: t.String({ description: "Provider name (ollama, openai, openrouter)" }),
      model: t.String({ description: "Model identifier" }),
    }),
    detail: {
      summary: "Reset Model Health",
      description: "Force a model back online by resetting its health status (use when a model was incorrectly marked unavailable)",
      tags: ["LLM", "Smart Select"],
    },
  })

  .delete("/api/llm/smart/stats", () => {
    clearModelStats();
    return {
      success: true,
      message: "All model statistics cleared",
    };
  }, {
    detail: {
      summary: "Clear Model Statistics",
      description: "Clear all model health and performance tracking data",
      tags: ["LLM", "Smart Select"],
    },
  })

  // ============================================
  // Workflow Execution Endpoints
  // ============================================

  .post("/api/research", async ({ body }) => {
    const { symbols, threadId } = body;

    console.log(`[API] Research request for: ${symbols.join(", ")}`);

    try {
      const result = await runResearchWorkflow(symbols, threadId);

      return {
        success: true,
        threadId: result.threadId,
        workflowId: result.workflowId,
        data: {
          marketData: result.marketData,
          news: result.news?.slice(0, 20), // Limit response size
          social: result.social,
        },
        summary: {
          symbolsRequested: symbols,
          marketDataCount: result.marketData?.length || 0,
          newsCount: result.news?.length || 0,
          socialMentions: result.social?.mentions.length || 0,
          trendingSymbols: result.social?.trendingSymbols || [],
          errors: result.errors,
        },
        messages: result.messages.slice(-5), // Last 5 messages
      };
    } catch (error) {
      console.error("[API] Research workflow failed:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }, {
    body: t.Object({
      symbols: t.Array(t.String(), { minItems: 1, description: "Array of stock symbols to research" }),
      threadId: t.Optional(t.String({ description: "Optional thread ID for conversation continuity" })),
    }),
    detail: {
      summary: "Run Research Workflow",
      description: "Executes the research workflow to gather market data, news, and social sentiment for the specified symbols",
      tags: ["Execution"],
    },
  })

  .post("/api/analyze", async ({ body }) => {
    const { symbols, threadId } = body;

    console.log(`[API] Analysis request for: ${symbols.join(", ")}`);

    try {
      const result = await runTradingWorkflow(
        { type: "analysis", symbols },
        threadId
      );

      return {
        success: true,
        threadId: result.threadId,
        workflowId: result.workflowId,
        data: {
          marketData: result.marketData,
          news: result.news?.slice(0, 10),
          social: result.social,
          technical: result.technical,
          fundamental: result.fundamental,
          sentiment: result.sentiment,
        },
        summary: {
          symbolsRequested: symbols,
          errors: result.errors,
        },
        messages: result.messages.slice(-10),
      };
    } catch (error) {
      console.error("[API] Analysis workflow failed:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }, {
    body: t.Object({
      symbols: t.Array(t.String(), { minItems: 1, description: "Array of stock symbols to analyze" }),
      threadId: t.Optional(t.String({ description: "Optional thread ID for conversation continuity" })),
    }),
    detail: {
      summary: "Run Analysis Workflow",
      description: "Executes the full analysis workflow including technical, fundamental, and sentiment analysis",
      tags: ["Execution"],
    },
  })

  .post("/api/trade", async ({ body }) => {
    const { symbols, threadId } = body;

    console.log(`[API] Trade request for: ${symbols.join(", ")}`);

    try {
      const result = await runTradingWorkflow(
        { type: "trade", symbols },
        threadId
      );

      return {
        success: true,
        threadId: result.threadId,
        workflowId: result.workflowId,
        data: {
          // Research data
          marketData: result.marketData,
          news: result.news?.slice(0, 20),
          social: result.social,
          // Analysis data
          technical: result.technical,
          fundamental: result.fundamental,
          sentiment: result.sentiment,
          // Decision data
          decisions: result.decisions,
          riskAssessment: result.riskAssessment,
          orders: result.orders,
        },
        summary: {
          symbolsRequested: symbols,
          decisionsCount: result.decisions?.length || 0,
          errors: result.errors,
        },
        messages: result.messages.slice(-10),
      };
    } catch (error) {
      console.error("[API] Trade workflow failed:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }, {
    body: t.Object({
      symbols: t.Array(t.String(), { minItems: 1, description: "Array of stock symbols for trading" }),
      threadId: t.Optional(t.String({ description: "Optional thread ID for conversation continuity" })),
    }),
    detail: {
      summary: "Run Trading Workflow",
      description: "Executes the complete trading workflow including research, analysis, decision making, and order generation",
      tags: ["Execution"],
    },
  })

  // ============================================
  // Debate Endpoint
  // ============================================

  .post("/api/debate", async ({ body }) => {
    const { symbols, threadId } = body;

    console.log(`[API] Debate request for: ${symbols.join(", ")}`);

    try {
      // Run the full debate workflow (research -> analysis -> debate)
      const result = await runDebateWorkflow(symbols, true, threadId);

      // Extract debates from the result
      const debates = result.debateState?.debates || [];

      return {
        success: true,
        threadId: result.threadId,
        workflowId: result.workflowId,
        debates: debates.map(d => ({
          symbol: d.symbol,
          verdict: d.synthesis.verdict,
          confidence: d.synthesis.confidence,
          summary: d.synthesis.summary,
          recommendation: d.synthesis.recommendation,
          bullCase: {
            thesis: d.bullCase.thesis,
            confidence: d.bullCase.overallConfidence,
            keyPoints: d.bullCase.keyPoints,
          },
          bearCase: {
            thesis: d.bearCase.thesis,
            confidence: d.bearCase.overallConfidence,
            keyRisks: d.bearCase.keyRisks,
          },
          strongestBullPoints: d.synthesis.strongestBullPoints,
          strongestBearPoints: d.synthesis.strongestBearPoints,
          riskRewardRatio: d.synthesis.riskRewardRatio,
        })),
        summary: {
          symbolsAnalyzed: symbols.length,
          bullishCount: debates.filter(d => d.synthesis.verdict === 'bullish').length,
          bearishCount: debates.filter(d => d.synthesis.verdict === 'bearish').length,
          neutralCount: debates.filter(d => d.synthesis.verdict === 'neutral').length,
        },
      };
    } catch (error) {
      console.error("[API] Debate workflow failed:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }, {
    body: t.Object({
      symbols: t.Array(t.String(), { minItems: 1, description: "Array of stock symbols for bull/bear debate" }),
      threadId: t.Optional(t.String({ description: "Optional thread ID for conversation continuity" })),
    }),
    detail: {
      summary: "Run Bull/Bear Debate",
      description: "Executes a structured debate between bull and bear researchers for the specified symbols, producing a balanced recommendation",
      tags: ["Execution"],
    },
  })

  // ============================================
  // Tiered Debate Endpoint
  // ============================================

  .post("/api/debate/tiered", async ({ body }) => {
    const { holdings, watchlist, discovery, config } = body;

    const totalSymbols = holdings.length + watchlist.length + discovery.length;
    console.log(`[API] Tiered debate request: ${totalSymbols} symbols`);
    console.log(`  Holdings: ${holdings.length} (individual debate)`);
    console.log(`  Watchlist: ${watchlist.length} (batch debate)`);
    console.log(`  Discovery: ${discovery.length} (score + top batch)`);

    try {
      // First, gather research data for all symbols (stored as 'debate' type)
      const allSymbols = [...new Set([...holdings, ...watchlist, ...discovery])];
      
      console.log(`[API] Running tiered debate workflow for ${allSymbols.length} unique symbols...`);
      const researchResult = await runTieredDebateWorkflow(allSymbols);
      
      // Build state from research result
      const state = {
        request: { symbols: allSymbols },
        marketData: researchResult.marketData || [],
        news: researchResult.news || [],
        social: researchResult.social,
        analysis: {
          technical: [],
          fundamental: [],
          sentiment: researchResult.social ? {
            overallScore: researchResult.social.overallSentiment || 0,
            score: researchResult.social.overallSentiment || 0,
          } : undefined,
        },
        messages: researchResult.messages || [],
        errors: researchResult.errors || [],
      };

      // Run tiered debate
      const tieredInput: TieredDebateInput = { holdings, watchlist, discovery };
      const result = await executeTieredDebate(tieredInput, state as any, config);

      // Build the response with tiered debate results
      const tieredDebateResults = {
        holdingsDebates: result.holdingsDebates.map(d => ({
          symbol: d.symbol,
          tier: "holdings",
          verdict: d.synthesis.verdict,
          confidence: d.synthesis.confidence,
          summary: d.synthesis.summary,
          recommendation: d.synthesis.recommendation,
          bullCase: {
            thesis: d.bullCase.thesis,
            confidence: d.bullCase.overallConfidence,
            keyPoints: d.bullCase.keyPoints,
          },
          bearCase: {
            thesis: d.bearCase.thesis,
            confidence: d.bearCase.overallConfidence,
            keyRisks: d.bearCase.keyRisks,
          },
          strongestBullPoints: d.synthesis.strongestBullPoints,
          strongestBearPoints: d.synthesis.strongestBearPoints,
          riskRewardRatio: d.synthesis.riskRewardRatio,
        })),
        watchlistDebates: result.watchlistDebates.map(batch => ({
          tier: "watchlist",
          symbols: batch.symbols,
          verdict: batch.verdict,
          confidence: batch.confidence,
          summary: batch.summary,
          symbolAnalysis: batch.symbolAnalysis,
          topOpportunities: batch.topOpportunities,
          topRisks: batch.topRisks,
        })),
        discoveryScores: result.discoveryScores.map(s => ({
          symbol: s.symbol,
          tier: "discovery",
          score: s.score,
          technicalScore: s.technicalScore,
          sentimentScore: s.sentimentScore,
          fundamentalScore: s.fundamentalScore,
          momentumScore: s.momentumScore,
          signals: s.signals,
          recommendation: s.recommendation,
        })),
        discoveryDebates: result.discoveryDebates.map(batch => ({
          tier: "discovery",
          symbols: batch.symbols,
          verdict: batch.verdict,
          confidence: batch.confidence,
          summary: batch.summary,
          symbolAnalysis: batch.symbolAnalysis,
          topOpportunities: batch.topOpportunities,
          topRisks: batch.topRisks,
        })),
        summary: {
          totalSymbols: result.summary.totalSymbols,
          holdingsAnalyzed: result.summary.holdingsAnalyzed,
          watchlistAnalyzed: result.summary.watchlistAnalyzed,
          discoveryScored: result.summary.discoveryScored,
          discoveryDebated: result.summary.discoveryDebated,
          llmCalls: result.summary.llmCalls,
          durationMs: result.summary.durationMs,
          estimatedNonTieredLlmCalls: totalSymbols * 3,
          llmSavings: `${Math.round((1 - result.summary.llmCalls / (totalSymbols * 3)) * 100)}%`,
        },
      };

      // Update the workflow execution with tiered debate results
      if (researchResult.workflowId) {
        const fullOutput = {
          ...researchResult,
          tieredDebateResults,
        };
        await sql`
          UPDATE workflow_executions
          SET output = ${JSON.stringify(fullOutput)}::jsonb
          WHERE id = ${researchResult.workflowId}::uuid
        `;
        console.log(`[API] Updated workflow execution ${researchResult.workflowId} with tiered debate results`);
      }

      return {
        success: true,
        workflowId: researchResult.workflowId,
        threadId: researchResult.threadId,
        ...tieredDebateResults,
      };
    } catch (error) {
      console.error("[API] Tiered debate failed:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }, {
    body: t.Object({
      holdings: t.Array(t.String(), { description: "Symbols you currently hold (full individual debate)" }),
      watchlist: t.Array(t.String(), { description: "Symbols you're watching (batch debate)" }),
      discovery: t.Array(t.String(), { description: "Symbols to scan for opportunities (quick score + top batch)" }),
      config: t.Optional(t.Object({
        watchlistBatchSize: t.Optional(t.Number({ description: "Symbols per watchlist batch (default: 5)" })),
        discoveryBatchSize: t.Optional(t.Number({ description: "Symbols per discovery batch (default: 10)" })),
        discoveryTopN: t.Optional(t.Number({ description: "Top discovery symbols to debate (default: 10)" })),
        discoveryMinScore: t.Optional(t.Number({ description: "Min score for discovery debate (default: 40)" })),
      })),
    }),
    detail: {
      summary: "Run Tiered Bull/Bear Debate",
      description: `Executes an efficient tiered debate system that handles large numbers of symbols:
      
- **Holdings** (Tier 1): Full individual bull/bear/synthesis debate for each symbol you own
- **Watchlist** (Tier 2): Batch debates in groups of 5 symbols
- **Discovery** (Tier 3): Quick scoring (no LLM) for all symbols, then batch debate only the top candidates

This dramatically reduces LLM calls. For 80 symbols (5 holdings, 10 watchlist, 65 discovery), 
the old approach would make ~240 LLM calls. Tiered approach: ~22 calls (90%+ savings).`,
      tags: ["Execution"],
    },
  })

  // ============================================
  // Memory Maintenance Endpoint
  // ============================================

  .post("/api/memory/maintenance", async () => {
    console.log("[API] Memory maintenance triggered");

    try {
      const result = await memoryStore.runMaintenance();

      return {
        success: true,
        timestamp: new Date().toISOString(),
        result: {
          decayed: result.decayed,
          boosted: result.boosted,
          consolidated: result.consolidated,
          cleaned: result.cleaned,
          promoted: result.promoted,
        },
      };
    } catch (error) {
      console.error("[API] Memory maintenance failed:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }, {
    detail: {
      summary: "Run Memory Maintenance",
      description: "Runs all memory maintenance tasks: decay old memories, boost frequently accessed, consolidate duplicates, cleanup old low-importance, and promote valuable learnings to global",
      tags: ["Memory"],
    },
  })

  .post("/api/memory/consolidate", async ({ body }) => {
    const { namespace, threshold } = body;

    console.log(`[API] Memory consolidation for namespace: ${namespace || 'all'}`);

    try {
      let result;
      if (namespace) {
        result = await memoryStore.consolidate(namespace, threshold || 0.9);
        return {
          success: true,
          timestamp: new Date().toISOString(),
          namespace,
          merged: result.merged,
          clusters: result.clusters,
        };
      } else {
        result = await memoryStore.consolidateAll(threshold || 0.9);
        return {
          success: true,
          timestamp: new Date().toISOString(),
          totalMerged: result.total,
          byNamespace: result.byNamespace,
        };
      }
    } catch (error) {
      console.error("[API] Memory consolidation failed:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }, {
    body: t.Object({
      namespace: t.Optional(t.String({ description: "Specific namespace to consolidate (default: all)" })),
      threshold: t.Optional(t.Number({ description: "Similarity threshold 0-1 (default: 0.9)" })),
    }),
    detail: {
      summary: "Consolidate Similar Memories",
      description: "Finds and merges semantically similar memories to reduce duplicates",
      tags: ["Memory"],
    },
  })

  .post("/api/memory/export", async ({ body }) => {
    const { namespace, type, minImportance, includeEmbeddings } = body;

    console.log(`[API] Memory export request`);

    try {
      const result = await memoryStore.exportMemories({
        namespace,
        type: type as "semantic" | "episodic" | "procedural" | undefined,
        minImportance,
        includeEmbeddings,
      });

      return {
        success: true,
        ...result,
      };
    } catch (error) {
      console.error("[API] Memory export failed:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }, {
    body: t.Object({
      namespace: t.Optional(t.String({ description: "Filter by namespace" })),
      type: t.Optional(t.Union([
        t.Literal("semantic"),
        t.Literal("episodic"),
        t.Literal("procedural"),
      ], { description: "Filter by memory type" })),
      minImportance: t.Optional(t.Number({ description: "Minimum importance threshold (default: 0)" })),
      includeEmbeddings: t.Optional(t.Boolean({ description: "Include embedding vectors in export (default: false)" })),
    }),
    detail: {
      summary: "Export Memories",
      description: "Export memories to JSON format for backup or sharing",
      tags: ["Memory"],
    },
  })

  // ============================================
  // WebSocket Endpoint
  // ============================================

  .ws("/ws", {
    body: t.Object({
      type: t.Union([
        t.Literal("subscribe"),
        t.Literal("unsubscribe"),
        t.Literal("ping"),
      ]),
      channel: t.Optional(t.String()),
      workflowId: t.Optional(t.String()),
    }),
    open(ws) {
      const clientId = crypto.randomUUID();
      ws.data = { id: clientId };
      wsClientCount++;
      
      // Subscribe to general updates by default
      ws.subscribe("system");
      
      ws.send(JSON.stringify({
        type: "connected",
        clientId,
        timestamp: new Date().toISOString(),
      }));
      
      console.log(`[WS] Client connected: ${clientId} (total: ${wsClientCount})`);
    },
    message(ws, message) {
      const { type, channel, workflowId } = message;
      
      switch (type) {
        case "subscribe":
          if (workflowId) {
            ws.subscribe(`workflow:${workflowId}`);
            ws.send(JSON.stringify({
              type: "subscribed",
              channel: `workflow:${workflowId}`,
            }));
          } else if (channel === "workflows") {
            ws.subscribe("workflows:all");
            ws.send(JSON.stringify({
              type: "subscribed",
              channel: "workflows:all",
            }));
          } else if (channel === "llm") {
            ws.subscribe("llm:events");
            ws.send(JSON.stringify({
              type: "subscribed",
              channel: "llm:events",
            }));
          }
          break;
          
        case "unsubscribe":
          if (workflowId) {
            ws.unsubscribe(`workflow:${workflowId}`);
          } else if (channel === "workflows") {
            ws.unsubscribe("workflows:all");
          } else if (channel === "llm") {
            ws.unsubscribe("llm:events");
          }
          ws.send(JSON.stringify({
            type: "unsubscribed",
            channel: workflowId ? `workflow:${workflowId}` : channel,
          }));
          break;
          
        case "ping":
          ws.send(JSON.stringify({
            type: "pong",
            timestamp: new Date().toISOString(),
          }));
          break;
      }
    },
    close(ws) {
      wsClientCount = Math.max(0, wsClientCount - 1);
      console.log(`[WS] Client disconnected: ${ws.data?.id} (total: ${wsClientCount})`);
    },
  })

  // ============================================
  // Error Handler
  // ============================================

  .onError(({ code, error }) => {
    console.error(`[Error] ${code}:`, error);
    return {
      error: error.message || "Internal server error",
      code,
    };
  });

// ============================================
// Startup
// ============================================

async function start() {
  console.log("Starting BrokeAgent...");

  // Test database connection
  const dbConnected = await testConnection();
  if (!dbConnected) {
    console.error("Failed to connect to database");
    process.exit(1);
  }
  console.log("Database connected");

  // Initialize database extensions
  await initializeDatabase();

  // Configure embedding provider for memory store
  try {
    const embeddingProvider = createDefaultEmbeddingProvider();
    memoryStore.setEmbeddingProvider(embeddingProvider);
  } catch (error) {
    console.warn("Embedding provider not configured:", (error as Error).message);
    console.warn("Memory search will fall back to text-based search");
  }

  // Load agents from database
  await loadAgentsFromDatabase();

  // Initialize LLM provider
  await llmProvider.initialize();
  const llmConfig = llmProvider.getConfig();
  console.log(`LLM Provider: ${llmConfig.provider}/${llmConfig.model}`);

  // Start server
  const port = Number(process.env.PORT) || 3050;
  app.listen(port);

  // Store reference for WebSocket broadcasting
  globalApp = app;

  // Set up workflow event emitter to broadcast via WebSocket
  setWorkflowEventEmitter((event: WorkflowEvent) => {
    if (globalApp?.server) {
      const message = JSON.stringify(event);
      globalApp.server.publish(`workflow:${event.workflowId}`, message);
      globalApp.server.publish("workflows:all", message);
    }
  });

  // Set up LLM event listener to broadcast via WebSocket
  setLLMEventListener((event: LLMUsageEvent) => {
    if (globalApp?.server) {
      // Broadcast LLM events to all workflow subscribers
      const workflowEvent: WorkflowEvent = {
        type: "workflow:llm",
        workflowId: "global", // LLM events are global
        data: {
          llmEvent: event.type,
          provider: event.provider,
          model: event.model,
          latencyMs: event.latencyMs,
          tokens: event.tokens,
          error: event.error,
          fallbackFrom: event.fallbackFrom,
        },
        timestamp: event.timestamp,
      };
      const message = JSON.stringify(workflowEvent);
      globalApp.server.publish("workflows:all", message);
      globalApp.server.publish("llm:events", message);
    }
  });

  console.log(`
  BrokeAgent API is running!

  Local:       http://localhost:${port}
  Health:      http://localhost:${port}/health
  OpenAPI:     http://localhost:${port}/openapi
  OpenAPI JSON: http://localhost:${port}/openapi/json
  WebSocket:   ws://localhost:${port}/ws

  API Endpoints:
    GET  /api/agents              - List all agents
    GET  /api/workflows           - List all workflows
    GET  /api/portfolio           - Get portfolio positions
    GET  /api/orders              - List orders
    GET  /api/news                - Get news articles
    GET  /api/market/quotes       - Get latest quotes

  LLM Configuration:
    GET  /api/llm/providers       - List available providers
    GET  /api/llm/models          - List available models
    GET  /api/llm/config          - Get current configuration
    POST /api/llm/config          - Switch provider/model

  Workflow Execution:
    POST /api/research  - Run research workflow
    POST /api/analyze   - Run analysis workflow
    POST /api/trade     - Run trading workflow

  Example:
    curl -X POST http://localhost:${port}/api/research \\
      -H "Content-Type: application/json" \\
      -d '{"symbols": ["AAPL", "MSFT"]}'

  Switch LLM Provider:
    curl -X POST http://localhost:${port}/api/llm/config \\
      -H "Content-Type: application/json" \\
      -d '{"provider": "openrouter", "model": "anthropic/claude-3.5-sonnet"}'

  WebSocket Example:
    const ws = new WebSocket('ws://localhost:${port}/ws');
    ws.onopen = () => ws.send(JSON.stringify({ type: 'subscribe', channel: 'workflows' }));
  `);
}

// ============================================
// Graceful Shutdown
// ============================================

let isShuttingDown = false;

async function gracefulShutdown(signal: string) {
  if (isShuttingDown) {
    console.log("Shutdown already in progress...");
    return;
  }
  
  isShuttingDown = true;
  console.log(`\n[${signal}] Initiating graceful shutdown...`);

  const shutdownTimeout = setTimeout(() => {
    console.error("Shutdown timed out after 30 seconds, forcing exit");
    process.exit(1);
  }, 30000);

  try {
    // 1. Stop accepting new connections
    if (globalApp?.server) {
      console.log("  Stopping HTTP server...");
      globalApp.server.stop();
    }

    // 2. Notify connected WebSocket clients
    if (globalApp?.server) {
      console.log(`  Notifying ${wsClientCount} WebSocket clients...`);
      globalApp.server.publish("system", JSON.stringify({
        type: "server:shutdown",
        message: "Server is shutting down",
        timestamp: new Date().toISOString(),
      }));
      
      // Give clients a moment to disconnect gracefully
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    // 3. Run memory maintenance (save any pending changes)
    console.log("  Running memory maintenance...");
    try {
      const maintenanceResult = await memoryStore.runMaintenance();
      console.log(`    Decayed: ${maintenanceResult.decayed}, Consolidated: ${maintenanceResult.consolidated}`);
    } catch (error) {
      console.warn("  Memory maintenance failed:", (error as Error).message);
    }

    // 4. Close cache connection
    console.log("  Closing cache connection...");
    try {
      await cacheService.close();
    } catch (error) {
      console.warn("  Cache close failed:", (error as Error).message);
    }

    // 5. Close database connection
    console.log("  Closing database connection...");
    await closeDatabase();

    clearTimeout(shutdownTimeout);
    console.log("Shutdown complete. Goodbye!");
    process.exit(0);
  } catch (error) {
    console.error("Error during shutdown:", error);
    clearTimeout(shutdownTimeout);
    process.exit(1);
  }
}

// Handle shutdown signals
process.on("SIGINT", () => gracefulShutdown("SIGINT"));
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));

// Handle uncaught errors
process.on("uncaughtException", (error) => {
  console.error("[FATAL] Uncaught exception:", error);
  gracefulShutdown("uncaughtException");
});

process.on("unhandledRejection", (reason, promise) => {
  console.error("[FATAL] Unhandled rejection at:", promise, "reason:", reason);
  // Don't exit on unhandled rejections, but log them
});

// Start the application
start().catch((error) => {
  console.error("Failed to start:", error);
  process.exit(1);
});

export { app };
