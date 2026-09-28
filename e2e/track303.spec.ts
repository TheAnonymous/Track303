import { expect, test, type Page } from "@playwright/test";

const port = Number.parseInt(process.env.TRACK303_E2E_PORT ?? "4303", 10);

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.stack ?? error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  page.on("requestfailed", (request) => {
    // Closing the recording sheet removes its player, which aborts the player's own blob read.
    if (request.url().startsWith("blob:") && request.resourceType() === "media" && request.failure()?.errorText === "net::ERR_ABORTED") return;
    errors.push(`Request fehlgeschlagen: ${request.url()} (${request.failure()?.errorText ?? "?"})`);
  });
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
 * A real finger flick through Chrome's touch pipeline, so touch-action, pointer
 * events and flings behave as on the phone (a fling left running would swallow
 * the next tap; the app's drag surfaces prevent it).
 */
async function swipe(page: Page, x: number, y: number, dx: number, dy = 0): Promise<void> {
  const client = await page.context().newCDPSession(page);
  await client.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
  for (let step = 1; step <= 6; step += 1) {
    await client.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x + (dx * step) / 6, y: y + (dy * step) / 6 }] });
  }
  await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await client.detach();
}

/** Holds a finger on one spot for `ms`, as a long press. */
async function longPress(page: Page, x: number, y: number, ms = 650): Promise<void> {
  const client = await page.context().newCDPSession(page);
  await client.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
  await page.waitForTimeout(ms);
  await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await client.detach();
}

/** A slow thumb drag that ends at rest, as when dialling in a value. */
async function drag(page: Page, x: number, y: number, dx: number, dy: number): Promise<void> {
  const client = await page.context().newCDPSession(page);
  await client.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
  for (let step = 1; step <= 8; step += 1) {
    await client.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x + (dx * step) / 8, y: y + (dy * step) / 8 }] });
    await page.waitForTimeout(16);
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
  await page.locator("[data-pattern-menu]").tap();
  await page.locator("[data-help-open]").tap();
  await expect(page.locator(".help")).toBeVisible();
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

    await page.locator('[data-view="perform"]').tap();
    expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeLessThanOrEqual(740);
    for (const control of await page.locator(".perform button, .perform [role='slider']").all()) {
      const box = (await control.boundingBox())!;
      expect(box.x + box.width).toBeLessThanOrEqual(360);
      expect(box.y + box.height).toBeLessThanOrEqual(740);
    }
    expect((await page.locator("[data-xy]").boundingBox())!.height, "das Filter-Feld bleibt groß genug für den Daumen").toBeGreaterThanOrEqual(200);
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
  await swipe(page, bpm.x + bpm.width / 2, bpm.y + bpm.height / 2, 0, -56);
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

/** Puts a finger down and leaves it there; the returned function lifts it. */
async function hold(page: Page, x: number, y: number): Promise<{ move(toX: number, toY: number): Promise<void>; lift(): Promise<void> }> {
  const client = await page.context().newCDPSession(page);
  await client.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
  return {
    move: async (toX, toY) => {
      for (let step = 1; step <= 5; step += 1) {
        await client.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x + ((toX - x) * step) / 5, y: y + ((toY - y) * step) / 5 }] });
      }
      x = toX;
      y = toY;
    },
    lift: async () => {
      await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      await client.detach();
    },
  };
}

