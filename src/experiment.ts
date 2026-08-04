import { ModelerPredictor, type ModelerPredictionPoint } from "./modeler-prediction.js";

type ExperimentMode = "baseline" | "cursor";
type PredictionMode = "off" | "browser" | "modeler" | "modeler-kalman";

interface CursorExperimentState {
  readonly mode: ExperimentMode;
  readonly customCursorEnabled: boolean;
  readonly hardwareCursorVisible: boolean;
  readonly delegatedInkEnabled: boolean;
  readonly cursorRenderStrategy: "immediate-dirty-rect";
  readonly predictionMode: PredictionMode;
  eventCount: number;
  cursorDrawCount: number;
  predictionEventCount: number;
  predictionDrawCount: number;
  predictionPointCount: number;
  averagePredictionHorizonMs: number;
  maximumPredictionHorizonMs: number;
  averagePredictionErrorPx: number;
  maximumPredictionErrorPx: number;
  averageModelerProcessingTimeMs: number;
  maximumModelerProcessingTimeMs: number;
  averageModelerCatchUpDistancePx: number;
  maximumModelerCatchUpDistancePx: number;
  averageModelerFutureDistancePx: number;
  maximumModelerFutureDistancePx: number;
  modelerUpdateErrorCount: number;
  averageEventAgeMs: number;
  maximumEventAgeMs: number;
  averageFrameDelayMs: number;
  maximumFrameDelayMs: number;
}

interface CursorPoint {
  readonly x: number;
  readonly y: number;
}

interface PredictedPoint extends CursorPoint {
  readonly timeStamp: number;
}

interface PredictionTraceEntry {
  readonly mode: PredictionMode;
  readonly actual: PredictedPoint;
  readonly predictions: readonly PredictedPoint[];
  readonly processingTimeMs: number;
}

const parameters = new URLSearchParams(location.search);
const requestedMode = parameters.get("mode");
const mode: ExperimentMode = requestedMode === "baseline" ? "baseline" : "cursor";
const customCursorEnabled = mode === "cursor";
const hardwareCursorVisible = !customCursorEnabled || parameters.get("hardwareCursor") === "1";
const delegatedInkEnabled = parameters.get("delegatedInk") !== "0";
const requestedPrediction = parameters.get("prediction");
const predictionMode: PredictionMode = requestedPrediction === "browser"
  || requestedPrediction === "modeler"
  || requestedPrediction === "modeler-kalman"
  ? requestedPrediction
  : "off";

(window as unknown as {
  __freehandOptions: { delegatedInkEnabled: boolean };
}).__freehandOptions = { delegatedInkEnabled };
await import("./main.js");

function requireCanvas(selector: string): HTMLCanvasElement {
  const canvas = document.querySelector<HTMLCanvasElement>(selector);
  if (canvas === null) throw new Error(`Experiment canvas ${selector} was not found.`);
  return canvas;
}

function requireContext(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const context = canvas.getContext("2d");
  if (context === null) throw new Error("2D canvas is not supported.");
  return context;
}

const inputCanvas = requireCanvas("#input-canvas");
const predictionCanvas = requireCanvas("#prediction-canvas");
const cursorCanvas = requireCanvas("#cursor-canvas");
const predictionContext = requireContext(predictionCanvas);
const cursorContext = requireContext(cursorCanvas);

const state: CursorExperimentState = {
  mode,
  customCursorEnabled,
  hardwareCursorVisible,
  delegatedInkEnabled,
  cursorRenderStrategy: "immediate-dirty-rect",
  predictionMode,
  eventCount: 0,
  cursorDrawCount: 0,
  predictionEventCount: 0,
  predictionDrawCount: 0,
  predictionPointCount: 0,
  averagePredictionHorizonMs: 0,
  maximumPredictionHorizonMs: 0,
  averagePredictionErrorPx: 0,
  maximumPredictionErrorPx: 0,
  averageModelerProcessingTimeMs: 0,
  maximumModelerProcessingTimeMs: 0,
  averageModelerCatchUpDistancePx: 0,
  maximumModelerCatchUpDistancePx: 0,
  averageModelerFutureDistancePx: 0,
  maximumModelerFutureDistancePx: 0,
  modelerUpdateErrorCount: 0,
  averageEventAgeMs: 0,
  maximumEventAgeMs: 0,
  averageFrameDelayMs: 0,
  maximumFrameDelayMs: 0,
};
(window as unknown as { __cursorExperiment: CursorExperimentState }).__cursorExperiment = state;
const predictionTrace: PredictionTraceEntry[] = [];
(window as unknown as { __predictionTrace: PredictionTraceEntry[] }).__predictionTrace = predictionTrace;

