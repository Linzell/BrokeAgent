import { z } from "zod";
import { UUIDSchema, TimestampSchema, MessageSchema } from "./message.schema";
import { AgentExecutionSchema } from "./agent.schema";

// SSE Event types
export const SSEEventTypeSchema = z.enum([
  // Message events
  "message.created",
  "message.streaming",
  "message.completed",

  // Agent events
  "agent.started",
  "agent.tool_call",
  "agent.tool_result",
  "agent.completed",
  "agent.error",

  // Workflow events
  "workflow.started",
  "workflow.triggered",
  "workflow.agent_switched",
  "workflow.completed",
  "workflow.failed",
  "workflow.error",

  // System events
  "heartbeat",
  "error",
]);

// Base SSE event
export const BaseSSEEventSchema = z.object({
  id: UUIDSchema,
  type: SSEEventTypeSchema,
  timestamp: TimestampSchema,
  conversationId: UUIDSchema.optional(),
});

// Message streaming event
export const MessageStreamingEventSchema = BaseSSEEventSchema.extend({
  type: z.literal("message.streaming"),
  data: z.object({
    messageId: UUIDSchema,
    chunk: z.string(),
    done: z.boolean(),
  }),
});

// Message completed event
export const MessageCompletedEventSchema = BaseSSEEventSchema.extend({
  type: z.literal("message.completed"),
  data: z.object({
    message: MessageSchema,
  }),
});

// Agent started event
export const AgentStartedEventSchema = BaseSSEEventSchema.extend({
  type: z.literal("agent.started"),
  data: z.object({
    executionId: UUIDSchema,
    agentId: UUIDSchema,
    agentName: z.string(),
  }),
});

// Agent tool call event
export const AgentToolCallEventSchema = BaseSSEEventSchema.extend({
  type: z.literal("agent.tool_call"),
  data: z.object({
    executionId: UUIDSchema,
    toolName: z.string(),
    input: z.record(z.string(), z.unknown()),
  }),
});

// Agent tool result event
export const AgentToolResultEventSchema = BaseSSEEventSchema.extend({
  type: z.literal("agent.tool_result"),
  data: z.object({
    executionId: UUIDSchema,
    toolName: z.string(),
    output: z.unknown(),
    duration: z.number(),
  }),
});

// Agent completed event
export const AgentCompletedEventSchema = BaseSSEEventSchema.extend({
  type: z.literal("agent.completed"),
  data: z.object({
    execution: AgentExecutionSchema,
  }),
});

// Workflow started event
export const WorkflowStartedEventSchema = BaseSSEEventSchema.extend({
  type: z.literal("workflow.started"),
  data: z.object({
    executionId: UUIDSchema,
    workflowId: UUIDSchema,
    workflowName: z.string(),
  }),
});

// Workflow completed event
export const WorkflowCompletedEventSchema = BaseSSEEventSchema.extend({
  type: z.literal("workflow.completed"),
  data: z.object({
    executionId: UUIDSchema,
    workflowId: UUIDSchema,
    output: z.unknown().optional(),
  }),
});

// Workflow triggered event
export const WorkflowTriggeredEventSchema = BaseSSEEventSchema.extend({
  type: z.literal("workflow.triggered"),
  data: z.object({
    workflowId: UUIDSchema,
    triggeredBy: z.string(),
  }),
});

// Workflow failed event
export const WorkflowFailedEventSchema = BaseSSEEventSchema.extend({
  type: z.literal("workflow.failed"),
  data: z.object({
    executionId: UUIDSchema,
    workflowId: UUIDSchema,
    error: z.string(),
  }),
});

// Agent error event
export const AgentErrorEventSchema = BaseSSEEventSchema.extend({
  type: z.literal("agent.error"),
  data: z.object({
    executionId: UUIDSchema.optional(),
    agentId: UUIDSchema,
    error: z.string(),
  }),
});

// Error event
export const ErrorEventSchema = BaseSSEEventSchema.extend({
  type: z.literal("error"),
  data: z.object({
    code: z.string(),
    message: z.string(),
    details: z.record(z.string(), z.unknown()).optional(),
  }),
});

// Union of all SSE events
export const SSEEventSchema = z.discriminatedUnion("type", [
  MessageStreamingEventSchema,
  MessageCompletedEventSchema,
  AgentStartedEventSchema,
  AgentToolCallEventSchema,
  AgentToolResultEventSchema,
  AgentCompletedEventSchema,
  AgentErrorEventSchema,
  WorkflowStartedEventSchema,
  WorkflowTriggeredEventSchema,
  WorkflowCompletedEventSchema,
  WorkflowFailedEventSchema,
  ErrorEventSchema,
]);

// Types
export type SSEEventType = z.infer<typeof SSEEventTypeSchema>;
export type BaseSSEEvent = z.infer<typeof BaseSSEEventSchema>;
export type MessageStreamingEvent = z.infer<typeof MessageStreamingEventSchema>;
export type MessageCompletedEvent = z.infer<typeof MessageCompletedEventSchema>;
export type AgentStartedEvent = z.infer<typeof AgentStartedEventSchema>;
export type AgentToolCallEvent = z.infer<typeof AgentToolCallEventSchema>;
export type AgentToolResultEvent = z.infer<typeof AgentToolResultEventSchema>;
export type AgentCompletedEvent = z.infer<typeof AgentCompletedEventSchema>;
export type AgentErrorEvent = z.infer<typeof AgentErrorEventSchema>;
export type WorkflowStartedEvent = z.infer<typeof WorkflowStartedEventSchema>;
export type WorkflowTriggeredEvent = z.infer<typeof WorkflowTriggeredEventSchema>;
export type WorkflowCompletedEvent = z.infer<typeof WorkflowCompletedEventSchema>;
export type WorkflowFailedEvent = z.infer<typeof WorkflowFailedEventSchema>;
export type ErrorEvent = z.infer<typeof ErrorEventSchema>;
export type SSEEvent = z.infer<typeof SSEEventSchema>;