test("live view: the XY field plays cutoff and resonance and saves one undo step per gesture", async ({ page }) => {
  const errors = watchErrors(page);
  await open(page);
  await page.locator('[data-view="perform"]').tap();
  await expect(page.locator("[data-xy-readout]")).toHaveText("42 · 62");

  const xy = (await page.locator("[data-xy]").boundingBox())!;
  const finger = await hold(page, xy.x + xy.width / 2, xy.y + xy.height / 2);
  await expect(page.locator("[data-xy-readout]")).toHaveText("50 · 50");
  await finger.move(xy.x + xy.width * 0.9, xy.y + xy.height * 0.1);
  await expect(page.locator("[data-xy-readout]")).toHaveText("90 · 90");
  await expect(page.locator("[data-xy]")).toHaveClass(/touched/);
  await expect(page.locator("[data-undo]"), "gespeichert wird erst beim Loslassen").toBeDisabled();
  await finger.lift();
  await expect(page.locator("[data-xy]")).not.toHaveClass(/touched/);
  await expect(page.locator("[data-undo]")).toBeEnabled();

  await page.locator('[data-view="sound"]').tap();
  await expect(page.locator('[data-knob="cutoff"] output')).toHaveText("90");
  await expect(page.locator('[data-knob="resonance"] output')).toHaveText("90");
  await page.locator("[data-undo]").tap();
  await expect(page.locator('[data-knob="cutoff"] output')).toHaveText("42");
  await expect(page.locator('[data-knob="resonance"] output')).toHaveText("62");
  await expect(page.locator("[data-undo]"), "eine Geste, ein Schritt").toBeDisabled();

  await page.locator('[data-view="perform"]').tap();
  await page.locator('[data-live-knob="envMod"] input').fill("0.9");
  await page.locator('[data-live-knob="envMod"] input').dispatchEvent("change");
  await expect(page.locator('[data-live-knob="envMod"] output')).toHaveText("90");
  await page.reload();
  await page.locator('[data-view="perform"]').tap();
  await expect(page.locator('[data-live-knob="envMod"] output')).toHaveText("90");
  expect(errors).toEqual([]);
});

test("live view: mutes and the drop land on the bar line, the DJ filter springs back", async ({ page }) => {
  const errors = watchErrors(page);
  await open(page);
  await page.locator('[data-view="perform"]').tap();

  await page.locator('[data-mute="hh"]').tap();
  await expect(page.locator('[data-mute="hh"]'), "gestoppt schaltet sofort").toHaveAttribute("data-state", "muted");
  await page.locator('[data-mute="hh"]').tap();
  await expect(page.locator('[data-mute="hh"]')).toHaveAttribute("data-state", "on");

  await page.locator("[data-play]").tap();
  await expect(page.locator(".bar i.now")).toHaveCount(1);
  await page.locator('[data-mute="acid"]').tap();
  await expect(page.locator('[data-mute="acid"]')).toHaveAttribute("data-state", "pending");
  await expect(page.locator('[data-mute="acid"]'), "am nächsten Takt").toHaveAttribute("data-state", "muted", { timeout: 4_000 });
  await expect(page.locator('[data-mute="bd"].lit')).toHaveCount(1, { timeout: 4_000 });
  await expect.poll(async () => page.locator('[data-mute="acid"].lit').count(), { timeout: 3_000 }).toBe(0);

  const button = (await page.locator("[data-break]").boundingBox())!;
  const finger = await hold(page, button.x + button.width / 2, button.y + button.height / 2);
  await expect(page.locator("[data-break]")).toHaveAttribute("data-state", "break");
  await expect(page.locator("[data-break]")).toContainText("Loslassen");
  await page.waitForTimeout(2_000);
  await expect(page.locator('[data-mute="bd"].lit'), "im Break ist die Kick raus").toHaveCount(0);
  await finger.lift();
  await expect(page.locator("[data-break]")).toHaveAttribute("data-state", /drop|idle/);
  await expect(page.locator("[data-break]"), "Drop am nächsten Takt").toHaveAttribute("data-state", "idle", { timeout: 4_000 });

  const dj = (await page.locator("[data-dj]").boundingBox())!;
  const filterFinger = await hold(page, dj.x + dj.width / 2, dj.y + dj.height / 2);
  await filterFinger.move(dj.x + dj.width * 0.1, dj.y + dj.height / 2);
  await expect(page.locator("[data-dj]")).toHaveClass(/low/);
  expect(Number(await page.locator("[data-dj]").getAttribute("data-value"))).toBeLessThan(-60);
  await filterFinger.lift();
  await expect(page.locator("[data-dj]")).toHaveAttribute("data-value", "0");

  await page.locator("[data-play]").tap();
  await expect(page.locator(".bar i.now")).toHaveCount(0);
  await page.locator('[data-mute="acid"]').tap();
  await expect(page.locator('[data-mute="acid"]')).toHaveAttribute("data-state", "on");
  expect(errors).toEqual([]);
});

