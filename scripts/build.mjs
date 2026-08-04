import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";

await rm("public/index.html", { force: true });
await rm("public/styles.css", { force: true });
await rm("public/latency.html", { force: true });
await rm("public/latency.css", { force: true });
await mkdir("public", { recursive: true });
const [index, latency, script, latencyScript, styles, latencyStyles] = await Promise.all([
  readFile("index.html", "utf8"),
  readFile("latency.html", "utf8"),
  readFile("public/assets/main.js"),
  readFile("public/assets/latency.js"),
  readFile("styles.css"),
  readFile("latency.css"),
]);
const buildHash = createHash("sha256")
  .update(script)
  .update(latencyScript)
  .update(styles)
  .update(latencyStyles)
  .digest("hex")
  .slice(0, 12);

await Promise.all([
  writeFile("public/index.html", index.replaceAll("__BUILD_HASH__", buildHash)),
  writeFile("public/latency.html", latency.replaceAll("__BUILD_HASH__", buildHash)),
  copyFile("styles.css", "public/styles.css"),
  copyFile("latency.css", "public/latency.css"),
]);
