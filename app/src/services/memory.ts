import { sql } from "../core/database";

// ============================================
// Types
// ============================================

export interface MemoryEntry {
  id?: string;
  content: string;
  type: "semantic" | "episodic" | "procedural";
  namespace: string;
  embedding?: number[];
  metadata?: Record<string, unknown>;
  importance?: number;
  agentId?: string;
  userId?: string;
  workflowExecutionId?: string;
}

export interface MemorySearchRequest {
  query: string;
  namespace?: string;
  type?: "semantic" | "episodic" | "procedural";
  agentId?: string;
  limit?: number;
  threshold?: number;
}

export interface MemorySearchResult {
  id: string;
  content: string;
  type: string;
  namespace: string;
  metadata: Record<string, unknown>;
  score: number;
}

// ============================================
// Embedding Provider Interface
// ============================================

export interface EmbeddingProvider {
  embed(text: string): Promise<number[]>;
  embedBatch(texts: string[]): Promise<number[][]>;
}

// ============================================
// Memory Store Class
// ============================================

class MemoryStore {
  private embeddingProvider: EmbeddingProvider | null = null;
  private embeddingDimensions = 1536; // OpenAI ada-002 default

  /**
   * Set the embedding provider
   */
  setEmbeddingProvider(provider: EmbeddingProvider): void {
    this.embeddingProvider = provider;
    console.log("Memory store embedding provider configured");
  }

  /**
   * Store a memory entry
   */
  async store(entry: MemoryEntry): Promise<string> {
    // Generate embedding if provider is available
    let embedding: number[] | null = null;
    if (this.embeddingProvider) {
      try {
        embedding = await this.embeddingProvider.embed(entry.content);
      } catch (error) {
        console.error("[Memory] Failed to generate embedding:", error);
      }
    }

    // Check for duplicates (high similarity)
    if (embedding) {
      const existing = await this.findSimilar(embedding, entry.namespace, 0.95, 1);
      if (existing.length > 0) {
        // Update existing instead of creating duplicate
        // Pass the already-computed embedding to avoid regeneration
        console.log(`[Memory] Updating existing memory ${existing[0].id} instead of creating duplicate`);
        await this.update(existing[0].id, {
          content: entry.content,
          importance: Math.max(existing[0].metadata?.importance as number || 0, entry.importance || 0.5),
          metadata: { ...existing[0].metadata, ...entry.metadata },
        }, embedding);
        return existing[0].id;
      }
    }

    // Insert new memory
    const result = await sql`
      INSERT INTO memories (
        content, memory_type, namespace, embedding,
        metadata, importance, agent_id, user_id, workflow_execution_id
      )
      VALUES (
        ${entry.content},
        ${entry.type},
        ${entry.namespace},
        ${embedding ? JSON.stringify(embedding) : null}::vector,
        ${JSON.stringify(entry.metadata || {})}::jsonb,
        ${entry.importance || 0.5},
        ${entry.agentId || null}::uuid,
        ${entry.userId || null}::uuid,
        ${entry.workflowExecutionId || null}::uuid
      )
      RETURNING id
    `;

    return result[0].id;
  }

  /**
   * Search memories by semantic similarity
   */
  async search(request: MemorySearchRequest): Promise<MemorySearchResult[]> {
    if (!this.embeddingProvider) {
      console.warn("No embedding provider configured, falling back to text search");
      return this.textSearch(request);
    }

    try {
      const queryEmbedding = await this.embeddingProvider.embed(request.query);
      return this.findSimilar(
        queryEmbedding,
        request.namespace,
        request.threshold || 0.7,
        request.limit || 10,
        request.type,
        request.agentId,
      );
    } catch (error) {
      console.error("Embedding search failed, falling back to text search:", error);
      return this.textSearch(request);
    }
  }

