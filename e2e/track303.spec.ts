import { expect, test, type Page } from "@playwright/test";

const port = Number.parseInt(process.env.TRACK303_E2E_PORT ?? "4303", 10);

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.stack ?? error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  page.on("requestfailed", (request) => errors.push(`Request fehlgeschlagen: ${request.url()}`));
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.protocol.startsWith("http") && url.origin !== `http://127.0.0.1:${port}`) errors.push(`Externer Request: ${request.url()}`);
  });
  return errors;
}

async function open(page: Page): Promise<void> {
  await page.goto("./");
  await page.locator("[data-help-close]").tap();
  await expect(page.locator(".help")).toHaveCount(0);
}

const cell = (page: Page, lane: string, row: number) => page.locator(`.cell[data-lane="${lane}"][data-row="${row}"]`).first();

/**
 * A real finger swipe through Chrome's touch pipeline, so touch-action and pointer
 * events behave as on the phone. A quick flick leaves a fling running, and Chrome
 * spends the next tap on stopping it, as on a real phone; `settle` rests the finger
 * before lifting it, as when dialling in a value.
 */
async function swipe(page: Page, x: number, y: number, dx: number, dy = 0, settle = false): Promise<void> {
  const client = await page.context().newCDPSession(page);
  await client.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
  for (let step = 1; step <= 6; step += 1) {
    await client.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x + (dx * step) / 6, y: y + (dy * step) / 6 }] });
  }
  if (settle) {
    await page.waitForTimeout(150);
    await client.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x + dx, y: y + dy }] });
  }
  await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await client.detach();
}

async function center(page: Page, lane: string, row: number): Promise<{ x: number; y: number }> {
  const box = (await cell(page, lane, row).boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    // The site's own audio and vibration are fine; a test page just must not buzz the host.
    Object.defineProperty(navigator, "vibrate", { value: () => true, configurable: true });
  });
});

test("fits a Pixel 7 without scrolling the page and shows the whole 16-row pattern", async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto("./");
  await expect(page.locator(".help")).toBeVisible();
  await page.locator("[data-help-close]").tap();

  const viewport = page.viewportSize()!;
  const size = await page.evaluate(() => ({ width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight }));
  expect(size.width).toBeLessThanOrEqual(viewport.width);
  expect(size.height).toBeLessThanOrEqual(viewport.height);

  for (const row of [0, 15]) {
    const box = (await cell(page, "acid", row).boundingBox())!;
    expect(box.y).toBeGreaterThan(0);
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
    expect(box.height, "Zeilen bleiben daumengroß").toBeGreaterThanOrEqual(28);
  }
  const editor = (await page.locator(".editor").boundingBox())!;
  expect(editor.y + editor.height).toBeLessThanOrEqual(viewport.height + 1);
  for (const pad of await page.locator(".pad").all()) expect((await pad.boundingBox())!.height).toBeGreaterThanOrEqual(48);

  await expect(cell(page, "bd", 0)).toContainText("KCK");
  await expect(cell(page, "acid", 0)).toContainText("A-2!");
  expect(errors).toEqual([]);

  await page.reload();
  await expect(page.locator(".grid")).toBeVisible();
  await expect(page.locator(".help"), "die Hilfe kommt nur beim ersten Besuch").toHaveCount(0);
});

test.describe("on a 360 px wide phone", () => {
  test.use({ viewport: { width: 360, height: 740 } });

  test("keeps every control inside the screen", async ({ page }) => {
    await open(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
    for (const control of await page.locator(".topbar button, .topbar [role='spinbutton'], .patterns button, .editor button").all()) {
      const box = (await control.boundingBox())!;
      expect(box.x, await control.innerText()).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width, await control.innerText()).toBeLessThanOrEqual(360);
      expect(await control.evaluate((element) => element.scrollWidth <= element.clientWidth), `${await control.innerText()} ist nicht abgeschnitten`).toBe(true);
    }
    expect((await page.locator("[data-octave]").boundingBox())!.height, "Okt 2 bleibt einzeilig").toBeLessThan(22);
    await cell(page, "acid", 15).scrollIntoViewIfNeeded();
    await expect(cell(page, "acid", 15)).toBeInViewport();
  });
});

