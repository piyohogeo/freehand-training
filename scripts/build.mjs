import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { build as bundle } from "esbuild";

await rm("public/index.html", { force: true });
await rm("public/styles.css", { force: true });
await rm("public/latency.html", { force: true });
await rm("public/latency.css", { force: true });
await rm("public/experiment.html", { force: true });
await rm("public/experiment.css", { force: true });
await mkdir("public", { recursive: true });
await mkdir("public/third-party", { recursive: true });
await bundle({
  entryPoints: ["src/experiment.ts"],
  bundle: true,
  outfile: "public/assets/experiment.js",
  format: "esm",
  platform: "browser",
  external: ["./main.js"],
  sourcemap: true,
});
const [
  index,
  latency,
  experiment,
  script,
  latencyScript,
  experimentScript,
  styles,
  latencyStyles,
  experimentStyles,
] = await Promise.all([
  readFile("index.html", "utf8"),
  readFile("latency.html", "utf8"),
  readFile("experiment.html", "utf8"),
  readFile("public/assets/main.js"),
  readFile("public/assets/latency.js"),
  readFile("public/assets/experiment.js"),
  readFile("styles.css"),
  readFile("latency.css"),
  readFile("experiment.css"),
]);
const buildHash = createHash("sha256")
  .update(script)
  .update(latencyScript)
  .update(experimentScript)
  .update(styles)
  .update(latencyStyles)
  .update(experimentStyles)
  .digest("hex")
  .slice(0, 12);

await Promise.all([
  writeFile("public/index.html", index.replaceAll("__BUILD_HASH__", buildHash)),
  writeFile("public/latency.html", latency.replaceAll("__BUILD_HASH__", buildHash)),
  writeFile("public/experiment.html", experiment.replaceAll("__BUILD_HASH__", buildHash)),
  copyFile("styles.css", "public/styles.css"),
  copyFile("latency.css", "public/latency.css"),
  copyFile("experiment.css", "public/experiment.css"),
  copyFile("THIRD_PARTY_NOTICES.md", "public/THIRD_PARTY_NOTICES.md"),
  copyFile(
    "node_modules/ink-stroke-modeler-ts/LICENSE",
    "public/third-party/ink-stroke-modeler-ts-LICENSE",
  ),
  copyFile(
    "node_modules/ink-stroke-modeler-ts/NOTICE",
    "public/third-party/ink-stroke-modeler-ts-NOTICE",
  ),
]);