  /**
   * Find similar memories by embedding
   */
  private async findSimilar(
    embedding: number[],
    namespace?: string,
    threshold: number = 0.7,
    limit: number = 10,
    type?: string,
    agentId?: string,
  ): Promise<MemorySearchResult[]> {
    const embeddingStr = `[${embedding.join(",")}]`;
    
    const results = await sql`
      SELECT 
        id,
        content,
        memory_type as type,
        namespace,
        metadata,
        1 - (embedding <=> ${embeddingStr}::vector) as score
      FROM memories
      WHERE 
        embedding IS NOT NULL
        AND (${namespace || null}::text IS NULL OR namespace LIKE ${namespace ? namespace + '%' : '%'})
        AND (${type || null}::text IS NULL OR memory_type = ${type || ''})
        AND (${agentId || null}::uuid IS NULL OR agent_id = ${agentId || '00000000-0000-0000-0000-000000000000'}::uuid)
        AND 1 - (embedding <=> ${embeddingStr}::vector) >= ${threshold}
      ORDER BY 
        embedding <=> ${embeddingStr}::vector,
        importance DESC
      LIMIT ${limit}
    `;

    // Update access counts
    if (results.length > 0) {
      const ids = results.map((r) => r.id);
      await sql`
        UPDATE memories 
        SET access_count = access_count + 1, last_accessed_at = NOW()
        WHERE id = ANY(${ids}::uuid[])
      `;
    }

    return results.map((r) => ({
      id: r.id,
      content: r.content,
      type: r.type,
      namespace: r.namespace,
      metadata: typeof r.metadata === 'string' ? JSON.parse(r.metadata) : (r.metadata as Record<string, unknown>),
      score: Number(r.score),
    }));
  }

  /**
   * Fallback text search when embeddings not available
   */
  private async textSearch(request: MemorySearchRequest): Promise<MemorySearchResult[]> {
    const results = await sql`
      SELECT 
        id,
        content,
        memory_type as type,
        namespace,
        metadata,
        similarity(content, ${request.query}) as score
      FROM memories
      WHERE 
        (${request.namespace || null}::text IS NULL OR namespace LIKE ${request.namespace ? request.namespace + '%' : '%'})
        AND (${request.type || null}::text IS NULL OR memory_type = ${request.type || ''})
        AND content % ${request.query}
      ORDER BY score DESC
      LIMIT ${request.limit || 10}
    `;

    return results.map((r) => ({
      id: r.id,
      content: r.content,
      type: r.type,
      namespace: r.namespace,
      metadata: typeof r.metadata === 'string' ? JSON.parse(r.metadata) : (r.metadata as Record<string, unknown>),
      score: Number(r.score),
    }));
  }

  /**
   * Update a memory entry
   * @param id - Memory ID to update
   * @param updates - Fields to update
   * @param existingEmbedding - Optional pre-computed embedding to avoid regeneration
   */
  async update(
    id: string,
    updates: Partial<Pick<MemoryEntry, "content" | "importance" | "metadata">>,
    existingEmbedding?: number[],
  ): Promise<void> {
    // Handle updates one field at a time to avoid SQL injection with dynamic SET clauses
    // This is safer than building dynamic SQL strings
    
    if (updates.content !== undefined) {
      // Update content
      await sql`
        UPDATE memories
        SET content = ${updates.content}, updated_at = NOW()
        WHERE id = ${id}::uuid
      `;

      // Use existing embedding if provided, otherwise skip re-generation
      // (Re-generating embeddings is expensive and the content is similar enough if we're updating a duplicate)
      if (existingEmbedding) {
        const embeddingStr = `[${existingEmbedding.join(",")}]`;
        await sql`
          UPDATE memories
          SET embedding = ${embeddingStr}::vector, updated_at = NOW()
          WHERE id = ${id}::uuid
        `;
      }
    }

    if (updates.importance !== undefined) {
      await sql`
        UPDATE memories
        SET importance = ${updates.importance}, updated_at = NOW()
        WHERE id = ${id}::uuid
      `;
    }

    if (updates.metadata !== undefined) {
      const metadataJson = JSON.stringify(updates.metadata);
      await sql`
        UPDATE memories
        SET metadata = ${metadataJson}::jsonb, updated_at = NOW()
        WHERE id = ${id}::uuid
      `;
    }
  }