test("writes notes with the thumb pad, moves on, and keeps them after a reload", async ({ page }) => {
  const errors = watchErrors(page);
  await open(page);
  await page.locator('[data-pattern="1"]').tap();
  await cell(page, "acid", 0).tap();
  await expect(page.locator(".where")).toContainText("303 · Zeile 00");

  await page.locator('.pad[data-degree="2"]').tap();
  await expect(cell(page, "acid", 0)).toContainText("C-3");
  await expect(page.locator(".where")).toContainText("Zeile 01");

  await page.getByRole("button", { name: "Oktave höher" }).tap();
  await expect(page.locator("[data-octave]")).toHaveText("Okt 3");
  await page.locator('.pad[data-degree="0"]').tap();
  await expect(cell(page, "acid", 1)).toContainText("A-3");

  await cell(page, "acid", 1).tap();
  await page.locator('[data-tool="accent"]').tap();
  await page.locator('[data-tool="slide"]').tap();
  await expect(cell(page, "acid", 1)).toContainText("A-3!~");

  await page.locator('[data-tool="step"]').tap();
  await expect(page.locator('[data-tool="step"]')).toContainText("2");
  await cell(page, "bd", 4).tap();
  await page.locator('.pad[data-voice="kick"]').tap();
  await expect(cell(page, "bd", 4)).toContainText("KCK");
  await expect(page.locator(".where")).toContainText("Zeile 06");

  await cell(page, "sd", 6).tap();
  await expect(page.locator('.pad[data-voice]')).toHaveText(["Snare", "Clap", "Tom"]);
  await page.locator('.pad[data-voice="tom"]').tap();
  await expect(cell(page, "sd", 6)).toContainText("TOM");

  await page.reload();
  await expect(page.locator('[data-pattern="1"]')).toHaveAttribute("aria-pressed", "true");
  await expect(cell(page, "acid", 0)).toContainText("C-3");
  await expect(cell(page, "acid", 1)).toContainText("A-3!~");
  await expect(cell(page, "bd", 4)).toContainText("KCK");
  await expect(cell(page, "sd", 6)).toContainText("TOM");
  expect(errors).toEqual([]);
});

test("double tap repeats the lane's last value, swipe left deletes, undo brings it back", async ({ page }) => {
  const errors = watchErrors(page);
  await open(page);
  await page.locator('[data-pattern="2"]').tap();

  await cell(page, "hh", 0).tap();
  await page.locator('.pad[data-voice="openHat"]').tap();
  await expect(cell(page, "hh", 0)).toContainText("OHH");

  const target = await center(page, "hh", 5);
  await page.touchscreen.tap(target.x, target.y);
  await page.touchscreen.tap(target.x, target.y);
  await expect(cell(page, "hh", 5)).toContainText("OHH");

  const empty = await center(page, "acid", 3);
  await page.touchscreen.tap(empty.x, empty.y);
  await page.touchscreen.tap(empty.x, empty.y);
  await expect(cell(page, "acid", 3), "ohne letzten Wert kommt der Grundton").toContainText("A-2");

  const hat = await center(page, "hh", 5);
  await swipe(page, hat.x + 20, hat.y, -70, 4);
  await expect(cell(page, "hh", 5)).toContainText("···");

  const note = await center(page, "acid", 3);
  await swipe(page, note.x, note.y, -8, -60);
  await expect(cell(page, "acid", 3), "senkrechtes Wischen löscht nichts").toContainText("A-2");

  await page.locator("[data-undo]").tap();
  await expect(cell(page, "hh", 5)).toContainText("OHH");
  await page.locator("[data-redo]").tap();
  await expect(cell(page, "hh", 5)).toContainText("···");
  expect(errors).toEqual([]);
});

