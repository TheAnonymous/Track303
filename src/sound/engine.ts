import * as Tone from "tone";
import { AUTO_PARAMS, automationAt, hasAutomation, type AutoParam } from "../domain/automation";
import { noteMidi, shiftDegree } from "../domain/music";
import type { AcidKnobs, Cell, DrumCell, FxValue, Lane, NoteCell, Pattern, Project } from "../domain/types";
import { LANES } from "../domain/types";
import { nextPosition, startPosition, type Arrangement, type PlayMode } from "./arrangement";
import { createAcid303, createDrumKit, type Acid303, type DrumKit } from "./banks";
import { applyTrackGraphParameters, createMasterGraph, createTrackGraph, setTrackGraphVolume, type MasterGraph, type TrackGraph } from "./graph";
import type { TrackMacros } from "./kitty-types";
import { PerformanceLayer, ROWS_PER_BAR, type PerformanceState } from "./performance-layer";
import { duckEnvelope, faderGain } from "./polish";
import { playThroughSilentSwitch } from "./ios-audio";
import { MasterRecorder, type Recording } from "./recorder";
import { safeEffectParameters } from "./sound-presets";

export type { PerformanceState } from "./performance-layer";

/** `interrupted`: the phone took the sound away while playing (a call, another app); playback stopped. */
export type EngineStatus = "idle" | "starting" | "playing" | "suspended" | "interrupted" | "error";

export interface PlayheadEvent {
  pattern: number;
  /** Song entry that plays, or `null` in loop mode. */
  songIndex: number | null;
  row: number;
  /** Lanes that sounded on this row. */
  triggered: Lane[];
  /** The 303 knobs as they sound on this row (ride and thumb included). */
  knobs: AcidKnobs;
}

/** One row of a filter ride captured while playing. */
export interface RideEvent {
  pattern: number;
  row: number;
  values: Partial<AcidKnobs>;
  /** Numbers the thumb gestures, so each gesture is one undo step. */
  pass: number;
}

const DRUM_MACROS: TrackMacros = { color: 0.55, pressure: 0.55, space: 0.12, motion: 0.2, density: 0.6 };

/* What the effect values do (see FX_TYPES). */
const ECHO_SEND: Record<FxValue, number> = { 1: 0.3, 2: 0.55, 3: 0.85 };
const VOLUME: Record<FxValue, number> = { 1: 0.3, 2: 0.55, 3: 0.8 };
/** Share of the row a 303 note sounds; 0.55 without GT. */
const GATE: Record<FxValue, number> = { 1: 0.15, 2: 0.3, 3: 0.9 };
/** Scale steps an arpeggio walks through within its row. */
const ARPEGGIOS: Record<FxValue, readonly number[]> = { 1: [0, 2, 4], 2: [0, 4, 7], 3: [0, 7, 0, 7] };
const STRIP_GAINS = { drums: 0.88, acid: 0.8 } as const;

/** Whether scheduled sound will be heard: the live context runs, or an offline render is being prepared. */
function audible(): boolean {
  const context = Tone.getContext();
  return context instanceof Tone.OfflineContext || context.state === "running";
}

function acidMacros(knobs: AcidKnobs): TrackMacros {
  return { color: 0.72, pressure: 0.4, space: knobs.space, motion: 0.3 + knobs.space * 0.35, density: 0.6 };
}

export interface Graph {
  master: MasterGraph;
  drums: TrackGraph;
  acid: TrackGraph;
  kit: DrumKit;
  acid303: Acid303;
  kitPreset: Project["kit"];
  acidPreset: Project["acidVoice"];
  acidWaveform: Project["waveform"];
}

/**
 * Plays a Track303 project: sixteenth rows of the active pattern through the
 * drum kit and the 303, each on a channel strip from Kitty's mixer, into the
 * master bus. A queued pattern takes over when the running one wraps.
 */