  /**
   * Delete a memory
   */
  async delete(id: string): Promise<void> {
    await sql`DELETE FROM memories WHERE id = ${id}::uuid`;
  }

  /**
   * Get memory by ID
   */
  async get(id: string): Promise<MemoryEntry | null> {
    const results = await sql`
      SELECT id, content, memory_type as type, namespace, metadata, importance,
             agent_id, user_id, workflow_execution_id
      FROM memories
      WHERE id = ${id}::uuid
    `;

    if (results.length === 0) return null;

    const r = results[0];
    return {
      id: r.id,
      content: r.content,
      type: r.type as MemoryEntry["type"],
      namespace: r.namespace,
      metadata: typeof r.metadata === 'string' ? JSON.parse(r.metadata) : (r.metadata as Record<string, unknown>),
      importance: Number(r.importance),
      agentId: r.agent_id,
      userId: r.user_id,
      workflowExecutionId: r.workflow_execution_id,
    };
  }

  /**
   * Get memories by namespace
   */
  async getByNamespace(
    namespace: string,
    limit: number = 100,
  ): Promise<MemoryEntry[]> {
    const results = await sql`
      SELECT id, content, memory_type as type, namespace, metadata, importance
      FROM memories
      WHERE namespace LIKE ${namespace + '%'}
      ORDER BY importance DESC, created_at DESC
      LIMIT ${limit}
    `;

    return results.map((r) => ({
      id: r.id,
      content: r.content,
      type: r.type as MemoryEntry["type"],
      namespace: r.namespace,
      metadata: typeof r.metadata === 'string' ? JSON.parse(r.metadata) : (r.metadata as Record<string, unknown>),
      importance: Number(r.importance),
    }));
  }

