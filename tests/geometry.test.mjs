import assert from "node:assert/strict";
import test from "node:test";
import {
  angularTravel,
  fitCircle,
  formatScore,
  MINIMUM_ANGULAR_TRAVEL,
  pathLength,
} from "../public/assets/geometry.js";

function arcPoints(degrees, segments = 60) {
  const radians = degrees * Math.PI / 180;
  return Array.from({ length: segments + 1 }, (_, index) => {
    const angle = radians * index / segments;
    return { x: 120 + 50 * Math.cos(angle), y: 80 + 50 * Math.sin(angle) };
  });
}

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

test("requires at least 300 degrees of angular travel around the fitted center", () => {
  const shortArc = arcPoints(30);
  const longArc = arcPoints(300);
  const shortCircle = fitCircle(shortArc);
  const longCircle = fitCircle(longArc);

  assert.ok(shortCircle);
  assert.ok(longCircle);
  assert.ok(angularTravel(shortArc, shortCircle.center) < MINIMUM_ANGULAR_TRAVEL);
  assert.ok(angularTravel(longArc, longCircle.center) >= MINIMUM_ANGULAR_TRAVEL);
});

test("allows angular travel beyond a full turn without requiring closed endpoints", () => {
  const points = arcPoints(540, 108);
  const circle = fitCircle(points);

  assert.ok(circle);
  assert.ok(angularTravel(points, circle.center) > Math.PI * 2);
  assert.ok(Math.hypot(
    points[0].x - points.at(-1).x,
    points[0].y - points.at(-1).y,
  ) > circle.radius);
});

test("keeps the original unbounded integer score formula", () => {
  assert.equal(
    formatScore({ center: { x: 0, y: 0 }, radius: 10, error: 3 }),
    "33",
  );
});
