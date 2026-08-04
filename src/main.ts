import { fitCircle, formatScore, type CircleFit, type Point } from "./geometry.js";

const FADE_DURATION_MS = 10_000;
const MINIMUM_POINT_COUNT = 3;
const MINIMUM_PATH_LENGTH = 20;
const CACHE_PADDING = 2;

interface CachedStroke {
  readonly image: HTMLCanvasElement;
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
  readonly finishedAt: number;
}

interface DelegatedInkTrailPresenter {
  updateInkTrailStartPoint(
    event: PointerEvent,
    style: { readonly color: string; readonly diameter: number },
  ): void;
}

interface InkNavigator extends Navigator {
  readonly ink?: {
    requestPresenter(options: {
      readonly presentationArea: Element;
    }): Promise<DelegatedInkTrailPresenter>;
  };
}

interface InputDiagnostics {
  inputEvent: "pointermove" | "pointerrawupdate";
  pointerType: string;
  eventCount: number;
  averageEventAgeMs: number;
  maximumEventAgeMs: number;
  averageFrameDelayMs: number;
  maximumFrameDelayMs: number;
  inkStatus: "unsupported" | "initializing" | "ready" | "failed" | "runtime-error";
  inkCallCount: number;
  canvasDrawCount: number;
}

function requireCanvas(selector: string): HTMLCanvasElement {
  const element = document.querySelector<HTMLCanvasElement>(selector);
  if (element === null) throw new Error(`Canvas element ${selector} was not found.`);
  return element;
}

function requireContext(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const canvasContext = canvas.getContext("2d");
  if (canvasContext === null) throw new Error("2D canvas is not supported.");
  return canvasContext;
}

const resultCanvas = requireCanvas("#result-canvas");
const inputCanvas = requireCanvas("#input-canvas");
const resultContext = requireContext(resultCanvas);
const inputContext = requireContext(inputCanvas);
const searchParameters = new URLSearchParams(location.search);
const rawInputEnabled = searchParameters.get("raw") === "1" && "onpointerrawupdate" in window;
const diagnostics: InputDiagnostics = {
  inputEvent: rawInputEnabled ? "pointerrawupdate" : "pointermove",
  pointerType: "none",
  eventCount: 0,
  averageEventAgeMs: 0,
  maximumEventAgeMs: 0,
  averageFrameDelayMs: 0,
  maximumFrameDelayMs: 0,
  inkStatus: "unsupported",
  inkCallCount: 0,
  canvasDrawCount: 0,
};
(window as unknown as { __freehandDiagnostics: InputDiagnostics }).__freehandDiagnostics = diagnostics;

const debugEnabled = searchParameters.get("debug") === "1";
const debugElement = debugEnabled ? document.createElement("pre") : null;
if (debugElement !== null) {
  debugElement.id = "input-diagnostics";
  document.body.append(debugElement);
}

let eventAgeTotal = 0;
let frameDelayTotal = 0;
let frameSampleCount = 0;
let pendingDiagnosticFrame: number | null = null;
let latestInputHandledAt = 0;

function renderDiagnostics(): void {
  if (debugElement === null) return;
  debugElement.textContent = [
    `input: ${diagnostics.inputEvent}`,
    `pointer: ${diagnostics.pointerType}`,
    `events: ${diagnostics.eventCount}`,
    `canvas draws: ${diagnostics.canvasDrawCount}`,
    `event age: ${diagnostics.averageEventAgeMs.toFixed(2)} ms avg / ${diagnostics.maximumEventAgeMs.toFixed(2)} ms max`,
    `next frame: ${diagnostics.averageFrameDelayMs.toFixed(2)} ms avg / ${diagnostics.maximumFrameDelayMs.toFixed(2)} ms max`,
    `ink: ${diagnostics.inkStatus} (${diagnostics.inkCallCount} calls)`,
  ].join("\n");
}

function recordInputTiming(event: PointerEvent): void {
  const handledAt = performance.now();
  latestInputHandledAt = handledAt;
  diagnostics.pointerType = event.pointerType || "unknown";
  diagnostics.eventCount += 1;
  const eventAge = handledAt - event.timeStamp;
  if (eventAge >= 0 && eventAge < 10_000) {
    eventAgeTotal += eventAge;
    diagnostics.averageEventAgeMs = eventAgeTotal / diagnostics.eventCount;
    diagnostics.maximumEventAgeMs = Math.max(diagnostics.maximumEventAgeMs, eventAge);
  }

  if (!debugEnabled || pendingDiagnosticFrame !== null) return;
  pendingDiagnosticFrame = requestAnimationFrame((frameTime) => {
    pendingDiagnosticFrame = null;
    // Use the freshest input received before this frame, not the first queued event.
    const delay = Math.max(0, frameTime - latestInputHandledAt);
    frameDelayTotal += delay;
    frameSampleCount += 1;
    diagnostics.averageFrameDelayMs = frameDelayTotal / frameSampleCount;
    diagnostics.maximumFrameDelayMs = Math.max(diagnostics.maximumFrameDelayMs, delay);
    renderDiagnostics();
  });
}

