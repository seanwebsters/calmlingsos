import { defineConfig } from "@playwright/test";

/**
 * Browser acceptance flow against a running server.
 * E2E_BASE_URL defaults to http://localhost:3100 (see README: "End-to-end tests").
 * The flow expects a fresh installation (it runs first-time setup).
 */
export default defineConfig({
  testDir: "e2e",
  timeout: 120_000,
  use: { baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3100", screenshot: "only-on-failure", viewport: { width: 1440, height: 900 }, launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined } },
  reporter: [["list"]],
});
