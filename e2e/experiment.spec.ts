import { expect, test } from "@playwright/test";

interface ExperimentState {
  readonly mode: "baseline" | "cursor";
  readonly customCursorEnabled: boolean;
  readonly hardwareCursorVisible: boolean;
  readonly delegatedInkEnabled: boolean;
  readonly cursorRenderStrategy: "immediate-dirty-rect";
  readonly predictionMode: "off" | "browser" | "modeler" | "modeler-kalman";
  readonly eventCount: number;
  readonly cursorDrawCount: number;
  readonly predictionEventCount: number;
  readonly predictionDrawCount: number;
  readonly predictionPointCount: number;
  readonly averagePredictionHorizonMs: number;
  readonly maximumPredictionHorizonMs: number;
  readonly averagePredictionErrorPx: number;
  readonly maximumPredictionErrorPx: number;
  readonly averageModelerProcessingTimeMs: number;
  readonly maximumModelerProcessingTimeMs: number;
  readonly averageModelerCatchUpDistancePx: number;
  readonly maximumModelerCatchUpDistancePx: number;
  readonly averageModelerFutureDistancePx: number;
  readonly maximumModelerFutureDistancePx: number;
  readonly modelerUpdateErrorCount: number;
}

async function getState(page: import("@playwright/test").Page): Promise<ExperimentState> {
  return page.evaluate(() =>
    (window as unknown as { __cursorExperiment: ExperimentState }).__cursorExperiment,
  );
}

async function countDarkPixels(
  page: import("@playwright/test").Page,
  selector: string,
): Promise<number> {
  return page.locator(selector).evaluate((canvas: HTMLCanvasElement) => {
    const context = canvas.getContext("2d");
    if (context === null) return 0;
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let count = 0;
    for (let index = 0; index < pixels.length; index += 4) {
      if (pixels[index + 3]! > 20 && pixels[index]! < 100) count += 1;
    }
    return count;
  });
}

async function countVisiblePixels(
  page: import("@playwright/test").Page,
  selector: string,
): Promise<number> {
  return page.locator(selector).evaluate((canvas: HTMLCanvasElement) => {
    const context = canvas.getContext("2d");
    if (context === null) return 0;
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let count = 0;
    for (let index = 3; index < pixels.length; index += 4) {
      if (pixels[index]! > 20) count += 1;
    }
    return count;
  });
}

test("keeps the hardware cursor and disables the overlay in baseline mode", async ({ page }) => {
  await page.goto("/experiment.html?mode=baseline");

  await expect(page.locator("#input-canvas")).toHaveCSS("cursor", "crosshair");
  expect(await getState(page)).toEqual(expect.objectContaining({
    mode: "baseline",
    customCursorEnabled: false,
    hardwareCursorVisible: true,
    cursorDrawCount: 0,
  }));
});

test("renders a custom cursor through the page compositor", async ({ page }) => {
  await page.goto("/experiment.html?mode=cursor");
  await page.mouse.move(380, 280);
  await page.mouse.move(420, 310);

  await expect(page.locator("#input-canvas")).toHaveCSS("cursor", "none");
  await expect.poll(() => countDarkPixels(page, "#cursor-canvas")).toBeGreaterThan(10);
  expect(await getState(page)).toEqual(expect.objectContaining({
    mode: "cursor",
    customCursorEnabled: true,
    hardwareCursorVisible: false,
    delegatedInkEnabled: true,
    cursorRenderStrategy: "immediate-dirty-rect",
    predictionMode: "off",
    eventCount: expect.any(Number),
    cursorDrawCount: expect.any(Number),
  }));
});

test("draws the custom cursor synchronously without waiting for animation frame", async ({ page }) => {
  await page.goto("/experiment.html?mode=cursor");

  const result = await page.locator("#input-canvas").evaluate((canvas) => {
    const state = (window as unknown as {
      __cursorExperiment: ExperimentState;
    }).__cursorExperiment;
    const before = state.cursorDrawCount;
    canvas.dispatchEvent(new PointerEvent("pointermove", {
      bubbles: true,
      clientX: 320,
      clientY: 240,
      isPrimary: true,
      pointerId: 42,
      pointerType: "pen",
    }));
    return { before, after: state.cursorDrawCount };
  });

  expect(result.after).toBe(result.before + 1);
  expect(await countDarkPixels(page, "#cursor-canvas")).toBeGreaterThan(10);
});

