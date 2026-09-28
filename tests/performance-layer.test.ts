import { describe, expect, it } from "vitest";
import { PerformanceLayer } from "../src/sound/performance-layer";

describe("PerformanceLayer", () => {
  it("mutes at once while stopped", () => {
    const layer = new PerformanceLayer();
    expect(layer.toggleMute("acid", false)).toBe(false);
    expect(layer.silences("acid")).toBe(true);
    expect(layer.state.muted).toEqual(["acid"]);
    layer.toggleMute("acid", false);
    expect(layer.silences("acid")).toBe(false);
  });

  it("waits for the bar line while playing, and a second tap takes the request back", () => {
    const layer = new PerformanceLayer();
    expect(layer.toggleMute("hh", true)).toBe(true);
    expect(layer.silences("hh")).toBe(false);
    expect(layer.state.pending).toEqual(["hh"]);
    layer.toggleMute("hh", true);
    expect(layer.state.pending).toEqual([]);
    layer.toggleMute("hh", true);
    layer.toggleMute("bd", true);
    expect(layer.barLine()).toEqual({ drop: false, changed: true });
    expect(layer.state).toEqual({ muted: ["bd", "hh"], pending: [], breakActive: false, dropPending: false });
    expect(layer.barLine().changed).toBe(false);
    layer.toggleMute("bd", true);
    expect(layer.silences("bd")).toBe(true);
    layer.barLine();
    expect(layer.silences("bd")).toBe(false);
  });

  it("holds the kick out during a break and drops on the next bar line", () => {
    const layer = new PerformanceLayer();
    expect(layer.setBreak(true, true)).toBe("rise");
    expect(layer.setBreak(true, true)).toBeNull();
    expect(layer.silences("bd")).toBe(true);
    expect(layer.silences("acid")).toBe(false);
    expect(layer.setBreak(false, true)).toBeNull();
    expect(layer.state.dropPending).toBe(true);
    expect(layer.silences("bd"), "the kick stays out until the drop").toBe(true);
    expect(layer.barLine()).toEqual({ drop: true, changed: true });
    expect(layer.silences("bd")).toBe(false);
    expect(layer.state.breakActive).toBe(false);
  });

  it("holding again before the drop keeps the break going", () => {
    const layer = new PerformanceLayer();
    layer.setBreak(true, true);
    layer.setBreak(false, true);
    expect(layer.setBreak(true, true)).toBe("rise");
    expect(layer.state).toMatchObject({ breakActive: true, dropPending: false });
    expect(layer.barLine().drop).toBe(false);
  });

  it("drops at once while stopped, and stopping settles everything", () => {
    const layer = new PerformanceLayer();
    layer.setBreak(true, false);
    expect(layer.setBreak(false, false)).toBe("drop");
    layer.toggleMute("sd", true);
    layer.setBreak(true, true);
    expect(layer.settle()).toBe(true);
    expect(layer.state).toEqual({ muted: ["sd"], pending: [], breakActive: false, dropPending: false });
    expect(layer.settle()).toBe(false);
  });

  it("letting go without a break does nothing", () => {
    expect(new PerformanceLayer().setBreak(false, true)).toBeNull();
  });
});