const entries = (page: Page) => page.locator("[data-song-entry]");

test("song view: pads write and append entries, swipe deletes, undo restores", async ({ page }) => {
  const errors = watchErrors(page);
  await open(page);
  await page.locator('[data-view="song"]').tap();
  await expect(page.locator("[data-song-summary]")).toHaveText("1 Eintrag · 1 Takt · 0:01");
  await expect(entries(page)).toHaveText([/P1/]);

  await page.locator("[data-song-end]").tap();
  await page.locator('[data-song-pad="1"]').tap();
  await page.locator('[data-song-pad="2"]').tap();
  await expect(entries(page)).toHaveText([/P1/, /P2/, /P3/]);
  await expect(page.locator("[data-song-end]")).toHaveClass(/cursor/);

  await entries(page).nth(1).tap();
  await page.locator('[data-song-pad="0"]').tap();
  await expect(entries(page)).toHaveText([/P1/, /P1/, /P3/]);
  await expect(entries(page).nth(2)).toHaveClass(/cursor/);
  await page.locator('[data-song-tool="repeat"]').tap();
  await expect(entries(page)).toHaveText([/P1/, /P1/, /P3/, /P3/]);
  await expect(page.locator("[data-song-summary]")).toContainText("4 Einträge · 4 Takte · 0:07");

  const first = (await entries(page).first().boundingBox())!;
  await swipe(page, first.x + first.width * 0.7, first.y + first.height / 2, -90, 3);
  await expect(entries(page)).toHaveText([/P1/, /P3/, /P3/]);
  await page.locator("[data-undo]").tap();
  await expect(entries(page)).toHaveText([/P1/, /P1/, /P3/, /P3/]);

  await page.reload();
  await page.locator('[data-view="song"]').tap();
  await expect(entries(page)).toHaveText([/P1/, /P1/, /P3/, /P3/]);
  expect(errors).toEqual([]);
});

test("song mode plays the song list in order and 'ab hier' starts at the chosen entry", async ({ page }) => {
  const errors = watchErrors(page);
  await open(page);
  // Pattern 2 becomes a copy of pattern 1, so both are audible.
  await page.locator("[data-pattern-menu]").tap();
  await page.locator('[data-pattern-action="copy"]').tap();
  await page.locator('[data-pattern="1"]').tap();
  await page.locator("[data-pattern-menu]").tap();
  await page.locator('[data-pattern-action="paste"]').tap();

  await page.locator('[data-view="song"]').tap();
  await page.locator("[data-song-end]").tap();
  await page.locator('[data-song-pad="1"]').tap();
  await expect(entries(page)).toHaveText([/P1/, /P2/]);

  await page.locator("[data-mode]").tap();
  await expect(page.locator("[data-mode]")).toHaveText(/SONG/);
  await page.locator("[data-play]").tap();
  await expect(entries(page).nth(0)).toHaveClass(/playhead/);
  await expect(page.locator('[data-pattern="0"]')).toHaveClass(/sounding/);
  await expect(entries(page).nth(1), "nach einem Takt kommt P2").toHaveClass(/playhead/, { timeout: 4_000 });
  await expect(page.locator('[data-pattern="1"]')).toHaveClass(/sounding/);
  await expect(entries(page).nth(0), "und dann wieder von vorn").toHaveClass(/playhead/, { timeout: 4_000 });

  await page.locator('[data-pattern="4"]').tap();
  await expect(page.locator(".pattern.queued"), "im Song-Modus zeigt ein Pattern-Tipp nur das Pattern").toHaveCount(0);

  await entries(page).nth(1).tap();
  await page.locator('[data-song-tool="play-from"]').tap();
  await expect(page.locator("[data-play]")).toHaveAttribute("aria-pressed", "true");
  await expect(entries(page).nth(1)).toHaveClass(/playhead/);
  await page.locator("[data-play]").tap();

  await page.locator("[data-mode]").tap();
  await expect(page.locator("[data-mode]")).toHaveText(/LOOP/);
  await page.locator('[data-pattern="0"]').tap();
  await page.locator("[data-play]").tap();
  await page.waitForTimeout(2_500);
  await expect(page.locator('[data-pattern="0"]'), "Loop bleibt auf dem Pattern").toHaveClass(/sounding/);
  await page.locator("[data-play]").tap();
  expect(errors).toEqual([]);
});

