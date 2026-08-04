import { expect, test } from "@playwright/test";

interface ExperimentState {
  readonly mode: "baseline" | "cursor";
  readonly customCursorEnabled: boolean;
  readonly hardwareCursorVisible: boolean;
  readonly eventCount: number;
  readonly cursorDrawCount: number;
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
  await page.mouse.move(420, 310);

  await expect(page.locator("#input-canvas")).toHaveCSS("cursor", "none");
  await expect.poll(() => countDarkPixels(page, "#cursor-canvas")).toBeGreaterThan(10);
  expect(await getState(page)).toEqual(expect.objectContaining({
    mode: "cursor",
    customCursorEnabled: true,
    hardwareCursorVisible: false,
    eventCount: expect.any(Number),
    cursorDrawCount: expect.any(Number),
  }));
});

test("can show both cursors for relative-lag measurement", async ({ page }) => {
  await page.goto("/experiment.html?mode=cursor&hardwareCursor=1");
  await page.mouse.move(420, 310);

  await expect(page.locator("#input-canvas")).toHaveCSS("cursor", "crosshair");
  await expect.poll(() => countDarkPixels(page, "#cursor-canvas")).toBeGreaterThan(10);
  expect(await getState(page)).toEqual(expect.objectContaining({
    customCursorEnabled: true,
    hardwareCursorVisible: true,
  }));
});