test("can show both cursors for relative-lag measurement", async ({ page }) => {
  await page.goto("/experiment.html?mode=cursor&hardwareCursor=1");
  await page.mouse.move(380, 280);
  await page.mouse.move(420, 310);

  await expect(page.locator("#input-canvas")).toHaveCSS("cursor", "crosshair");
  await expect.poll(() => countDarkPixels(page, "#cursor-canvas")).toBeGreaterThan(10);
  expect(await getState(page)).toEqual(expect.objectContaining({
    customCursorEnabled: true,
    hardwareCursorVisible: true,
  }));
});

test("keeps immediate cursor rendering within its browser performance budget", async ({ page }) => {
  await page.goto("/experiment.html?mode=cursor");

  const measurement = await page.locator("#input-canvas").evaluate((canvas) => {
    const state = (window as unknown as {
      __cursorExperiment: ExperimentState;
    }).__cursorExperiment;
    const eventCount = 2_000;
    const beforeDrawCount = state.cursorDrawCount;
    const startedAt = performance.now();
    for (let index = 0; index < eventCount; index += 1) {
      canvas.dispatchEvent(new PointerEvent("pointermove", {
        bubbles: true,
        clientX: 100 + index % 800,
        clientY: 200 + index % 400,
        isPrimary: true,
        pointerId: 42,
        pointerType: "pen",
      }));
    }
    return {
      elapsedMs: performance.now() - startedAt,
      drawCount: state.cursorDrawCount - beforeDrawCount,
      eventCount,
    };
  });

  expect(measurement.drawCount).toBe(measurement.eventCount);
  expect(measurement.elapsedMs).toBeLessThan(150);
});

test("can disable Delegated Ink without changing the drawing pipeline", async ({ page }) => {
  await page.goto("/experiment.html?mode=cursor&delegatedInk=0");
  await page.mouse.move(380, 280);
  await page.mouse.move(420, 310);

  await expect.poll(() => countDarkPixels(page, "#cursor-canvas")).toBeGreaterThan(10);
  expect(await getState(page)).toEqual(expect.objectContaining({
    customCursorEnabled: true,
    delegatedInkEnabled: false,
  }));
  expect(await page.evaluate(() =>
    (window as unknown as {
      __freehandDiagnostics: { inkStatus: string; inkCallCount: number };
    }).__freehandDiagnostics,
  )).toEqual(expect.objectContaining({ inkStatus: "disabled", inkCallCount: 0 }));
});

test("renders browser-predicted points on a temporary overlay", async ({ page }) => {
  await page.goto("/experiment.html?mode=cursor&delegatedInk=0&prediction=browser");

  const result = await page.locator("#input-canvas").evaluate((canvas) => {
    const down = new PointerEvent("pointerdown", {
      bubbles: true,
      button: 0,
      buttons: 1,
      clientX: 200,
      clientY: 200,
      isPrimary: true,
      pointerId: 71,
      pointerType: "pen",
    });
    canvas.dispatchEvent(down);
    const move = new PointerEvent("pointermove", {
      bubbles: true,
      buttons: 1,
      clientX: 210,
      clientY: 205,
      isPrimary: true,
      pointerId: 71,
      pointerType: "pen",
    });
    const predicted = [
      new PointerEvent("pointermove", { clientX: 220, clientY: 210 }),
      new PointerEvent("pointermove", { clientX: 232, clientY: 216 }),
    ];
    Object.defineProperty(predicted[0], "timeStamp", { value: move.timeStamp + 8 });
    Object.defineProperty(predicted[1], "timeStamp", { value: move.timeStamp + 16 });
    Object.defineProperty(move, "getPredictedEvents", { value: () => predicted });
    canvas.dispatchEvent(move);
    return (window as unknown as {
      __cursorExperiment: ExperimentState;
    }).__cursorExperiment;
  });

  expect(result).toEqual(expect.objectContaining({
    predictionMode: "browser",
    predictionEventCount: 1,
    predictionDrawCount: 1,
    predictionPointCount: 2,
    averagePredictionHorizonMs: 16,
  }));
  expect(await countDarkPixels(page, "#prediction-canvas")).toBeGreaterThan(5);

  await page.locator("#input-canvas").dispatchEvent("pointerup", {
    button: 0,
    clientX: 232,
    clientY: 216,
    isPrimary: true,
    pointerId: 71,
    pointerType: "pen",
  });
  expect(await countDarkPixels(page, "#prediction-canvas")).toBe(0);
});