test("records the live play as a WAV to listen to, save or throw away", async ({ page }, testInfo) => {
  test.setTimeout(60_000);
  const errors = watchErrors(page);
  await open(page);
  await page.locator('[data-view="perform"]').tap();
  await page.locator("[data-play]").tap();
  await page.locator("[data-rec]").tap();
  await expect(page.locator("[data-rec]")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("[data-rec-indicator]"), "die Aufnahme ist auch oben sichtbar").toBeVisible();
  await expect(page.locator("[data-rec-time]")).not.toHaveText("0:00", { timeout: 5_000 });
  await page.waitForTimeout(1_200);
  await page.locator("[data-rec-indicator]").tap();
  await expect(page.locator("[data-take]")).toBeVisible();
  await expect(page.locator("[data-rec-indicator]")).toHaveCount(0);
  await expect(page.locator("[data-take] audio")).toHaveAttribute("src", /^blob:/);
  await expect(page.locator("[data-take-close]")).toHaveText("Verwerfen");
  await page.locator("[data-play]").tap();
  await expect(page.locator("[data-play]"), "Stopp bleibt über dem Blatt erreichbar").toHaveAttribute("aria-pressed", "false");
  await page.locator("[data-play]").tap();
  await expect(page.locator("[data-play]")).toHaveAttribute("aria-pressed", "true");
  await page.locator("[data-take] audio").evaluate((audio: HTMLAudioElement) => audio.play());
  await expect(page.locator("[data-play]"), "Anhören stoppt den Loop").toHaveAttribute("aria-pressed", "false");
  await page.locator("[data-take] audio").evaluate((audio: HTMLAudioElement) => audio.pause());

  const download = page.waitForEvent("download");
  await page.locator("[data-take-save]").tap();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/^track303-\d{4}-\d{2}-\d{2}-\d{4}\.wav$/);
  const path = testInfo.outputPath("live.wav");
  await file.saveAs(path);
  const { readFile } = await import("node:fs/promises");
  const wav = await readFile(path);
  expect(wav.subarray(0, 4).toString()).toBe("RIFF");
  expect(wav.readUInt16LE(22), "Stereo").toBe(2);
  expect(wav.readUInt32LE(40) / (wav.readUInt32LE(24) * 4), "mindestens anderthalb Sekunden").toBeGreaterThan(1.5);
  let peak = 0;
  for (let offset = 44; offset < wav.length; offset += 2) peak = Math.max(peak, Math.abs(wav.readInt16LE(offset)));
  expect(peak).toBeGreaterThan(2_000);

  await expect(page.locator("[data-take-close]")).toHaveText("Fertig");
  await page.locator("[data-take-close]").tap();
  await expect(page.locator("[data-take]")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("effects: the FX column opens the effect pads, values read in words, drums offer fewer", async ({ page }) => {
  const errors = watchErrors(page);
  await open(page);
  await page.locator('[data-focus-lane="acid"]').first().tap();
  await expect(page.locator(".head.columns")).toContainText("FX");
  const fx = (row: number, lane = "acid") => page.locator(`.cell[data-lane="${lane}"][data-row="${row}"][data-column="fx"]`);

  await fx(3).tap();
  await expect(page.locator(".where")).toContainText("Zeile 03");
  await expect(page.locator("[data-fx]")).toHaveText([/EC/, /DL/, /VL/, /GT/, /FL/, /AR/]);
  await expect(page.locator("[data-fx-value]").first()).toBeDisabled();
  await page.locator('[data-fx="AR"]').tap();
  await expect(fx(3)).toHaveText("AR2");
  await expect(page.locator("[data-fx-value]")).toHaveText([/Dreiklang/, /Quinte/, /Oktave/]);
  await page.locator('[data-fx-value="3"]').tap();
  await expect(fx(3)).toHaveText("AR3");
  await expect(page.locator("[data-cursor-value]")).toContainText("AR3");
  await page.locator('[data-fx="DL"]').tap();
  await expect(fx(3), "anderer Effekt, Stufe bleibt").toHaveText("DL3");
  await expect(page.locator('[data-fx-value="1"]')).toContainText("¼ Zeile");

  await fx(1).tap();
  await expect(page.locator('[data-fx="EC"]'), "leere Zeile nimmt keinen Effekt").toBeDisabled();

  await page.locator('[data-focus-lane="sd"]').tap();
  await fx(4, "sd").tap();
  await expect(page.locator("[data-fx]")).toHaveText([/EC/, /DL/, /VL/]);
  await page.locator('[data-fx="EC"]').tap();
  await page.locator("[data-fx-off]").tap();
  await expect(fx(4, "sd")).toHaveText("···");
  await page.locator("[data-undo]").tap();
  await expect(fx(4, "sd")).toHaveText("EC2");

  await page.locator('[data-editor-mode="notes"]').tap();
  await expect(page.locator('.pad[data-voice="clap"]')).toBeVisible();
  await page.locator('.pad[data-voice="snare"]').tap();
  await page.locator("[data-overview]").tap();
  await expect(cell(page, "sd", 4)).toContainText("SNR");
  await expect(cell(page, "sd", 4).locator(".depth"), "neue Stimme, Effekt bleibt").toBeVisible();
  await expect(cell(page, "acid", 3).locator(".depth")).toBeVisible();

  await page.reload();
  await page.locator('[data-focus-lane="acid"]').first().tap();
  await expect(fx(3)).toHaveText("DL3");
  expect(errors).toEqual([]);
});

test("projects: new, rename, switch, save as a file, open it again, delete", async ({ page }, testInfo) => {
  const errors = watchErrors(page);
  await open(page);
  const openProjects = async () => {
    await page.locator("[data-pattern-menu]").tap();
    await page.locator("[data-projects-open]").tap();
    await expect(page.locator("[data-projects]")).toBeVisible();
  };
  await openProjects();
  await page.locator("[data-project-name]").fill("Acid Nacht");
  await page.locator("[data-project-name]").press("Enter");
  await page.locator("[data-project-name]").dispatchEvent("change");
  await page.locator('[data-project-new="empty"]').tap();
  await expect(page.locator(".cell.on")).toHaveCount(0);

  await openProjects();
  await expect(page.locator(".project-open")).toHaveCount(2);
  await page.locator('[data-project="Acid Nacht"]').tap();
  await expect(cell(page, "bd", 0)).toContainText("KCK!");

  await openProjects();
  const download = page.waitForEvent("download");
  await page.locator("[data-project-save]").tap();
  const file = await download;
  expect(file.suggestedFilename()).toBe("acid-nacht.track303.json");
  const path = testInfo.outputPath("acid-nacht.track303.json");
  await file.saveAs(path);

  await page.locator("[data-projects-close]").tap();
  await openProjects();
  await page.locator("[data-project-file]").setInputFiles(path);
  await expect(page.locator(".notice")).toContainText("„Acid Nacht“ ist geöffnet");
  await expect(cell(page, "bd", 0)).toContainText("KCK!");
  await openProjects();
  await expect(page.locator(".project-open")).toHaveCount(3);

  await page.locator('[data-project-delete="Track 2"]').tap();
  await expect(page.locator('[data-project-delete="Track 2"]')).toHaveText("Wirklich?");
  await page.locator('[data-project-delete="Track 2"]').tap();
  await expect(page.locator(".project-open")).toHaveCount(2);

  await page.reload();
  await openProjects();
  await expect(page.locator(".project-open")).toHaveCount(2);
  await expect(page.locator(".project-list li.active")).toContainText("Acid Nacht");
  expect(errors).toEqual([]);
});

test("a phone call taking the sound stops playback cleanly and says so", async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto("./?audio-test=1");
  await page.locator("[data-help-close]").tap();
  await expect(page.locator("html")).toHaveAttribute("data-audio-test", "ready");
  await page.locator("[data-play]").tap();
  await expect(page.locator(".line.playhead")).toHaveCount(1);
  await page.evaluate(() => window.__track303AudioTest!.interruptLiveAudio());
  await expect(page.locator("[data-play]")).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator(".notice")).toContainText("unterbrochen");
  await page.locator("[data-play]").tap();
  await expect(page.locator(".line.playhead"), "Play startet wieder").toHaveCount(1);
  await page.locator("[data-play]").tap();
  expect(errors).toEqual([]);
});