  /**
   * Consolidate similar memories (merge duplicates)
   * Finds clusters of semantically similar memories and merges them into single entries.
   * The merged memory keeps the most important content and combines metadata.
   */
  async consolidate(namespace: string, threshold: number = 0.9): Promise<{
    merged: number;
    clusters: Array<{ kept: string; removed: string[]; similarity: number }>;
  }> {
    console.log(`[Memory] Starting consolidation for namespace: ${namespace} (threshold: ${threshold})`);
    
    // Find pairs of similar memories within the namespace
    const similarPairs = await sql`
      WITH memory_pairs AS (
        SELECT 
          m1.id as id1,
          m1.content as content1,
          m1.importance as importance1,
          m1.access_count as access_count1,
          m1.metadata as metadata1,
          m1.created_at as created1,
          m2.id as id2,
          m2.content as content2,
          m2.importance as importance2,
          m2.access_count as access_count2,
          m2.metadata as metadata2,
          m2.created_at as created2,
          1 - (m1.embedding <=> m2.embedding) as similarity
        FROM memories m1
        JOIN memories m2 ON m1.id < m2.id
        WHERE 
          m1.namespace LIKE ${namespace + '%'}
          AND m2.namespace LIKE ${namespace + '%'}
          AND m1.embedding IS NOT NULL
          AND m2.embedding IS NOT NULL
          AND 1 - (m1.embedding <=> m2.embedding) > ${threshold}
      )
      SELECT * FROM memory_pairs
      ORDER BY similarity DESC
    `;

    if (similarPairs.length === 0) {
      console.log(`[Memory] No similar memories found to consolidate`);
      return { merged: 0, clusters: [] };
    }

    // Build clusters using union-find approach
    const processed = new Set<string>();
    const clusters: Array<{ kept: string; removed: string[]; similarity: number }> = [];
    let merged = 0;

    for (const pair of similarPairs) {
      // Skip if either memory already processed
      if (processed.has(pair.id1) || processed.has(pair.id2)) continue;

      // Determine which memory to keep (higher importance, more accesses, or older)
      const score1 = (pair.importance1 * 2) + (pair.access_count1 * 0.1);
      const score2 = (pair.importance2 * 2) + (pair.access_count2 * 0.1);
      
      const [keepId, removeId, keepContent, removeContent, keepMeta, removeMeta, keepImportance, removeImportance] = 
        score1 >= score2 
          ? [pair.id1, pair.id2, pair.content1, pair.content2, pair.metadata1, pair.metadata2, pair.importance1, pair.importance2]
          : [pair.id2, pair.id1, pair.content2, pair.content1, pair.metadata2, pair.metadata1, pair.importance2, pair.importance1];

      // Merge metadata
      const mergedMetadata = {
        ...(typeof keepMeta === 'string' ? JSON.parse(keepMeta) : keepMeta || {}),
        ...(typeof removeMeta === 'string' ? JSON.parse(removeMeta) : removeMeta || {}),
        consolidatedFrom: [removeId],
        consolidatedAt: new Date().toISOString(),
      };

      // Increase importance (memories that appear multiple times are more important)
      const newImportance = Math.min(1.0, Math.max(keepImportance, removeImportance) + 0.1);

      // Update the kept memory
      await sql`
        UPDATE memories
        SET 
          importance = ${newImportance},
          metadata = ${JSON.stringify(mergedMetadata)}::jsonb,
          access_count = access_count + ${pair.access_count1 < pair.access_count2 ? pair.access_count2 : pair.access_count1},
          updated_at = NOW()
        WHERE id = ${keepId}::uuid
      `;

      // Delete the duplicate
      await sql`DELETE FROM memories WHERE id = ${removeId}::uuid`;

      processed.add(keepId);
      processed.add(removeId);
      clusters.push({ kept: keepId, removed: [removeId], similarity: Number(pair.similarity) });
      merged++;
    }

    console.log(`[Memory] Consolidation complete: ${merged} memories merged`);
    return { merged, clusters };
  }

  /**
   * Consolidate all namespaces
   */
  async consolidateAll(threshold: number = 0.9): Promise<{
    total: number;
    byNamespace: Record<string, number>;
  }> {
    // Get all unique namespaces
    const namespaces = await sql`
      SELECT DISTINCT SPLIT_PART(namespace, '/', 1) as ns
      FROM memories
    `;

    const byNamespace: Record<string, number> = {};
    let total = 0;

    for (const row of namespaces) {
      const result = await this.consolidate(row.ns, threshold);
      byNamespace[row.ns] = result.merged;
      total += result.merged;
    }

    return { total, byNamespace };
  }

  /**
   * Decay importance of old, unused memories
   * This implements a forgetting curve - memories that haven't been accessed
   * gradually become less important over time.
   */
  async decayImportance(
    olderThanDays: number = 30,
    decayFactor: number = 0.95,
  ): Promise<{ decayed: number; avgImportanceBefore: number; avgImportanceAfter: number }> {
    // Get stats before decay
    const beforeStats = await sql`
      SELECT AVG(importance) as avg_importance, COUNT(*) as count
      FROM memories
      WHERE 
        last_accessed_at < NOW() - INTERVAL '1 day' * ${olderThanDays}
        AND importance > 0.1
    `;

    // Apply decay
    const result = await sql`
      UPDATE memories
      SET 
        importance = importance * ${decayFactor},
        metadata = jsonb_set(
          COALESCE(metadata, '{}'::jsonb),
          '{lastDecayAt}',
          to_jsonb(NOW()::text)
        ),
        updated_at = NOW()
      WHERE 
        last_accessed_at < NOW() - INTERVAL '1 day' * ${olderThanDays}
        AND importance > 0.1
      RETURNING id, importance
    `;

    // Calculate after stats
    const avgAfter = result.length > 0 
      ? result.reduce((sum, r) => sum + Number(r.importance), 0) / result.length 
      : 0;

    console.log(`[Memory] Decayed ${result.length} memories (factor: ${decayFactor})`);
    
    return {
      decayed: result.length,
      avgImportanceBefore: Number(beforeStats[0]?.avg_importance || 0),
      avgImportanceAfter: avgAfter,
    };
  }

