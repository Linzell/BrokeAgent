import { sql as db } from "../core/database";
import * as fs from "node:fs";
import * as path from "node:path";

// ============================================
// Migration System
// ============================================

// Get the app root directory (app/)
const APP_ROOT = path.resolve(import.meta.dir, "../..");

interface Migration {
  name: string;
  sql: string;
  appliedAt?: Date;
}

/**
 * Simple migration runner for raw SQL files
 * 
 * Migration files should be named: 001_initial.sql, 002_add_feature.sql, etc.
 * The naming convention ensures migrations run in order.
 */
export class MigrationRunner {
  private migrationsDir: string;

  constructor(migrationsDir?: string) {
    this.migrationsDir = migrationsDir || path.join(APP_ROOT, "database/migrations");
  }

  /**
   * Ensure migrations table exists
   */
  async init(): Promise<void> {
    await db`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL UNIQUE,
        applied_at TIMESTAMPTZ DEFAULT NOW()
      )
    `;
    console.log("Migration table initialized");
  }

  /**
   * Get list of applied migrations
   */
  async getAppliedMigrations(): Promise<string[]> {
    const result = await db`
      SELECT name FROM schema_migrations ORDER BY name
    `;
    return result.map((r) => r.name);
  }

  /**
   * Get list of pending migrations from filesystem
   */
  getPendingMigrations(appliedMigrations: string[]): string[] {
    if (!fs.existsSync(this.migrationsDir)) {
      return [];
    }

    const files = fs.readdirSync(this.migrationsDir)
      .filter((f) => f.endsWith(".sql"))
      .sort();

    return files.filter((f) => !appliedMigrations.includes(f));
  }

  /**
   * Run all pending migrations
   */
  async runAll(): Promise<number> {
    await this.init();

    const applied = await this.getAppliedMigrations();
    const pending = this.getPendingMigrations(applied);

    if (pending.length === 0) {
      console.log("No pending migrations");
      return 0;
    }

    console.log(`Found ${pending.length} pending migrations`);

    for (const migrationFile of pending) {
      await this.runMigration(migrationFile);
    }

    return pending.length;
  }

  /**
   * Run a single migration
   */
  async runMigration(filename: string): Promise<void> {
    const filePath = path.join(this.migrationsDir, filename);
    const sql = fs.readFileSync(filePath, "utf-8");

    console.log(`Running migration: ${filename}`);

    try {
      // Run migration in a transaction
      await db.begin(async (tx) => {
        // Execute the migration SQL
        await tx.unsafe(sql);

        // Record the migration
        await tx`
          INSERT INTO schema_migrations (name) VALUES (${filename})
        `;
      });

      console.log(`  ✓ ${filename} applied`);
    } catch (error) {
      console.error(`  ✗ ${filename} failed:`, error);
      throw error;
    }
  }

  /**
   * Run initial setup from init.sql
   */
  async runInitialSetup(): Promise<void> {
    const initPath = path.join(APP_ROOT, "database/init.sql");
    
    if (!fs.existsSync(initPath)) {
      console.error("init.sql not found at:", initPath);
      return;
    }

    console.log("Running initial database setup...");

    const sql = fs.readFileSync(initPath, "utf-8");

    try {
      await db.unsafe(sql);
      console.log("Initial setup complete");
    } catch (error) {
      console.error("Initial setup failed:", error);
      throw error;
    }
  }

  /**
   * Get migration status
   */
  async status(): Promise<{ applied: string[]; pending: string[] }> {
    await this.init();
    const applied = await this.getAppliedMigrations();
    const pending = this.getPendingMigrations(applied);

    return { applied, pending };
  }

  /**
   * Rollback the last migration (dangerous!)
   */
  async rollbackLast(): Promise<string | null> {
    const applied = await this.getAppliedMigrations();
    
    if (applied.length === 0) {
      console.log("No migrations to rollback");
      return null;
    }

    const lastMigration = applied[applied.length - 1];
    
    // Check if there's a down migration
    const downFile = lastMigration.replace(".sql", ".down.sql");
    const downPath = path.join(this.migrationsDir, downFile);

    if (fs.existsSync(downPath)) {
      const sql = fs.readFileSync(downPath, "utf-8");
      
      console.log(`Rolling back: ${lastMigration}`);
      
      await db.begin(async (tx) => {
        await tx.unsafe(sql);
        await tx`DELETE FROM schema_migrations WHERE name = ${lastMigration}`;
      });

      console.log(`  ✓ ${lastMigration} rolled back`);
      return lastMigration;
    } else {
      console.error(`No rollback file found for ${lastMigration}`);
      console.error(`Expected: ${downFile}`);
      return null;
    }
  }
}

// Export singleton instance
export const migrationRunner = new MigrationRunner();

// CLI helper
export async function runMigrationsCLI(command: string): Promise<void> {
  switch (command) {
    case "init":
      await migrationRunner.runInitialSetup();
      break;

    case "run":
      const count = await migrationRunner.runAll();
      console.log(`Applied ${count} migrations`);
      break;

    case "status":
      const status = await migrationRunner.status();
      console.log("\nMigration Status:");
      console.log("Applied:", status.applied.length > 0 ? status.applied.join(", ") : "none");
      console.log("Pending:", status.pending.length > 0 ? status.pending.join(", ") : "none");
      break;

    case "rollback":
      const rolledBack = await migrationRunner.rollbackLast();
      if (rolledBack) {
        console.log(`Rolled back: ${rolledBack}`);
      }
      break;

    default:
      console.log("Usage: migrate [init|run|status|rollback]");
  }
}
