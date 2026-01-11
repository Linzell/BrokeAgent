#!/usr/bin/env bun

import { runMigrationsCLI } from "./migrate";
import { closeDatabase } from "../core/database";

const command = process.argv[2] || "status";

runMigrationsCLI(command)
  .then(() => {
    console.log("\nDone");
    process.exit(0);
  })
  .catch((error) => {
    if (error.code === "3D000") {
      console.error("\nDatabase 'broker_agent' does not exist.");
      console.error("Please create it first:");
      console.error("  docker-compose up -d postgres");
      console.error("  docker exec -it broker-agent-postgres psql -U postgres -c 'CREATE DATABASE broker_agent;'");
    } else if (error.code === "ECONNREFUSED") {
      console.error("\nCannot connect to PostgreSQL.");
      console.error("Make sure PostgreSQL is running:");
      console.error("  docker-compose up -d postgres");
    } else {
      console.error("Migration failed:", error.message || error);
    }
    process.exit(1);
  })
  .finally(() => {
    closeDatabase();
  });