  /**
   * Boost importance of frequently accessed memories
   * Opposite of decay - rewards memories that are being used.
   */
  async boostFrequentlyAccessed(
    minAccessCount: number = 5,
    boostFactor: number = 1.05,
    maxImportance: number = 1.0,
  ): Promise<number> {
    const result = await sql`
      UPDATE memories
      SET 
        importance = LEAST(importance * ${boostFactor}, ${maxImportance}),
        updated_at = NOW()
      WHERE 
        access_count >= ${minAccessCount}
        AND importance < ${maxImportance}
        AND last_accessed_at > NOW() - INTERVAL '7 days'
      RETURNING id
    `;

    console.log(`[Memory] Boosted ${result.length} frequently accessed memories`);
    return result.length;
  }

  /**
   * Cleanup old, low-importance memories
   */
  async cleanup(
    minImportance: number = 0.1,
    minAccessCount: number = 3,
    olderThanDays: number = 90,
  ): Promise<number> {
    const result = await sql`
      DELETE FROM memories
      WHERE 
        importance < ${minImportance}
        AND access_count < ${minAccessCount}
        AND created_at < NOW() - INTERVAL '1 day' * ${olderThanDays}
      RETURNING id
    `;

    console.log(`[Memory] Cleaned up ${result.length} old, low-importance memories`);
    return result.length;
  }

  // ============================================
  // Cross-Agent Learning
  // ============================================

  /**
   * Share a learning from one agent to others
   * Creates copies in other agent namespaces with lower importance
   */
  async shareLesson(
    memoryId: string,
    targetNamespaces: string[],
    importanceMultiplier: number = 0.7,
  ): Promise<string[]> {
    const original = await this.get(memoryId);
    if (!original) throw new Error(`Memory ${memoryId} not found`);

    const sharedIds: string[] = [];

    for (const targetNs of targetNamespaces) {
      // Don't share to same namespace
      if (targetNs === original.namespace) continue;

      const sharedId = await this.store({
        content: original.content,
        type: original.type,
        namespace: targetNs,
        metadata: {
          ...original.metadata,
          sharedFrom: original.namespace,
          originalId: memoryId,
          sharedAt: new Date().toISOString(),
        },
        importance: (original.importance || 0.5) * importanceMultiplier,
      });

      sharedIds.push(sharedId);
    }

    console.log(`[Memory] Shared lesson to ${sharedIds.length} namespaces`);
    return sharedIds;
  }

  /**
   * Find valuable lessons that should be shared globally
   * High importance + high access count = valuable knowledge
   */
  async findShareableMemories(
    minImportance: number = 0.8,
    minAccessCount: number = 5,
    limit: number = 10,
  ): Promise<MemoryEntry[]> {
    const results = await sql`
      SELECT id, content, memory_type as type, namespace, metadata, importance,
             agent_id, user_id, workflow_execution_id
      FROM memories
      WHERE 
        importance >= ${minImportance}
        AND access_count >= ${minAccessCount}
        AND memory_type = 'procedural'
        AND NOT namespace LIKE 'global%'
      ORDER BY importance DESC, access_count DESC
      LIMIT ${limit}
    `;

    return results.map((r) => ({
      id: r.id,
      content: r.content,
      type: r.type as MemoryEntry["type"],
      namespace: r.namespace,
      metadata: typeof r.metadata === 'string' ? JSON.parse(r.metadata) : (r.metadata as Record<string, unknown>),
      importance: Number(r.importance),
      agentId: r.agent_id,
      userId: r.user_id,
      workflowExecutionId: r.workflow_execution_id,
    }));
  }

