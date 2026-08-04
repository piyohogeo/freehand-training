type ProbeMode = "canvas" | "opaque" | "desync" | "svg" | "dom";

interface ProbePoint {
  readonly x: number;
  readonly y: number;
}

interface ProbeRenderer {
  readonly desynchronizedActive: boolean;
  reset(start: ProbePoint): void;
  append(points: readonly ProbePoint[]): void;
}

interface ProbeState {
  readonly mode: ProbeMode;
  readonly desynchronizedRequested: boolean;
  readonly desynchronizedActive: boolean;
  eventCount: number;
  drawCount: number;
  averageEventAgeMs: number;
  maximumEventAgeMs: number;
}

interface ContextAttributesWithDesynchronization {
  readonly desynchronized?: boolean;
}

const requestedMode = new URLSearchParams(location.search).get("mode");
const MODES: readonly ProbeMode[] = ["canvas", "opaque", "desync", "svg", "dom"];
const mode: ProbeMode = MODES.includes(requestedMode as ProbeMode)
  ? requestedMode as ProbeMode
  : "canvas";

function pointFromEvent(event: PointerEvent): ProbePoint {
  return { x: event.clientX, y: event.clientY };
}

function createCanvasRenderer(
  alpha: boolean,
  desynchronized: boolean,
): ProbeRenderer {
  const canvas = document.createElement("canvas");
  canvas.className = "probe-surface";
  document.body.append(canvas);
  const canvasContext = canvas.getContext("2d", { alpha, desynchronized });
  if (canvasContext === null) throw new Error("2D canvas is not supported.");
  const context = canvasContext;
  const attributes = context.getContextAttributes() as ContextAttributesWithDesynchronization;
  let previous: ProbePoint = { x: 0, y: 0 };

  function resize(): void {
    const ratio = devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.round(innerWidth * ratio));
    canvas.height = Math.max(1, Math.round(innerHeight * ratio));
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.fillStyle = "white";
    context.fillRect(0, 0, innerWidth, innerHeight);
    context.strokeStyle = "black";
    context.lineWidth = 1;
    context.lineCap = "round";
    context.lineJoin = "round";
  }

  addEventListener("resize", resize);
  resize();
  return {
    desynchronizedActive: attributes.desynchronized === true,
    reset(start) {
      context.fillStyle = "white";
      context.fillRect(0, 0, innerWidth, innerHeight);
      context.strokeStyle = "black";
      previous = start;
    },
    append(points) {
      if (points.length === 0) return;
      context.beginPath();
      context.moveTo(previous.x, previous.y);
      for (const point of points) context.lineTo(point.x, point.y);
      context.stroke();
      previous = points[points.length - 1]!;
    },
  };
}

function createSvgRenderer(): ProbeRenderer {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.classList.add("probe-surface");
  const polyline = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
  polyline.setAttribute("fill", "none");
  polyline.setAttribute("stroke", "black");
  polyline.setAttribute("stroke-width", "1");
  polyline.setAttribute("stroke-linecap", "round");
  polyline.setAttribute("stroke-linejoin", "round");
  svg.append(polyline);
  document.body.append(svg);
  let points: ProbePoint[] = [];

  return {
    desynchronizedActive: false,
    reset(start) {
      points = [start];
      polyline.setAttribute("points", `${start.x},${start.y}`);
    },
    append(nextPoints) {
      points.push(...nextPoints);
      polyline.setAttribute("points", points.map((point) => `${point.x},${point.y}`).join(" "));
    },
  };
}

function createDomRenderer(): ProbeRenderer {
  const surface = document.createElement("div");
  surface.className = "probe-surface";
  document.body.append(surface);
  let previous: ProbePoint = { x: 0, y: 0 };

  return {
    desynchronizedActive: false,
    reset(start) {
      surface.replaceChildren();
      previous = start;
    },
    append(points) {
      const fragment = document.createDocumentFragment();
      for (const point of points) {
        const dx = point.x - previous.x;
        const dy = point.y - previous.y;
        const segment = document.createElement("div");
        segment.className = "dom-segment";
        segment.style.width = `${Math.hypot(dx, dy)}px`;
        segment.style.transform =
          `translate3d(${previous.x}px, ${previous.y}px, 0) rotate(${Math.atan2(dy, dx)}rad)`;
        fragment.append(segment);
        previous = point;
      }
      surface.append(fragment);
    },
  };
}

const renderer = mode === "canvas"
  ? createCanvasRenderer(true, false)
  : mode === "opaque"
    ? createCanvasRenderer(false, false)
    : mode === "desync"
      ? createCanvasRenderer(false, true)
      : mode === "svg"
        ? createSvgRenderer()
        : createDomRenderer();

const state: ProbeState = {
  mode,
  desynchronizedRequested: mode === "desync",
  desynchronizedActive: renderer.desynchronizedActive,
  eventCount: 0,
  drawCount: 0,
  averageEventAgeMs: 0,
  maximumEventAgeMs: 0,
};
(window as unknown as { __latencyProbe: ProbeState }).__latencyProbe = state;
document.title = `Latency Probe — ${mode}${mode === "desync" ? renderer.desynchronizedActive ? " active" : " fallback" : ""}`;

let activePointerId: number | null = null;
let eventAgeTotal = 0;

function recordEvent(event: PointerEvent): void {
  const age = performance.now() - event.timeStamp;
  state.eventCount += 1;
  if (age >= 0 && age < 10_000) {
    eventAgeTotal += age;
    state.averageEventAgeMs = eventAgeTotal / state.eventCount;
    state.maximumEventAgeMs = Math.max(state.maximumEventAgeMs, age);
  }
}

document.body.addEventListener("pointerdown", (event) => {
  if (!event.isPrimary || event.button !== 0 || activePointerId !== null) return;
  event.preventDefault();
  activePointerId = event.pointerId;
  document.body.setPointerCapture?.(event.pointerId);
  renderer.reset(pointFromEvent(event));
  state.eventCount = 0;
  state.drawCount = 0;
  state.averageEventAgeMs = 0;
  state.maximumEventAgeMs = 0;
  eventAgeTotal = 0;
});

document.body.addEventListener("pointermove", (event) => {
  if (event.pointerId !== activePointerId) return;
  event.preventDefault();
  recordEvent(event);
  const events = event.getCoalescedEvents?.() ?? [event];
  renderer.append(events.length > 0 ? events.map(pointFromEvent) : [pointFromEvent(event)]);
  state.drawCount += 1;
});

function finish(event: PointerEvent): void {
  if (event.pointerId !== activePointerId) return;
  activePointerId = null;
  document.body.releasePointerCapture?.(event.pointerId);
  console.table(state);
}

document.body.addEventListener("pointerup", finish);
document.body.addEventListener("pointercancel", finish);