document.title = `Freehand Training — ${mode}${hardwareCursorVisible ? " + hardware cursor" : ""}${delegatedInkEnabled ? "" : " + ink off"}${predictionMode === "browser" ? " + browser prediction" : ""}${predictionMode === "modeler" ? " + stroke modeler" : ""}${predictionMode === "modeler-kalman" ? " + stroke modeler kalman" : ""}`;
if (!hardwareCursorVisible) inputCanvas.classList.add("experiment-hide-hardware-cursor");

let pixelRatio = 1;
let renderedPoint: CursorPoint | null = null;
let pendingDiagnosticFrame: number | null = null;
let latestEventHandledAt = 0;
let eventAgeTotal = 0;
let frameDelayTotal = 0;
let frameSampleCount = 0;
let activePredictionPointerId: number | null = null;
let renderedPredictionBounds: DOMRect | null = null;
let previousPredictions: PredictedPoint[] = [];
let predictionHorizonTotal = 0;
let predictionHorizonSampleCount = 0;
let predictionErrorTotal = 0;
let predictionErrorSampleCount = 0;
let modelerProcessingTimeTotal = 0;
let modelerProcessingSampleCount = 0;
let modelerCatchUpDistanceTotal = 0;
let modelerCatchUpSampleCount = 0;
let modelerFutureDistanceTotal = 0;
let modelerFutureSampleCount = 0;
const modelerPredictor = predictionMode === "modeler"
  ? new ModelerPredictor("stroke-end")
  : predictionMode === "modeler-kalman"
    ? new ModelerPredictor("kalman")
    : null;

function resizeCursorCanvas(): void {
  pixelRatio = devicePixelRatio || 1;
  const width = Math.max(1, Math.round(innerWidth * pixelRatio));
  const height = Math.max(1, Math.round(innerHeight * pixelRatio));
  predictionCanvas.width = width;
  predictionCanvas.height = height;
  cursorCanvas.width = width;
  cursorCanvas.height = height;
  predictionContext.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  cursorContext.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  renderedPredictionBounds = null;
  previousPredictions = [];
}

function clearPrediction(): void {
  if (renderedPredictionBounds !== null) {
    const padding = 3;
    predictionContext.clearRect(
      renderedPredictionBounds.x - padding,
      renderedPredictionBounds.y - padding,
      renderedPredictionBounds.width + padding * 2,
      renderedPredictionBounds.height + padding * 2,
    );
  }
  renderedPredictionBounds = null;
}

function recordPredictionError(event: PointerEvent): void {
  if (previousPredictions.length === 0) return;
  let nearest = previousPredictions[0]!;
  let nearestTimeDifference = Math.abs(nearest.timeStamp - event.timeStamp);
  for (let index = 1; index < previousPredictions.length; index += 1) {
    const candidate = previousPredictions[index]!;
    const difference = Math.abs(candidate.timeStamp - event.timeStamp);
    if (difference < nearestTimeDifference) {
      nearest = candidate;
      nearestTimeDifference = difference;
    }
  }
  const error = Math.hypot(event.clientX - nearest.x, event.clientY - nearest.y);
  predictionErrorTotal += error;
  predictionErrorSampleCount += 1;
  state.averagePredictionErrorPx = predictionErrorTotal / predictionErrorSampleCount;
  state.maximumPredictionErrorPx = Math.max(state.maximumPredictionErrorPx, error);
}