  /**
   * Promote agent-specific lessons to global namespace
   */
  async promoteToGlobal(
    memoryId: string,
    globalSubNamespace: string = 'learnings',
  ): Promise<string> {
    const original = await this.get(memoryId);
    if (!original) throw new Error(`Memory ${memoryId} not found`);

    const globalId = await this.store({
      content: original.content,
      type: original.type,
      namespace: `global/${globalSubNamespace}`,
      metadata: {
        ...original.metadata,
        promotedFrom: original.namespace,
        originalId: memoryId,
        promotedAt: new Date().toISOString(),
      },
      importance: Math.min(1.0, (original.importance || 0.5) * 1.2), // Boost importance
    });

    console.log(`[Memory] Promoted memory ${memoryId} to global namespace`);
    return globalId;
  }

  // ============================================
  // Export/Import
  // ============================================

  /**
   * Export memories to JSON format for backup or sharing
   */
  async exportMemories(options: {
    namespace?: string;
    type?: MemoryEntry["type"];
    minImportance?: number;
    includeEmbeddings?: boolean;
  } = {}): Promise<{
    version: string;
    exportedAt: string;
    count: number;
    memories: Array<{
      content: string;
      type: string;
      namespace: string;
      metadata: Record<string, unknown>;
      importance: number;
      embedding?: number[];
    }>;
  }> {
    const results = await sql`
      SELECT 
        content, 
        memory_type as type, 
        namespace, 
        metadata, 
        importance,
        ${options.includeEmbeddings ? sql`embedding::text` : sql`NULL`} as embedding
      FROM memories
      WHERE 
        (${options.namespace || null}::text IS NULL OR namespace LIKE ${options.namespace ? options.namespace + '%' : '%'})
        AND (${options.type || null}::text IS NULL OR memory_type = ${options.type || ''})
        AND importance >= ${options.minImportance || 0}
      ORDER BY namespace, importance DESC
    `;

    const memories = results.map((r) => {
      const mem: {
        content: string;
        type: string;
        namespace: string;
        metadata: Record<string, unknown>;
        importance: number;
        embedding?: number[];
      } = {
        content: r.content,
        type: r.type,
        namespace: r.namespace,
        metadata: typeof r.metadata === 'string' ? JSON.parse(r.metadata) : (r.metadata as Record<string, unknown>),
        importance: Number(r.importance),
      };
      
      if (options.includeEmbeddings && r.embedding) {
        // Parse embedding from PostgreSQL vector format "[1,2,3]"
        mem.embedding = JSON.parse(r.embedding.replace(/^\[/, '[').replace(/\]$/, ']'));
      }
      
      return mem;
    });

    console.log(`[Memory] Exported ${memories.length} memories`);
    
    return {
      version: '1.0',
      exportedAt: new Date().toISOString(),
      count: memories.length,
      memories,
    };
  }

