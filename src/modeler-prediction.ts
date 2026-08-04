import {
  EventType,
  StrokeModeler,
  defaultKalmanPredictorParams,
  defaultStrokeModelParams,
  type Result,
  type StrokeModelParams,
} from "ink-stroke-modeler-ts";

export type ModelerPredictionStrategy = "stroke-end" | "kalman";

function createModelParams(strategy: ModelerPredictionStrategy): StrokeModelParams {
  const params = defaultStrokeModelParams();
  if (strategy === "stroke-end") return params;

  const predictionParams = defaultKalmanPredictorParams();
  predictionParams.processNoise = 0.01;
  predictionParams.measurementNoise = 1;
  predictionParams.minCatchupVelocity = 0.5;
  predictionParams.accelerationWeight = 0.25;
  predictionParams.jerkWeight = 0.02;
  predictionParams.predictionInterval = 0.05;
  predictionParams.confidenceParams.maxEstimationDistance = 4;
  predictionParams.confidenceParams.minTravelSpeed = 25;
  predictionParams.confidenceParams.maxTravelSpeed = 200;
  predictionParams.confidenceParams.maxLinearDeviation = 10;
  params.predictionParams = predictionParams;
  return params;
}

export interface ModelerPredictionPoint {
  readonly x: number;
  readonly y: number;
  readonly timeStamp: number;
}

export interface ModelerPredictionResult {
  readonly points: readonly ModelerPredictionPoint[];
  readonly processingTimeMs: number;
  readonly updateErrorCount: number;
}

export class ModelerPredictor {
  private readonly modeler = new StrokeModeler();
  private readonly modeledResults: Result[] = [];
  private readonly predictedResults: Result[] = [];
  private lastTimeStamp = Number.NEGATIVE_INFINITY;
  private lastX = Number.NaN;
  private lastY = Number.NaN;
  private active = false;
  private updateErrorCount = 0;

  constructor(private readonly strategy: ModelerPredictionStrategy = "stroke-end") {
    const status = this.modeler.reset(createModelParams(this.strategy));
    if (!status.ok) throw new Error(`Stroke modeler initialization failed: ${status.message}`);
  }

  start(event: PointerEvent): void {
    const status = this.modeler.reset(createModelParams(this.strategy));
    if (!status.ok) throw new Error(`Stroke modeler reset failed: ${status.message}`);
    this.lastTimeStamp = Number.NEGATIVE_INFINITY;
    this.lastX = Number.NaN;
    this.lastY = Number.NaN;
    this.active = true;
    this.updateErrorCount = 0;
    this.push(EventType.Down, event);
  }

  update(event: PointerEvent): ModelerPredictionResult {
    const startedAt = performance.now();
    if (!this.active) {
      return { points: [], processingTimeMs: 0, updateErrorCount: this.updateErrorCount };
    }

    const coalesced = event.getCoalescedEvents?.() ?? [];
    for (const sample of coalesced) this.push(EventType.Move, sample);
    this.push(EventType.Move, event);

    this.predictedResults.length = 0;
    const status = this.modeler.predict(this.predictedResults);
    if (!status.ok) this.updateErrorCount += 1;
    const points = status.ok
      ? this.predictedResults.map((result) => ({
          x: result.position.x,
          y: result.position.y,
          timeStamp: result.time * 1000,
        }))
      : [];
    return {
      points,
      processingTimeMs: performance.now() - startedAt,
      updateErrorCount: this.updateErrorCount,
    };
  }

  finish(event: PointerEvent): void {
    if (!this.active) return;
    this.push(EventType.Up, event);
    this.active = false;
  }

  cancel(): void {
    this.active = false;
  }

  private push(eventType: EventType, event: PointerEvent): void {
    if (event.timeStamp < this.lastTimeStamp) return;
    if (
      event.timeStamp === this.lastTimeStamp
      && event.clientX === this.lastX
      && event.clientY === this.lastY
    ) return;

    this.modeledResults.length = 0;
    const status = this.modeler.update({
      eventType,
      position: { x: event.clientX, y: event.clientY },
      time: event.timeStamp / 1000,
      pressure: event.pressure > 0 ? event.pressure : undefined,
    }, this.modeledResults);
    if (!status.ok) {
      this.updateErrorCount += 1;
      return;
    }
    this.lastTimeStamp = event.timeStamp;
    this.lastX = event.clientX;
    this.lastY = event.clientY;
  }
}
