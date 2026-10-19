import { build } from "esbuild";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Bundle the action into a single dist/index.js so `runs.using: node24` can execute
// it with no install step. The action is self-contained (src/ + src/agent/); its
// npm dependencies (the LLM SDKs) resolve from the repo's node_modules.
const dir = path.dirname(fileURLToPath(import.meta.url));

await build({
  entryPoints: [path.join(dir, "src/main.ts")],
  bundle: true,
  platform: "node",
  target: "node24",
  format: "cjs",
  outfile: path.join(dir, "dist/index.js"),
  legalComments: "none",
  logLevel: "info",
});

console.log("Built action/dist/index.js");