function drawPredictionPoints(
  event: PointerEvent,
  predictions: readonly PredictedPoint[],
  start: CursorPoint,
  color: string,
  processingTimeMs = 0,
): void {
  recordPredictionError(event);
  clearPrediction();
  previousPredictions = [...predictions];
  if (predictionTrace.length < 20_000) {
    predictionTrace.push({
      mode: predictionMode,
      actual: { x: event.clientX, y: event.clientY, timeStamp: event.timeStamp },
      predictions: [...predictions],
      processingTimeMs,
    });
  }
  state.predictionEventCount += 1;
  state.predictionPointCount += predictions.length;
  if (predictions.length === 0) return;

  const lastPrediction = predictions[predictions.length - 1]!;
  const horizon = Math.max(0, lastPrediction.timeStamp - event.timeStamp);
  predictionHorizonTotal += horizon;
  predictionHorizonSampleCount += 1;
  state.averagePredictionHorizonMs = predictionHorizonTotal / predictionHorizonSampleCount;
  state.maximumPredictionHorizonMs = Math.max(state.maximumPredictionHorizonMs, horizon);

  let left = start.x;
  let top = start.y;
  let right = start.x;
  let bottom = start.y;
  predictionContext.strokeStyle = color;
  predictionContext.lineWidth = 1;
  predictionContext.lineJoin = "round";
  predictionContext.lineCap = "round";
  predictionContext.beginPath();
  predictionContext.moveTo(start.x, start.y);
  for (const prediction of predictions) {
    predictionContext.lineTo(prediction.x, prediction.y);
    left = Math.min(left, prediction.x);
    top = Math.min(top, prediction.y);
    right = Math.max(right, prediction.x);
    bottom = Math.max(bottom, prediction.y);
  }
  predictionContext.stroke();
  renderedPredictionBounds = new DOMRect(left, top, right - left, bottom - top);
  state.predictionDrawCount += 1;
}

function drawBrowserPrediction(event: PointerEvent): void {
  let predictedEvents: PointerEvent[] = [];
  try {
    predictedEvents = event.getPredictedEvents?.() ?? [];
  } catch {
    previousPredictions = [];
    return;
  }
  const predictions = predictedEvents.map((prediction) => ({
    x: prediction.clientX,
    y: prediction.clientY,
    timeStamp: prediction.timeStamp,
  }));
  drawPredictionPoints(event, predictions, event, "#006dff");
}

function drawModelerPrediction(event: PointerEvent): void {
  if (modelerPredictor === null) return;
  const result = modelerPredictor.update(event);
  modelerProcessingTimeTotal += result.processingTimeMs;
  modelerProcessingSampleCount += 1;
  state.averageModelerProcessingTimeMs = modelerProcessingTimeTotal / modelerProcessingSampleCount;
  state.maximumModelerProcessingTimeMs = Math.max(
    state.maximumModelerProcessingTimeMs,
    result.processingTimeMs,
  );
  state.modelerUpdateErrorCount = result.updateErrorCount;

  const predictions: PredictedPoint[] = result.points.map((point: ModelerPredictionPoint) => ({
    x: point.x,
    y: point.y,
    timeStamp: point.timeStamp,
  }));
  if (predictions.length > 1) {
    const first = predictions[0]!;
    const last = predictions[predictions.length - 1]!;
    const catchUpDistance = Math.hypot(last.x - first.x, last.y - first.y);
    modelerCatchUpDistanceTotal += catchUpDistance;
    modelerCatchUpSampleCount += 1;
    state.averageModelerCatchUpDistancePx = modelerCatchUpDistanceTotal / modelerCatchUpSampleCount;
    state.maximumModelerCatchUpDistancePx = Math.max(
      state.maximumModelerCatchUpDistancePx,
      catchUpDistance,
    );
  }
  const futurePredictions = predictions.filter((point) => point.timeStamp > event.timeStamp);
  if (futurePredictions.length > 0) {
    const lastFuture = futurePredictions[futurePredictions.length - 1]!;
    const futureDistance = Math.hypot(lastFuture.x - event.clientX, lastFuture.y - event.clientY);
    modelerFutureDistanceTotal += futureDistance;
    modelerFutureSampleCount += 1;
    state.averageModelerFutureDistancePx = modelerFutureDistanceTotal / modelerFutureSampleCount;
    state.maximumModelerFutureDistancePx = Math.max(
      state.maximumModelerFutureDistancePx,
      futureDistance,
    );
  }
  drawPredictionPoints(
    event,
    predictions,
    predictions[0] ?? event,
    predictionMode === "modeler-kalman" ? "#d000ff" : "#ff6b00",
    result.processingTimeMs,
  );
}

