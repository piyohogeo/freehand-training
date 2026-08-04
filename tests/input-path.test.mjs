import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("keeps raw input bounded to one queued canvas draw per frame", async () => {
  const source = await readFile(new URL("../src/main.ts", import.meta.url), "utf8");
  const rawHandlerStart = source.indexOf("function handleRawPointerInput");
  const rawHandlerEnd = source.indexOf("\n}", rawHandlerStart);
  const queueStart = source.indexOf("function queueSamplesForNextFrame");
  const queueEnd = source.indexOf("\n}\n", queueStart);

  assert.ok(rawHandlerStart >= 0, "pointerrawupdate handler is missing");
  assert.ok(rawHandlerEnd > rawHandlerStart, "raw handler could not be inspected");
  assert.ok(queueStart >= 0, "frame queue is missing");
  assert.ok(queueEnd > queueStart, "frame queue could not be inspected");
  const rawHandler = source.slice(rawHandlerStart, rawHandlerEnd);
  const frameQueue = source.slice(queueStart, queueEnd);

  const forbiddenOperations = ["appendSamples", "clearRect", "drawImage", "stroke"];
  for (const operation of forbiddenOperations) {
    assert.equal(
      rawHandler.includes(operation),
      false,
      `${operation} must not run for every raw input event`,
    );
  }
  assert.ok(rawHandler.includes("queueSamplesForNextFrame"));
  assert.ok(frameQueue.includes("requestAnimationFrame"));
  assert.ok(frameQueue.includes("queuedInputFrame !== null"));
  assert.ok(frameQueue.includes("appendSamples"));
  assert.equal(source.includes("getPredictedEvents"), false);
});

test("uses standard canvas rendering and versioned production assets", async () => {
  const [source, builtIndex, builtLatency, builtExperiment] = await Promise.all([
    readFile(new URL("../src/main.ts", import.meta.url), "utf8"),
    readFile(new URL("../public/index.html", import.meta.url), "utf8"),
    readFile(new URL("../public/latency.html", import.meta.url), "utf8"),
    readFile(new URL("../public/experiment.html", import.meta.url), "utf8"),
  ]);

  assert.equal(source.includes("desynchronized"), false);
  assert.equal(builtIndex.includes("__BUILD_HASH__"), false);
  assert.match(builtIndex, /styles\.css\?v=[a-f0-9]{12}/);
  assert.match(builtIndex, /main\.js\?v=[a-f0-9]{12}/);
  assert.equal(builtLatency.includes("__BUILD_HASH__"), false);
  assert.match(builtLatency, /latency\.css\?v=[a-f0-9]{12}/);
  assert.match(builtLatency, /latency\.js\?v=[a-f0-9]{12}/);
  assert.equal(builtExperiment.includes("__BUILD_HASH__"), false);
  assert.match(builtExperiment, /experiment\.css\?v=[a-f0-9]{12}/);
  assert.match(builtExperiment, /experiment\.js\?v=[a-f0-9]{12}/);
});
