<script setup lang="ts">
/**
 * A number changed by dragging the thumb up or down, as on the M8: one step
 * per few pixels, a short buzz per step. Arrow keys work too.
 */
const props = withDefaults(defineProps<{ value: number; min: number; max: number; label: string; pixelsPerStep?: number }>(), { pixelsPerStep: 7 });
const emit = defineEmits<{ change: [value: number] }>();

let drag: { id: number; y: number; start: number; last: number } | null = null;

function clamp(value: number): number {
  return Math.max(props.min, Math.min(props.max, Math.round(value)));
}

function down(event: PointerEvent): void {
  (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  drag = { id: event.pointerId, y: event.clientY, start: props.value, last: props.value };
}

function move(event: PointerEvent): void {
  if (!drag || event.pointerId !== drag.id) return;
  const value = clamp(drag.start + (drag.y - event.clientY) / props.pixelsPerStep);
  if (value === drag.last) return;
  drag.last = value;
  navigator.vibrate?.(4);
  emit("change", value);
}

function end(event: PointerEvent): void {
  if (drag?.id === event.pointerId) drag = null;
}

function key(event: KeyboardEvent): void {
  const delta = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1 }[event.key];
  if (delta === undefined) return;
  event.preventDefault();
  const value = clamp(props.value + delta);
  if (value !== props.value) emit("change", value);
}
</script>

<template>
  <div
    class="drag-value"
    role="spinbutton"
    tabindex="0"
    :aria-label="label"
    :aria-valuenow="value"
    :aria-valuemin="min"
    :aria-valuemax="max"
    @pointerdown="down"
    @pointermove="move"
    @pointerup="end"
    @pointercancel="end"
    @keydown="key"
  >
    <strong>{{ value }}</strong><small>{{ label }}</small>
  </div>
</template>
