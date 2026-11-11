import { build } from "esbuild";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";

// Packages that must load from node_modules instead of being inlined (they use require()).
const nodeExternals = ["node:zlib", "mongodb"];

/** Bundle a TypeScript entry and its runtime imports for Node-based tests. */
export async function loadTsBundle(entryPath, platform = "neutral") {
  const result = await build({
    entryPoints: [entryPath],
    bundle: true,
    format: "esm",
    platform,
    external: platform === "node" ? nodeExternals : [],
    target: "es2022",
    write: false,
    logLevel: "silent",
  });
  const code = result.outputFiles[0].text;
  if (platform !== "node")
    return import(
      `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`
    );
  // A file inside the project lets bare imports such as "mongodb" resolve from node_modules.
  const dir = new URL("../node_modules/.cache/ts-bundles/", import.meta.url);
  mkdirSync(dir, { recursive: true });
  const file = new URL(
    `${createHash("sha256").update(code).digest("hex").slice(0, 16)}.mjs`,
    dir,
  );
  writeFileSync(file, code);
  return import(file.href);
}
