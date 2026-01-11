import { ChatOllama } from "@langchain/ollama";
import { ChatOpenAI } from "@langchain/openai";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { BaseMessage } from "@langchain/core/messages";
import { HumanMessage, SystemMessage, AIMessage } from "@langchain/core/messages";

// ============================================
// LLM Event System
// ============================================

export interface LLMUsageEvent {
  type: "llm:call" | "llm:success" | "llm:error" | "llm:fallback";
  provider: string;
  model: string;
  latencyMs?: number;
  tokens?: number;
  error?: string;
  fallbackFrom?: { provider: string; model: string };
  timestamp: string;
}

type LLMEventListener = (event: LLMUsageEvent) => void;
let llmEventListener: LLMEventListener | null = null;

/**
 * Set a listener for LLM usage events (used by workflow system to broadcast)
 */
export function setLLMEventListener(listener: LLMEventListener | null): void {
  llmEventListener = listener;
}

/**
 * Emit an LLM usage event
 */
function emitLLMEvent(event: Omit<LLMUsageEvent, "timestamp">): void {
  if (llmEventListener) {
    llmEventListener({
      ...event,
      timestamp: new Date().toISOString(),
    });
  }
}

// ============================================
// Types
// ============================================

export interface LLMProviderConfig {
  model?: string;
  temperature?: number;
  maxTokens?: number;
}

export interface OllamaConfig extends LLMProviderConfig {
  baseUrl?: string;
}

export interface OpenAIConfig extends LLMProviderConfig {
  apiKey?: string;
}

export interface OpenRouterConfig extends LLMProviderConfig {
  apiKey?: string;
}

// ============================================
// Model Info Types
// ============================================

export interface ModelInfo {
  id: string;
  name: string;
  provider: LLMProviderType;
  size?: string;
  contextLength?: number;
  description?: string;
  pricing?: {
    prompt?: string;
    completion?: string;
  };
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatResponse {
  content: string;
  model: string;
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };
}

export interface LLMProvider {
  chat(messages: ChatMessage[]): Promise<ChatResponse>;
  stream(messages: ChatMessage[]): AsyncGenerator<string, void, unknown>;
  getModel(): BaseChatModel;
}

// ============================================
// Helper functions
// ============================================

function convertToLangChainMessages(messages: ChatMessage[]): BaseMessage[] {
  return messages.map((msg) => {
    switch (msg.role) {
      case "system":
        return new SystemMessage(msg.content);
      case "user":
        return new HumanMessage(msg.content);
      case "assistant":
        return new AIMessage(msg.content);
      default:
        throw new Error(`Unknown message role: ${msg.role}`);
    }
  });
}

// ============================================
// Ollama LLM Provider
// ============================================

export class OllamaLLMProvider implements LLMProvider {
  private model: ChatOllama;
  private modelName: string;

  constructor(config?: OllamaConfig) {
    this.modelName = config?.model || process.env.OLLAMA_MODEL || "llama3.2";
    this.model = new ChatOllama({
      baseUrl: config?.baseUrl || process.env.OLLAMA_BASE_URL || "http://localhost:11434",
      model: this.modelName,
      temperature: config?.temperature ?? 0.7,
      numPredict: config?.maxTokens,
    });
  }

  async chat(messages: ChatMessage[]): Promise<ChatResponse> {
    const langChainMessages = convertToLangChainMessages(messages);
    const response = await this.model.invoke(langChainMessages);

    return {
      content: typeof response.content === "string" ? response.content : JSON.stringify(response.content),
      model: this.modelName,
      usage: response.usage_metadata
        ? {
            promptTokens: response.usage_metadata.input_tokens,
            completionTokens: response.usage_metadata.output_tokens,
            totalTokens: response.usage_metadata.total_tokens,
          }
        : undefined,
    };
  }

  async *stream(messages: ChatMessage[]): AsyncGenerator<string, void, unknown> {
    const langChainMessages = convertToLangChainMessages(messages);
    const stream = await this.model.stream(langChainMessages);

    for await (const chunk of stream) {
      if (typeof chunk.content === "string") {
        yield chunk.content;
      }
    }
  }

  getModel(): BaseChatModel {
    return this.model;
  }
}

// ============================================
// OpenAI LLM Provider
// ============================================

export class OpenAILLMProvider implements LLMProvider {
  private model: ChatOpenAI;
  private modelName: string;

  constructor(config?: OpenAIConfig) {
    this.modelName = config?.model || process.env.OPENAI_MODEL || "gpt-4o-mini";
    this.model = new ChatOpenAI({
      modelName: this.modelName,
      openAIApiKey: config?.apiKey || process.env.OPENAI_API_KEY,
      temperature: config?.temperature ?? 0.7,
      maxTokens: config?.maxTokens,
    });
  }

  async chat(messages: ChatMessage[]): Promise<ChatResponse> {
    const langChainMessages = convertToLangChainMessages(messages);
    const response = await this.model.invoke(langChainMessages);

    return {
      content: typeof response.content === "string" ? response.content : JSON.stringify(response.content),
      model: this.modelName,
      usage: response.usage_metadata
        ? {
            promptTokens: response.usage_metadata.input_tokens,
            completionTokens: response.usage_metadata.output_tokens,
            totalTokens: response.usage_metadata.total_tokens,
          }
        : undefined,
    };
  }

  async *stream(messages: ChatMessage[]): AsyncGenerator<string, void, unknown> {
    const langChainMessages = convertToLangChainMessages(messages);
    const stream = await this.model.stream(langChainMessages);

    for await (const chunk of stream) {
      if (typeof chunk.content === "string") {
        yield chunk.content;
      }
    }
  }

  getModel(): BaseChatModel {
    return this.model;
  }
}

// ============================================
// Mock LLM Provider (for testing)
// ============================================

export class MockLLMProvider implements LLMProvider {
  private responses: Map<string, string> = new Map();
  private defaultResponse: string = "This is a mock response.";

  constructor(config?: { defaultResponse?: string; responses?: Record<string, string> }) {
    if (config?.defaultResponse) {
      this.defaultResponse = config.defaultResponse;
    }
    if (config?.responses) {
      Object.entries(config.responses).forEach(([key, value]) => {
        this.responses.set(key, value);
      });
    }
  }

  setResponse(trigger: string, response: string): void {
    this.responses.set(trigger, response);
  }

  async chat(messages: ChatMessage[]): Promise<ChatResponse> {
    const lastMessage = messages[messages.length - 1];
    const content = lastMessage?.content || "";

    // Check for matching response
    for (const [trigger, response] of this.responses) {
      if (content.toLowerCase().includes(trigger.toLowerCase())) {
        return { content: response, model: "mock" };
      }
    }

    return { content: this.defaultResponse, model: "mock" };
  }

  async *stream(messages: ChatMessage[]): AsyncGenerator<string, void, unknown> {
    const response = await this.chat(messages);
    // Simulate streaming by yielding word by word
    const words = response.content.split(" ");
    for (const word of words) {
      yield word + " ";
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }

  getModel(): BaseChatModel {
    throw new Error("MockLLMProvider does not have a LangChain model");
  }
}

// ============================================
// OpenRouter LLM Provider
// ============================================

export class OpenRouterLLMProvider implements LLMProvider {
  private model: ChatOpenAI;
  private modelName: string;

  constructor(config?: OpenRouterConfig) {
    this.modelName = config?.model || process.env.OPENROUTER_MODEL || "openai/gpt-4o-mini";
    const apiKey = config?.apiKey || process.env.OPENROUTER_API_KEY;
    
    if (!apiKey) {
      throw new Error("OpenRouter API key is required. Set OPENROUTER_API_KEY environment variable or pass apiKey in config.");
    }
    
    this.model = new ChatOpenAI({
      model: this.modelName,
      apiKey: apiKey,
      temperature: config?.temperature ?? 0.7,
      maxTokens: config?.maxTokens,
      configuration: {
        baseURL: "https://openrouter.ai/api/v1",
      },
    });
  }

  async chat(messages: ChatMessage[]): Promise<ChatResponse> {
    const langChainMessages = convertToLangChainMessages(messages);
    const response = await this.model.invoke(langChainMessages);

    return {
      content: typeof response.content === "string" ? response.content : JSON.stringify(response.content),
      model: this.modelName,
      usage: response.usage_metadata
        ? {
            promptTokens: response.usage_metadata.input_tokens,
            completionTokens: response.usage_metadata.output_tokens,
            totalTokens: response.usage_metadata.total_tokens,
          }
        : undefined,
    };
  }

  async *stream(messages: ChatMessage[]): AsyncGenerator<string, void, unknown> {
    const langChainMessages = convertToLangChainMessages(messages);
    const stream = await this.model.stream(langChainMessages);

    for await (const chunk of stream) {
      if (typeof chunk.content === "string") {
        yield chunk.content;
      }
    }
  }