function drawPrediction(event: PointerEvent): void {
  if (event.pointerId !== activePredictionPointerId) return;
  if (predictionMode === "browser") drawBrowserPrediction(event);
  if (predictionMode === "modeler" || predictionMode === "modeler-kalman") {
    drawModelerPrediction(event);
  }
}

function clearRenderedCursor(): void {
  if (renderedPoint === null) return;
  const padding = 12;
  cursorContext.clearRect(
    renderedPoint.x - padding,
    renderedPoint.y - padding,
    padding * 2,
    padding * 2,
  );
  renderedPoint = null;
}

function drawCursor(point: CursorPoint): void {
  clearRenderedCursor();
  if (!customCursorEnabled) return;

  const { x, y } = point;
  cursorContext.strokeStyle = "black";
  cursorContext.lineWidth = 1;
  cursorContext.beginPath();
  cursorContext.arc(x, y, 6, 0, Math.PI * 2);
  cursorContext.moveTo(x - 9, y);
  cursorContext.lineTo(x - 4, y);
  cursorContext.moveTo(x + 4, y);
  cursorContext.lineTo(x + 9, y);
  cursorContext.moveTo(x, y - 9);
  cursorContext.lineTo(x, y - 4);
  cursorContext.moveTo(x, y + 4);
  cursorContext.lineTo(x, y + 9);
  cursorContext.stroke();
  renderedPoint = point;
  state.cursorDrawCount += 1;
}

function requestFrameTimingSample(): void {
  if (!customCursorEnabled || pendingDiagnosticFrame !== null) return;
  pendingDiagnosticFrame = requestAnimationFrame((frameTime) => {
    pendingDiagnosticFrame = null;
    const delay = Math.max(0, frameTime - latestEventHandledAt);
    frameDelayTotal += delay;
    frameSampleCount += 1;
    state.averageFrameDelayMs = frameDelayTotal / frameSampleCount;
    state.maximumFrameDelayMs = Math.max(state.maximumFrameDelayMs, delay);
  });
}

function updateCursor(event: PointerEvent): void {
  if (!event.isPrimary) return;
  const handledAt = performance.now();
  latestEventHandledAt = handledAt;
  state.eventCount += 1;
  const eventAge = handledAt - event.timeStamp;
  if (eventAge >= 0 && eventAge < 10_000) {
    eventAgeTotal += eventAge;
    state.averageEventAgeMs = eventAgeTotal / state.eventCount;
    state.maximumEventAgeMs = Math.max(state.maximumEventAgeMs, eventAge);
  }
  drawCursor({ x: event.clientX, y: event.clientY });
  requestFrameTimingSample();
}

inputCanvas.addEventListener("pointerenter", updateCursor);
inputCanvas.addEventListener("pointermove", updateCursor);
inputCanvas.addEventListener("pointerdown", updateCursor);
inputCanvas.addEventListener("pointerup", updateCursor);
inputCanvas.addEventListener("pointerleave", () => {
  clearRenderedCursor();
});
inputCanvas.addEventListener("pointercancel", () => {
  clearRenderedCursor();
});
inputCanvas.addEventListener("pointerdown", (event) => {
  if (predictionMode === "off" || !event.isPrimary || event.button !== 0) return;
  activePredictionPointerId = event.pointerId;
  previousPredictions = [];
  clearPrediction();
  modelerPredictor?.start(event);
});
inputCanvas.addEventListener("pointermove", drawPrediction);
inputCanvas.addEventListener("pointerup", (event) => {
  if (event.pointerId !== activePredictionPointerId) return;
  modelerPredictor?.finish(event);
  activePredictionPointerId = null;
  previousPredictions = [];
  clearPrediction();
});
inputCanvas.addEventListener("pointerleave", (event) => {
  if (event.pointerId !== activePredictionPointerId) return;
  modelerPredictor?.cancel();
  activePredictionPointerId = null;
  previousPredictions = [];
  clearPrediction();
});
inputCanvas.addEventListener("pointercancel", (event) => {
  if (event.pointerId !== activePredictionPointerId) return;
  modelerPredictor?.cancel();
  activePredictionPointerId = null;
  previousPredictions = [];
  clearPrediction();
});
addEventListener("resize", resizeCursorCanvas);
resizeCursorCanvas();