test("keeps browser prediction within its browser performance budget", async ({ page }) => {
  await page.goto("/experiment.html?mode=cursor&delegatedInk=0&prediction=browser");

  const measurement = await page.locator("#input-canvas").evaluate((canvas) => {
    const pointerId = 73;
    canvas.dispatchEvent(new PointerEvent("pointerdown", {
      bubbles: true,
      button: 0,
      buttons: 1,
      clientX: 100,
      clientY: 200,
      isPrimary: true,
      pointerId,
      pointerType: "pen",
    }));
    const eventCount = 1_000;
    const startedAt = performance.now();
    for (let index = 0; index < eventCount; index += 1) {
      const move = new PointerEvent("pointermove", {
        bubbles: true,
        buttons: 1,
        clientX: 100 + index % 800,
        clientY: 200 + index % 400,
        isPrimary: true,
        pointerId,
        pointerType: "pen",
      });
      const predicted = new PointerEvent("pointermove", {
        clientX: move.clientX + 4,
        clientY: move.clientY + 2,
      });
      Object.defineProperty(predicted, "timeStamp", { value: move.timeStamp + 8 });
      Object.defineProperty(move, "getPredictedEvents", { value: () => [predicted] });
      canvas.dispatchEvent(move);
    }
    const state = (window as unknown as {
      __cursorExperiment: ExperimentState;
    }).__cursorExperiment;
    return {
      elapsedMs: performance.now() - startedAt,
      drawCount: state.predictionDrawCount,
      eventCount,
    };
  });

  expect(measurement.drawCount).toBe(measurement.eventCount);
  expect(measurement.elapsedMs).toBeLessThan(200);
});

test("renders stroke modeler catch-up prediction on a temporary overlay", async ({ page }) => {
  await page.goto("/experiment.html?mode=cursor&delegatedInk=0&prediction=modeler");
  await page.mouse.move(200, 200);
  await page.mouse.down();
  for (let index = 1; index <= 20; index += 1) {
    await page.mouse.move(200 + index * 6, 200 + index * 3);
  }

  const state = await getState(page);
  expect(state).toEqual(expect.objectContaining({
    predictionMode: "modeler",
    predictionEventCount: 20,
    predictionDrawCount: 20,
    modelerUpdateErrorCount: 0,
  }));
  expect(state.predictionPointCount).toBeGreaterThan(20);
  expect(state.maximumModelerProcessingTimeMs).toBeLessThan(20);
  expect(await countVisiblePixels(page, "#prediction-canvas")).toBeGreaterThan(5);

  await page.mouse.up();
  expect(await countVisiblePixels(page, "#prediction-canvas")).toBe(0);
});

test("keeps stroke modeler prediction within its browser performance budget", async ({ page }) => {
  await page.goto("/experiment.html?mode=cursor&delegatedInk=0&prediction=modeler");

  const measurement = await page.locator("#input-canvas").evaluate((canvas) => {
    const pointerId = 79;
    const makeEvent = (type: string, index: number): PointerEvent => {
      const event = new PointerEvent(type, {
        bubbles: true,
        button: type === "pointerdown" ? 0 : -1,
        buttons: 1,
        clientX: 100 + index * 0.5,
        clientY: 200 + Math.sin(index / 20) * 50,
        isPrimary: true,
        pointerId,
        pointerType: "pen",
      });
      Object.defineProperty(event, "timeStamp", { value: 1_000 + index * 8 });
      Object.defineProperty(event, "getCoalescedEvents", { value: () => [] });
      return event;
    };
    canvas.dispatchEvent(makeEvent("pointerdown", 0));
    const eventCount = 1_000;
    const startedAt = performance.now();
    for (let index = 1; index <= eventCount; index += 1) {
      canvas.dispatchEvent(makeEvent("pointermove", index));
    }
    const state = (window as unknown as {
      __cursorExperiment: ExperimentState;
    }).__cursorExperiment;
    return {
      elapsedMs: performance.now() - startedAt,
      drawCount: state.predictionDrawCount,
      updateErrorCount: state.modelerUpdateErrorCount,
      eventCount,
    };
  });

  expect(measurement.drawCount).toBe(measurement.eventCount);
  expect(measurement.updateErrorCount).toBe(0);
  expect(measurement.elapsedMs).toBeLessThan(500);
});

