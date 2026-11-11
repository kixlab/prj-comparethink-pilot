import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { pilotPlugin } from "./server/pilotPlugin";
import { sttPlugin } from "./server/sttPlugin";
import { syncPlugin } from "./server/syncPlugin";
const version = JSON.parse(
  readFileSync(new URL("./package.json", import.meta.url), "utf8"),
).version;
let commit = "unknown";
try {
  commit = execFileSync("git", ["rev-parse", "--short=12", "HEAD"], {
    encoding: "utf8",
  }).trim();
  if (
    execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim()
  )
    commit += "-dirty";
} catch {
  /* source archive */
}
export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, process.cwd(), ""), ...process.env };
  const allowedHosts = ["internal.kixlab.org"];
  if (env.PILOT_PUBLIC_ORIGIN)
    allowedHosts.push(new URL(env.PILOT_PUBLIC_ORIGIN).hostname);
  return {
    plugins: [
      react(),
      pilotPlugin(env, version, commit),
      sttPlugin(env, process.cwd()),
      syncPlugin(env, process.cwd()),
    ],
    server: { host: "127.0.0.1", allowedHosts },
    // Deployment: PILOT_HOST/PILOT_PORT pick the address the reverse proxy forwards to.
    preview: {
      host: env.PILOT_HOST || "127.0.0.1",
      port: Number(env.PILOT_PORT) || 4173,
      strictPort: true,
      allowedHosts,
    },
  };
});
