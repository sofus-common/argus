import { cloudflare } from "@cloudflare/vite-plugin";
import { cloudflareTest } from "@cloudflare/vitest-plugin";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { parseEnv } from "node:util";

export default defineConfig(({ mode, command, isPreview }) => {
  const localDev = command === "serve" && !isPreview && mode !== "test";
  if (localDev) {
    // Worktrees do not contain the main checkout's ignored .env.
    const localEnv = resolve("../.env");
    const commonGitDir = existsSync(localEnv) ? null : execFileSync("git", ["rev-parse", "--git-common-dir"], { encoding: "utf8" }).trim();
    const file = commonGitDir ? resolve(dirname(resolve(commonGitDir)), ".env") : localEnv;
    if (existsSync(file)) {
      const env = parseEnv(readFileSync(file, "utf8"));
      for (const name of ["OPENROUTER_API_KEY", "ALPACA_API_KEY", "ALPACA_SECRET_KEY", "FRED_API_KEY", "EXA_AI_KEY", "TASTYTRADE_CLIENT_ID", "TASTYTRADE_CLIENT_SECRET", "TASTYTRADE_REFRESH_TOKEN", "THETADATA_TERMINAL_URL"]) {
        if (!process.env[name] && env[name]) process.env[name] = env[name];
      }
      if (process.env.THETADATA_TERMINAL_URL?.replace(/\/$/, "") === "http://theta-terminal:25503") process.env.THETADATA_TERMINAL_URL = "http://127.0.0.1:25503";
    }
  }
  return {
    // Candidate text runs through the same offline contracts before local activation.
    resolve: mode === "test" && process.env.ARGUS_PROMPT_CANDIDATE ? { alias: [{ find: /.*prompts\/analysis-v1\.json$/, replacement: resolve(process.env.ARGUS_PROMPT_CANDIDATE) }] } : undefined,
    plugins:
    mode === "test"
      ? [cloudflareTest({ wrangler: { configPath: "wrangler.jsonc" }, remoteBindings: false, miniflare: { d1Databases: ["DB"], bindings: { ARGUS_PROMPT_EXPECTED_DIGEST: process.env.ARGUS_PROMPT_EXPECTED_DIGEST ?? "" } } })]
      : [react(), cloudflare(localDev ? {
        remoteBindings: false,
        config: config => ({
          vars: { ...config.vars, ARGUS_LOCAL_DEV: "true" },
          d1_databases: JSON.parse(readFileSync(resolve("wrangler.local.json"), "utf8")).d1_databases,
        }),
      } : {})],
  };
});
