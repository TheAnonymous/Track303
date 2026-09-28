<script setup lang="ts">
import { computed } from "vue";
import { ROOT_LABELS, SCALE_LABELS } from "../domain/music";
import type { AcidKnobs, AcidVoice, Kit, Project } from "../domain/types";
import { ACID_VOICES, KITS, MAX_SWING, MAX_TEMPO, MIN_TEMPO, ROOT_NOTES, SCALES } from "../domain/types";
import { presetDefinition } from "../sound/sound-presets";
import type { Track303Store } from "../store";
import { versionLabel } from "../version";

const props = defineProps<{ store: Track303Store }>();
const project = computed(() => props.store.project.value);

const KNOBS: { key: keyof AcidKnobs; label: string }[] = [
  { key: "cutoff", label: "Cutoff" },
  { key: "resonance", label: "Resonanz" },
  { key: "envMod", label: "Env Mod" },
  { key: "decay", label: "Decay" },
  { key: "accent", label: "Akzent" },
  { key: "drive", label: "Drive" },
  { key: "space", label: "Raum" },
];

const appVersion = versionLabel();

function set<K extends keyof Project>(key: K, value: Project[K], mergeKey?: string): void {
  props.store.edit((draft) => { draft[key] = value; }, mergeKey);
}

function setKnob(key: keyof AcidKnobs, event: Event): void {
  const value = Number((event.target as HTMLInputElement).value);
  props.store.edit((draft) => { draft.knobs[key] = value; }, `knob:${key}`);
}

function number(event: Event): number {
  return Number((event.target as HTMLInputElement).value);
}

const acidLabel = (voice: AcidVoice) => presetDefinition("acid", voice).label;
const kitLabel = (kit: Kit) => presetDefinition("drums", kit).label;
</script>

<template>
  <section class="sound" aria-label="Klang">
    <h2>303</h2>
    <div class="segmented" role="group" aria-label="303-Stimme">
      <button v-for="voice in ACID_VOICES" :key="voice" type="button" :aria-pressed="project.acidVoice === voice" :data-acid-voice="voice" @click="set('acidVoice', voice)">{{ acidLabel(voice) }}</button>
    </div>
    <label v-for="knob in KNOBS" :key="knob.key" class="slider" :data-knob="knob.key">
      <span>{{ knob.label }}</span>
      <input type="range" min="0" max="1" step="0.01" :value="project.knobs[knob.key]" @input="setKnob(knob.key, $event)" />
      <output>{{ Math.round(project.knobs[knob.key] * 100) }}</output>
    </label>

    <h2>Drums</h2>
    <div class="segmented" role="group" aria-label="Drum-Kit">
      <button v-for="kit in KITS" :key="kit" type="button" :aria-pressed="project.kit === kit" :data-kit="kit" @click="set('kit', kit)">{{ kitLabel(kit) }}</button>
    </div>

    <h2>Groove</h2>
    <label class="slider" data-setting="tempo">
      <span>Tempo</span>
      <input type="range" :min="MIN_TEMPO" :max="MAX_TEMPO" step="1" :value="project.tempo" @input="set('tempo', number($event), 'tempo')" />
      <output>{{ project.tempo }}</output>
    </label>
    <label class="slider" data-setting="swing">
      <span>Swing</span>
      <input type="range" min="0" :max="MAX_SWING" step="0.01" :value="project.swing" @input="set('swing', number($event), 'swing')" />
      <output>{{ Math.round(project.swing * 100) }}</output>
    </label>
    <label class="slider" data-setting="volume">
      <span>Lautstärke</span>
      <input type="range" min="0" max="1" step="0.01" :value="project.volume" @input="set('volume', number($event), 'volume')" />
      <output>{{ Math.round(project.volume * 100) }}</output>
    </label>
    <div class="key">
      <label>
        <span>Grundton</span>
        <select :value="project.root" data-setting="root" @change="set('root', ($event.target as HTMLSelectElement).value as Project['root'])">
          <option v-for="root in ROOT_NOTES" :key="root" :value="root">{{ ROOT_LABELS[root] }}</option>
        </select>
      </label>
      <div class="segmented" role="group" aria-label="Tonleiter">
        <button v-for="scale in SCALES" :key="scale" type="button" :aria-pressed="project.scale === scale" :data-scale="scale" @click="set('scale', scale)">{{ SCALE_LABELS[scale] }}</button>
      </div>
    </div>

    <p class="note">Alles bleibt auf diesem Handy und wird bei jeder Änderung gespeichert.</p>
    <p class="note" data-app-version>{{ appVersion }}</p>
  </section>
</template>