test("lane focus shows every column and taps on them change the row", async ({ page }) => {
  const errors = watchErrors(page);
  await open(page);
  await page.locator('[data-focus-lane="acid"]').first().tap();
  await expect(page.locator(".head.columns")).toContainText("Note");
  await expect(page.locator(".head.columns")).toContainText("Sld");

  const accent = page.locator('.cell[data-lane="acid"][data-row="2"][data-column="accent"]');
  await expect(accent).toHaveText("·");
  await accent.tap();
  await expect(accent).toHaveText("!");

  const chance = page.locator('.cell[data-lane="acid"][data-row="2"][data-column="chance"]');
  await chance.tap();
  await expect(chance).toHaveText("75");
  const ratchet = page.locator('.cell[data-lane="acid"][data-row="2"][data-column="ratchet"]');
  await ratchet.tap();
  await ratchet.tap();
  await expect(ratchet).toHaveText("×3");
  await expect(page.locator('[data-tool="chance"]')).toContainText("75 %");

  await page.locator('[data-focus-lane="bd"]').tap();
  await expect(page.locator(".head.columns")).not.toContainText("Sld");
  await page.locator("[data-overview]").tap();
  await expect(cell(page, "acid", 2)).toContainText("A-3!");
  await expect(cell(page, "acid", 2).locator(".depth")).toBeVisible();
  expect(errors).toEqual([]);
});

test("plays the loop, follows the playhead and switches patterns at the end of the loop", async ({ page }) => {
  const errors = watchErrors(page);
  await page.addInitScript(() => {
    const Native = window.AudioContext;
    const created: { hint: string; context: AudioContext }[] = [];
    (window as unknown as { audioContexts: typeof created }).audioContexts = created;
    window.AudioContext = class extends Native {
      constructor(options?: AudioContextOptions) {
        super(options);
        created.push({ hint: String(options?.latencyHint ?? "default"), context: this });
      }
    };
  });
  await open(page);
  /** Contexts that are still open, by latency hint. */
  const contexts = () => page.evaluate(() => (window as unknown as { audioContexts: { hint: string; context: AudioContext }[] }).audioContexts
    .filter(({ context }) => context.state !== "closed").map(({ hint }) => hint));
  await cell(page, "bd", 0).tap();
  await expect.poll(contexts, "ein einziger offener Audio-Kontext, mit größerem Puffer fürs Handy").toEqual(["balanced"]);
  await page.locator("[data-play]").tap();
  await expect(page.locator("[data-play]")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".line.playhead")).toHaveCount(1);
  const first = Number(await page.locator(".line.playhead").getAttribute("data-row-line"));
  await expect.poll(async () => Number(await page.locator(".line.playhead").getAttribute("data-row-line"))).not.toBe(first);
  await expect(page.locator(".lanehead.lit").first()).toBeVisible();

  await page.locator('[data-pattern="1"]').tap();
  await expect(page.locator('[data-pattern="1"]')).toHaveClass(/queued/);
  await expect(page.locator('[data-pattern="0"]')).toHaveClass(/sounding/);
  await expect(page.locator('[data-pattern="1"]')).toHaveClass(/sounding/, { timeout: 10_000 });
  await expect(page.locator('[data-pattern="1"]')).not.toHaveClass(/queued/);

  await page.locator("[data-play]").tap();
  await expect(page.locator("[data-play]")).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator(".line.playhead")).toHaveCount(0);
  expect(await contexts()).toEqual(["balanced"]);
  expect(errors).toEqual([]);
});

test("the sound page turns the 303 knobs, sets tempo by drag and saves both", async ({ page }) => {
  const errors = watchErrors(page);
  await open(page);

  const bpm = (await page.getByRole("spinbutton", { name: "BPM" }).boundingBox())!;
  await swipe(page, bpm.x + bpm.width / 2, bpm.y + bpm.height / 2, 0, -56, true);
  await expect(page.getByRole("spinbutton", { name: "BPM" })).toHaveAttribute("aria-valuenow", "144");

  await page.locator('[data-view="sound"]').tap();
  const cutoff = page.locator('[data-knob="cutoff"] input');
  await cutoff.fill("0.8");
  await expect(page.locator('[data-knob="cutoff"] output')).toHaveText("80");
  await page.locator('[data-acid-voice="venom"]').tap();
  await page.locator('[data-kit="rumble"]').tap();
  await page.locator('[data-scale="phrygian"]').tap();
  await page.locator('[data-setting="root"]').selectOption("E");
  await page.locator("[data-undo]").tap();
  await expect(page.locator('[data-setting="root"]')).toHaveValue("A");
  await page.locator("[data-redo]").tap();
  await expect(page.locator('[data-setting="root"]')).toHaveValue("E");

  await page.reload();
  await page.locator('[data-view="sound"]').tap();
  await expect(page.locator('[data-knob="cutoff"] output')).toHaveText("80");
  await expect(page.locator('[data-acid-voice="venom"]')).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator('[data-kit="rumble"]')).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("spinbutton", { name: "BPM" })).toHaveAttribute("aria-valuenow", "144");
  await expect(page.locator("[data-app-version]")).toContainText(/lokaler Build|Version [0-9a-f]{7}/);

  await page.locator('[data-view="pattern"]').tap();
  await expect(page.locator(".pad[data-degree]")).toHaveText(["E", "F", "G", "A", "B", "C", "D"]);
  await expect(cell(page, "acid", 0)).toContainText("E-2!");
  await expect(page.locator("[data-undo]"), "der Verlauf gilt nur für die laufende Sitzung").toBeDisabled();
  expect(errors).toEqual([]);
});

