import { expect, test } from "@playwright/test";

const modes = [
  "canvas",
  "opaque",
  "desync",
  "webgl",
  "webgl-frame",
  "webgl-frame-no-preserve",
  "svg",
  "dom",
] as const;

for (const mode of modes) {
  test(`latency probe renders a stroke in ${mode} mode`, async ({ page, browserName }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await page.goto(`/latency.html?mode=${mode}`);

    await page.mouse.move(200, 300);
    await page.mouse.down();
    for (let index = 1; index <= 20; index += 1) {
      await page.mouse.move(200 + index * 10, 300 + Math.sin(index / 3) * 30);
    }
    await page.mouse.up();

    const state = await page.evaluate(() =>
      (window as unknown as {
        __latencyProbe: {
          mode: string;
          eventCount: number;
          drawCount: number;
          desynchronizedActive: boolean;
          preserveDrawingBufferActive: boolean;
          renderSubmissionCount: number;
        };
      }).__latencyProbe,
    );
    expect(state.mode).toBe(mode);
    expect(state.eventCount).toBeGreaterThan(0);
    expect(state.drawCount).toBeGreaterThan(0);
    if ((mode === "desync"
      || mode === "webgl"
      || mode === "webgl-frame"
      || mode === "webgl-frame-no-preserve")
      && browserName === "chromium") {
      expect(state.desynchronizedActive).toBe(true);
    }
    if (mode === "webgl" || mode === "webgl-frame") {
      expect(state.preserveDrawingBufferActive).toBe(true);
    }
    if (mode === "webgl-frame-no-preserve") {
      expect(state.preserveDrawingBufferActive).toBe(false);
    }

    if (mode === "svg") {
      expect((await page.locator("polyline").getAttribute("points"))?.length).toBeGreaterThan(20);
    } else if (mode === "dom") {
      expect(await page.locator(".dom-segment").count()).toBeGreaterThan(0);
    } else if (mode === "webgl" || mode === "webgl-frame") {
      const darkPixels = await page.locator("canvas").evaluate((canvas: HTMLCanvasElement) => {
        const context = canvas.getContext("webgl");
        if (context === null) return 0;
        const pixels = new Uint8Array(canvas.width * canvas.height * 4);
        context.readPixels(
          0,
          0,
          canvas.width,
          canvas.height,
          context.RGBA,
          context.UNSIGNED_BYTE,
          pixels,
        );
        let count = 0;
        for (let index = 0; index < pixels.length; index += 4) {
          if (pixels[index]! < 100 && pixels[index + 1]! < 100 && pixels[index + 2]! < 100) {
            count += 1;
          }
        }
        return count;
      });
      expect(darkPixels).toBeGreaterThan(20);
    } else if (mode !== "webgl-frame-no-preserve") {
      const darkPixels = await page.locator("canvas").evaluate((canvas: HTMLCanvasElement) => {
        const pixels = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height).data;
        let count = 0;
        for (let index = 0; index < pixels.length; index += 4) {
          if (pixels[index]! < 100 && pixels[index + 1]! < 100 && pixels[index + 2]! < 100) {
            count += 1;
          }
        }
        return count;
      });
      expect(darkPixels).toBeGreaterThan(20);
    }
    expect(pageErrors).toEqual([]);
  });
}

test("batches a burst of WebGL input into one frame submission", async ({ page }) => {
  await page.goto("/latency.html?mode=webgl-frame");

  const beforeFrame = await page.evaluate(() => {
    const pointerId = 97;
    document.body.dispatchEvent(new PointerEvent("pointerdown", {
      bubbles: true,
      button: 0,
      buttons: 1,
      clientX: 100,
      clientY: 200,
      isPrimary: true,
      pointerId,
      pointerType: "pen",
    }));
    for (let index = 1; index <= 500; index += 1) {
      document.body.dispatchEvent(new PointerEvent("pointermove", {
        bubbles: true,
        buttons: 1,
        clientX: 100 + index,
        clientY: 200 + Math.sin(index / 20) * 50,
        isPrimary: true,
        pointerId,
        pointerType: "pen",
      }));
    }
    return (window as unknown as {
      __latencyProbe: { eventCount: number; renderSubmissionCount: number };
    }).__latencyProbe;
  });

  expect(beforeFrame.eventCount).toBe(500);
  expect(beforeFrame.renderSubmissionCount).toBe(0);
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
  const afterFrame = await page.evaluate(() =>
    (window as unknown as {
      __latencyProbe: { renderSubmissionCount: number };
    }).__latencyProbe.renderSubmissionCount,
  );
  expect(afterFrame).toBe(1);
});

test("batches and redraws retained CPU points without preserving the WebGL buffer", async ({ page }) => {
  await page.goto("/latency.html?mode=webgl-frame-no-preserve");

  const state = await page.evaluate(async () => {
    const pointerId = 101;
    document.body.dispatchEvent(new PointerEvent("pointerdown", {
      bubbles: true,
      button: 0,
      buttons: 1,
      clientX: 100,
      clientY: 200,
      isPrimary: true,
      pointerId,
      pointerType: "pen",
    }));
    for (let index = 1; index <= 500; index += 1) {
      document.body.dispatchEvent(new PointerEvent("pointermove", {
        bubbles: true,
        buttons: 1,
        clientX: 100 + index,
        clientY: 200 + Math.sin(index / 20) * 50,
        isPrimary: true,
        pointerId,
        pointerType: "pen",
      }));
    }
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    return (window as unknown as {
      __latencyProbe: {
        eventCount: number;
        renderSubmissionCount: number;
        preserveDrawingBufferActive: boolean;
      };
    }).__latencyProbe;
  });

  expect(state.eventCount).toBe(500);
  expect(state.renderSubmissionCount).toBe(1);
  expect(state.preserveDrawingBufferActive).toBe(false);
});
