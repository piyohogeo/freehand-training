type ProbeMode =
  | "canvas"
  | "opaque"
  | "desync"
  | "webgl"
  | "webgl-frame"
  | "webgl-frame-no-preserve"
  | "svg"
  | "dom";

interface ProbePoint {
  readonly x: number;
  readonly y: number;
}

interface ProbeRenderer {
  readonly desynchronizedActive: boolean;
  readonly preserveDrawingBufferActive: boolean;
  readonly renderSubmissionCount: number;
  reset(start: ProbePoint): void;
  append(points: readonly ProbePoint[]): void;
}

interface ProbeState {
  readonly mode: ProbeMode;
  readonly desynchronizedRequested: boolean;
  readonly desynchronizedActive: boolean;
  readonly preserveDrawingBufferRequested: boolean;
  readonly preserveDrawingBufferActive: boolean;
  readonly renderSubmissionCount: number;
  eventCount: number;
  drawCount: number;
  averageEventAgeMs: number;
  maximumEventAgeMs: number;
}

interface ContextAttributesWithDesynchronization {
  readonly desynchronized?: boolean;
}

const requestedMode = new URLSearchParams(location.search).get("mode");
const MODES: readonly ProbeMode[] = [
  "canvas",
  "opaque",
  "desync",
  "webgl",
  "webgl-frame",
  "webgl-frame-no-preserve",
  "svg",
  "dom",
];
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
  let renderSubmissionCount = 0;

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
    preserveDrawingBufferActive: false,
    get renderSubmissionCount() {
      return renderSubmissionCount;
    },
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
      renderSubmissionCount += 1;
    },
  };
}

function compileShader(
  context: WebGLRenderingContext,
  type: number,
  source: string,
): WebGLShader {
  const shader = context.createShader(type);
  if (shader === null) throw new Error("WebGL shader creation failed.");
  context.shaderSource(shader, source);
  context.compileShader(shader);
  if (!context.getShaderParameter(shader, context.COMPILE_STATUS)) {
    throw new Error(`WebGL shader compilation failed: ${context.getShaderInfoLog(shader) ?? ""}`);
  }
  return shader;
}