test("the sound page switches the 303 between saw and square", async ({ page }) => {
  const errors = watchErrors(page);
  await open(page);
  await page.locator('[data-view="sound"]').tap();
  await expect(page.locator('[data-waveform="sawtooth"]')).toHaveAttribute("aria-pressed", "true");
  await page.locator('[data-waveform="square"]').tap();
  await expect(page.locator('[data-waveform="square"]')).toHaveAttribute("aria-pressed", "true");
  await page.locator('[data-acid-voice="venom"]').tap();
  await expect(page.locator('[data-waveform="sawtooth"]'), "eine Stimme bringt ihre Wellenform mit").toHaveAttribute("aria-pressed", "true");
  await page.locator('[data-acid-voice="rubber"]').tap();
  await expect(page.locator('[data-waveform="square"]')).toHaveAttribute("aria-pressed", "true");
  await page.reload();
  await page.locator('[data-view="sound"]').tap();
  await expect(page.locator('[data-waveform="square"]')).toHaveAttribute("aria-pressed", "true");
  expect(errors).toEqual([]);
});

test("dice roll a new 303 line and new drums, and undo brings the old ones back", async ({ page }) => {
  const errors = watchErrors(page);
  await open(page);
  const acidText = () => page.locator('.cell[data-lane="acid"]').allInnerTexts();
  const before = await acidText();
  let changed = false;
  for (let attempt = 0; attempt < 3 && !changed; attempt += 1) {
    await page.locator("[data-pattern-menu]").tap();
    await page.locator('[data-roll="acid"]').tap();
    changed = JSON.stringify(await acidText()) !== JSON.stringify(before);
  }
  expect(changed).toBe(true);
  await expect(cell(page, "acid", 0)).toContainText(/A-2/);
  await expect(page.locator(".notice")).toContainText("↶");

  await page.locator("[data-pattern-menu]").tap();
  await page.locator('[data-roll="drums"]').tap();
  for (const row of [0, 4, 8, 12]) await expect(cell(page, "bd", row)).toContainText("KCK");

  await page.locator("[data-undo]").tap();
  await page.locator("[data-undo]").tap();
  let undone = false;
  for (let step = 0; step < 3 && !undone; step += 1) {
    undone = JSON.stringify(await acidText()) === JSON.stringify(before);
    if (!undone) await page.locator("[data-undo]").tap();
  }
  expect(undone).toBe(true);
  expect(errors).toEqual([]);
});

