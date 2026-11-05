import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { pilotPlugin } from "./server/pilotPlugin";
import { sttPlugin } from "./server/sttPlugin";
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
    ],
    server: { host: "127.0.0.1", allowedHosts },
    preview: { host: "127.0.0.1", allowedHosts },
  };
});
