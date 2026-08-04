import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";

await rm("public/index.html", { force: true });
await rm("public/styles.css", { force: true });
await mkdir("public", { recursive: true });
const [index, script, styles] = await Promise.all([
  readFile("index.html", "utf8"),
  readFile("public/assets/main.js"),
  readFile("styles.css"),
]);
const buildHash = createHash("sha256")
  .update(script)
  .update(styles)
  .digest("hex")
  .slice(0, 12);

await Promise.all([
  writeFile("public/index.html", index.replaceAll("__BUILD_HASH__", buildHash)),
  copyFile("styles.css", "public/styles.css"),
]);
