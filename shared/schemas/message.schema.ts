import { z } from "zod";

// Base schemas
export const UUIDSchema = z.string().uuid();
export const TimestampSchema = z.string().datetime();

// Message role
export const MessageRoleSchema = z.enum(["user", "assistant", "system", "tool"]);

// Message schema
export const MessageSchema = z.object({
  id: UUIDSchema,
  conversationId: UUIDSchema,
  role: MessageRoleSchema,
  content: z.string(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  createdAt: TimestampSchema,
});

// Conversation schema
export const ConversationSchema = z.object({
  id: UUIDSchema,
  userId: UUIDSchema.optional(),
  title: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});

// Create message request
export const CreateMessageRequestSchema = z.object({
  conversationId: UUIDSchema.optional(),
  content: z.string().min(1),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

// Message response
export const MessageResponseSchema = z.object({
  message: MessageSchema,
  conversation: ConversationSchema,
});

// Types
export type UUID = z.infer<typeof UUIDSchema>;
export type Timestamp = z.infer<typeof TimestampSchema>;
export type MessageRole = z.infer<typeof MessageRoleSchema>;
export type Message = z.infer<typeof MessageSchema>;
export type Conversation = z.infer<typeof ConversationSchema>;
export type CreateMessageRequest = z.infer<typeof CreateMessageRequestSchema>;
export type MessageResponse = z.infer<typeof MessageResponseSchema>;