let inkPresenter: DelegatedInkTrailPresenter | null = null;
const ink = (navigator as InkNavigator).ink;
if (ink !== undefined) {
  diagnostics.inkStatus = "initializing";
  void ink.requestPresenter({ presentationArea: inputCanvas }).then(
    (presenter) => {
      inkPresenter = presenter;
      diagnostics.inkStatus = "ready";
      renderDiagnostics();
    },
    () => {
      inkPresenter = null;
      diagnostics.inkStatus = "failed";
      renderDiagnostics();
    },
  );
}
renderDiagnostics();

let pixelRatio = 1;
let activePointerId: number | null = null;
let activePoints: Point[] | null = null;
let activePathLength = 0;
let finishedStrokes: CachedStroke[] = [];
let animationFrame: number | null = null;
let queuedInputFrame: number | null = null;
let queuedSamples: PointerEvent[] = [];

function configureLine(context: CanvasRenderingContext2D): void {
  context.strokeStyle = "black";
  context.lineWidth = 1;
  context.lineJoin = "round";
  context.lineCap = "round";
}

function resizeCanvas(): void {
  pixelRatio = window.devicePixelRatio || 1;
  const width = Math.max(1, Math.round(window.innerWidth * pixelRatio));
  const height = Math.max(1, Math.round(window.innerHeight * pixelRatio));
  for (const canvas of [resultCanvas, inputCanvas]) {
    canvas.width = width;
    canvas.height = height;
  }
  resultContext.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  inputContext.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  configureLine(inputContext);
  activePointerId = null;
  activePoints = null;
  activePathLength = 0;
  finishedStrokes = [];
  if (animationFrame !== null) cancelAnimationFrame(animationFrame);
  animationFrame = null;
  if (queuedInputFrame !== null) cancelAnimationFrame(queuedInputFrame);
  queuedInputFrame = null;
  queuedSamples = [];
}

function pointerPosition(event: PointerEvent): Point {
  // Both canvases are fixed to the viewport, so no layout read is needed here.
  return { x: event.clientX, y: event.clientY };
}

function appendSamples(events: readonly PointerEvent[]): void {
  if (activePoints === null || events.length === 0) return;
  let previous = activePoints[activePoints.length - 1]!;

  inputContext.beginPath();
  inputContext.moveTo(previous.x, previous.y);
  for (const event of events) {
    const current = pointerPosition(event);
    if (current.x === previous.x && current.y === previous.y) continue;
    inputContext.lineTo(current.x, current.y);
    activePathLength += Math.hypot(current.x - previous.x, current.y - previous.y);
    activePoints.push(current);
    previous = current;
  }
  inputContext.stroke();
  diagnostics.canvasDrawCount += 1;
}

function flushQueuedSamples(): void {
  if (queuedInputFrame !== null) cancelAnimationFrame(queuedInputFrame);
  queuedInputFrame = null;
  if (queuedSamples.length === 0) return;
  const samples = queuedSamples;
  queuedSamples = [];
  appendSamples(samples);
}

function queueSamplesForNextFrame(samples: readonly PointerEvent[]): void {
  queuedSamples.push(...samples);
  if (queuedInputFrame !== null) return;
  queuedInputFrame = requestAnimationFrame(() => {
    queuedInputFrame = null;
    if (queuedSamples.length === 0) return;
    const samplesToDraw = queuedSamples;
    queuedSamples = [];
    appendSamples(samplesToDraw);
  });
}

function drawPath(context: CanvasRenderingContext2D, points: readonly Point[]): void {
  if (points.length === 0) return;
  configureLine(context);
  context.beginPath();
  context.moveTo(points[0]!.x, points[0]!.y);
  for (let index = 1; index < points.length; index += 1) {
    context.lineTo(points[index]!.x, points[index]!.y);
  }
  context.stroke();
}

function drawResult(
  context: CanvasRenderingContext2D,
  circle: CircleFit | null,
  score: string | null,
): void {
  if (circle === null || score === null) return;
  const { center, radius } = circle;
  context.strokeStyle = "red";
  context.lineWidth = 1;
  context.beginPath();
  context.arc(center.x, center.y, radius, 0, Math.PI * 2);
  context.stroke();
  context.fillStyle = "black";
  context.font = "40px sans-serif";
  context.textBaseline = "top";
  context.fillText(score, center.x - 30, center.y - 20);
}

