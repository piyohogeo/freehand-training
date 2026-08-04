import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import test from "node:test";
import { fitCircle, pathLength } from "../public/assets/geometry.js";

const POINT_COUNT = 50_000;
const ITERATIONS = 5;
const AVERAGE_LIMIT_MS = 100;

test("processes a high-frequency tablet stroke within the performance budget", (context) => {
  const points = Array.from({ length: POINT_COUNT }, (_, index) => {
    const angle = (index / POINT_COUNT) * Math.PI * 2;
    const wobble = Math.sin(index * 0.17) * 0.8;
    const radius = 400 + wobble;
    return { x: 960 + radius * Math.cos(angle), y: 540 + radius * Math.sin(angle) };
  });

  // Warm up the JIT before measuring.
  assert.ok(fitCircle(points));
  pathLength(points);

  const startedAt = performance.now();
  for (let iteration = 0; iteration < ITERATIONS; iteration += 1) {
    assert.ok(fitCircle(points));
    assert.ok(pathLength(points) > 0);
  }
  const averageMs = (performance.now() - startedAt) / ITERATIONS;

  context.diagnostic(
    `${POINT_COUNT.toLocaleString()} points: ${averageMs.toFixed(2)} ms average ` +
      `(budget: ${AVERAGE_LIMIT_MS} ms)`,
  );
  assert.ok(
    averageMs <= AVERAGE_LIMIT_MS,
    `Average processing time ${averageMs.toFixed(2)} ms exceeded ${AVERAGE_LIMIT_MS} ms`,
  );
});
