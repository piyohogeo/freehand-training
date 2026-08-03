import assert from "node:assert/strict";
import test from "node:test";
import { fitCircle, formatScore, pathLength } from "../public/assets/geometry.js";

test("fits an exact circle and displays infinity", () => {
  const points = Array.from({ length: 32 }, (_, index) => {
    const angle = (index / 32) * Math.PI * 2;
    return { x: 120 + 50 * Math.cos(angle), y: 80 + 50 * Math.sin(angle) };
  });
  const circle = fitCircle(points);
  assert.ok(circle);
  assert.ok(Math.abs(circle.center.x - 120) < 1e-8);
  assert.ok(Math.abs(circle.center.y - 80) < 1e-8);
  assert.ok(Math.abs(circle.radius - 50) < 1e-8);
  assert.equal(formatScore(circle), "∞");
});

test("rejects collinear and insufficient points", () => {
  assert.equal(fitCircle([{ x: 0, y: 0 }, { x: 1, y: 1 }]), null);
  assert.equal(
    fitCircle([{ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 20, y: 20 }]),
    null,
  );
});

test("calculates the complete drawn path length", () => {
  assert.equal(pathLength([{ x: 0, y: 0 }, { x: 3, y: 4 }, { x: 6, y: 8 }]), 10);
});

test("keeps the original unbounded integer score formula", () => {
  assert.equal(
    formatScore({ center: { x: 0, y: 0 }, radius: 10, error: 3 }),
    "33",
  );
});
