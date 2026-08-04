import { expect, test } from "@playwright/test";

const modes = ["canvas", "opaque", "desync", "svg", "dom"] as const;

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
        };
      }).__latencyProbe,
    );
    expect(state.mode).toBe(mode);
    expect(state.eventCount).toBeGreaterThan(0);
    expect(state.drawCount).toBeGreaterThan(0);
    if (mode === "desync" && browserName === "chromium") {
      expect(state.desynchronizedActive).toBe(true);
    }

    if (mode === "svg") {
      expect((await page.locator("polyline").getAttribute("points"))?.length).toBeGreaterThan(20);
    } else if (mode === "dom") {
      expect(await page.locator(".dom-segment").count()).toBeGreaterThan(0);
    } else {
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
