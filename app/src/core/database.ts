import postgres from "postgres";

// Database connection
const connectionString =
  process.env.DATABASE_URL || "postgres://postgres:postgres@localhost:5432/broker_agent";

// Create postgres client
export const sql = postgres(connectionString, {
  max: 10,
  idle_timeout: 20,
  connect_timeout: 10,
});

// Test connection
export async function testConnection(): Promise<boolean> {
  try {
    await sql`SELECT 1`;
    return true;
  } catch (error) {
    console.error("Database connection failed:", error);
    return false;
  }
}

// Initialize database schema
export async function initializeDatabase(): Promise<void> {
  console.log("Initializing database...");

  try {
    // Check if extensions exist
    await sql`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`;
    await sql`CREATE EXTENSION IF NOT EXISTS "vector"`;

    console.log("Database extensions enabled");
  } catch (error) {
    console.error("Failed to initialize database:", error);
    throw error;
  }
}

// Graceful shutdown
export async function closeDatabase(): Promise<void> {
  await sql.end();
}