  getModel(): BaseChatModel {
    return this.model;
  }
}

// ============================================
// Model Listing Functions
// ============================================

/**
 * List available models from Ollama
 */
export async function listOllamaModels(baseUrl?: string): Promise<ModelInfo[]> {
  const url = baseUrl || process.env.OLLAMA_BASE_URL || "http://localhost:11434";
  
  try {
    const response = await fetch(`${url}/api/tags`, {
      method: "GET",
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) {
      throw new Error(`Ollama API returned ${response.status}`);
    }

    const data = await response.json() as {
      models: Array<{
        name: string;
        model: string;
        size: number;
        details?: {
          family?: string;
          parameter_size?: string;
          quantization_level?: string;
        };
      }>;
    };

    return data.models.map((m) => ({
      id: m.name,
      name: m.name.split(":")[0],
      provider: "ollama" as const,
      size: m.details?.parameter_size,
      description: m.details ? 
        `${m.details.family || ""} ${m.details.parameter_size || ""} ${m.details.quantization_level || ""}`.trim() : 
        undefined,
    }));
  } catch (error) {
    console.error("Failed to list Ollama models:", error);
    return [];
  }
}

/**
 * List available models from OpenRouter
 */
export async function listOpenRouterModels(apiKey?: string): Promise<ModelInfo[]> {
  const key = apiKey || process.env.OPENROUTER_API_KEY;
  
  if (!key) {
    console.warn("No OpenRouter API key provided");
    return [];
  }

  try {
    const response = await fetch("https://openrouter.ai/api/v1/models", {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${key}`,
      },
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      throw new Error(`OpenRouter API returned ${response.status}`);
    }

    const data = await response.json() as {
      data: Array<{
        id: string;
        name: string;
        context_length?: number;
        pricing?: {
          prompt?: string;
          completion?: string;
        };
        description?: string;
      }>;
    };

    return data.data.map((m) => ({
      id: m.id,
      name: m.name,
      provider: "openrouter" as const,
      contextLength: m.context_length,
      description: m.description,
      pricing: m.pricing,
    }));
  } catch (error) {
    console.error("Failed to list OpenRouter models:", error);
    return [];
  }
}

/**
 * List available models for a specific provider
 */
export async function listModels(provider?: LLMProviderType): Promise<ModelInfo[]> {
  const results: ModelInfo[] = [];

  if (!provider || provider === "ollama") {
    const ollamaModels = await listOllamaModels();
    results.push(...ollamaModels);
  }

  if (!provider || provider === "openrouter") {
    const openRouterModels = await listOpenRouterModels();
    results.push(...openRouterModels);
  }

  if (!provider || provider === "openai") {
    // OpenAI doesn't have a public model listing API, return known models
    results.push(
      { id: "gpt-4o", name: "GPT-4o", provider: "openai", contextLength: 128000 },
      { id: "gpt-4o-mini", name: "GPT-4o Mini", provider: "openai", contextLength: 128000 },
      { id: "gpt-4-turbo", name: "GPT-4 Turbo", provider: "openai", contextLength: 128000 },
      { id: "gpt-3.5-turbo", name: "GPT-3.5 Turbo", provider: "openai", contextLength: 16385 },
    );
  }

  if (!provider || provider === "mock") {
    results.push({ id: "mock", name: "Mock Provider", provider: "mock" });
  }

  return results;
}

/**
 * Get available providers based on environment configuration
 */
export async function getAvailableProviders(): Promise<Array<{
  type: LLMProviderType;
  name: string;
  available: boolean;
  configured: boolean;
}>> {
  const ollamaAvailable = await isOllamaAvailable();
  
  return [
    {
      type: "ollama",
      name: "Ollama",
      available: ollamaAvailable,
      configured: !!(process.env.OLLAMA_BASE_URL || process.env.OLLAMA_MODEL) || ollamaAvailable,
    },
    {
      type: "openrouter",
      name: "OpenRouter",
      available: !!process.env.OPENROUTER_API_KEY,
      configured: !!process.env.OPENROUTER_API_KEY,
    },
    {
      type: "openai",
      name: "OpenAI",
      available: !!process.env.OPENAI_API_KEY,
      configured: !!process.env.OPENAI_API_KEY,
    },
    {
      type: "mock",
      name: "Mock (Testing)",
      available: true,
      configured: true,
    },
  ];
}

// ============================================
// Factory functions
// ============================================

export type LLMProviderType = "ollama" | "openai" | "openrouter" | "mock";

export function createLLMProvider(type: LLMProviderType, config?: Record<string, unknown>): LLMProvider {
  switch (type) {
    case "ollama":
      return new OllamaLLMProvider(config as OllamaConfig);

    case "openai":
      return new OpenAILLMProvider(config as OpenAIConfig);

    case "openrouter":
      return new OpenRouterLLMProvider(config as OpenRouterConfig);

    case "mock":
      return new MockLLMProvider(config as { defaultResponse?: string; responses?: Record<string, string> });

    default:
      throw new Error(`Unknown LLM provider type: ${type}`);
  }
}

/**
 * Check if Ollama is available at the given URL
 */
async function isOllamaAvailable(baseUrl: string = "http://localhost:11434"): Promise<boolean> {
  try {
    const response = await fetch(`${baseUrl}/api/tags`, {
      method: "GET",
      signal: AbortSignal.timeout(2000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Create the default LLM provider based on environment.
 * Priority:
 * 1. Explicit LLM_PROVIDER env var
 * 2. OpenAI if OPENAI_API_KEY is set
 * 3. OpenRouter if OPENROUTER_API_KEY is set
 * 4. Ollama if OLLAMA_BASE_URL or OLLAMA_MODEL is set
 * 5. Mock provider in development/test
 */
export function createDefaultLLMProvider(): LLMProvider {
  const explicitProvider = process.env.LLM_PROVIDER as LLMProviderType | undefined;
  if (explicitProvider) {
    console.log(`Using explicitly configured LLM provider: ${explicitProvider}`);
    return createLLMProvider(explicitProvider);
  }

  if (process.env.OPENAI_API_KEY) {
    console.log("Using OpenAI LLM provider");
    return new OpenAILLMProvider();
  }

  if (process.env.OPENROUTER_API_KEY) {
    console.log("Using OpenRouter LLM provider");
    return new OpenRouterLLMProvider();
  }

  if (process.env.OLLAMA_BASE_URL || process.env.OLLAMA_MODEL) {
    console.log("Using Ollama LLM provider");
    return new OllamaLLMProvider();
  }

  if (process.env.NODE_ENV === "development" || process.env.NODE_ENV === "test") {
    console.warn("No LLM provider configured, using mock provider");
    return new MockLLMProvider();
  }

  throw new Error(
    "No LLM provider configured. Set OPENAI_API_KEY, OPENROUTER_API_KEY, OLLAMA_BASE_URL, or LLM_PROVIDER environment variable."
  );
}

/**
 * Create the default LLM provider with async Ollama detection.
 */
export async function createDefaultLLMProviderAsync(): Promise<LLMProvider> {
  const explicitProvider = process.env.LLM_PROVIDER as LLMProviderType | undefined;
  if (explicitProvider) {
    console.log(`Using explicitly configured LLM provider: ${explicitProvider}`);
    return createLLMProvider(explicitProvider);
  }

  if (process.env.OPENAI_API_KEY) {
    console.log("Using OpenAI LLM provider");
    return new OpenAILLMProvider();
  }

  if (process.env.OPENROUTER_API_KEY) {
    console.log("Using OpenRouter LLM provider");
    return new OpenRouterLLMProvider();
  }

  const ollamaUrl = process.env.OLLAMA_BASE_URL || "http://localhost:11434";
  if (await isOllamaAvailable(ollamaUrl)) {
    console.log("Ollama detected, using Ollama LLM provider");
    return new OllamaLLMProvider({ baseUrl: ollamaUrl });
  }

  if (process.env.NODE_ENV === "development" || process.env.NODE_ENV === "test") {
    console.warn("No LLM provider available, using mock provider");
    return new MockLLMProvider();
  }

  throw new Error(
    "No LLM provider available. Install Ollama, set OPENAI_API_KEY, OPENROUTER_API_KEY, or set LLM_PROVIDER=mock."
  );
}

// ============================================
// Singleton LLM Provider Manager
// ============================================

export interface LLMConfig {
  provider: LLMProviderType;
  model: string;
  baseUrl?: string;
}

// Cached candidates for smart mode (refreshed periodically)
let cachedCandidates: ModelSpec[] = [];
let candidatesCacheTime = 0;
const CANDIDATES_CACHE_TTL = 60000; // 1 minute

/**
 * Get cached candidate models (refreshes every minute)
 */
async function getCachedCandidates(): Promise<ModelSpec[]> {
  const now = Date.now();
  if (now - candidatesCacheTime > CANDIDATES_CACHE_TTL || cachedCandidates.length === 0) {
    cachedCandidates = await getDefaultCandidateModels();
    candidatesCacheTime = now;
  }
  return cachedCandidates;
}

class LLMProviderManager {
  private provider: LLMProvider | null = null;
  private config: LLMConfig = { provider: "mock", model: "unknown" };
  private initialized: boolean = false;

  /**
   * Initialize the LLM provider (should be called at startup)
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      this.provider = await createDefaultLLMProviderAsync();
      
      // Determine config based on what was created
      if (process.env.LLM_PROVIDER) {
        const providerType = process.env.LLM_PROVIDER as LLMProviderType;
        this.config = {
          provider: providerType,
          model: this.getDefaultModelForProvider(providerType),
          baseUrl: providerType === "ollama" ? (process.env.OLLAMA_BASE_URL || "http://localhost:11434") : undefined,
        };
      } else if (process.env.OPENAI_API_KEY) {
        this.config = {
          provider: "openai",
          model: process.env.OPENAI_MODEL || "gpt-4o-mini",
        };
      } else if (process.env.OPENROUTER_API_KEY) {
        this.config = {
          provider: "openrouter",
          model: process.env.OPENROUTER_MODEL || "openai/gpt-4o-mini",
        };
      } else if (process.env.OLLAMA_BASE_URL || process.env.OLLAMA_MODEL) {
        this.config = {
          provider: "ollama",
          model: process.env.OLLAMA_MODEL || "llama3.2",
          baseUrl: process.env.OLLAMA_BASE_URL || "http://localhost:11434",
        };
      } else if (await isOllamaAvailable()) {
        this.config = {
          provider: "ollama",
          model: process.env.OLLAMA_MODEL || "llama3.2",
          baseUrl: "http://localhost:11434",
        };
      } else {
        this.config = { provider: "mock", model: "mock" };
      }

      this.initialized = true;
      console.log(`LLM Provider initialized: ${this.config.provider}/${this.config.model}`);
    } catch (error) {
      console.error("Failed to initialize LLM provider:", error);
      this.provider = new MockLLMProvider();
      this.config = { provider: "mock", model: "mock" };
      this.initialized = true;
    }
  }

  /**
   * Get default model for a provider type
   */
  private getDefaultModelForProvider(provider: LLMProviderType): string {
    switch (provider) {
      case "ollama":
        return process.env.OLLAMA_MODEL || "llama3.2";
      case "openai":
        return process.env.OPENAI_MODEL || "gpt-4o-mini";
      case "openrouter":
        return process.env.OPENROUTER_MODEL || "openai/gpt-4o-mini";
      case "mock":
        return "mock";
      default:
        return "unknown";
    }
  }

  /**
   * Set the active provider and model
   */
  async setProvider(type: LLMProviderType, model?: string): Promise<void> {
    const modelToUse = model || this.getDefaultModelForProvider(type);
    
    switch (type) {
      case "ollama":
        this.provider = new OllamaLLMProvider({ model: modelToUse });
        this.config = {
          provider: "ollama",
          model: modelToUse,
          baseUrl: process.env.OLLAMA_BASE_URL || "http://localhost:11434",
        };
        break;
      case "openai":
        this.provider = new OpenAILLMProvider({ model: modelToUse });
        this.config = { provider: "openai", model: modelToUse };
        break;
      case "openrouter":
        this.provider = new OpenRouterLLMProvider({ model: modelToUse });
        this.config = { provider: "openrouter", model: modelToUse };
        break;
      case "mock":
        this.provider = new MockLLMProvider();
        this.config = { provider: "mock", model: "mock" };
        break;
      default:
        throw new Error(`Unknown provider type: ${type}`);
    }

    console.log(`LLM Provider switched to: ${this.config.provider}/${this.config.model}`);
  }

  /**
   * List available models for the current or specified provider
   */
  async listModels(provider?: LLMProviderType): Promise<ModelInfo[]> {
    return listModels(provider);
  }

  /**
   * Get available providers
   */
  async getProviders(): Promise<Array<{
    type: LLMProviderType;
    name: string;
    available: boolean;
    configured: boolean;
  }>> {
    return getAvailableProviders();
  }

  /**
   * Get the LLM provider (auto-initializes if needed)
   * Returns a smart wrapper that automatically falls back on errors
   */
  getLLM(): BaseChatModel {
    if (!this.provider) {
      // Synchronous fallback
      this.provider = createDefaultLLMProvider();
      this.config = { provider: "mock", model: "unknown" };
    }
    
    const originalModel = this.provider.getModel();
    const self = this;
    
    // Create a proxy that wraps invoke() with smart fallback
    return new Proxy(originalModel, {
      get(target, prop, receiver) {
        if (prop === "invoke") {
          return async function smartInvokeWrapper(input: string | BaseMessage[]) {
            const startTime = Date.now();
            const currentModel: ModelSpec = {
              provider: self.config.provider,
              model: self.config.model,
            };
            
            // Emit call event
            emitLLMEvent({
              type: "llm:call",
              provider: currentModel.provider,
              model: currentModel.model,
            });
            
            try {
              // Try the current model first
              const result = await target.invoke(input);
              const latencyMs = Date.now() - startTime;
              
              // Record success
              recordModelSuccess(currentModel, latencyMs);
              
              // Emit success event
              emitLLMEvent({
                type: "llm:success",
                provider: currentModel.provider,
                model: currentModel.model,
                latencyMs,
                tokens: result.usage_metadata?.total_tokens,
              });
              
              return result;
            } catch (error) {
              const errorMsg = error instanceof Error ? error.message : String(error);
              console.error(`[SmartLLM] Primary model ${self.config.provider}/${self.config.model} failed:`, error);
              
              // Emit error event
              emitLLMEvent({
                type: "llm:error",
                provider: currentModel.provider,
                model: currentModel.model,
                error: errorMsg,
                latencyMs: Date.now() - startTime,
              });
              
              // Record failure
              recordModelFailure(currentModel, error);
              
              // Try fallback models
              const candidates = await getCachedCandidates();
              const otherCandidates = candidates.filter(
                c => !(c.provider === currentModel.provider && c.model === currentModel.model)
              );
              
              if (otherCandidates.length === 0) {
                throw error; // No fallbacks available
              }
              
              // Convert input to messages format
              const messages: ChatMessage[] = typeof input === "string"
                ? [{ role: "user" as const, content: input }]
                : input.map(m => ({
                    role: (m._getType() === "human" ? "user" : m._getType() === "ai" ? "assistant" : "system") as "system" | "user" | "assistant",
                    content: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
                  }));
              
              // Use smart fallback
              console.log(`[SmartLLM] Trying ${otherCandidates.length} fallback models...`);
              const fallbackResult = await smartChatInternal(messages, {
                candidateModels: otherCandidates,
                optimizePrompts: true,
                rankingStrategy: "balanced",
              });
              
              console.log(`[SmartLLM] Fallback succeeded with ${fallbackResult.model.provider}/${fallbackResult.model.model}`);
              
              // Emit fallback event
              emitLLMEvent({
                type: "llm:fallback",
                provider: fallbackResult.model.provider,
                model: fallbackResult.model.model,
                latencyMs: fallbackResult.latencyMs,
                tokens: fallbackResult.response.usage?.totalTokens,
                fallbackFrom: {
                  provider: currentModel.provider,
                  model: currentModel.model,
                },
              });
              
              // Return in LangChain format
              return {
                content: fallbackResult.response.content,
                usage_metadata: fallbackResult.response.usage ? {
                  input_tokens: fallbackResult.response.usage.promptTokens,
                  output_tokens: fallbackResult.response.usage.completionTokens,
                  total_tokens: fallbackResult.response.usage.totalTokens,
                } : undefined,
              };
            }
          };
        }
        return Reflect.get(target, prop, receiver);
      },
    });
  }

  /**
   * Get the raw provider (without smart wrapper, for direct access)
   */
  getProvider(): LLMProvider {
    if (!this.provider) {
      this.provider = createDefaultLLMProvider();
      this.config = { provider: "mock", model: "unknown" };
    }
    return this.provider;
  }

  /**
   * Get configuration info
   */
  getConfig(): LLMConfig {
    return this.config;
  }

  /**
   * Chat with the LLM
   */
  async chat(messages: ChatMessage[]): Promise<ChatResponse> {
    const provider = this.getProvider();
    return provider.chat(messages);
  }

  /**
   * Smart chat with automatic fallback
   */
  async smartChat(messages: ChatMessage[]): Promise<ChatResponse> {
    try {
      // Get cached candidates
      const candidates = await getCachedCandidates();

      if (candidates.length === 0) {
        // No candidates, fall back to regular chat
        return this.chat(messages);
      }

      const result = await smartChatInternal(messages, {
        candidateModels: candidates,
        optimizePrompts: true,
        rankingStrategy: "balanced",
      });

      return result.response;
    } catch (error) {
      console.error("[LLM] Smart chat failed, falling back to regular chat:", error);
      return this.chat(messages);
    }
  }

  /**
   * Check if initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }
}

// Export singleton instance
export const llmProvider = new LLMProviderManager();

// ============================================
// Model Comparison Types
// ============================================

export interface ModelSpec {
  provider: LLMProviderType;
  model: string;
}

export interface ComparisonResult {
  model: ModelSpec;
  response: ChatResponse;
  latencyMs: number;
  error?: string;
}

export interface ComparisonSummary {
  prompt: string;
  results: ComparisonResult[];
  totalModels: number;
  successfulModels: number;
  failedModels: number;
  averageLatencyMs: number;
  timestamp: string;
}

export interface ConsensusVote {
  model: ModelSpec;
  vote: string;
  confidence: number;
  reasoning: string;
  latencyMs: number;
}

export interface ConsensusResult {
  question: string;
  votes: ConsensusVote[];
  consensus: {
    decision: string;
    confidence: number;
    agreementRatio: number;
    dissenting: string[];
  };
  timestamp: string;
}

// ============================================
// Model Comparison Service
// ============================================

/**
 * Run the same prompt through multiple models and compare results
 */
export async function compareModels(
  messages: ChatMessage[],
  models: ModelSpec[],
  options?: {
    timeout?: number;
    includeFailures?: boolean;
  }
): Promise<ComparisonSummary> {
  const timeout = options?.timeout ?? 60000;
  const includeFailures = options?.includeFailures ?? true;
  const startTime = Date.now();

  // Run all models in parallel
  const promises = models.map(async (spec): Promise<ComparisonResult> => {
    const modelStart = Date.now();
    
    try {
      const provider = createLLMProvider(spec.provider, { model: spec.model });
      
      // Add timeout
      const response = await Promise.race([
        provider.chat(messages),
        new Promise<never>((_, reject) => 
          setTimeout(() => reject(new Error("Model timeout")), timeout)
        ),
      ]);

      return {
        model: spec,
        response,
        latencyMs: Date.now() - modelStart,
      };
    } catch (error) {
      return {
        model: spec,
        response: {
          content: "",
          model: spec.model,
        },
        latencyMs: Date.now() - modelStart,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  });

  const results = await Promise.all(promises);
  
  // Filter out failures if requested
  const filteredResults = includeFailures 
    ? results 
    : results.filter(r => !r.error);

  const successfulResults = results.filter(r => !r.error);
  const totalLatency = successfulResults.reduce((sum, r) => sum + r.latencyMs, 0);

  // Get the last user message as the prompt summary
  const lastUserMessage = messages.filter(m => m.role === "user").pop();
  const promptSummary = lastUserMessage?.content.slice(0, 200) || "No prompt";

  return {
    prompt: promptSummary,
    results: filteredResults,
    totalModels: models.length,
    successfulModels: successfulResults.length,
    failedModels: results.length - successfulResults.length,
    averageLatencyMs: successfulResults.length > 0 
      ? Math.round(totalLatency / successfulResults.length) 
      : 0,
    timestamp: new Date().toISOString(),
  };
}

// ============================================
// Consensus Voting Service
// ============================================

/**
 * Prompt template for extracting structured votes from models
 */
function createVotingPrompt(question: string, options: string[]): string {
  return `You are participating in a consensus voting system. Answer the following question by choosing one of the provided options.

Question: ${question}

Options:
${options.map((opt, i) => `${i + 1}. ${opt}`).join("\n")}

Respond in the following JSON format ONLY (no other text):
{
  "vote": "<your chosen option exactly as written>",
  "confidence": <number between 0 and 100>,
  "reasoning": "<brief explanation for your choice>"
}`;
}

/**
 * Parse a voting response from a model
 */
function parseVoteResponse(content: string, options: string[]): { vote: string; confidence: number; reasoning: string } | null {
  try {
    // Try to extract JSON from the response
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;

    const parsed = JSON.parse(jsonMatch[0]);
    
    // Validate the vote is one of the options (case-insensitive match)
    const normalizedVote = parsed.vote?.toLowerCase().trim();
    const matchedOption = options.find(opt => 
      opt.toLowerCase().trim() === normalizedVote ||
      opt.toLowerCase().includes(normalizedVote) ||
      normalizedVote?.includes(opt.toLowerCase())
    );

    if (!matchedOption) {
      // Try to find the closest match
      const optionLower = options.map(o => o.toLowerCase());
      const closestMatch = options.find((_, i) => 
        content.toLowerCase().includes(optionLower[i])
      );
      if (closestMatch) {
        parsed.vote = closestMatch;
      } else {
        return null;
      }
    } else {
      parsed.vote = matchedOption;
    }

    return {
      vote: parsed.vote,
      confidence: Math.min(100, Math.max(0, Number(parsed.confidence) || 50)),
      reasoning: String(parsed.reasoning || "No reasoning provided"),
    };
  } catch {
    // Try to extract vote from plain text
    const optionLower = options.map(o => o.toLowerCase());
    const matchedOption = options.find((_, i) => 
      content.toLowerCase().includes(optionLower[i])
    );
    
    if (matchedOption) {
      return {
        vote: matchedOption,
        confidence: 50,
        reasoning: "Extracted from response (parsing failed)",
      };
    }
    
    return null;
  }
}

/**
 * Run a consensus vote across multiple models
 */
export async function consensusVote(
  question: string,
  options: string[],
  models: ModelSpec[],
  config?: {
    timeout?: number;
    minConfidence?: number;
    requireMajority?: boolean;
  }
): Promise<ConsensusResult> {
  const timeout = config?.timeout ?? 60000;
  const minConfidence = config?.minConfidence ?? 0;
  const requireMajority = config?.requireMajority ?? false;

  const votingPrompt = createVotingPrompt(question, options);
  const messages: ChatMessage[] = [
    { role: "system", content: "You are a helpful AI assistant participating in a multi-model consensus vote. Always respond in valid JSON format." },
    { role: "user", content: votingPrompt },
  ];

  // Run all models in parallel
  const promises = models.map(async (spec): Promise<ConsensusVote | null> => {
    const modelStart = Date.now();
    
    try {
      const provider = createLLMProvider(spec.provider, { model: spec.model });
      
      const response = await Promise.race([
        provider.chat(messages),
        new Promise<never>((_, reject) => 
          setTimeout(() => reject(new Error("Model timeout")), timeout)
        ),
      ]);

      const parsed = parseVoteResponse(response.content, options);
      if (!parsed) {
        console.warn(`[Consensus] Failed to parse vote from ${spec.provider}/${spec.model}`);
        return null;
      }

      return {
        model: spec,
        vote: parsed.vote,
        confidence: parsed.confidence,
        reasoning: parsed.reasoning,
        latencyMs: Date.now() - modelStart,
      };
    } catch (error) {
      console.error(`[Consensus] Error from ${spec.provider}/${spec.model}:`, error);
      return null;
    }
  });

  const results = await Promise.all(promises);
  const validVotes = results.filter((v): v is ConsensusVote => 
    v !== null && v.confidence >= minConfidence
  );

  // Count votes
  const voteCounts = new Map<string, { count: number; totalConfidence: number; voters: string[] }>();
  for (const vote of validVotes) {
    const existing = voteCounts.get(vote.vote) || { count: 0, totalConfidence: 0, voters: [] };
    existing.count++;
    existing.totalConfidence += vote.confidence;
    existing.voters.push(`${vote.model.provider}/${vote.model.model}`);
    voteCounts.set(vote.vote, existing);
  }

  // Determine consensus
  let winningVote = "";
  let maxScore = 0;
  const dissenting: string[] = [];

  for (const [vote, data] of voteCounts) {
    // Score = count * average confidence
    const score = data.count * (data.totalConfidence / data.count);
    if (score > maxScore) {
      maxScore = score;
      winningVote = vote;
    }
  }

  // Find dissenting votes
  for (const vote of validVotes) {
    if (vote.vote !== winningVote) {
      dissenting.push(`${vote.model.provider}/${vote.model.model}: ${vote.vote}`);
    }
  }

  // Calculate agreement ratio
  const winningCount = voteCounts.get(winningVote)?.count || 0;
  const agreementRatio = validVotes.length > 0 
    ? winningCount / validVotes.length 
    : 0;

  // Check if we have majority (if required)
  const hasMajority = agreementRatio > 0.5;
  if (requireMajority && !hasMajority) {
    winningVote = "NO_CONSENSUS";
  }

  // Calculate average confidence for winning vote
  const winningConfidence = winningVote && winningVote !== "NO_CONSENSUS"
    ? (voteCounts.get(winningVote)?.totalConfidence || 0) / (voteCounts.get(winningVote)?.count || 1)
    : 0;

  return {
    question,
    votes: validVotes,
    consensus: {
      decision: winningVote || "NO_VOTES",
      confidence: Math.round(winningConfidence),
      agreementRatio: Math.round(agreementRatio * 100) / 100,
      dissenting,
    },
    timestamp: new Date().toISOString(),
  };
}

/**
 * Quick helper to run consensus on a trading decision
 */
export async function tradingConsensus(
  symbol: string,
  context: string,
  models: ModelSpec[]
): Promise<ConsensusResult> {
  const question = `Based on the following analysis for ${symbol}, what trading action should be taken?\n\nContext:\n${context}`;
  const options = ["BUY", "HOLD", "SELL"];
  
  return consensusVote(question, options, models, {
    requireMajority: true,
    minConfidence: 30,
  });
}

// ============================================
// Model-Specific Prompts
// ============================================

/**
 * Model family detection based on model ID
 */
export type ModelFamily = "claude" | "gpt" | "llama" | "mistral" | "gemini" | "qwen" | "deepseek" | "unknown";

export function detectModelFamily(modelId: string): ModelFamily {
  const lower = modelId.toLowerCase();
  
  if (lower.includes("claude") || lower.includes("anthropic")) return "claude";
  if (lower.includes("gpt") || lower.includes("openai") || lower.includes("o1") || lower.includes("o3")) return "gpt";
  if (lower.includes("llama") || lower.includes("meta")) return "llama";
  if (lower.includes("mistral") || lower.includes("mixtral")) return "mistral";
  if (lower.includes("gemini") || lower.includes("google")) return "gemini";
  if (lower.includes("qwen") || lower.includes("alibaba")) return "qwen";
  if (lower.includes("deepseek")) return "deepseek";
  
  return "unknown";
}

/**
 * Model-specific prompt optimizations
 */
export interface PromptOptimizations {
  systemPrefix?: string;
  systemSuffix?: string;
  userPrefix?: string;
  userSuffix?: string;
  preferredFormat?: "json" | "markdown" | "xml" | "plain";
  thinkingStyle?: "chain-of-thought" | "direct" | "structured";
  maxOutputTokens?: number;
}

const MODEL_OPTIMIZATIONS: Record<ModelFamily, PromptOptimizations> = {
  claude: {
    systemPrefix: "",
    systemSuffix: "\n\nBe direct and concise. Think step by step when needed.",
    preferredFormat: "xml",
    thinkingStyle: "structured",
  },
  gpt: {
    systemPrefix: "",
    systemSuffix: "",
    preferredFormat: "json",
    thinkingStyle: "chain-of-thought",
  },
  llama: {
    systemPrefix: "",
    systemSuffix: "\n\nRespond concisely and stay focused on the task.",
    preferredFormat: "markdown",
    thinkingStyle: "direct",
    maxOutputTokens: 2048,
  },
  mistral: {
    systemPrefix: "",
    systemSuffix: "",
    preferredFormat: "json",
    thinkingStyle: "direct",
  },
  gemini: {
    systemPrefix: "",
    systemSuffix: "",
    preferredFormat: "json",
    thinkingStyle: "chain-of-thought",
  },
  qwen: {
    systemPrefix: "",
    systemSuffix: "\n\nProvide a clear, structured response.",
    preferredFormat: "json",
    thinkingStyle: "structured",
  },
  deepseek: {
    systemPrefix: "",
    systemSuffix: "\n\nThink through this carefully before responding.",
    preferredFormat: "json",
    thinkingStyle: "chain-of-thought",
  },
  unknown: {
    preferredFormat: "json",
    thinkingStyle: "direct",
  },
};

/**
 * Get optimizations for a specific model
 */
export function getModelOptimizations(modelId: string): PromptOptimizations {
  const family = detectModelFamily(modelId);
  return MODEL_OPTIMIZATIONS[family];
}

/**
 * Optimize a prompt for a specific model
 */
export function optimizePromptForModel(
  messages: ChatMessage[],
  modelId: string
): ChatMessage[] {
  const opts = getModelOptimizations(modelId);
  
  return messages.map((msg, index) => {
    if (msg.role === "system" && index === 0) {
      let content = msg.content;
      if (opts.systemPrefix) {
        content = opts.systemPrefix + content;
      }
      if (opts.systemSuffix) {
        content = content + opts.systemSuffix;
      }
      return { ...msg, content };
    }
    
    if (msg.role === "user") {
      let content = msg.content;
      if (opts.userPrefix) {
        content = opts.userPrefix + content;
      }
      if (opts.userSuffix) {
        content = content + opts.userSuffix;
      }
      return { ...msg, content };
    }
    
    return msg;
  });
}

/**
 * Format output request based on model preference
 */
export function getOutputFormatInstruction(modelId: string, schema?: string): string {
  const opts = getModelOptimizations(modelId);
  
  switch (opts.preferredFormat) {
    case "xml":
      return schema
        ? `Respond using the following XML structure:\n${schema}`
        : "Respond in well-formed XML.";
    case "json":
      return schema
        ? `Respond with valid JSON matching this schema:\n${schema}`
        : "Respond with valid JSON only, no additional text.";
    case "markdown":
      return "Format your response using Markdown with clear headers and bullet points.";
    case "plain":
    default:
      return "Provide a clear, well-structured response.";
  }
}

/**
 * Create a prompt template registry for different task types
 */
export interface PromptTemplate {
  name: string;
  description: string;
  templates: Partial<Record<ModelFamily, string>>;
  defaultTemplate: string;
  variables: string[];
}

const PROMPT_TEMPLATES: Map<string, PromptTemplate> = new Map();

/**
 * Register a prompt template
 */
export function registerPromptTemplate(template: PromptTemplate): void {
  PROMPT_TEMPLATES.set(template.name, template);
}

/**
 * Get a prompt template for a specific model
 */
export function getPromptTemplate(
  templateName: string,
  modelId: string,
  variables: Record<string, string>
): string {
  const template = PROMPT_TEMPLATES.get(templateName);
  if (!template) {
    throw new Error(`Unknown prompt template: ${templateName}`);
  }

  const family = detectModelFamily(modelId);
  const promptText = template.templates[family] || template.defaultTemplate;

  // Replace variables
  let result = promptText;
  for (const [key, value] of Object.entries(variables)) {
    result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, "g"), value);
  }

  return result;
}

/**
 * List all registered prompt templates
 */
export function listPromptTemplates(): Array<{ name: string; description: string; variables: string[] }> {
  return Array.from(PROMPT_TEMPLATES.values()).map(t => ({
    name: t.name,
    description: t.description,
    variables: t.variables,
  }));
}

// ============================================
// Built-in Prompt Templates
// ============================================

// Trading Analysis Template
registerPromptTemplate({
  name: "trading_analysis",
  description: "Analyze a stock for trading opportunities",
  variables: ["symbol", "market_data", "news_summary", "technical_indicators"],
  defaultTemplate: `Analyze {{symbol}} for trading opportunities.

Market Data:
{{market_data}}

Recent News:
{{news_summary}}

Technical Indicators:
{{technical_indicators}}

Provide your analysis with a clear BUY/HOLD/SELL recommendation and confidence level (0-100).`,
  templates: {
    claude: `<task>Analyze {{symbol}} for trading opportunities</task>

<market_data>
{{market_data}}
</market_data>

<news>
{{news_summary}}
</news>

<technical>
{{technical_indicators}}
</technical>

<instructions>
Provide a structured analysis with:
1. Key observations
2. Bull case
3. Bear case
4. Recommendation (BUY/HOLD/SELL)
5. Confidence (0-100)
</instructions>`,
    gpt: `You are a financial analyst. Analyze {{symbol}} for trading opportunities.

## Market Data
{{market_data}}

## Recent News
{{news_summary}}

## Technical Indicators
{{technical_indicators}}

Provide your analysis as JSON:
{
  "observations": ["..."],
  "bullCase": "...",
  "bearCase": "...",
  "recommendation": "BUY|HOLD|SELL",
  "confidence": 0-100,
  "reasoning": "..."
}`,
    llama: `Analyze {{symbol}} stock.

Data: {{market_data}}
News: {{news_summary}}
Technical: {{technical_indicators}}

Give a brief analysis and clear BUY/HOLD/SELL recommendation with confidence 0-100.`,
  },
});

// Sentiment Analysis Template
registerPromptTemplate({
  name: "sentiment_analysis",
  description: "Analyze sentiment from text content",
  variables: ["content", "context"],
  defaultTemplate: `Analyze the sentiment of the following content related to {{context}}.

Content:
{{content}}

Rate the sentiment from -100 (very bearish) to +100 (very bullish) and explain key drivers.`,
  templates: {
    claude: `<task>Sentiment Analysis for {{context}}</task>

<content>
{{content}}
</content>

<response_format>
Score: [number from -100 to +100]
Sentiment: [very_bearish|bearish|neutral|bullish|very_bullish]
Key Drivers:
- [driver 1]
- [driver 2]
Summary: [brief explanation]
</response_format>`,
    gpt: `Analyze sentiment for {{context}}.

Content: {{content}}

Respond with JSON:
{
  "score": <-100 to +100>,
  "sentiment": "very_bearish|bearish|neutral|bullish|very_bullish",
  "keyDrivers": ["..."],
  "summary": "..."
}`,
  },
});

// Risk Assessment Template
registerPromptTemplate({
  name: "risk_assessment",
  description: "Assess risk for a trading position",
  variables: ["symbol", "position_size", "entry_price", "portfolio_value", "market_conditions"],
  defaultTemplate: `Assess the risk of taking a position in {{symbol}}.

Position Details:
- Size: {{position_size}}
- Entry Price: {{entry_price}}
- Portfolio Value: {{portfolio_value}}

Market Conditions:
{{market_conditions}}

Provide risk assessment with suggested stop-loss, position sizing recommendation, and risk score (1-10).`,
  templates: {
    claude: `<task>Risk Assessment for {{symbol}} Position</task>

<position>
Size: {{position_size}}
Entry: {{entry_price}}
Portfolio: {{portfolio_value}}
</position>

<market>
{{market_conditions}}
</market>

<required_output>
1. Risk Score (1-10)
2. Key Risks
3. Suggested Stop-Loss
4. Position Size Recommendation
5. Risk/Reward Ratio
</required_output>`,
  },
});

// ============================================
// A/B Testing Framework
// ============================================

export interface ABTestConfig {
  id: string;
  name: string;
  description: string;
  variants: ABTestVariant[];
  trafficSplit: number[]; // Percentage for each variant (should sum to 100)
  metrics: string[]; // Metrics to track (e.g., "latency", "accuracy", "user_rating")
  status: "active" | "paused" | "completed";
  createdAt: string;
  endedAt?: string;
}

export interface ABTestVariant {
  id: string;
  name: string;
  model: ModelSpec;
  promptTemplate?: string; // Optional template override
}

export interface ABTestResult {
  testId: string;
  variantId: string;
  timestamp: string;
  requestId: string;
  metrics: Record<string, number>;
  metadata?: Record<string, unknown>;
}

export interface ABTestSummary {
  testId: string;
  testName: string;
  status: string;
  totalRequests: number;
  variantStats: Array<{
    variantId: string;
    variantName: string;
    model: ModelSpec;
    requests: number;
    percentage: number;
    avgMetrics: Record<string, number>;
  }>;
  winner?: {
    variantId: string;
    confidence: number;
    improvement: number; // Percentage improvement over baseline
  };
}

// In-memory storage for A/B tests (in production, use database)
const abTests = new Map<string, ABTestConfig>();
const abTestResults = new Map<string, ABTestResult[]>();

/**
 * Create a new A/B test
 */
export function createABTest(config: Omit<ABTestConfig, "id" | "status" | "createdAt">): ABTestConfig {
  const id = `ab_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  
  // Validate traffic split
  const totalSplit = config.trafficSplit.reduce((sum, s) => sum + s, 0);
  if (Math.abs(totalSplit - 100) > 0.01) {
    throw new Error(`Traffic split must sum to 100, got ${totalSplit}`);
  }
  
  if (config.variants.length !== config.trafficSplit.length) {
    throw new Error("Number of variants must match traffic split length");
  }

  const test: ABTestConfig = {
    ...config,
    id,
    status: "active",
    createdAt: new Date().toISOString(),
  };

  abTests.set(id, test);
  abTestResults.set(id, []);
  
  console.log(`[A/B Test] Created test "${test.name}" (${id}) with ${test.variants.length} variants`);
  
  return test;
}

/**
 * Get an A/B test by ID
 */
export function getABTest(testId: string): ABTestConfig | undefined {
  return abTests.get(testId);
}

/**
 * List all A/B tests
 */
export function listABTests(status?: "active" | "paused" | "completed"): ABTestConfig[] {
  const tests = Array.from(abTests.values());
  if (status) {
    return tests.filter(t => t.status === status);
  }
  return tests;
}

/**
 * Update A/B test status
 */
export function updateABTestStatus(testId: string, status: "active" | "paused" | "completed"): ABTestConfig | null {
  const test = abTests.get(testId);
  if (!test) return null;

  test.status = status;
  if (status === "completed") {
    test.endedAt = new Date().toISOString();
  }
  
  abTests.set(testId, test);
  console.log(`[A/B Test] Updated test "${test.name}" status to ${status}`);
  
  return test;
}

/**
 * Delete an A/B test
 */
export function deleteABTest(testId: string): boolean {
  const deleted = abTests.delete(testId);
  abTestResults.delete(testId);
  return deleted;
}

/**
 * Select a variant based on traffic split (weighted random)
 */
export function selectVariant(test: ABTestConfig): ABTestVariant {
  const rand = Math.random() * 100;
  let cumulative = 0;
  
  for (let i = 0; i < test.variants.length; i++) {
    cumulative += test.trafficSplit[i];
    if (rand < cumulative) {
      return test.variants[i];
    }
  }
  
  // Fallback to last variant
  return test.variants[test.variants.length - 1];
}

/**
 * Record a result for an A/B test
 */
export function recordABTestResult(
  testId: string,
  variantId: string,
  metrics: Record<string, number>,
  metadata?: Record<string, unknown>
): ABTestResult | null {
  const test = abTests.get(testId);
  if (!test || test.status !== "active") return null;

  const result: ABTestResult = {
    testId,
    variantId,
    timestamp: new Date().toISOString(),
    requestId: `req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    metrics,
    metadata,
  };

  const results = abTestResults.get(testId) || [];
  results.push(result);
  abTestResults.set(testId, results);

  return result;
}

/**
 * Get A/B test summary with statistics
 */
export function getABTestSummary(testId: string): ABTestSummary | null {
  const test = abTests.get(testId);
  if (!test) return null;

  const results = abTestResults.get(testId) || [];
  
  // Group results by variant
  const variantResults = new Map<string, ABTestResult[]>();
  for (const variant of test.variants) {
    variantResults.set(variant.id, []);
  }
  for (const result of results) {
    const existing = variantResults.get(result.variantId) || [];
    existing.push(result);
    variantResults.set(result.variantId, existing);
  }

  // Calculate stats for each variant
  const variantStats = test.variants.map(variant => {
    const vResults = variantResults.get(variant.id) || [];
    const avgMetrics: Record<string, number> = {};

    if (vResults.length > 0) {
      // Calculate average for each metric
      for (const metric of test.metrics) {
        const values = vResults
          .map(r => r.metrics[metric])
          .filter(v => v !== undefined && !isNaN(v));
        
        if (values.length > 0) {
          avgMetrics[metric] = values.reduce((sum, v) => sum + v, 0) / values.length;
        }
      }
    }

    return {
      variantId: variant.id,
      variantName: variant.name,
      model: variant.model,
      requests: vResults.length,
      percentage: results.length > 0 ? (vResults.length / results.length) * 100 : 0,
      avgMetrics,
    };
  });

  // Determine winner (simple: best average of first metric)
  let winner: ABTestSummary["winner"];
  if (results.length >= 10 && test.metrics.length > 0) {
    const primaryMetric = test.metrics[0];
    const baseline = variantStats[0];
    
    let bestVariant = variantStats[0];
    let bestValue = baseline.avgMetrics[primaryMetric] || 0;
    
    for (const stat of variantStats.slice(1)) {
      const value = stat.avgMetrics[primaryMetric] || 0;
      // For latency, lower is better; for others, higher is better
      const isBetter = primaryMetric.includes("latency") 
        ? value < bestValue 
        : value > bestValue;
      
      if (isBetter) {
        bestVariant = stat;
        bestValue = value;
      }
    }

    if (bestVariant !== baseline) {
      const baselineValue = baseline.avgMetrics[primaryMetric] || 1;
      const improvement = primaryMetric.includes("latency")
        ? ((baselineValue - bestValue) / baselineValue) * 100
        : ((bestValue - baselineValue) / baselineValue) * 100;

      // Simple confidence based on sample size
      const minSamples = Math.min(...variantStats.map(s => s.requests));
      const confidence = Math.min(95, 50 + minSamples * 2);

      winner = {
        variantId: bestVariant.variantId,
        confidence: Math.round(confidence),
        improvement: Math.round(improvement * 10) / 10,
      };
    }
  }

  return {
    testId: test.id,
    testName: test.name,
    status: test.status,
    totalRequests: results.length,
    variantStats,
    winner,
  };
}

/**
 * Run a request through an A/B test
 */
export async function runABTest(
  testId: string,
  messages: ChatMessage[],
  options?: { timeout?: number }
): Promise<{
  variant: ABTestVariant;
  response: ChatResponse;
  latencyMs: number;
  testId: string;
  requestId: string;
} | null> {
  const test = abTests.get(testId);
  if (!test || test.status !== "active") {
    console.warn(`[A/B Test] Test ${testId} not found or not active`);
    return null;
  }

  const variant = selectVariant(test);
  const startTime = Date.now();

  try {
    // Optionally optimize prompt for the selected model
    const optimizedMessages = optimizePromptForModel(messages, variant.model.model);
    
    const provider = createLLMProvider(variant.model.provider, { model: variant.model.model });
    
    const response = await Promise.race([
      provider.chat(optimizedMessages),
      new Promise<never>((_, reject) => 
        setTimeout(() => reject(new Error("Timeout")), options?.timeout ?? 60000)
      ),
    ]);

    const latencyMs = Date.now() - startTime;

    // Record result
    const result = recordABTestResult(testId, variant.id, {
      latency: latencyMs,
      tokens: response.usage?.totalTokens || 0,
    });

    return {
      variant,
      response,
      latencyMs,
      testId,
      requestId: result?.requestId || "unknown",
    };
  } catch (error) {
    const latencyMs = Date.now() - startTime;
    
    // Record failure
    recordABTestResult(testId, variant.id, {
      latency: latencyMs,
      error: 1,
    });

    console.error(`[A/B Test] Error in variant ${variant.id}:`, error);
    return null;
  }
}

/**
 * Quick helper to create a model comparison A/B test
 */
export function createModelComparisonTest(
  name: string,
  models: ModelSpec[],
  trafficSplit?: number[]
): ABTestConfig {
  const split = trafficSplit || models.map(() => 100 / models.length);
  
  return createABTest({
    name,
    description: `Compare performance of ${models.length} models`,
    variants: models.map((model, i) => ({
      id: `variant_${i}`,
      name: `${model.provider}/${model.model}`,
      model,
    })),
    trafficSplit: split,
    metrics: ["latency", "tokens", "error"],
  });
}

// ============================================
// Smart Auto-Select Model System
// ============================================

/**
 * Reasons why a model might be unavailable
 */
export type ModelUnavailableReason = 
  | "rate_limited"
  | "credits_exhausted" 
  | "api_error"
  | "timeout"
  | "network_error"
  | "unknown";

/**
 * Model health status tracking
 */
export interface ModelHealth {
  model: ModelSpec;
  available: boolean;
  unavailableReason?: ModelUnavailableReason;
  unavailableUntil?: number; // Timestamp when model should be available again
  consecutiveFailures: number;
  lastSuccess?: number;
  lastFailure?: number;
  lastError?: string;
}

/**
 * Model performance statistics
 */
export interface ModelPerformance {
  model: ModelSpec;
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  totalLatencyMs: number;
  avgLatencyMs: number;
  successRate: number;
  avgTokens: number;
  // From consensus voting
  consensusWins: number;
  consensusParticipations: number;
  consensusWinRate: number;
  // Computed ranking score
  rankScore: number;
  lastUpdated: number;
}

/**
 * Configuration for smart model selection
 */
export interface SmartSelectConfig {
  // Models to consider (in priority order if no performance data)
  candidateModels: ModelSpec[];
  // How long to cool down a model after failure (ms)
  cooldownMs?: number;
  // Max consecutive failures before longer cooldown
  maxConsecutiveFailures?: number;
  // Extended cooldown after max failures (ms)
  extendedCooldownMs?: number;
  // Request timeout (ms)
  timeout?: number;
  // Whether to optimize prompts for each model
  optimizePrompts?: boolean;
  // Ranking strategy
  rankingStrategy?: "performance" | "latency" | "cost" | "balanced";
}

// In-memory storage for model health and performance
const modelHealthMap = new Map<string, ModelHealth>();
const modelPerformanceMap = new Map<string, ModelPerformance>();

/**
 * Get unique key for a model
 */
function getModelKey(model: ModelSpec): string {
  return `${model.provider}:${model.model}`;
}

/**
 * Parse error to determine unavailability reason
 */
function parseErrorReason(error: unknown): { reason: ModelUnavailableReason; cooldownMs: number } {
  const errorStr = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  
  // Rate limit detection
  if (errorStr.includes("rate limit") || errorStr.includes("429") || errorStr.includes("too many requests")) {
    return { reason: "rate_limited", cooldownMs: 60000 }; // 1 minute
  }
  
  // Credits/quota exhausted
  if (errorStr.includes("credit") || errorStr.includes("quota") || errorStr.includes("exceeded") || 
      errorStr.includes("insufficient") || errorStr.includes("402") || errorStr.includes("payment")) {
    return { reason: "credits_exhausted", cooldownMs: 3600000 }; // 1 hour
  }
  
  // Timeout
  if (errorStr.includes("timeout") || errorStr.includes("timed out") || errorStr.includes("deadline")) {
    return { reason: "timeout", cooldownMs: 30000 }; // 30 seconds
  }
  
  // Network errors
  if (errorStr.includes("network") || errorStr.includes("econnrefused") || 
      errorStr.includes("enotfound") || errorStr.includes("fetch failed")) {
    return { reason: "network_error", cooldownMs: 30000 }; // 30 seconds
  }
  
  // API errors (500s, etc)
  if (errorStr.includes("500") || errorStr.includes("502") || errorStr.includes("503") || 
      errorStr.includes("server error") || errorStr.includes("internal error")) {
    return { reason: "api_error", cooldownMs: 60000 }; // 1 minute
  }
  
  return { reason: "unknown", cooldownMs: 30000 }; // 30 seconds default
}

/**
 * Get or initialize model health
 */
export function getModelHealth(model: ModelSpec): ModelHealth {
  const key = getModelKey(model);
  let health = modelHealthMap.get(key);
  
  if (!health) {
    health = {
      model,
      available: true,
      consecutiveFailures: 0,
    };
    modelHealthMap.set(key, health);
  }
  
  // Check if cooldown has expired
  if (!health.available && health.unavailableUntil && Date.now() >= health.unavailableUntil) {
    health.available = true;
    health.unavailableReason = undefined;
    health.unavailableUntil = undefined;
    console.log(`[SmartSelect] Model ${key} cooldown expired, marking available`);
  }
  
  return health;
}

/**
 * Get or initialize model performance
 */
export function getModelPerformance(model: ModelSpec): ModelPerformance {
  const key = getModelKey(model);
  let perf = modelPerformanceMap.get(key);
  
  if (!perf) {
    perf = {
      model,
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      totalLatencyMs: 0,
      avgLatencyMs: 0,
      successRate: 1, // Start optimistic
      avgTokens: 0,
      consensusWins: 0,
      consensusParticipations: 0,
      consensusWinRate: 0,
      rankScore: 50, // Start neutral
      lastUpdated: Date.now(),
    };
    modelPerformanceMap.set(key, perf);
  }
  
  return perf;
}

/**
 * Record a successful model call
 */
export function recordModelSuccess(
  model: ModelSpec, 
  latencyMs: number, 
  tokens?: number
): void {
  const key = getModelKey(model);
  
  // Update health
  const health = getModelHealth(model);
  health.available = true;
  health.consecutiveFailures = 0;
  health.lastSuccess = Date.now();
  health.unavailableReason = undefined;
  health.unavailableUntil = undefined;
  modelHealthMap.set(key, health);
  
  // Update performance
  const perf = getModelPerformance(model);
  perf.totalRequests++;
  perf.successfulRequests++;
  perf.totalLatencyMs += latencyMs;
  perf.avgLatencyMs = perf.totalLatencyMs / perf.successfulRequests;
  perf.successRate = perf.successfulRequests / perf.totalRequests;
  if (tokens) {
    const totalTokens = perf.avgTokens * (perf.successfulRequests - 1) + tokens;
    perf.avgTokens = totalTokens / perf.successfulRequests;
  }
  perf.lastUpdated = Date.now();
  updateRankScore(perf);
  modelPerformanceMap.set(key, perf);
}

/**
 * Record a failed model call
 */
export function recordModelFailure(
  model: ModelSpec,
  error: unknown,
  config?: { maxConsecutiveFailures?: number; extendedCooldownMs?: number }
): void {
  const key = getModelKey(model);
  const { reason, cooldownMs } = parseErrorReason(error);
  const maxFailures = config?.maxConsecutiveFailures ?? 3;
  const extendedCooldown = config?.extendedCooldownMs ?? 300000; // 5 minutes
  
  // Update health
  const health = getModelHealth(model);
  health.consecutiveFailures++;
  health.lastFailure = Date.now();
  health.lastError = error instanceof Error ? error.message : String(error);
  health.unavailableReason = reason;
  
  // Calculate cooldown
  let actualCooldown = cooldownMs;
  if (health.consecutiveFailures >= maxFailures) {
    actualCooldown = extendedCooldown;
    console.log(`[SmartSelect] Model ${key} hit max failures (${maxFailures}), extended cooldown: ${extendedCooldown}ms`);
  }
  
  health.available = false;
  health.unavailableUntil = Date.now() + actualCooldown;
  modelHealthMap.set(key, health);
  
  console.log(`[SmartSelect] Model ${key} marked unavailable: ${reason}, cooldown: ${actualCooldown}ms`);
  
  // Update performance
  const perf = getModelPerformance(model);
  perf.totalRequests++;
  perf.failedRequests++;
  perf.successRate = perf.successfulRequests / perf.totalRequests;
  perf.lastUpdated = Date.now();
  updateRankScore(perf);
  modelPerformanceMap.set(key, perf);
}

/**
 * Record consensus voting result
 */
export function recordConsensusResult(model: ModelSpec, won: boolean): void {
  const key = getModelKey(model);
  const perf = getModelPerformance(model);
  
  perf.consensusParticipations++;
  if (won) {
    perf.consensusWins++;
  }
  perf.consensusWinRate = perf.consensusParticipations > 0 
    ? perf.consensusWins / perf.consensusParticipations 
    : 0;
  perf.lastUpdated = Date.now();
  updateRankScore(perf);
  modelPerformanceMap.set(key, perf);
}

/**
 * Update the rank score based on performance metrics
 */
function updateRankScore(perf: ModelPerformance): void {
  // Weights for different factors
  const weights = {
    successRate: 40,      // 40% weight on success rate
    latency: 20,          // 20% weight on latency (lower is better)
    consensusWinRate: 30, // 30% weight on consensus wins
    recency: 10,          // 10% weight on recency of data
  };
  
  // Success rate score (0-100)
  const successScore = perf.successRate * 100;
  
  // Latency score (0-100, lower latency = higher score)
  // Assume <1s is excellent, >10s is poor
  const latencyScore = perf.avgLatencyMs > 0 
    ? Math.max(0, 100 - (perf.avgLatencyMs / 100)) 
    : 50;
  
  // Consensus score (0-100)
  // Weight by participation count (more data = more reliable)
  const consensusConfidence = Math.min(1, perf.consensusParticipations / 10);
  const consensusScore = perf.consensusParticipations > 0 
    ? perf.consensusWinRate * 100 * consensusConfidence + 50 * (1 - consensusConfidence)
    : 50;
  
  // Recency score (prefer models with recent activity)
  const hoursSinceUpdate = (Date.now() - perf.lastUpdated) / (1000 * 60 * 60);
  const recencyScore = Math.max(0, 100 - hoursSinceUpdate * 2);
  
  // Calculate weighted score
  perf.rankScore = (
    (successScore * weights.successRate) +
    (latencyScore * weights.latency) +
    (consensusScore * weights.consensusWinRate) +
    (recencyScore * weights.recency)
  ) / 100;
}

/**
 * Get all available models sorted by rank
 */
export function getAvailableModelsByRank(
  candidateModels: ModelSpec[],
  strategy: "performance" | "latency" | "cost" | "balanced" = "balanced"
): Array<{ model: ModelSpec; health: ModelHealth; performance: ModelPerformance }> {
  const results: Array<{ model: ModelSpec; health: ModelHealth; performance: ModelPerformance; sortScore: number }> = [];
  
  for (const model of candidateModels) {
    const health = getModelHealth(model);
    const performance = getModelPerformance(model);
    
    if (!health.available) {
      continue; // Skip unavailable models
    }
    
    // Calculate sort score based on strategy
    let sortScore: number;
    switch (strategy) {
      case "performance":
        sortScore = performance.successRate * 100;
        break;
      case "latency":
        sortScore = performance.avgLatencyMs > 0 ? 10000 / performance.avgLatencyMs : 50;
        break;
      case "cost":
        // Prefer local models (Ollama) over API models
        sortScore = model.provider === "ollama" ? 100 : 
                   model.provider === "mock" ? 90 : 50;
        break;
      case "balanced":
      default:
        sortScore = performance.rankScore;
        break;
    }
    
    results.push({ model, health, performance, sortScore });
  }
  
  // Sort by score (descending)
  results.sort((a, b) => b.sortScore - a.sortScore);
  
  return results.map(({ model, health, performance }) => ({ model, health, performance }));
}

/**
 * Smart chat with automatic model selection and fallback (internal implementation)
 */
async function smartChatInternal(
  messages: ChatMessage[],
  config: SmartSelectConfig
): Promise<{
  response: ChatResponse;
  model: ModelSpec;
  latencyMs: number;
  attempts: number;
  fallbackUsed: boolean;
  failedModels: Array<{ model: ModelSpec; error: string }>;
}> {
  const {
    candidateModels,
    cooldownMs = 60000,
    maxConsecutiveFailures = 3,
    extendedCooldownMs = 300000,
    timeout = 60000,
    optimizePrompts = true,
    rankingStrategy = "balanced",
  } = config;
  
  if (candidateModels.length === 0) {
    throw new Error("No candidate models provided");
  }
  
  // Get available models sorted by rank
  const rankedModels = getAvailableModelsByRank(candidateModels, rankingStrategy);
  
  // If no models available, check if any are close to coming back online
  if (rankedModels.length === 0) {
    // Find the model that will be available soonest
    let soonestAvailable: { model: ModelSpec; waitMs: number } | null = null;
    
    for (const model of candidateModels) {
      const health = getModelHealth(model);
      if (health.unavailableUntil) {
        const waitMs = health.unavailableUntil - Date.now();
        if (waitMs > 0 && (!soonestAvailable || waitMs < soonestAvailable.waitMs)) {
          soonestAvailable = { model, waitMs };
        }
      }
    }
    
    if (soonestAvailable && soonestAvailable.waitMs < 10000) {
      // Wait for it if less than 10 seconds
      console.log(`[SmartSelect] All models unavailable, waiting ${soonestAvailable.waitMs}ms for ${getModelKey(soonestAvailable.model)}`);
      await new Promise(resolve => setTimeout(resolve, soonestAvailable.waitMs + 100));
      // Retry selection
      const retryModels = getAvailableModelsByRank(candidateModels, rankingStrategy);
      if (retryModels.length > 0) {
        rankedModels.push(...retryModels);
      }
    }
    
    if (rankedModels.length === 0) {
      throw new Error("All candidate models are currently unavailable due to rate limits or errors");
    }
  }
  
  const failedModels: Array<{ model: ModelSpec; error: string }> = [];
  let attempts = 0;
  
  // Try each available model in order
  for (const { model } of rankedModels) {
    attempts++;
    const startTime = Date.now();
    const modelKey = getModelKey(model);
    
    console.log(`[SmartSelect] Attempt ${attempts}: trying ${modelKey}`);
    
    try {
      // Optionally optimize prompts for this model
      const finalMessages = optimizePrompts 
        ? optimizePromptForModel(messages, model.model) 
        : messages;
      
      const provider = createLLMProvider(model.provider, { model: model.model });
      
      const response = await Promise.race([
        provider.chat(finalMessages),
        new Promise<never>((_, reject) => 
          setTimeout(() => reject(new Error("Request timeout")), timeout)
        ),
      ]);
      
      const latencyMs = Date.now() - startTime;
      
      // Record success
      recordModelSuccess(model, latencyMs, response.usage?.totalTokens);
      
      console.log(`[SmartSelect] Success with ${modelKey} in ${latencyMs}ms`);
      
      return {
        response,
        model,
        latencyMs,
        attempts,
        fallbackUsed: attempts > 1,
        failedModels,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`[SmartSelect] Failed with ${modelKey}: ${errorMsg}`);
      
      failedModels.push({ model, error: errorMsg });
      
      // Record failure and apply cooldown
      recordModelFailure(model, error, { maxConsecutiveFailures, extendedCooldownMs });
    }
  }
  
  // All models failed
  throw new Error(
    `All ${attempts} candidate models failed. Errors: ${failedModels.map(f => `${getModelKey(f.model)}: ${f.error}`).join("; ")}`
  );
}

/**
 * Smart chat with automatic model selection and fallback (exported wrapper)
 */
export async function smartChat(
  messages: ChatMessage[],
  config: SmartSelectConfig
): Promise<{
  response: ChatResponse;
  model: ModelSpec;
  latencyMs: number;
  attempts: number;
  fallbackUsed: boolean;
  failedModels: Array<{ model: ModelSpec; error: string }>;
}> {
  return smartChatInternal(messages, config);
}

/**
 * Get health status for all tracked models
 */
export function getAllModelHealth(): ModelHealth[] {
  return Array.from(modelHealthMap.values());
}

/**
 * Get performance stats for all tracked models
 */
export function getAllModelPerformance(): ModelPerformance[] {
  return Array.from(modelPerformanceMap.values());
}

/**
 * Reset health for a specific model (force it back online)
 */
export function resetModelHealth(model: ModelSpec): void {
  const key = getModelKey(model);
  const health = getModelHealth(model);
  health.available = true;
  health.consecutiveFailures = 0;
  health.unavailableReason = undefined;
  health.unavailableUntil = undefined;
  modelHealthMap.set(key, health);
  console.log(`[SmartSelect] Model ${key} health reset`);
}

/**
 * Clear all health and performance data
 */
export function clearModelStats(): void {
  modelHealthMap.clear();
  modelPerformanceMap.clear();
  console.log("[SmartSelect] All model stats cleared");
}

/**
 * Configure default candidate models from environment
 */
export async function getDefaultCandidateModels(): Promise<ModelSpec[]> {
  const candidates: ModelSpec[] = [];
  
  // Check OpenRouter
  if (process.env.OPENROUTER_API_KEY) {
    candidates.push(
      { provider: "openrouter", model: process.env.OPENROUTER_MODEL || "openai/gpt-4o-mini" },
    );
  }
  
  // Check OpenAI
  if (process.env.OPENAI_API_KEY) {
    candidates.push(
      { provider: "openai", model: process.env.OPENAI_MODEL || "gpt-4o-mini" },
    );
  }
  
  // Check Ollama
  if (await isOllamaAvailable()) {
    const ollamaModels = await listOllamaModels();
    for (const m of ollamaModels.slice(0, 3)) { // Add up to 3 Ollama models
      candidates.push({ provider: "ollama", model: m.id });
    }
  }
  
  return candidates;
}

/**
 * Smart chat with automatic candidate detection
 */
export async function smartChatAuto(
  messages: ChatMessage[],
  options?: Partial<Omit<SmartSelectConfig, "candidateModels">>
): Promise<{
  response: ChatResponse;
  model: ModelSpec;
  latencyMs: number;
  attempts: number;
  fallbackUsed: boolean;
  failedModels: Array<{ model: ModelSpec; error: string }>;
}> {
  const candidates = await getDefaultCandidateModels();
  
  if (candidates.length === 0) {
    throw new Error("No LLM providers configured. Set OPENROUTER_API_KEY, OPENAI_API_KEY, or start Ollama.");
  }
  
  return smartChat(messages, {
    candidateModels: candidates,
    ...options,
  });
}

/**
 * Smart invoke - convenient function for agents that mimics LangChain's .invoke()
 * but with automatic fallback. Use this as a drop-in replacement for llm.invoke(prompt).
 * 
 * @param prompt - The prompt string (will be sent as a user message)
 * @param systemPrompt - Optional system prompt
 * @returns The response content string
 */
export async function smartInvoke(
  prompt: string,
  systemPrompt?: string
): Promise<string> {
  const messages: ChatMessage[] = [];
  
  if (systemPrompt) {
    messages.push({ role: "system", content: systemPrompt });
  }
  messages.push({ role: "user", content: prompt });

  // Use the provider's smartChat method which respects global smart mode settings
  const response = await llmProvider.smartChat(messages);
  return response.content;
}

/**
 * Get the smart LLM - returns a proxy object that behaves like BaseChatModel
 * but uses smart fallback when invoked. This is a drop-in replacement for llmProvider.getLLM()
 */
export function getSmartLLM(): {
  invoke: (prompt: string) => Promise<{ content: string }>;
} {
  return {
    async invoke(prompt: string): Promise<{ content: string }> {
      const content = await smartInvoke(prompt);
      return { content };
    },
  };
}


