import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL || "postgres://postgres:postgres@localhost:5432/broker_agent",
  },
  verbose: true,
  strict: true,
});