export class TrackerEngine {
  private project: Project;
  private graph: Graph | null = null;
  private graphReady: Promise<Graph> | null = null;
  private scheduleId: number | null = null;
  private row = 0;
  private pattern = 0;
  private queued: number | null = null;
  private mode: PlayMode = "loop";
  private songStart = 0;
  private songIndex: number | null = null;
  private readonly recorder = new MasterRecorder(() => undefined);
  private acidHeld = false;
  /** Rows since start, for bar lines. */
  private step = 0;
  private ownContext: Tone.Context | null = null;
  /** 303 knobs under a thumb right now, ahead of the saved project. */
  private liveKnobs: AcidKnobs | null = null;
  /** Which of those knobs the thumb is actually moving. */
  private readonly touched = new Set<AutoParam>();
  private ridePass = 0;
  private rideRecording = false;
  /** Whether the previous row played a ride, so the knobs glide back when it ends. */
  private riding = false;
  private readonly rideListeners = new Set<(event: RideEvent) => void>();
  private readonly performance = new PerformanceLayer();
  private readonly playheadListeners = new Set<(event: PlayheadEvent) => void>();
  private readonly statusListeners = new Set<(status: EngineStatus) => void>();
  private readonly performanceListeners = new Set<(state: PerformanceState) => void>();

  /**
   * `latencyHint` gives the live app its own audio context, created on the first
   * tap: phones crackle with the smallest buffers, and a tracker is programmed
   * rather than played, so a few milliseconds more latency cost nothing.
   */
  constructor(project: Project, private readonly options: { latencyHint?: AudioContextLatencyCategory; offline?: boolean } = {}) {
    this.project = structuredClone(project);
  }

  get playing(): boolean {
    return this.scheduleId !== null;
  }

  get queuedPattern(): number | null {
    return this.queued;
  }

  onPlayhead(listener: (event: PlayheadEvent) => void): () => void {
    this.playheadListeners.add(listener);
    return () => this.playheadListeners.delete(listener);
  }

  onStatus(listener: (status: EngineStatus) => void): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  onPerformance(listener: (state: PerformanceState) => void): () => void {
    this.performanceListeners.add(listener);
    listener(this.performance.state);
    return () => this.performanceListeners.delete(listener);
  }

  get performanceState(): PerformanceState {
    return this.performance.state;
  }

  async start(): Promise<void> {
    this.emitStatus("starting");
    try {
      await this.prepare();
      if (!audible()) {
        this.emitStatus("suspended");
        return;
      }
      const transport = Tone.getTransport();
      transport.stop();
      transport.cancel();
      transport.position = 0;
      this.applyTiming();
      this.row = 0;
      this.step = 0;
      const position = startPosition(this.arrangement, this.project.activePattern);
      this.pattern = position.pattern;
      this.songIndex = position.songIndex;
      this.queued = null;
      this.acidHeld = false;
      this.scheduleId = transport.scheduleRepeat((time) => this.tick(time), "16n");
      transport.start("+0.05");
      this.emitStatus("playing");
    } catch (error) {
      this.emitStatus("error");
      throw error;
    }
  }

  stop(): void {
    const transport = Tone.getTransport();
    transport.stop();
    if (this.scheduleId !== null) transport.clear(this.scheduleId);
    this.scheduleId = null;
    this.queued = null;
    const now = Tone.now();
    this.graph?.kit.release(now);
    this.graph?.acid303.release(now);
    this.acidHeld = false;
    // A ride stops where it is; the filter goes back to the knobs for previews and the next start.
    if (this.riding) this.graph?.acid303.setKnobs({ ...this.project.knobs });
    this.riding = false;
    if (this.performance.settle()) this.graph?.master.performance.endRise(Tone.immediate());
    this.emitPerformance();
    this.emitStatus("idle");
  }

  /** Loop mode: switches at the end of the running pattern while playing, immediately otherwise. The song ignores it. */
  queuePattern(index: number): void {
    if (this.mode === "song") return;
    if (this.playing) this.queued = index === this.pattern ? null : index;
    else this.pattern = index;
  }

  get playMode(): PlayMode {
    return this.mode;
  }

