import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("keeps expensive work out of the pointer movement hot path", async () => {
  const source = await readFile(new URL("../src/main.ts", import.meta.url), "utf8");
  const listenerStart = source.indexOf('inputCanvas.addEventListener("pointermove"');
  const listenerEnd = source.indexOf("\n});", listenerStart);

  assert.ok(listenerStart >= 0, "pointermove listener is missing");
  assert.ok(listenerEnd > listenerStart, "pointermove listener could not be inspected");
  const hotPath = source.slice(listenerStart, listenerEnd);

  const forbiddenOperations = [
    "clearRect",
    "drawImage",
    "getPredictedEvents",
    "requestAnimationFrame",
  ];
  for (const operation of forbiddenOperations) {
    assert.equal(
      hotPath.includes(operation),
      false,
      `${operation} must not run for every pointer movement`,
    );
  }
  assert.equal(
    source.includes("pointerrawupdate"),
    false,
    "Unthrottled pointerrawupdate can overwhelm the rendering pipeline",
  );
});
