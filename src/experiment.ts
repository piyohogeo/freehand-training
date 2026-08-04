import "./main.js";

type ExperimentMode = "baseline" | "cursor";

interface CursorExperimentState {
  readonly mode: ExperimentMode;
  readonly customCursorEnabled: boolean;
  readonly hardwareCursorVisible: boolean;
  eventCount: number;
  cursorDrawCount: number;
  averageEventAgeMs: number;
  maximumEventAgeMs: number;
  averageFrameDelayMs: number;
  maximumFrameDelayMs: number;
}

interface CursorPoint {
  readonly x: number;
  readonly y: number;
}

const parameters = new URLSearchParams(location.search);
const requestedMode = parameters.get("mode");
const mode: ExperimentMode = requestedMode === "baseline" ? "baseline" : "cursor";
const customCursorEnabled = mode === "cursor";
const hardwareCursorVisible = !customCursorEnabled || parameters.get("hardwareCursor") === "1";

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
const cursorCanvas = requireCanvas("#cursor-canvas");
const cursorContext = requireContext(cursorCanvas);

const state: CursorExperimentState = {
  mode,
  customCursorEnabled,
  hardwareCursorVisible,
  eventCount: 0,
  cursorDrawCount: 0,
  averageEventAgeMs: 0,
  maximumEventAgeMs: 0,
  averageFrameDelayMs: 0,
  maximumFrameDelayMs: 0,
};
(window as unknown as { __cursorExperiment: CursorExperimentState }).__cursorExperiment = state;

document.title = `Freehand Training — ${mode}${hardwareCursorVisible ? " + hardware cursor" : ""}`;
if (!hardwareCursorVisible) inputCanvas.classList.add("experiment-hide-hardware-cursor");

let pixelRatio = 1;
let latestPoint: CursorPoint | null = null;
let cursorVisible = false;
let pendingFrame: number | null = null;
let latestEventHandledAt = 0;
let eventAgeTotal = 0;
let frameDelayTotal = 0;
let frameSampleCount = 0;

function resizeCursorCanvas(): void {
  pixelRatio = devicePixelRatio || 1;
  cursorCanvas.width = Math.max(1, Math.round(innerWidth * pixelRatio));
  cursorCanvas.height = Math.max(1, Math.round(innerHeight * pixelRatio));
  cursorContext.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
}

function clearCursor(): void {
  cursorContext.clearRect(0, 0, innerWidth, innerHeight);
}

function drawCursor(): void {
  clearCursor();
  if (!customCursorEnabled || !cursorVisible || latestPoint === null) return;

  const { x, y } = latestPoint;
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
  state.cursorDrawCount += 1;
}

function requestCursorRender(): void {
  if (!customCursorEnabled || pendingFrame !== null) return;
  pendingFrame = requestAnimationFrame((frameTime) => {
    pendingFrame = null;
    const delay = Math.max(0, frameTime - latestEventHandledAt);
    frameDelayTotal += delay;
    frameSampleCount += 1;
    state.averageFrameDelayMs = frameDelayTotal / frameSampleCount;
    state.maximumFrameDelayMs = Math.max(state.maximumFrameDelayMs, delay);
    drawCursor();
  });
}

function updateCursor(event: PointerEvent): void {
  if (!event.isPrimary) return;
  const handledAt = performance.now();
  latestEventHandledAt = handledAt;
  latestPoint = { x: event.clientX, y: event.clientY };
  cursorVisible = true;
  state.eventCount += 1;
  const eventAge = handledAt - event.timeStamp;
  if (eventAge >= 0 && eventAge < 10_000) {
    eventAgeTotal += eventAge;
    state.averageEventAgeMs = eventAgeTotal / state.eventCount;
    state.maximumEventAgeMs = Math.max(state.maximumEventAgeMs, eventAge);
  }
  requestCursorRender();
}

inputCanvas.addEventListener("pointerenter", updateCursor);
inputCanvas.addEventListener("pointermove", updateCursor);
inputCanvas.addEventListener("pointerdown", updateCursor);
inputCanvas.addEventListener("pointerup", updateCursor);
inputCanvas.addEventListener("pointerleave", () => {
  cursorVisible = false;
  requestCursorRender();
});
inputCanvas.addEventListener("pointercancel", () => {
  cursorVisible = false;
  requestCursorRender();
});
addEventListener("resize", resizeCursorCanvas);
resizeCursorCanvas();