test("the song renders to a WAV faster than real time", async ({ page }, testInfo) => {
  test.setTimeout(60_000);
  const errors = watchErrors(page);
  await open(page);
  await page.locator('[data-view="song"]').tap();
  await page.locator("[data-song-end]").tap();
  await page.locator('[data-song-pad="0"]').tap();
  await expect(page.locator("[data-song-summary]")).toContainText("2 Takte");
  const started = Date.now();
  await page.locator("[data-song-export]").tap();
  await expect(page.locator("[data-take] #take-title")).toContainText("Song", { timeout: 20_000 });
  expect(Date.now() - started, "schneller als die 3,5 s Musik").toBeLessThan(10_000);
  const download = page.waitForEvent("download");
  await page.locator("[data-take-save]").tap();
  const file = await download;
  expect(file.suggestedFilename()).toBe("mein-track-song.wav");
  const path = testInfo.outputPath("song.wav");
  await file.saveAs(path);
  const { readFile } = await import("node:fs/promises");
  const wav = await readFile(path);
  const seconds = wav.readUInt32LE(40) / (wav.readUInt32LE(24) * 4);
  // Two bars at 136 BPM are 3.53 s; the tail rings out a little after.
  expect(seconds).toBeGreaterThan(3.5);
  expect(seconds).toBeLessThan(7);
  let peak = 0;
  for (let offset = 44; offset < wav.length; offset += 2) peak = Math.max(peak, Math.abs(wav.readInt16LE(offset)));
  expect(peak).toBeGreaterThan(4_000);
  expect(peak).toBeLessThan(32_767);
  await page.locator("[data-take-close]").tap();
  expect(errors).toEqual([]);
});