  /**
   * Loop or song, and the song entry to start from. Switching while playing
   * takes effect when the running pattern ends: the song then starts at
   * `songStart`, a loop keeps the pattern that plays.
   */
  setArrangement(mode: PlayMode, songStart: number): void {
    this.songStart = songStart;
    if (mode === this.mode) return;
    this.mode = mode;
    this.songIndex = null;
    this.queued = null;
  }

  /**
   * Builds the graph in the current (offline) context and schedules `steps`
   * rows of the song from its first entry at time 0, for a WAV render.
   */
  async scheduleOffline(steps: number): Promise<void> {
    await this.createGraph();
    this.mode = "song";
    this.songStart = 0;
    const position = startPosition(this.arrangement, this.project.activePattern);
    this.pattern = position.pattern;
    this.songIndex = position.songIndex;
    this.row = 0;
    this.step = 0;
    let remaining = steps;
    this.scheduleId = Tone.getTransport().scheduleRepeat((time) => {
      if (remaining <= 0) return;
      remaining -= 1;
      this.tick(time);
    }, "16n", 0);
  }

  /** Records what leaves the master until `stopRecording`. */
  async startRecording(): Promise<void> {
    await this.prepare();
    if (!audible()) throw new Error("Audio ist pausiert");
    await this.recorder.start(Tone.getDestination());
  }

  stopRecording(): Promise<Recording> {
    return this.recorder.stop();
  }

  get recordingSeconds(): number {
    return this.recorder.active ? this.recorder.seconds : 0;
  }

  /** Mutes at once (renders, tests). */
  setMuted(lane: Lane, muted: boolean): void {
    this.performance.setMute(lane, muted);
    this.emitPerformance();
  }

  /** Flips a lane's mute on the next bar line while playing, at once otherwise. */
  toggleMute(lane: Lane): void {
    this.performance.toggleMute(lane, this.playing);
    this.emitPerformance();
  }

  /** Hold for the break (kick out, highpass rises over two bars); let go for the drop on the next bar line. */
  setBreak(active: boolean): void {
    const action = this.performance.setBreak(active, this.playing);
    const filter = this.graph?.master.performance;
    const now = Tone.immediate();
    if (action === "rise") filter?.startRise(now, (2 * 240) / this.project.tempo);
    if (action === "drop") filter?.endRise(now);
    this.emitPerformance();
  }

  /** The master's DJ filter: −1 lowpass, 0 open, +1 highpass. */
  setPerformanceFilter(value: number): void {
    this.graph?.master.performance.setFilter(value);
  }

  /**
   * Plays knob moves under a thumb at once; `touched` names the knobs the
   * thumb moves (they are recorded when riding); `null` hands back to the
   * saved project and its ride.
   */
  setLiveKnobs(knobs: AcidKnobs | null, touched: readonly AutoParam[] = []): void {
    if (knobs && !this.liveKnobs) this.ridePass += 1;
    this.liveKnobs = knobs;
    if (!knobs) this.touched.clear();
    for (const param of touched) this.touched.add(param);
    if (knobs) this.graph?.acid303.setKnobs(knobs);
  }

  /** While on, thumb moves in the live view are written into the playing pattern, row by row. */
  setRideRecording(on: boolean): void {
    this.rideRecording = on;
  }

  onRide(listener: (event: RideEvent) => void): () => void {
    this.rideListeners.add(listener);
    return () => this.rideListeners.delete(listener);
  }

  syncProject(project: Project): void {
    const knobsChanged = JSON.stringify(this.project.knobs) !== JSON.stringify(project.knobs);
    this.project = structuredClone(project);
    if (!this.playing) this.pattern = project.activePattern;
    const graph = this.graph;
    if (!graph) return;
    this.applyTiming();
    graph.master.fader.gain.rampTo(faderGain(project.volume), 0.05);
    if (graph.kitPreset !== project.kit) {
      graph.kit.dispose();
      graph.kit = createDrumKit(project.kit, graph.drums.input, this.alwaysAwake);
      graph.kitPreset = project.kit;
    }
    if (graph.acidPreset !== project.acidVoice || graph.acidWaveform !== project.waveform) {
      graph.acid303.dispose();
      graph.acid303 = createAcid303(project.acidVoice, project.knobs, graph.acid.input, this.alwaysAwake, project.waveform);
      graph.acidPreset = project.acidVoice;
      graph.acidWaveform = project.waveform;
    }
    // Only a real knob change moves the filter here; rides are scheduled row by row.
    if (knobsChanged && !this.liveKnobs) graph.acid303.setKnobs(project.knobs);
    applyTrackGraphParameters(graph.acid, "acid", project.acidVoice, acidMacros(project.knobs), 0.08);
  }

