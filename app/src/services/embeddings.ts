import { OpenAIEmbeddings } from "@langchain/openai";
import { OllamaEmbeddings } from "@langchain/ollama";
import type { EmbeddingProvider } from "./memory";

// ============================================
// OpenAI Embedding Provider
// ============================================

export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  private embeddings: OpenAIEmbeddings;

  constructor(config?: { modelName?: string; apiKey?: string }) {
    this.embeddings = new OpenAIEmbeddings({
      modelName: config?.modelName || "text-embedding-3-small",
      openAIApiKey: config?.apiKey || process.env.OPENAI_API_KEY,
    });
  }

  async embed(text: string): Promise<number[]> {
    const result = await this.embeddings.embedQuery(text);
    return result;
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    const results = await this.embeddings.embedDocuments(texts);
    return results;
  }
}

// ============================================
// Mock Embedding Provider (for testing/development)
// ============================================

export class MockEmbeddingProvider implements EmbeddingProvider {
  private dimensions: number;

  constructor(dimensions: number = 1536) {
    this.dimensions = dimensions;
  }

  async embed(text: string): Promise<number[]> {
    // Generate deterministic embeddings based on text hash
    return this.generateMockEmbedding(text);
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    return texts.map((text) => this.generateMockEmbedding(text));
  }

  private generateMockEmbedding(text: string): number[] {
    // Simple hash-based embedding for consistent results
    const hash = this.hashString(text);
    const embedding: number[] = [];

    for (let i = 0; i < this.dimensions; i++) {
      // Use hash + index to generate pseudo-random but deterministic values
      const seed = (hash * (i + 1)) % 2147483647;
      embedding.push(((seed % 1000) / 500) - 1); // Normalize to [-1, 1]
    }

    // Normalize the vector
    const magnitude = Math.sqrt(embedding.reduce((sum, val) => sum + val * val, 0));
    return embedding.map((val) => val / magnitude);
  }

  private hashString(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return Math.abs(hash);
  }
}

// ============================================
// Ollama Embedding Provider (for local use)
// Uses @langchain/ollama for consistent LangChain integration
// ============================================

export class OllamaEmbeddingProvider implements EmbeddingProvider {
  private embeddings: OllamaEmbeddings;
  private timeoutMs: number;

  constructor(config?: { baseUrl?: string; model?: string; timeoutMs?: number }) {
    this.embeddings = new OllamaEmbeddings({
      baseUrl: config?.baseUrl || process.env.OLLAMA_BASE_URL || "http://localhost:11434",
      model: config?.model || process.env.OLLAMA_EMBEDDING_MODEL || "nomic-embed-text",
    });
    this.timeoutMs = config?.timeoutMs || 15000; // 15 second default timeout
  }

  async embed(text: string): Promise<number[]> {
    return this.withTimeout(
      () => this.embeddings.embedQuery(text),
      `embed text (${text.length} chars)`
    );
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    return this.withTimeout(
      () => this.embeddings.embedDocuments(texts),
      `embed batch (${texts.length} texts)`
    );
  }

  private async withTimeout<T>(fn: () => Promise<T>, operation: string): Promise<T> {
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        reject(new Error(`Ollama embedding timeout after ${this.timeoutMs}ms for: ${operation}`));
      }, this.timeoutMs);
    });

    return Promise.race([fn(), timeoutPromise]);
  }
}

// ============================================
// Factory function
// ============================================

export type EmbeddingProviderType = "openai" | "ollama" | "mock";

export function createEmbeddingProvider(
  type: EmbeddingProviderType = "openai",
  config?: Record<string, unknown>
): EmbeddingProvider {
  switch (type) {
    case "openai":
      return new OpenAIEmbeddingProvider(config as { modelName?: string; apiKey?: string });

    case "ollama":
      return new OllamaEmbeddingProvider(config as { baseUrl?: string; model?: string });

    case "mock":
      return new MockEmbeddingProvider((config?.dimensions as number) || 1536);

    default:
      throw new Error(`Unknown embedding provider type: ${type}`);
  }
}

// ============================================
// Auto-configure based on environment
// ============================================

/**
 * Check if Ollama is available at the given URL
 */
async function isOllamaAvailable(baseUrl: string = "http://localhost:11434"): Promise<boolean> {
  try {
    const response = await fetch(`${baseUrl}/api/tags`, {
      method: "GET",
      signal: AbortSignal.timeout(2000), // 2 second timeout
    });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Create the default embedding provider based on environment.
 * Priority:
 * 1. Explicit EMBEDDING_PROVIDER env var
 * 2. OpenAI if OPENAI_API_KEY is set
 * 3. Ollama if available (checks localhost:11434)
 * 4. Mock provider in development/test
 */
export function createDefaultEmbeddingProvider(): EmbeddingProvider {
  // Check for explicit provider configuration
  const explicitProvider = process.env.EMBEDDING_PROVIDER as EmbeddingProviderType | undefined;
  if (explicitProvider) {
    console.log(`Using explicitly configured embedding provider: ${explicitProvider}`);
    return createEmbeddingProvider(explicitProvider);
  }

  // Check for OpenAI API key
  if (process.env.OPENAI_API_KEY) {
    console.log("Using OpenAI embedding provider");
    return new OpenAIEmbeddingProvider();
  }

  // Check for Ollama configuration
  if (process.env.OLLAMA_BASE_URL || process.env.OLLAMA_EMBEDDING_MODEL) {
    console.log("Using Ollama embedding provider");
    return new OllamaEmbeddingProvider();
  }

  // Fall back to mock in development/test
  if (process.env.NODE_ENV === "development" || process.env.NODE_ENV === "test") {
    console.warn("No embedding provider configured, using mock provider");
    return new MockEmbeddingProvider();
  }

  throw new Error(
    "No embedding provider configured. Set OPENAI_API_KEY, OLLAMA_BASE_URL, or EMBEDDING_PROVIDER environment variable."
  );
}

/**
 * Create the default embedding provider with async Ollama detection.
 * Use this when you want to auto-detect Ollama availability.
 */
export async function createDefaultEmbeddingProviderAsync(): Promise<EmbeddingProvider> {
  // Check for explicit provider configuration
  const explicitProvider = process.env.EMBEDDING_PROVIDER as EmbeddingProviderType | undefined;
  if (explicitProvider) {
    console.log(`Using explicitly configured embedding provider: ${explicitProvider}`);
    return createEmbeddingProvider(explicitProvider);
  }

  // Check for OpenAI API key
  if (process.env.OPENAI_API_KEY) {
    console.log("Using OpenAI embedding provider");
    return new OpenAIEmbeddingProvider();
  }

  // Try to detect Ollama
  const ollamaUrl = process.env.OLLAMA_BASE_URL || "http://localhost:11434";
  if (await isOllamaAvailable(ollamaUrl)) {
    console.log("Ollama detected, using Ollama embedding provider");
    return new OllamaEmbeddingProvider({ baseUrl: ollamaUrl });
  }

  // Fall back to mock in development/test
  if (process.env.NODE_ENV === "development" || process.env.NODE_ENV === "test") {
    console.warn("No embedding provider available, using mock provider");
    return new MockEmbeddingProvider();
  }

  throw new Error(
    "No embedding provider available. Install Ollama, set OPENAI_API_KEY, or set EMBEDDING_PROVIDER=mock."
  );
}
