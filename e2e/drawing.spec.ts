import { expect, test } from "@playwright/test";

interface PixelCounts {
  black: number;
  red: number;
}

async function drawCircle(page: import("@playwright/test").Page, pointCount = 64): Promise<void> {
  const center = { x: 400, y: 300 };
  const radius = 120;
  await page.mouse.move(center.x + radius, center.y);
  await page.mouse.down();
  for (let index = 1; index <= pointCount; index += 1) {
    const angle = (index / pointCount) * Math.PI * 2;
    await page.mouse.move(
      center.x + radius * Math.cos(angle),
      center.y + radius * Math.sin(angle),
    );
  }
  await page.mouse.up();
}

async function countResultPixels(page: import("@playwright/test").Page): Promise<PixelCounts> {
  return page.locator("#result-canvas").evaluate((canvas: HTMLCanvasElement) => {
    const context = canvas.getContext("2d");
    if (context === null) return { black: 0, red: 0 };
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let black = 0;
    let red = 0;
    for (let index = 0; index < pixels.length; index += 4) {
      const r = pixels[index]!;
      const g = pixels[index + 1]!;
      const b = pixels[index + 2]!;
      const alpha = pixels[index + 3]!;
      if (alpha > 20 && r < 90 && g < 90 && b < 90) black += 1;
      if (alpha > 20 && r > 80 && r > g * 1.5 && r > b * 1.5) red += 1;
    }
    return { black, red };
  });
}

test("draws a visible stroke and fitted circle without page errors", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await page.goto("/");
  await expect(page.locator("#input-canvas")).toBeVisible();
  await drawCircle(page);

  await expect.poll(() => countResultPixels(page)).toEqual(
    expect.objectContaining({
      black: expect.any(Number),
      red: expect.any(Number),
    }),
  );
  const counts = await countResultPixels(page);
  expect(counts.black, "hand-drawn black pixels").toBeGreaterThan(20);
  expect(counts.red, "fitted-circle red pixels").toBeGreaterThan(20);
  expect(pageErrors).toEqual([]);
});

test.describe("browser input performance", () => {
  test.skip(({ browserName }) => browserName !== "chromium", "Measured once in Chromium");

  test("processes a dense synthetic input stream within the browser budget", async ({
    page,
  }, testInfo) => {
    await page.goto("/");

    const durationMs = await page.locator("#input-canvas").evaluate((canvas: HTMLCanvasElement) => {
      const pointerId = 1;
      const dispatch = (type: string, x: number, y: number, buttons: number): void => {
        const event = new PointerEvent(type, {
          bubbles: true,
          button: type === "pointerdown" || type === "pointerup" ? 0 : -1,
          buttons,
          clientX: x,
          clientY: y,
          isPrimary: true,
          pointerId,
          pointerType: "mouse",
        });
        if (type === "pointermove") {
          Object.defineProperty(event, "getCoalescedEvents", { value: () => [event] });
        }
        canvas.dispatchEvent(event);
      };

      dispatch("pointerdown", 600, 300, 1);
      const startedAt = performance.now();
      const pointCount = 2_000;
      for (let index = 1; index <= pointCount; index += 1) {
        const angle = (index / pointCount) * Math.PI * 2;
        dispatch("pointermove", 400 + 200 * Math.cos(angle), 300 + 200 * Math.sin(angle), 1);
      }
      dispatch("pointerup", 600, 300, 0);
      return performance.now() - startedAt;
    });

    testInfo.annotations.push({
      type: "performance",
      description: `2,000 browser pointer events: ${durationMs.toFixed(2)} ms (budget: 500 ms)`,
    });
    expect(durationMs).toBeLessThan(500);
  });
});
