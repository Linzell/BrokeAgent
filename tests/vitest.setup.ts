import { beforeAll, vi } from "vitest";

// Mock environment variables for testing
process.env.NODE_ENV = "test";
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";

// Global mocks
beforeAll(() => {
  // Mock console methods to reduce noise in tests
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  // Keep error logging for debugging
  // vi.spyOn(console, "error").mockImplementation(() => {});
});
