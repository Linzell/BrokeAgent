import { z } from "zod";
import { UUIDSchema, TimestampSchema } from "./message.schema";

// Agent type - all specialized agent types for trading system
export const AgentTypeSchema = z.enum([
  // Orchestration
  "orchestrator",

  // Research Team
  "news_analyst",
  "social_analyst",
  "market_data_agent",

  // Analysis Team
  "technical_analyst",
  "fundamental_analyst",
  "sentiment_analyst",

  // Decision Team
  "portfolio_manager",
  "risk_manager",
  "order_executor",

  // Debate Agents (optional)
  "bull_researcher",
  "bear_researcher",

  // Legacy/Generic
  "chat",
  "task",
  "research",
]);

// Agent status
export const AgentStatusSchema = z.enum(["idle", "running", "completed", "failed"]);

// Tool definition
export const ToolDefinitionSchema = z.object({
  name: z.string(),
  description: z.string(),
  parameters: z.record(z.string(), z.unknown()).optional(),
});

// MCP Server definition
export const MCPServerSchema = z.object({
  id: UUIDSchema,
  name: z.string(),
  url: z.string().url(),
  tools: z.array(ToolDefinitionSchema),
  enabled: z.boolean(),
});

// Agent definition
export const AgentSchema = z.object({
  id: UUIDSchema,
  type: AgentTypeSchema,
  name: z.string(),
  description: z.string().optional(),
  systemPrompt: z.string().optional(),
  tools: z.array(ToolDefinitionSchema),
  mcpServers: z.array(UUIDSchema).optional(),
  config: z.record(z.string(), z.unknown()).optional(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});

// Agent execution
export const AgentExecutionSchema = z.object({
  id: UUIDSchema,
  agentId: UUIDSchema,
  conversationId: UUIDSchema,
  status: AgentStatusSchema,
  input: z.string(),
  output: z.string().optional(),
  toolCalls: z
    .array(
      z.object({
        toolName: z.string(),
        input: z.record(z.string(), z.unknown()),
        output: z.unknown().optional(),
        duration: z.number().optional(),
      }),
    )
    .optional(),
  startedAt: TimestampSchema,
  completedAt: TimestampSchema.optional(),
  error: z.string().optional(),
});

// Types
export type AgentType = z.infer<typeof AgentTypeSchema>;
export type AgentStatus = z.infer<typeof AgentStatusSchema>;
export type ToolDefinition = z.infer<typeof ToolDefinitionSchema>;
export type MCPServer = z.infer<typeof MCPServerSchema>;
export type Agent = z.infer<typeof AgentSchema>;
export type AgentExecution = z.infer<typeof AgentExecutionSchema>;
