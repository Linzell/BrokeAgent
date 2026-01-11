import { z } from "zod";
import { UUIDSchema, TimestampSchema } from "./message.schema";

// Memory type
export const MemoryTypeSchema = z.enum(["conversation", "semantic", "episodic"]);

// Memory entry
export const MemoryEntrySchema = z.object({
  id: UUIDSchema,
  type: MemoryTypeSchema,
  content: z.string(),
  embedding: z.array(z.number()).optional(), // Vector embedding
  metadata: z.record(z.string(), z.unknown()).optional(),
  conversationId: UUIDSchema.optional(),
  agentId: UUIDSchema.optional(),
  userId: UUIDSchema.optional(),
  createdAt: TimestampSchema,
});

// Memory search request
export const MemorySearchRequestSchema = z.object({
  query: z.string(),
  type: MemoryTypeSchema.optional(),
  conversationId: UUIDSchema.optional(),
  agentId: UUIDSchema.optional(),
  userId: UUIDSchema.optional(),
  limit: z.number().min(1).max(100).default(10),
  threshold: z.number().min(0).max(1).default(0.7),
});

// Memory search result
export const MemorySearchResultSchema = z.object({
  entry: MemoryEntrySchema,
  score: z.number(),
});

// Types
export type MemoryType = z.infer<typeof MemoryTypeSchema>;
export type MemoryEntry = z.infer<typeof MemoryEntrySchema>;
export type MemorySearchRequest = z.infer<typeof MemorySearchRequestSchema>;
export type MemorySearchResult = z.infer<typeof MemorySearchResultSchema>;
