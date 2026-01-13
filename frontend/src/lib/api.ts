// API client for BrokeAgent backend

const API_BASE_URL = import.meta.env.PUBLIC_API_URL || "http://localhost:3050";

interface ApiResponse<T> {
  data?: T;
  error?: string;
}

async function request<T>(
  endpoint: string,
  options?: RequestInit & { timeout?: number }
): Promise<ApiResponse<T>> {
  try {
    // Default timeout of 30s, can be overridden
    const timeout = options?.timeout || 30000;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    const response = await fetch(`${API_BASE_URL}${endpoint}`, {
      headers: {
        "Content-Type": "application/json",
        ...options?.headers,
      },
      ...options,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    const data = await response.json();

    if (!response.ok) {
      return { error: data.error || `HTTP ${response.status}` };
    }

    return { data };
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      return { error: "Request timeout - the workflow may still be running in the background" };
    }
    return {
      error: error instanceof Error ? error.message : "Network error",
    };
  }
}

// Health & Status
export const api = {
  // Health check
  health: () => request<{
    status: "healthy" | "unhealthy";
    timestamp: string;
    services: {
      database: "connected" | "disconnected";
      memory: { totalMemories: number; byType: Record<string, number> };
    };
  }>("/health"),

  // Agents
  agents: {
    list: () =>
      request<{
        agents: Array<{
          id: string;
          type: string;
          name: string;
          description?: string;
          enabled: boolean;
          created_at?: string;
        }>;
      }>("/api/agents"),

    get: (id: string) =>
      request<{
        agent: {
          id: string;
          type: string;
          name: string;
          description?: string;
          system_prompt?: string;
          tools?: string[];
          config?: Record<string, unknown>;
          enabled: boolean;
        };
      }>(`/api/agents/${id}`),
  },

  // Workflows
  workflows: {
    list: () =>
      request<{
        workflows: Array<{
          id: string;
          name: string;
          description?: string;
          trigger_type: string;
          enabled: boolean;
          created_at?: string;
        }>;
      }>("/api/workflows"),

    executions: (limit?: number) =>
      request<{
        executions: Array<{
          id: string;
          workflow_id: string;
          thread_id: string;
          trigger_type: string;
          status: string;
          current_step?: string;
          started_at: string;
          completed_at?: string;
          error?: string;
        }>;
      }>(`/api/workflows/executions${limit ? `?limit=${limit}` : ""}`),

    execution: (id: string) =>
      request<{
        execution: Record<string, unknown>;
        agentExecutions: Array<{
          id: string;
          agent_id: string;
          agent_name: string;
          agent_type: string;
          started_at: string;
          completed_at?: string;
          status: string;
        }>;
      }>(`/api/workflows/executions/${id}`),
  },

  // Portfolio
  portfolio: {
    get: () =>
      request<{
        account: {
          id: string;
          name: string;
          cash: number;
          total_value?: number;
          total_pnl?: number;
          total_pnl_percent?: number;
          mode: string;
          currency: string;
        } | null;
        positions: Array<{
          symbol: string;
          quantity: number;
          avg_cost: number;
          current_price?: number;
          market_value?: number;
          unrealized_pnl?: number;
          unrealized_pnl_percent?: number;
          portfolio_weight?: number;
        }>;
      }>("/api/portfolio"),

    decisions: (limit?: number) =>
      request<{
        decisions: Array<{
          id: string;
          symbol: string;
          action: string;
          confidence: number;
          reasoning?: string;
          executed: boolean;
          outcome_pnl?: number;
          created_at: string;
          workflow_status?: string;
        }>;
      }>(`/api/portfolio/decisions${limit ? `?limit=${limit}` : ""}`),
  },

  // Market Data
  market: {
    quotes: () =>
      request<{
        quotes: Array<{
          symbol: string;
          price: number;
          change: number;
          change_percent: number;
          volume: number;
          quote_time: string;
        }>;
      }>("/api/market/quotes"),

    symbol: (symbol: string) =>
      request<{
        symbol: string;
        quotes: Array<{
          price: number;
          change: number;
          change_percent: number;
          volume: number;
          quote_time: string;
        }>;
      }>(`/api/market/quotes/${symbol}`),
  },

  // Orders
  orders: {
    list: (options?: { status?: string; limit?: number }) => {
      const params = new URLSearchParams();
      if (options?.status) params.set("status", options.status);
      if (options?.limit) params.set("limit", options.limit.toString());
      const query = params.toString();
      return request<{
        orders: Array<{
          id: string;
          symbol: string;
          side: "buy" | "sell";
          quantity: number;
          price?: number;
          status: string;
          created_at: string;
          filled_at?: string;
        }>;
      }>(`/api/orders${query ? `?${query}` : ""}`);
    },
  },

  // News
  news: {
    list: (options?: { symbol?: string; limit?: number }) => {
      const params = new URLSearchParams();
      if (options?.symbol) params.set("symbol", options.symbol);
      if (options?.limit) params.set("limit", options.limit.toString());
      const query = params.toString();
      return request<{
        news: Array<{
          id: string;
          headline: string;
          summary?: string;
          source: string;
          symbols: string[];
          sentiment_score?: number;
          published_at: string;
        }>;
      }>(`/api/news${query ? `?${query}` : ""}`);
    },
  },

  // Memory
  memory: {
    stats: () =>
      request<{
        stats: {
          total: number;
          byType: Record<string, number>;
          byNamespace: Record<string, number>;
          byAgent: Record<string, number>;
        };
      }>("/api/memory/stats"),

    search: (query: string, options?: { namespace?: string; type?: string; limit?: number }) =>
      request<{
        results: Array<{
          id: string;
          content: string;
          type: string;
          namespace: string;
          similarity?: number;
          score?: number;
          metadata?: Record<string, unknown>;
        }>;
      }>("/api/memory/search", {
        method: "POST",
        body: JSON.stringify({ query, ...options }),
      }),

    byNamespace: (namespace: string) =>
      request<{
        memories: Array<{
          id: string;
          content: string;
          type: string;
          namespace: string;
          importance?: number;
          metadata?: Record<string, unknown>;
        }>;
      }>(`/api/memory/namespace/${encodeURIComponent(namespace)}`),
  },

  // Workflow Execution
  execute: {
    research: (symbols: string[], threadId?: string) =>
      request<{
        success: boolean;
        threadId: string;
        workflowId: string;
        data: Record<string, unknown>;
        summary: Record<string, unknown>;
        messages: Array<{ role: string; content: string }>;
        error?: string;
      }>("/api/research", {
        method: "POST",
        body: JSON.stringify({ symbols, threadId }),
      }),

    analyze: (symbols: string[], threadId?: string) =>
      request<{
        success: boolean;
        threadId: string;
        workflowId: string;
        data: Record<string, unknown>;
        summary: Record<string, unknown>;
        messages: Array<{ role: string; content: string }>;
        error?: string;
      }>("/api/analyze", {
        method: "POST",
        body: JSON.stringify({ symbols, threadId }),
        timeout: 120000, // 2 minutes for analysis
      }),

    trade: (symbols: string[], threadId?: string) =>
      request<{
        success: boolean;
        threadId: string;
        workflowId: string;
        data: Record<string, unknown>;
        summary: Record<string, unknown>;
        messages: Array<{ role: string; content: string }>;
        error?: string;
      }>("/api/trade", {
        method: "POST",
        body: JSON.stringify({ symbols, threadId }),
        timeout: 180000, // 3 minutes for trade
      }),

    debate: (symbols: string[], threadId?: string) =>
      request<{
        success: boolean;
        threadId: string;
        workflowId: string;
        debates: Array<{
          symbol: string;
          verdict: "bullish" | "bearish" | "neutral";
          confidence: number;
          summary: string;
          recommendation: string;
          bullCase: {
            thesis: string;
            confidence: number;
            keyPoints: string[];
          };
          bearCase: {
            thesis: string;
            confidence: number;
            keyRisks: string[];
          };
          strongestBullPoints: string[];
          strongestBearPoints: string[];
          riskRewardRatio?: number;
        }>;
        summary: {
          symbolsAnalyzed: number;
          bullishCount: number;
          bearishCount: number;
          neutralCount: number;
        };
        error?: string;
      }>("/api/debate", {
        method: "POST",
        body: JSON.stringify({ symbols, threadId }),
        timeout: 300000, // 5 minutes timeout for debate (many LLM calls)
      }),

    tieredDebate: (
      holdings: string[],
      watchlist: string[],
      discovery: string[],
      config?: {
        watchlistBatchSize?: number;
        discoveryBatchSize?: number;
        discoveryTopN?: number;
        discoveryMinScore?: number;
      }
    ) =>
      request<{
        success: boolean;
        holdingsDebates: Array<{
          symbol: string;
          tier: "holdings";
          verdict: "bullish" | "bearish" | "neutral";
          confidence: number;
          summary: string;
          recommendation: string;
          bullCase: {
            thesis: string;
            confidence: number;
            keyPoints: string[];
          };
          bearCase: {
            thesis: string;
            confidence: number;
            keyRisks: string[];
          };
          strongestBullPoints: string[];
          strongestBearPoints: string[];
          riskRewardRatio?: number;
        }>;
        watchlistDebates: Array<{
          tier: "watchlist";
          symbols: string[];
          verdict: "bullish" | "bearish" | "mixed" | "neutral";
          confidence: number;
          summary: string;
          symbolAnalysis: Array<{
            symbol: string;
            verdict: "bullish" | "bearish" | "neutral";
            confidence: number;
            keyPoint: string;
            recommendation: string;
          }>;
          topOpportunities: string[];
          topRisks: string[];
        }>;
        discoveryScores: Array<{
          symbol: string;
          tier: "discovery";
          score: number;
          technicalScore: number;
          sentimentScore: number;
          fundamentalScore: number;
          momentumScore: number;
          signals: string[];
          recommendation: "strong_buy" | "buy" | "hold" | "sell" | "strong_sell";
        }>;
        discoveryDebates: Array<{
          tier: "discovery";
          symbols: string[];
          verdict: "bullish" | "bearish" | "mixed" | "neutral";
          confidence: number;
          summary: string;
          symbolAnalysis: Array<{
            symbol: string;
            verdict: "bullish" | "bearish" | "neutral";
            confidence: number;
            keyPoint: string;
            recommendation: string;
          }>;
          topOpportunities: string[];
          topRisks: string[];
        }>;
        summary: {
          totalSymbols: number;
          holdingsAnalyzed: number;
          watchlistAnalyzed: number;
          discoveryScored: number;
          discoveryDebated: number;
          llmCalls: number;
          durationMs: number;
          estimatedNonTieredLlmCalls: number;
          llmSavings: string;
        };
        error?: string;
      }>("/api/debate/tiered", {
        method: "POST",
        body: JSON.stringify({ holdings, watchlist, discovery, config }),
        timeout: 600000, // 10 minutes for tiered debate (many symbols)
      }),
  },

  // Schedules
  schedules: {
    list: () =>
      request<{
        schedules: Array<{
          id: string;
          name: string;
          description?: string;
          trigger: {
            type: "cron" | "interval" | "event";
            expression?: string;
            intervalMs?: number;
            eventType?: string;
          };
          request: {
            type: string;
            symbols: string[];
          };
          enabled: boolean;
          maxConcurrent: number;
          retryOnFail: boolean;
          tags?: string[];
          createdAt: string;
          lastRunAt?: string;
          nextRunAt?: string;
        }>;
      }>("/api/schedules"),

    presets: () =>
      request<{
        presets: Array<{
          key: string;
          name: string;
          description: string;
          trigger: {
            type: "cron" | "interval" | "event";
            expression?: string;
            intervalMs?: number;
            eventType?: string;
          };
          requestType: string;
        }>;
      }>("/api/schedules/presets"),

    get: (id: string) =>
      request<{
        schedule: {
          id: string;
          name: string;
          description?: string;
          trigger: {
            type: "cron" | "interval" | "event";
            expression?: string;
            intervalMs?: number;
            eventType?: string;
          };
          request: {
            type: string;
            symbols: string[];
          };
          enabled: boolean;
          maxConcurrent: number;
          retryOnFail: boolean;
          tags?: string[];
          createdAt: string;
          lastRunAt?: string;
          nextRunAt?: string;
        };
      }>(`/api/schedules/${id}`),

    create: (data: {
      name: string;
      description?: string;
      trigger: {
        type: "cron" | "interval" | "event";
        expression?: string;
        intervalMs?: number;
        eventType?: string;
      };
      request: {
        type: string;
        symbols: string[];
      };
      enabled?: boolean;
      maxConcurrent?: number;
      retryOnFail?: boolean;
      tags?: string[];
    }) =>
      request<{
        success: boolean;
        scheduleId: string;
      }>("/api/schedules", {
        method: "POST",
        body: JSON.stringify(data),
      }),

    createFromPreset: (presetKey: string, symbols: string[]) =>
      request<{
        success: boolean;
        scheduleId: string;
      }>(`/api/schedules/preset/${presetKey}`, {
        method: "POST",
        body: JSON.stringify({ symbols }),
      }),

    delete: (id: string) =>
      request<{ success: boolean }>(`/api/schedules/${id}`, {
        method: "DELETE",
      }),

    enable: (id: string) =>
      request<{ success: boolean }>(`/api/schedules/${id}/enable`, {
        method: "POST",
      }),

    disable: (id: string) =>
      request<{ success: boolean }>(`/api/schedules/${id}/disable`, {
        method: "POST",
      }),

    runNow: (id: string) =>
      request<{
        success: boolean;
        executionId?: string;
      }>(`/api/schedules/${id}/run`, {
        method: "POST",
      }),

    history: (id: string, limit?: number) =>
      request<{
        history: Array<{
          id: string;
          scheduleId: string;
          status: "pending" | "running" | "completed" | "failed";
          startedAt: string;
          completedAt?: string;
          error?: string;
          workflowExecutionId?: string;
        }>;
      }>(`/api/schedules/${id}/history${limit ? `?limit=${limit}` : ""}`),

    triggerEvent: (eventType: string, payload?: unknown) =>
      request<{ success: boolean }>(`/api/schedules/event/${eventType}`, {
        method: "POST",
        body: JSON.stringify({ payload }),
      }),
  },

  // Memory maintenance
  maintenance: {
    runMemoryMaintenance: () =>
      request<{
        success: boolean;
        timestamp: string;
        result: {
          decayed: number;
          boosted: number;
          consolidated: number;
          cleaned: number;
          promoted: number;
        };
        error?: string;
      }>("/api/memory/maintenance", {
        method: "POST",
      }),

    consolidateMemories: (namespace?: string, threshold?: number) =>
      request<{
        success: boolean;
        timestamp: string;
        totalMerged?: number;
        merged?: number;
        byNamespace?: Record<string, number>;
        clusters?: Array<{ kept: string; removed: string[]; similarity: number }>;
        error?: string;
      }>("/api/memory/consolidate", {
        method: "POST",
        body: JSON.stringify({ namespace, threshold }),
      }),
  },
};

// WebSocket client
export function createWebSocketClient(onMessage: (event: unknown) => void) {
  const wsUrl = API_BASE_URL.replace(/^http/, "ws") + "/ws";
  console.log("[WS] Connecting to:", wsUrl);
  
  const ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    console.log("[WS] Connected successfully");
  };

  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      onMessage(data);
    } catch (e) {
      console.error("[WS] Failed to parse message:", e);
    }
  };

  ws.onclose = (event) => {
    console.log("[WS] Disconnected - Code:", event.code, "Reason:", event.reason || "none");
  };

  ws.onerror = (error) => {
    console.error("[WS] Connection error - this usually means the backend is not running or WebSocket endpoint is unreachable");
  };

  return {
    subscribe: (channel: string, workflowId?: string) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "subscribe", channel, workflowId }));
      } else {
        console.warn("[WS] Cannot subscribe - socket not open, state:", ws.readyState);
      }
    },
    unsubscribe: (channel: string, workflowId?: string) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "unsubscribe", channel, workflowId }));
      }
    },
    ping: () => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "ping" }));
      }
    },
    close: () => {
      ws.close();
    },
    ws,
  };
}

export default api;