test("long press marks a block: fill, copy, paste, transpose and shift it", async ({ page }) => {
  const errors = watchErrors(page);
  await open(page);
  await page.locator('[data-pattern="1"]').tap();
  const hat0 = await center(page, "hh", 0);
  await longPress(page, hat0.x, hat0.y);
  await expect(page.locator(".selection-bar")).toBeVisible();
  await expect(page.locator("[data-selection-summary]")).toContainText("HH · Zeile 00–00");
  await cell(page, "hh", 15).tap();
  await expect(page.locator(".selection-bar")).toContainText("16 Zeilen");
  await expect(page.locator(".cell.selected")).toHaveCount(16);
  await page.locator('[data-block="fill"]').tap();
  await page.locator('[data-fill="2"]').tap();
  await expect(page.locator('.cell[data-lane="hh"].on')).toHaveCount(8);
  await expect(cell(page, "hh", 2)).toContainText("CHH");
  await expect(cell(page, "hh", 1)).toContainText("···");

  await page.locator('[data-block="copy"]').tap();
  await page.locator('[data-block="done"]').tap();
  await expect(page.locator(".selection-bar")).toHaveCount(0);
  await page.locator('[data-pattern="2"]').tap();
  const target = await center(page, "hh", 0);
  await longPress(page, target.x, target.y);
  await page.locator('[data-block="paste"]').tap();
  await expect(page.locator('.cell[data-lane="hh"].on')).toHaveCount(8);
  await page.locator('[data-block="down"]').tap();
  await expect(cell(page, "hh", 1)).toContainText("CHH");
  await expect(cell(page, "hh", 0)).toContainText("···");
  await page.locator('[data-block="done"]').tap();

  await page.locator('[data-pattern="0"]').tap();
  const acid = await center(page, "acid", 0);
  await longPress(page, acid.x, acid.y);
  await cell(page, "acid", 3).tap();
  await page.locator('[data-block="tone-up"]').tap();
  await expect(cell(page, "acid", 0)).toContainText("B-2");
  await page.locator('[data-block="octave-up"]').tap();
  await expect(cell(page, "acid", 0)).toContainText("B-3");
  await page.locator("[data-undo]").tap();
  await page.locator("[data-undo]").tap();
  await expect(cell(page, "acid", 0)).toContainText("A-2");
  expect(errors).toEqual([]);
});

test("in the focus view a thumb drag on a note moves it through the scale", async ({ page }) => {
  const errors = watchErrors(page);
  await open(page);
  await page.locator('[data-focus-lane="acid"]').first().tap();
  const note = page.locator('.cell[data-lane="acid"][data-row="0"][data-column="main"]');
  await expect(note).toContainText("A-2");
  const box = (await note.boundingBox())!;
  await drag(page, box.x + box.width / 2, box.y + box.height / 2, 0, -40);
  await expect(note, "zwei Stufen höher: A → B → C").toContainText("C-3");
  await drag(page, box.x + box.width / 2, box.y + box.height / 2, 0, 20);
  await expect(note).toContainText("B-2");
  await page.locator("[data-undo]").tap();
  await expect(note).toContainText("C-3");
  await page.locator("[data-undo]").tap();
  await expect(note, "eine Geste, ein Schritt").toContainText("A-2");
  expect(errors).toEqual([]);
});

