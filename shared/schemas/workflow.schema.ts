import { z } from "zod";
import { UUIDSchema, TimestampSchema } from "./message.schema";

// Workflow trigger type
export const WorkflowTriggerTypeSchema = z.enum(["manual", "schedule", "event"]);

// Workflow status
export const WorkflowStatusSchema = z.enum([
  "pending",
  "running",
  "completed",
  "failed",
  "cancelled",
]);

// Schedule definition (cron)
export const ScheduleSchema = z.object({
  cron: z.string(),
  timezone: z.string().default("UTC"),
  enabled: z.boolean().default(true),
});

// Workflow definition
export const WorkflowSchema = z.object({
  id: UUIDSchema,
  name: z.string(),
  description: z.string().optional(),
  triggerType: WorkflowTriggerTypeSchema,
  schedule: ScheduleSchema.optional(),
  entryAgentId: UUIDSchema, // Orchestrator agent
  config: z.record(z.string(), z.unknown()).optional(),
  enabled: z.boolean().default(true),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});

// Workflow execution
export const WorkflowExecutionSchema = z.object({
  id: UUIDSchema,
  workflowId: UUIDSchema,
  conversationId: UUIDSchema,
  status: WorkflowStatusSchema,
  triggerType: WorkflowTriggerTypeSchema,
  triggeredBy: z.string().optional(), // userId or "scheduler"
  input: z.record(z.string(), z.unknown()).optional(),
  output: z.record(z.string(), z.unknown()).optional(),
  agentExecutions: z.array(UUIDSchema),
  startedAt: TimestampSchema,
  completedAt: TimestampSchema.optional(),
  error: z.string().optional(),
});

// Trigger workflow request
export const TriggerWorkflowRequestSchema = z.object({
  workflowId: UUIDSchema,
  input: z.record(z.string(), z.unknown()).optional(),
  userId: UUIDSchema.optional(),
});

// Types
export type WorkflowTriggerType = z.infer<typeof WorkflowTriggerTypeSchema>;
export type WorkflowStatus = z.infer<typeof WorkflowStatusSchema>;
export type Schedule = z.infer<typeof ScheduleSchema>;
export type Workflow = z.infer<typeof WorkflowSchema>;
export type WorkflowExecution = z.infer<typeof WorkflowExecutionSchema>;
export type TriggerWorkflowRequest = z.infer<typeof TriggerWorkflowRequestSchema>;
