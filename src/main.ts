import { fitCircle, formatScore, pathLength, type CircleFit, type Point } from "./geometry.js";

const FADE_DURATION_MS = 10_000;
const MINIMUM_POINT_COUNT = 3;
const MINIMUM_PATH_LENGTH = 20;

interface FinishedStroke {
  readonly points: readonly Point[];
  readonly circle: CircleFit | null;
  readonly score: string | null;
  readonly finishedAt: number;
}

const canvasElement = document.querySelector<HTMLCanvasElement>("#canvas");
if (canvasElement === null) throw new Error("Canvas element was not found.");
const canvas: HTMLCanvasElement = canvasElement;

const canvasContext = canvas.getContext("2d");
if (canvasContext === null) throw new Error("2D canvas is not supported.");
const context: CanvasRenderingContext2D = canvasContext;

let activePointerId: number | null = null;
let activePoints: Point[] | null = null;
let finishedStrokes: FinishedStroke[] = [];
let animationFrame: number | null = null;

function resizeCanvas(): void {
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.round(window.innerWidth * ratio));
  canvas.height = Math.max(1, Math.round(window.innerHeight * ratio));
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  activePointerId = null;
  activePoints = null;
  finishedStrokes = [];
  render(performance.now());
}

function pointerPosition(event: PointerEvent): Point {
  const bounds = canvas.getBoundingClientRect();
  return { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
}

function drawPath(points: readonly Point[], opacity: number): void {
  if (points.length === 0) return;
  context.save();
  context.globalAlpha = opacity;
  context.strokeStyle = "black";
  context.lineWidth = 1;
  context.beginPath();
  context.moveTo(points[0]!.x, points[0]!.y);
  for (let index = 1; index < points.length; index += 1) {
    context.lineTo(points[index]!.x, points[index]!.y);
  }
  context.stroke();
  context.restore();
}

function drawResult(stroke: FinishedStroke, opacity: number): void {
  if (stroke.circle === null || stroke.score === null) return;
  const { center, radius } = stroke.circle;
  context.save();
  context.globalAlpha = opacity;
  context.strokeStyle = "red";
  context.lineWidth = 1;
  context.beginPath();
  context.arc(center.x, center.y, radius, 0, Math.PI * 2);
  context.stroke();
  context.fillStyle = "black";
  context.font = "40px sans-serif";
  context.textBaseline = "top";
  context.fillText(stroke.score, center.x - 30, center.y - 20);
  context.restore();
}

function render(now: number): void {
  animationFrame = null;
  context.clearRect(0, 0, window.innerWidth, window.innerHeight);
  finishedStrokes = finishedStrokes.filter(
    (stroke) => now - stroke.finishedAt < FADE_DURATION_MS,
  );

  for (const stroke of finishedStrokes) {
    const opacity = Math.max(0, 1 - (now - stroke.finishedAt) / FADE_DURATION_MS);
    drawPath(stroke.points, opacity);
    drawResult(stroke, opacity);
  }
  if (activePoints !== null) drawPath(activePoints, 1);

  if (finishedStrokes.length > 0 && animationFrame === null) {
    animationFrame = requestAnimationFrame(render);
  }
}

function requestRender(): void {
  if (animationFrame === null) animationFrame = requestAnimationFrame(render);
}

function finishStroke(): void {
  if (activePoints === null) return;
  const points = activePoints;
  activePointerId = null;
  activePoints = null;

  let circle: CircleFit | null = null;
  let score: string | null = null;
  if (points.length >= MINIMUM_POINT_COUNT && pathLength(points) >= MINIMUM_PATH_LENGTH) {
    circle = fitCircle(points);
    if (circle !== null) score = formatScore(circle);
  }

  finishedStrokes.push({ points, circle, score, finishedAt: performance.now() });
  requestRender();
}

canvas.addEventListener("pointerdown", (event) => {
  if (activePointerId !== null || !event.isPrimary || event.button !== 0) return;
  event.preventDefault();
  activePointerId = event.pointerId;
  activePoints = [pointerPosition(event)];
  requestRender();
});

canvas.addEventListener("pointermove", (event) => {
  if (event.pointerId !== activePointerId || activePoints === null) return;
  event.preventDefault();
  const events = event.getCoalescedEvents?.() ?? [event];
  for (const sample of events) activePoints.push(pointerPosition(sample));
  requestRender();
});

canvas.addEventListener("pointerup", (event) => {
  if (event.pointerId !== activePointerId) return;
  event.preventDefault();
  if (activePoints !== null) activePoints.push(pointerPosition(event));
  finishStroke();
});

canvas.addEventListener("pointerleave", (event) => {
  if (event.pointerId === activePointerId) finishStroke();
});

canvas.addEventListener("pointercancel", (event) => {
  if (event.pointerId === activePointerId) finishStroke();
});

canvas.addEventListener("contextmenu", (event) => event.preventDefault());
window.addEventListener("resize", resizeCanvas);
resizeCanvas();
