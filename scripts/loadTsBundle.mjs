import { build } from "esbuild";

/** Bundle a TypeScript entry and its runtime imports for Node-based tests. */
export async function loadTsBundle(entryPath, platform = "neutral") {
  const result = await build({
    entryPoints: [entryPath],
    bundle: true,
    format: "esm",
    platform,
    external: platform === "node" ? ["node:zlib"] : [],
    target: "es2022",
    write: false,
    logLevel: "silent",
  });
  const code = result.outputFiles[0].text;
  return import(
    `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`
  );
}