  /** Plays one cell right away, so editing on the phone is heard as it happens. */
  async preview(lane: Lane, cell: Cell): Promise<void> {
    if (!cell) return;
    const graph = await this.prepare();
    if (!audible()) return;
    const time = Tone.now() + 0.02;
    if (cell.kind === "drum") graph.kit.trigger(cell.voice, time, cell.accent ? 1 : 0.8);
    else graph.acid303.trigger(this.midi(cell), time, { accent: cell.accent, glide: false, hold: false, seconds: 0.18, velocity: 0.82 });
  }

  dispose(): void {
    this.stop();
    const graph = this.graph;
    this.graph = null;
    if (!graph) return;
    graph.kit.dispose();
    graph.acid303.dispose();
    graph.drums.nodes.forEach((node) => node.dispose());
    graph.acid.nodes.forEach((node) => node.dispose());
    graph.master.nodes.forEach((node) => node.dispose());
  }

  /** Unlocks audio (call from a tap) and builds the graph once. */
  async prepare(): Promise<Graph> {
    // Still inside the tap: on an iPhone, keep the silent switch from muting the music.
    if (this.options.latencyHint) playThroughSilentSwitch();
    if (this.options.latencyHint && !this.ownContext) {
      this.ownContext = new Tone.Context({ latencyHint: this.options.latencyHint });
      // Importing Tone already made a default context; it never started and is closed here.
      Tone.setContext(this.ownContext, true);
      // A call or another app can take the sound away. The clock would stand
      // still while Play still showed "playing"; stop cleanly and say so instead.
      (this.ownContext.rawContext as AudioContext).addEventListener("statechange", () => {
        if (this.playing && this.ownContext?.state !== "running") {
          this.stop();
          this.emitStatus("interrupted");
        }
      });
    }
    await Tone.start();
    if (this.graph) return this.graph;
    this.graphReady ??= this.createGraph().finally(() => { this.graphReady = null; });
    return this.graphReady;
  }

  private async createGraph(): Promise<Graph> {
    const master = createMasterGraph(Tone.getDestination(), this.project.volume);
    const drums = createTrackGraph("drums", this.project.kit, DRUM_MACROS, STRIP_GAINS.drums, master.input);
    const acid = createTrackGraph("acid", this.project.acidVoice, acidMacros(this.project.knobs), STRIP_GAINS.acid, master.input);
    await Promise.all([drums.ready, acid.ready]);
    setTrackGraphVolume(drums, STRIP_GAINS.drums, 0.01);
    setTrackGraphVolume(acid, STRIP_GAINS.acid, 0.01);
    this.graph = {
      master,
      drums,
      acid,
      kit: createDrumKit(this.project.kit, drums.input, this.alwaysAwake),
      acid303: createAcid303(this.project.acidVoice, this.project.knobs, acid.input, this.alwaysAwake, this.project.waveform),
      kitPreset: this.project.kit,
      acidPreset: this.project.acidVoice,
      acidWaveform: this.project.waveform,
    };
    this.applyTiming();
    return this.graph;
  }

  /**
   * How long sound takes from the audio clock to the ear (the device's
   * buffers; much more over Bluetooth), so the playhead lights up when a row
   * is heard, not when it is computed.
   */
  private outputDelay(): number {
    const raw = Tone.getContext().rawContext as Partial<AudioContext>;
    const latency = (raw.outputLatency || raw.baseLatency || 0);
    return Number.isFinite(latency) ? Math.max(0, Math.min(0.5, latency)) : 0;
  }