test("installs as an app: manifest and icons load, and after one visit it starts offline", async ({ page, context }) => {
  const errors = watchErrors(page);
  await open(page);
  const manifestUrl = await page.locator('link[rel="manifest"]').getAttribute("href");
  const manifest = await (await page.request.get(manifestUrl!)).json() as { start_url: string; scope: string; display: string; icons: { src: string; sizes: string; purpose: string }[] };
  expect(manifest).toMatchObject({ start_url: "/Track303/", scope: "/Track303/", display: "standalone" });
  expect(manifest.icons.map((icon) => `${icon.sizes} ${icon.purpose}`)).toEqual(["192x192 any", "512x512 any", "512x512 maskable"]);
  for (const icon of manifest.icons) {
    const response = await page.request.get(new URL(icon.src, new URL(manifestUrl!, page.url())).href);
    expect(response.headers()["content-type"]).toBe("image/png");
  }
  expect(await page.evaluate(() => getComputedStyle(document.querySelector(".play")!).borderRadius), "eckige Knöpfe").toBe("0px");

  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 10_000 });
  await cell(page, "acid", 1).tap();
  await page.locator('.pad[data-degree="4"]').tap();
  await expect(cell(page, "acid", 1)).toContainText("E-3");

  await context.setOffline(true);
  await page.reload();
  await expect(page.locator(".grid"), "offline aus dem Speicher des Handys").toBeVisible();
  await expect(cell(page, "acid", 1)).toContainText("E-3");
  await page.locator("[data-play]").tap();
  await expect(page.locator(".line.playhead")).toHaveCount(1);
  await page.locator("[data-play]").tap();
  await context.setOffline(false);
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

  const held = await page.evaluate(() => window.__track303AudioTest!.render(["bd"], 2, {}, { break: true }));
  expect(held.peak, "im Break schweigt die Kick").toBeLessThan(0.001);
  const breakMix = await page.evaluate(() => window.__track303AudioTest!.render(undefined, 4, {}, { break: true }));
  expect(breakMix.nonFinite).toBe(0);
  expect(breakMix.peak, "303 und Hats laufen im Break weiter").toBeGreaterThan(0.05);

  const loud = await page.evaluate(() => window.__track303AudioTest!.render(["hh"], 2));
  const ghost = await page.evaluate(() => window.__track303AudioTest!.render(["hh"], 2, {}, { fx: { hh: { type: "VL", value: 1 } } }));
  expect(ghost.peak / loud.peak, "VL1 spielt die Hats deutlich leiser").toBeLessThan(0.5);
  const dry = await page.evaluate(() => window.__track303AudioTest!.render(["sd"], 4));
  const echoed = await page.evaluate(() => window.__track303AudioTest!.render(["sd"], 4, {}, { fx: { sd: { type: "EC", value: 3 } } }));
  expect(echoed.activeShare, "EC3 lässt die Claps nachhallen").toBeGreaterThan(dry.activeShare * 1.5);
  const square = await page.evaluate(() => window.__track303AudioTest!.render(["acid"], 2, { resonance: 1, drive: 1 }, { waveform: "square" }));
  expect(square.nonFinite).toBe(0);
  expect(square.peak, "Rechteck bleibt unter 0 dBFS").toBeLessThanOrEqual(1);
  expect(square.peak).toBeGreaterThan(0.05);
  for (const type of ["DL", "GT", "FL", "AR"] as const) {
    const metrics = await page.evaluate((fx) => window.__track303AudioTest!.render(["acid"], 2, {}, { fx: { acid: { type: fx, value: 3 } } }), type);
    expect(metrics.nonFinite, type).toBe(0);
    expect(metrics.peak, `${type} bleibt hörbar und unter 0 dBFS`).toBeGreaterThan(0.05);
    expect(metrics.peak, type).toBeLessThanOrEqual(1);
  }

  const nodes = await page.evaluate(() => window.__track303AudioTest!.countEngineNodes());
  expect(nodes.total).toBeLessThanOrEqual(240);
  expect(nodes.constantSources).toBeLessThanOrEqual(8);
  expect(errors).toEqual([]);
});

test("offers no audio test hook without the local query", async ({ page }) => {
  await page.goto("./");
  expect(await page.evaluate(() => window.__track303AudioTest)).toBeUndefined();
});