function cacheStroke(
  points: readonly Point[],
  circle: CircleFit | null,
  score: string | null,
): CachedStroke {
  let left = points[0]!.x;
  let top = points[0]!.y;
  let right = points[0]!.x;
  let bottom = points[0]!.y;
  for (let index = 1; index < points.length; index += 1) {
    const point = points[index]!;
    left = Math.min(left, point.x);
    top = Math.min(top, point.y);
    right = Math.max(right, point.x);
    bottom = Math.max(bottom, point.y);
  }

  if (circle !== null && score !== null) {
    left = Math.min(left, circle.center.x - circle.radius, circle.center.x - 30);
    top = Math.min(top, circle.center.y - circle.radius, circle.center.y - 20);
    right = Math.max(right, circle.center.x + circle.radius, circle.center.x - 30 + score.length * 40);
    bottom = Math.max(bottom, circle.center.y + circle.radius, circle.center.y + 28);
  }

  left = Math.max(0, Math.floor(left - CACHE_PADDING));
  top = Math.max(0, Math.floor(top - CACHE_PADDING));
  right = Math.min(window.innerWidth, Math.ceil(right + CACHE_PADDING));
  bottom = Math.min(window.innerHeight, Math.ceil(bottom + CACHE_PADDING));
  const width = Math.max(1, right - left);
  const height = Math.max(1, bottom - top);
  const image = document.createElement("canvas");
  image.width = Math.max(1, Math.ceil(width * pixelRatio));
  image.height = Math.max(1, Math.ceil(height * pixelRatio));
  const context = requireContext(image);
  context.setTransform(pixelRatio, 0, 0, pixelRatio, -left * pixelRatio, -top * pixelRatio);
  drawPath(context, points);
  drawResult(context, circle, score);

  return { image, left, top, width, height, finishedAt: performance.now() };
}

function renderResults(now: number): void {
  animationFrame = null;
  resultContext.clearRect(0, 0, window.innerWidth, window.innerHeight);
  finishedStrokes = finishedStrokes.filter(
    (stroke) => now - stroke.finishedAt < FADE_DURATION_MS,
  );

  for (const stroke of finishedStrokes) {
    resultContext.globalAlpha = Math.max(0, 1 - (now - stroke.finishedAt) / FADE_DURATION_MS);
    resultContext.drawImage(
      stroke.image,
      stroke.left,
      stroke.top,
      stroke.width,
      stroke.height,
    );
  }
  resultContext.globalAlpha = 1;

  if (finishedStrokes.length > 0) animationFrame = requestAnimationFrame(renderResults);
}

function requestResultRender(): void {
  if (animationFrame === null) animationFrame = requestAnimationFrame(renderResults);
}

function finishStroke(): void {
  if (activePoints === null) return;
  flushQueuedSamples();
  const points = activePoints;
  activePointerId = null;
  activePoints = null;

  let circle: CircleFit | null = null;
  let score: string | null = null;
  if (points.length >= MINIMUM_POINT_COUNT && activePathLength >= MINIMUM_PATH_LENGTH) {
    circle = fitCircle(points);
    if (circle !== null) score = formatScore(circle);
  }

  finishedStrokes.push(cacheStroke(points, circle, score));
  inputContext.clearRect(0, 0, window.innerWidth, window.innerHeight);
  activePathLength = 0;
  requestResultRender();
}

inputCanvas.addEventListener("pointerdown", (event) => {
  if (activePointerId !== null || !event.isPrimary || event.button !== 0) return;
  event.preventDefault();
  activePointerId = event.pointerId;
  activePoints = [pointerPosition(event)];
  activePathLength = 0;
  inputContext.clearRect(0, 0, window.innerWidth, window.innerHeight);
});

function updateDelegatedInk(event: PointerEvent): void {
  if (event.pointerType !== "pen" || !event.isTrusted || inkPresenter === null) return;
  try {
    inkPresenter.updateInkTrailStartPoint(event, { color: "black", diameter: 1 });
    diagnostics.inkCallCount += 1;
  } catch {
    // The experimental API can disappear or reject a device at runtime.
    inkPresenter = null;
    diagnostics.inkStatus = "runtime-error";
  }
}

function handlePointerInput(event: PointerEvent): void {
  if (event.pointerId !== activePointerId || activePoints === null) return;
  if (event.cancelable) event.preventDefault();
  recordInputTiming(event);
  appendSamples(event.getCoalescedEvents?.() ?? [event]);
  updateDelegatedInk(event);
}

function handleRawPointerInput(event: PointerEvent): void {
  if (event.pointerId !== activePointerId || activePoints === null) return;
  recordInputTiming(event);
  queueSamplesForNextFrame(event.getCoalescedEvents?.() ?? [event]);
  updateDelegatedInk(event);
}

if (rawInputEnabled) {
  inputCanvas.addEventListener("pointerrawupdate", (event) => {
    handleRawPointerInput(event as PointerEvent);
  });
} else {
  inputCanvas.addEventListener("pointermove", handlePointerInput);
}

inputCanvas.addEventListener("pointerup", (event) => {
  if (event.pointerId !== activePointerId) return;
  event.preventDefault();
  flushQueuedSamples();
  appendSamples([event]);
  finishStroke();
});

inputCanvas.addEventListener("pointerleave", (event) => {
  if (event.pointerId === activePointerId) finishStroke();
});

inputCanvas.addEventListener("pointercancel", (event) => {
  if (event.pointerId === activePointerId) finishStroke();
});

inputCanvas.addEventListener("contextmenu", (event) => event.preventDefault());
window.addEventListener("resize", resizeCanvas);
resizeCanvas();