  /**
   * Offline renders keep every voice connected: idle voices sleep by a timer
   * against the context clock, which in a render runs ahead of the audio.
   */
  private get alwaysAwake(): boolean {
    return this.options.offline === true;
  }

  private get arrangement(): Arrangement {
    return { mode: this.mode, song: this.project.song, songStart: this.songStart };
  }

  private applyTiming(): void {
    const transport = Tone.getTransport();
    transport.bpm.value = this.project.tempo;
    transport.swing = this.project.swing;
    transport.swingSubdivision = "16n";
  }

  private tick(time: number): void {
    const graph = this.graph;
    if (!graph) return;
    const pattern = this.project.patterns[this.pattern];
    if (!pattern) return;
    const row = this.row;
    if (this.step % ROWS_PER_BAR === 0) {
      const { drop, changed } = this.performance.barLine();
      if (drop) graph.master.performance.endRise(time);
      if (changed) Tone.getDraw().schedule(() => this.emitPerformance(), time + this.outputDelay());
    }
    this.step += 1;
    const knobs = this.rideRow(graph, pattern, row, time);
    const triggered = LANES.filter((lane) => this.playCell(graph, pattern, lane, row, time));
    if (!triggered.includes("acid") && this.acidHeld) {
      // A held (slid-into) note whose follower did not play ends here.
      graph.acid303.release(time);
      this.acidHeld = false;
    }
    const current = this.pattern;
    const songIndex = this.songIndex;
    Tone.getDraw().schedule(() => {
      for (const listener of this.playheadListeners) listener({ pattern: current, songIndex, row, triggered, knobs });
    }, time + this.outputDelay());
    this.row += 1;
    if (this.row >= pattern.rows) {
      this.row = 0;
      const next = nextPosition({ pattern: this.pattern, songIndex: this.songIndex }, this.arrangement, this.queued);
      this.pattern = next.pattern;
      this.songIndex = next.songIndex;
      this.queued = null;
    }
  }

  private playCell(graph: Graph, pattern: Pattern, lane: Lane, row: number, time: number): boolean {
    const cell = pattern.lanes[lane][row];
    if (!cell || this.performance.silences(lane)) return false;
    if (cell.chance < 1 && Math.random() >= cell.chance) return false;
    const sixteenth = 15 / this.project.tempo;
    const hits = Math.max(1, cell.ratchet);
    const fx = cell.fx;
    const at = fx?.type === "DL" ? time + (fx.value * sixteenth) / 4 : time;
    const volume = fx?.type === "VL" ? VOLUME[fx.value] : 1;
    if (fx?.type === "EC") this.throwEcho(cell.kind === "drum" ? graph.drums : graph.acid, at, ECHO_SEND[fx.value], sixteenth);
    if (cell.kind === "drum") {
      this.playDrum(graph, cell, at, sixteenth, hits, volume);
      return true;
    }
    this.playAcid(graph, pattern, cell, row, at, sixteenth, hits, volume);
    return true;
  }

  private playDrum(graph: Graph, cell: DrumCell, time: number, sixteenth: number, hits: number, volume: number): void {
    const velocity = (cell.accent ? 1 : 0.78) * volume;
    for (let hit = 0; hit < hits; hit += 1) graph.kit.trigger(cell.voice, time + (hit * sixteenth) / hits, velocity * (hit === 0 ? 1 : 0.84));
    if (cell.voice === "kick" && volume >= 0.5) this.duck(graph, time);
  }