  /**
   * Import memories from JSON backup
   */
  async importMemories(data: {
    memories: Array<{
      content: string;
      type: string;
      namespace: string;
      metadata?: Record<string, unknown>;
      importance?: number;
      embedding?: number[];
    }>;
  }, options: {
    overwrite?: boolean; // If true, update existing similar memories
    namespacePrefix?: string; // Add prefix to all namespaces
  } = {}): Promise<{
    imported: number;
    skipped: number;
    updated: number;
  }> {
    let imported = 0;
    let skipped = 0;
    let updated = 0;

    for (const mem of data.memories) {
      const namespace = options.namespacePrefix 
        ? `${options.namespacePrefix}/${mem.namespace}` 
        : mem.namespace;

      try {
        // Check for existing similar memory if embedding provided
        if (mem.embedding && !options.overwrite) {
          const existing = await this.findSimilar(mem.embedding, namespace, 0.95, 1);
          if (existing.length > 0) {
            skipped++;
            continue;
          }
        }

        // Store the memory
        if (mem.embedding) {
          // Direct insert with embedding
          await sql`
            INSERT INTO memories (
              content, memory_type, namespace, embedding,
              metadata, importance
            )
            VALUES (
              ${mem.content},
              ${mem.type},
              ${namespace},
              ${JSON.stringify(mem.embedding)}::vector,
              ${JSON.stringify(mem.metadata || {})}::jsonb,
              ${mem.importance || 0.5}
            )
          `;
          imported++;
        } else {
          // Use store method to generate embedding
          await this.store({
            content: mem.content,
            type: mem.type as MemoryEntry["type"],
            namespace,
            metadata: {
              ...mem.metadata,
              importedAt: new Date().toISOString(),
            },
            importance: mem.importance,
          });
          imported++;
        }
      } catch (error) {
        console.error(`[Memory] Failed to import memory:`, error);
        skipped++;
      }
    }

    console.log(`[Memory] Import complete: ${imported} imported, ${skipped} skipped, ${updated} updated`);
    return { imported, skipped, updated };
  }

  // ============================================
  // Maintenance Jobs
  // ============================================

  /**
   * Run all maintenance tasks
   * Should be called periodically (e.g., daily via scheduler)
   */
  async runMaintenance(): Promise<{
    decayed: number;
    boosted: number;
    consolidated: number;
    cleaned: number;
    promoted: number;
  }> {
    console.log('[Memory] Starting maintenance...');

    // 1. Decay old unused memories
    const decayResult = await this.decayImportance(30, 0.95);

    // 2. Boost frequently accessed memories
    const boosted = await this.boostFrequentlyAccessed(5, 1.05);

    // 3. Consolidate similar memories
    const consolidateResult = await this.consolidateAll(0.92);

    // 4. Cleanup very old, low-importance memories
    const cleaned = await this.cleanup(0.1, 2, 90);

    // 5. Find and promote valuable lessons to global
    const shareable = await this.findShareableMemories(0.85, 10, 5);
    let promoted = 0;
    for (const mem of shareable) {
      if (mem.id) {
        try {
          await this.promoteToGlobal(mem.id);
          promoted++;
        } catch (e) {
          // May already exist in global
        }
      }
    }

    console.log('[Memory] Maintenance complete');

    return {
      decayed: decayResult.decayed,
      boosted,
      consolidated: consolidateResult.total,
      cleaned,
      promoted,
    };
  }

  /**
   * Get statistics about memory usage
   */
  async getStats(): Promise<{
    total: number;
    byType: Record<string, number>;
    byNamespace: Record<string, number>;
    byAgent: Record<string, number>;
  }> {
    const total = await sql`SELECT COUNT(*) as count FROM memories`;
    
    const byType = await sql`
      SELECT memory_type as type, COUNT(*) as count 
      FROM memories 
      GROUP BY memory_type
    `;
    
    const byNamespace = await sql`
      SELECT 
        SPLIT_PART(namespace, '/', 1) as ns,
        COUNT(*) as count 
      FROM memories 
      GROUP BY SPLIT_PART(namespace, '/', 1)
    `;

    // Get breakdown by full namespace path (agent level)
    const byAgent = await sql`
      SELECT 
        namespace,
        COUNT(*) as count 
      FROM memories 
      GROUP BY namespace
      ORDER BY count DESC
    `;

    return {
      total: Number(total[0].count),
      byType: Object.fromEntries(byType.map((r) => [r.type, Number(r.count)])),
      byNamespace: Object.fromEntries(byNamespace.map((r) => [r.ns, Number(r.count)])),
      byAgent: Object.fromEntries(byAgent.map((r) => [r.namespace, Number(r.count)])),
    };
  }
}

// Export singleton instance
export const memoryStore = new MemoryStore();
