import { copyFile, mkdir, rm } from "node:fs/promises";

await rm("public/index.html", { force: true });
await rm("public/styles.css", { force: true });
await mkdir("public", { recursive: true });
await Promise.all([
  copyFile("index.html", "public/index.html"),
  copyFile("styles.css", "public/styles.css"),
]);