function createWebGlRenderer(frameBatched: boolean, preserveDrawingBuffer: boolean): ProbeRenderer {
  const canvas = document.createElement("canvas");
  canvas.className = "probe-surface";
  document.body.append(canvas);
  const context = canvas.getContext("webgl", {
    alpha: false,
    depth: false,
    stencil: false,
    antialias: true,
    desynchronized: true,
    preserveDrawingBuffer,
  });
  if (context === null) throw new Error("WebGL is not supported.");
  const gl = context;

  const vertexShader = compileShader(context, context.VERTEX_SHADER, `
    attribute vec2 position;
    uniform vec2 resolution;
    void main() {
      vec2 clip = position / resolution * 2.0 - 1.0;
      gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
    }
  `);
  const fragmentShader = compileShader(context, context.FRAGMENT_SHADER, `
    precision mediump float;
    void main() {
      gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
    }
  `);
  const program = context.createProgram();
  if (program === null) throw new Error("WebGL program creation failed.");
  context.attachShader(program, vertexShader);
  context.attachShader(program, fragmentShader);
  context.linkProgram(program);
  if (!context.getProgramParameter(program, context.LINK_STATUS)) {
    throw new Error(`WebGL program linking failed: ${context.getProgramInfoLog(program) ?? ""}`);
  }
  const positionLocation = context.getAttribLocation(program, "position");
  const resolutionLocation = context.getUniformLocation(program, "resolution");
  const buffer = context.createBuffer();
  if (positionLocation < 0 || resolutionLocation === null || buffer === null) {
    throw new Error("WebGL stroke resources could not be created.");
  }
  const attributes = context.getContextAttributes();
  let previous: ProbePoint = { x: 0, y: 0 };
  let pendingPoints: ProbePoint[] = [];
  let strokePoints: ProbePoint[] = [];
  let pendingFrame: number | null = null;
  let renderSubmissionCount = 0;

  context.useProgram(program);
  context.bindBuffer(context.ARRAY_BUFFER, buffer);
  context.enableVertexAttribArray(positionLocation);
  context.vertexAttribPointer(positionLocation, 2, context.FLOAT, false, 0, 0);
  context.clearColor(1, 1, 1, 1);

  function resize(): void {
    const ratio = devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.round(innerWidth * ratio));
    canvas.height = Math.max(1, Math.round(innerHeight * ratio));
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.uniform2f(resolutionLocation, innerWidth, innerHeight);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.flush();
  }

  addEventListener("resize", resize);
  resize();

  function render(points: readonly ProbePoint[], includePrevious: boolean): void {
    if (points.length === 0) return;
    const offset = includePrevious ? 1 : 0;
    const vertices = new Float32Array((points.length + offset) * 2);
    if (includePrevious) {
      vertices[0] = previous.x;
      vertices[1] = previous.y;
    }
    for (let index = 0; index < points.length; index += 1) {
      const point = points[index]!;
      vertices[(index + offset) * 2] = point.x;
      vertices[(index + offset) * 2 + 1] = point.y;
    }
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STREAM_DRAW);
    gl.drawArrays(gl.LINE_STRIP, 0, points.length + offset);
    if (!frameBatched) gl.flush();
    previous = points[points.length - 1]!;
    renderSubmissionCount += 1;
  }

  return {
    desynchronizedActive: attributes?.desynchronized === true,
    preserveDrawingBufferActive: attributes?.preserveDrawingBuffer === true,
    get renderSubmissionCount() {
      return renderSubmissionCount;
    },
    reset(start) {
      if (pendingFrame !== null) cancelAnimationFrame(pendingFrame);
      pendingFrame = null;
      pendingPoints = [];
      strokePoints = [start];
      context.clear(context.COLOR_BUFFER_BIT);
      context.flush();
      previous = start;
    },
    append(points) {
      if (points.length === 0) return;
      if (!frameBatched) {
        render(points, true);
        return;
      }
      pendingPoints.push(...points);
      if (pendingFrame !== null) return;
      pendingFrame = requestAnimationFrame(() => {
        pendingFrame = null;
        const pointsToRender = pendingPoints;
        pendingPoints = [];
        if (preserveDrawingBuffer) {
          render(pointsToRender, true);
          return;
        }
        strokePoints.push(...pointsToRender);
        gl.clear(gl.COLOR_BUFFER_BIT);
        render(strokePoints, false);
      });
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
    preserveDrawingBufferActive: false,
    get renderSubmissionCount() {
      return 0;
    },
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
  let renderSubmissionCount = 0;

  return {
    desynchronizedActive: false,
    preserveDrawingBufferActive: false,
    get renderSubmissionCount() {
      return renderSubmissionCount;
    },
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
      renderSubmissionCount += 1;
    },
  };
}

const renderer = mode === "canvas"
  ? createCanvasRenderer(true, false)
  : mode === "opaque"
    ? createCanvasRenderer(false, false)
    : mode === "desync"
      ? createCanvasRenderer(false, true)
      : mode === "webgl"
        ? createWebGlRenderer(false, true)
        : mode === "webgl-frame"
          ? createWebGlRenderer(true, true)
          : mode === "webgl-frame-no-preserve"
            ? createWebGlRenderer(true, false)
            : mode === "svg"
              ? createSvgRenderer()
              : createDomRenderer();

const webGlMode = mode === "webgl"
  || mode === "webgl-frame"
  || mode === "webgl-frame-no-preserve";

const state: ProbeState = {
  mode,
  desynchronizedRequested: mode === "desync" || webGlMode,
  desynchronizedActive: renderer.desynchronizedActive,
  preserveDrawingBufferRequested: mode === "webgl" || mode === "webgl-frame",
  preserveDrawingBufferActive: renderer.preserveDrawingBufferActive,
  get renderSubmissionCount() {
    return renderer.renderSubmissionCount;
  },
  eventCount: 0,
  drawCount: 0,
  averageEventAgeMs: 0,
  maximumEventAgeMs: 0,
};
(window as unknown as { __latencyProbe: ProbeState }).__latencyProbe = state;
document.title = `Latency Probe — ${mode}${mode === "desync" || webGlMode ? renderer.desynchronizedActive ? " desync active" : " desync fallback" : ""}`;

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
