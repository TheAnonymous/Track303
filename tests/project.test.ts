import { describe, expect, it } from "vitest";
import { createProject, emptyPattern, sanitizeProject, starterPattern } from "../src/domain/project";
import { ACID_VOICES, ACID_WAVEFORMS, LANES, PATTERN_COUNT } from "../src/domain/types";
import { presetDefinition } from "../src/sound/sound-presets";

describe("createProject", () => {
  it("starts with an acid groove in pattern 1 and seven empty patterns", () => {
    const project = createProject();
    expect(project.patterns).toHaveLength(PATTERN_COUNT);
    expect(project.patterns[0]).toEqual(starterPattern());
    for (const pattern of project.patterns.slice(1)) expect(pattern).toEqual(emptyPattern());
    const starter = project.patterns[0]!;
    expect(starter.lanes.bd.filter(Boolean)).toHaveLength(4);
    expect(starter.lanes.acid.filter((cell) => cell?.kind === "note" && cell.slide).length).toBeGreaterThan(0);
  });

  it("survives its own sanitizer unchanged", () => {
    const project = createProject();
    expect(sanitizeProject(JSON.parse(JSON.stringify(project)))).toEqual(project);
  });
});

describe("sanitizeProject", () => {
  it("turns garbage into a complete default project", () => {
    for (const value of [null, 3, "x", [], { patterns: "no" }]) {
      const project = sanitizeProject(value);
      expect(project.schemaVersion).toBe(1);
      expect(project.patterns).toHaveLength(PATTERN_COUNT);
    }
  });

  it("clamps numbers and rejects unknown choices", () => {
    const project = sanitizeProject({ tempo: 999, swing: -1, root: "H", scale: "blues", kit: "x", acidVoice: "y", volume: 4, knobs: { cutoff: 7, resonance: "loud" }, activePattern: 42 });
    expect(project.tempo).toBe(180);
    expect(project.swing).toBe(0);
    expect(project.root).toBe("A");
    expect(project.scale).toBe("minor");
    expect(project.kit).toBe("warehouse");
    expect(project.acidVoice).toBe("silverbox");
    expect(project.volume).toBe(1);
    expect(project.knobs.cutoff).toBe(1);
    expect(project.knobs.resonance).toBe(createProject().knobs.resonance);
    expect(project.activePattern).toBe(PATTERN_COUNT - 1);
  });

  it("keeps cells only on lanes that can play them", () => {
    const pattern = emptyPattern() as unknown as { lanes: Record<string, unknown[]> };
    pattern.lanes.bd![0] = { kind: "drum", voice: "clap" };
    pattern.lanes.sd![0] = { kind: "drum", voice: "clap", accent: true, chance: 0.5, ratchet: 3 };
    pattern.lanes.hh![0] = { kind: "note", degree: 2 };
    pattern.lanes.acid![0] = { kind: "note", degree: 9, octave: 7, slide: true, chance: 0.6, ratchet: 9 };
    const project = sanitizeProject({ patterns: [pattern] });
    const lanes = project.patterns[0]!.lanes;
    expect(lanes.bd[0]).toBeNull();
    expect(lanes.sd[0]).toEqual({ kind: "drum", voice: "clap", accent: true, chance: 0.5, ratchet: 3 });
    expect(lanes.hh[0]).toBeNull();
    expect(lanes.acid[0]).toEqual({ kind: "note", degree: 6, octave: 2, accent: false, slide: true, chance: 1, ratchet: 1 });
  });

  it("fits every lane to the pattern length", () => {
    const project = sanitizeProject({ patterns: [{ rows: 32, lanes: { bd: [{ kind: "drum", voice: "kick" }] } }, { rows: 20 }] });
    expect(project.patterns[0]!.rows).toBe(32);
    for (const lane of LANES) expect(project.patterns[0]!.lanes[lane]).toHaveLength(32);
    expect(project.patterns[1]!.rows).toBe(16);
  });

  it("keeps only valid song entries, and at least one", () => {
    expect(sanitizeProject({ song: [0, 3, 9, -1, 2.5, "1", 7] }).song).toEqual([0, 3, 7]);
    expect(sanitizeProject({ song: [] }).song).toEqual([0]);
    expect(sanitizeProject({}).song).toEqual([0]);
    expect(sanitizeProject({ song: Array.from({ length: 90 }, () => 1) }).song).toHaveLength(64);
  });

  it("keeps effects only where the lane offers them, with values 1–3", () => {
    const pattern = emptyPattern() as unknown as { lanes: Record<string, unknown[]> };
    pattern.lanes.bd![0] = { kind: "drum", voice: "kick", fx: { type: "EC", value: 3 } };
    pattern.lanes.bd![1] = { kind: "drum", voice: "kick", fx: { type: "AR", value: 1 } };
    pattern.lanes.acid![0] = { kind: "note", degree: 0, fx: { type: "AR", value: 2 } };
    pattern.lanes.acid![1] = { kind: "note", degree: 0, fx: { type: "GT", value: 9 } };
    pattern.lanes.acid![2] = { kind: "note", degree: 0, fx: "EC1" };
    const lanes = sanitizeProject({ patterns: [pattern] }).patterns[0]!.lanes;
    expect(lanes.bd[0]).toMatchObject({ fx: { type: "EC", value: 3 } });
    expect(lanes.bd[1]).not.toHaveProperty("fx");
    expect(lanes.acid[0]).toMatchObject({ fx: { type: "AR", value: 2 } });
    expect(lanes.acid[1]).not.toHaveProperty("fx");
    expect(lanes.acid[2]).not.toHaveProperty("fx");
  });

  it("gives each 303 voice its own waveform unless the switch says otherwise", () => {
    for (const voice of ACID_VOICES) expect(ACID_WAVEFORMS[voice]).toBe(presetDefinition("acid", voice).synthesis.oscillator);
    expect(sanitizeProject({ acidVoice: "rubber" }).waveform).toBe("square");
    expect(sanitizeProject({ acidVoice: "rubber", waveform: "sawtooth" }).waveform).toBe("sawtooth");
    expect(sanitizeProject({ waveform: "triangle" }).waveform).toBe("sawtooth");
  });
});