test("extends the Kalman modeler prediction beyond the latest input", async ({ page }) => {
  await page.goto("/experiment.html?mode=cursor&delegatedInk=0&prediction=modeler-kalman");

  const result = await page.locator("#input-canvas").evaluate((canvas) => {
    const pointerId = 83;
    const makeEvent = (type: string, index: number): PointerEvent => {
      const event = new PointerEvent(type, {
        bubbles: true,
        button: type === "pointerdown" ? 0 : -1,
        buttons: 1,
        clientX: 200 + index * 2,
        clientY: 250 + index * 0.5,
        isPrimary: true,
        pointerId,
        pointerType: "pen",
      });
      Object.defineProperty(event, "timeStamp", { value: 1_000 + index * 8 });
      Object.defineProperty(event, "getCoalescedEvents", { value: () => [] });
      return event;
    };
    canvas.dispatchEvent(makeEvent("pointerdown", 0));
    for (let index = 1; index <= 60; index += 1) {
      canvas.dispatchEvent(makeEvent("pointermove", index));
    }
    return {
      state: (window as unknown as {
        __cursorExperiment: ExperimentState;
      }).__cursorExperiment,
      trace: (window as unknown as {
        __predictionTrace: Array<{
          actual: { timeStamp: number };
          predictions: Array<{ timeStamp: number }>;
        }>;
      }).__predictionTrace,
    };
  });

  expect(result.state).toEqual(expect.objectContaining({
    predictionMode: "modeler-kalman",
    predictionEventCount: 60,
    predictionDrawCount: expect.any(Number),
    modelerUpdateErrorCount: 0,
  }));
  expect(result.state.predictionDrawCount).toBeGreaterThan(0);
  expect(result.state.maximumPredictionHorizonMs).toBeGreaterThan(0);
  expect(result.state.maximumPredictionHorizonMs).toBeLessThanOrEqual(100);
  expect(result.state.maximumModelerFutureDistancePx).toBeGreaterThan(0);
  expect(result.state.maximumModelerProcessingTimeMs).toBeLessThan(20);
  expect(result.trace.some((entry) => entry.predictions.some(
    (prediction) => prediction.timeStamp > entry.actual.timeStamp,
  ))).toBe(true);
  expect(await countVisiblePixels(page, "#prediction-canvas")).toBeGreaterThan(5);
});

test("keeps Kalman modeler prediction within its browser performance budget", async ({ page }) => {
  await page.goto("/experiment.html?mode=cursor&delegatedInk=0&prediction=modeler-kalman");

  const measurement = await page.locator("#input-canvas").evaluate((canvas) => {
    const pointerId = 89;
    const makeEvent = (type: string, index: number): PointerEvent => {
      const event = new PointerEvent(type, {
        bubbles: true,
        button: type === "pointerdown" ? 0 : -1,
        buttons: 1,
        clientX: 100 + index * 0.5,
        clientY: 200 + Math.sin(index / 20) * 50,
        isPrimary: true,
        pointerId,
        pointerType: "pen",
      });
      Object.defineProperty(event, "timeStamp", { value: 1_000 + index * 8 });
      Object.defineProperty(event, "getCoalescedEvents", { value: () => [] });
      return event;
    };
    canvas.dispatchEvent(makeEvent("pointerdown", 0));
    const eventCount = 1_000;
    const startedAt = performance.now();
    for (let index = 1; index <= eventCount; index += 1) {
      canvas.dispatchEvent(makeEvent("pointermove", index));
    }
    const state = (window as unknown as {
      __cursorExperiment: ExperimentState;
    }).__cursorExperiment;
    return {
      elapsedMs: performance.now() - startedAt,
      drawCount: state.predictionDrawCount,
      updateErrorCount: state.modelerUpdateErrorCount,
      eventCount,
    };
  });

  expect(measurement.drawCount).toBeGreaterThan(0);
  expect(measurement.updateErrorCount).toBe(0);
  expect(measurement.elapsedMs).toBeLessThan(500);
});