  private playAcid(graph: Graph, pattern: Pattern, cell: NoteCell, row: number, time: number, sixteenth: number, hits: number, volume: number): void {
    const fx = cell.fx;
    const velocity = 0.8 * volume;
    const filterKick = fx?.type === "FL" ? fx.value : 0;
    if (fx?.type === "AR") {
      // An arpeggio walks up the scale within the row; it replaces repeats.
      const steps = ARPEGGIOS[fx.value];
      steps.forEach((step, index) => {
        const note = shiftDegree(cell.degree, cell.octave, step);
        graph.acid303.trigger(this.midi({ ...cell, ...note }), time + (index * sixteenth) / steps.length, { accent: cell.accent && index === 0, glide: false, hold: false, seconds: (sixteenth / steps.length) * 0.75, velocity, filterKick });
      });
      this.acidHeld = false;
      return;
    }
    const midi = this.midi(cell);
    if (hits > 1) {
      for (let hit = 0; hit < hits; hit += 1) {
        graph.acid303.trigger(midi, time + (hit * sixteenth) / hits, { accent: cell.accent, glide: false, hold: false, seconds: (sixteenth / hits) * 0.7, velocity, filterKick });
      }
      this.acidHeld = false;
      return;
    }
    // A slide on a row glides into its note from the one before, which keeps sounding until then.
    const next = row + 1 < pattern.rows ? pattern.lanes.acid[row + 1] : null;
    const hold = Boolean(next && next.kind === "note" && next.slide);
    const gate = fx?.type === "GT" ? GATE[fx.value] : 0.55;
    graph.acid303.trigger(midi, time, { accent: cell.accent, glide: cell.slide && this.acidHeld, hold, seconds: sixteenth * gate, velocity, filterKick });
    this.acidHeld = hold;
  }

  /**
   * The filter ride on one row: records what the thumb moves (when riding is
   * on), plays the pattern's ride for everything else, and glides back to the
   * knobs when a ridden pattern gives way to one without. Returns the knobs
   * as they sound on the row.
   */
  private rideRow(graph: Graph, pattern: Pattern, row: number, time: number): AcidKnobs {
    const live = this.liveKnobs;
    const base = this.project.knobs;
    if (live && this.touched.size && this.rideRecording) {
      const values = Object.fromEntries([...this.touched].map((param) => [param, live[param]])) as Partial<AcidKnobs>;
      const event: RideEvent = { pattern: this.pattern, row, values, pass: this.ridePass };
      for (const listener of this.rideListeners) listener(event);
    }
    const ridden = hasAutomation(pattern);
    const ride = ridden ? automationAt(pattern, row) : {};
    if (ridden || this.riding) {
      const targets = Object.fromEntries(AUTO_PARAMS.filter((param) => !this.touched.has(param)).map((param) => [param, ride[param] ?? base[param]])) as Partial<AcidKnobs>;
      graph.acid303.ride(targets, time - 15 / this.project.tempo, time);
    }
    this.riding = ridden;
    const touchedValues = live ? Object.fromEntries([...this.touched].map((param) => [param, live[param]])) : {};
    return { ...base, ...ride, ...touchedValues };
  }

  /** Opens the strip's delay send for one row, so that hit echoes on (a dub-style throw). */
  private throwEcho(strip: TrackGraph, time: number, level: number, sixteenth: number): void {
    const graph = this.graph;
    if (!graph) return;
    const base = strip === graph.drums
      ? safeEffectParameters("drums", graph.kitPreset, DRUM_MACROS).delayWet
      : safeEffectParameters("acid", graph.acidPreset, acidMacros(this.liveKnobs ?? this.project.knobs)).delayWet;
    const send = strip.delaySend.gain;
    send.cancelAndHoldAtTime(time);
    send.setValueAtTime(Math.max(base, level), time);
    send.setValueAtTime(base, time + sixteenth * 0.9);
  }

  private duck(graph: Graph, time: number): void {
    const envelope = duckEnvelope("acid", this.project.tempo);
    const gain = graph.acid.duck.gain;
    gain.cancelAndHoldAtTime(time);
    gain.linearRampToValueAtTime(envelope.gain, time + envelope.attack);
    gain.setValueAtTime(envelope.gain, time + envelope.attack + envelope.hold);
    gain.exponentialRampToValueAtTime(1, time + envelope.end);
  }

  private midi(cell: NoteCell): number {
    return noteMidi(this.project.root, this.project.scale, cell.degree, cell.octave);
  }

  private emitPerformance(): void {
    const state = this.performance.state;
    for (const listener of this.performanceListeners) listener(state);
  }

  private emitStatus(status: EngineStatus): void {
    for (const listener of this.statusListeners) listener(status);
  }
}
