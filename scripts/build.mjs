import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";

await rm("public/index.html", { force: true });
await rm("public/styles.css", { force: true });
await rm("public/latency.html", { force: true });
await rm("public/latency.css", { force: true });
await rm("public/experiment.html", { force: true });
await rm("public/experiment.css", { force: true });
await mkdir("public", { recursive: true });
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
]);