test("pattern tools copy, paste, double and clear a pattern", async ({ page }) => {
  const errors = watchErrors(page);
  await open(page);
  await page.locator("[data-pattern-menu]").tap();
  await page.locator('[data-pattern-action="copy"]').tap();
  await page.locator('[data-pattern="4"]').tap();
  await expect(cell(page, "bd", 0)).toContainText("···");
  await page.locator("[data-pattern-menu]").tap();
  await page.locator('[data-pattern-action="paste"]').tap();
  await expect(cell(page, "bd", 0)).toContainText("KCK!");

  await page.locator("[data-pattern-menu]").tap();
  await page.locator('[data-rows="32"]').tap();
  await expect(page.locator(".line")).toHaveCount(32);
  await expect(cell(page, "bd", 16)).toContainText("KCK!");
  await cell(page, "acid", 31).scrollIntoViewIfNeeded();
  await expect(cell(page, "acid", 31)).toBeInViewport();

  await page.locator("[data-pattern-menu]").tap();
  await page.locator('[data-pattern-action="clear"]').tap();
  await expect(page.locator(".cell.on")).toHaveCount(0);
  await page.locator('[data-pattern="0"]').tap();
  await expect(cell(page, "bd", 0)).toContainText("KCK!");
  expect(errors).toEqual([]);
});

test("renders the starter groove offline with every lane audible and a lean audio graph", async ({ page }) => {
  test.setTimeout(120_000);
  const errors = watchErrors(page);
  await page.goto("./?audio-test=1");
  await expect(page.locator("html")).toHaveAttribute("data-audio-test", "ready");

  const all = await page.evaluate(() => window.__track303AudioTest!.render());
  expect(all.nonFinite).toBe(0);
  expect(all.peak).toBeLessThanOrEqual(1);
  expect(all.peak).toBeGreaterThan(0.2);
  expect(all.rmsDb).toBeGreaterThan(-20);
  expect(all.activeShare).toBeGreaterThan(0.9);

  for (const lane of ["bd", "sd", "hh", "acid"] as const) {
    const alone = await page.evaluate((name) => window.__track303AudioTest!.render([name]), lane);
    expect(alone.nonFinite, lane).toBe(0);
    expect(alone.peak, `${lane} ist hörbar`).toBeGreaterThan(0.03);
  }

  const open = await page.evaluate(() => window.__track303AudioTest!.render(["acid"], 4, { cutoff: 1, resonance: 1, envMod: 1, drive: 1 }));
  expect(open.nonFinite).toBe(0);
  expect(open.peak, "voll aufgedrehte 303 bleibt unter 0 dBFS").toBeLessThanOrEqual(1);

  const nodes = await page.evaluate(() => window.__track303AudioTest!.countEngineNodes());
  expect(nodes.total).toBeLessThanOrEqual(240);
  expect(nodes.constantSources).toBeLessThanOrEqual(8);
  expect(errors).toEqual([]);
});

test("offers no audio test hook without the local query", async ({ page }) => {
  await page.goto("./");
  expect(await page.evaluate(() => window.__track303AudioTest)).toBeUndefined();
});
