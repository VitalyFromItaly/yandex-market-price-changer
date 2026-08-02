<script setup lang="ts">
import { onMounted, onBeforeUnmount } from 'vue';

// Отдельный компонент, а не MessageModal: тот показывает строку журнала и умеет
// только закрываться. Здесь нужен выбор «подтвердить/отменить». Структуру
// подложки и Escape берём такую же, чтобы модалки в панели выглядели одинаково.
const props = withDefaults(
  defineProps<{
    title: string;
    message: string;
    confirmLabel?: string;
    busy?: boolean;
  }>(),
  { confirmLabel: 'Удалить', busy: false },
);

const emit = defineEmits<{ confirm: []; cancel: [] }>();

function onKey(event: KeyboardEvent): void {
  // Пока идёт удаление, Escape не закрывает: закрыть на полпути — сбить с толку.
  if (event.key === 'Escape' && !props.busy) emit('cancel');
}

onMounted(() => window.addEventListener('keydown', onKey));
onBeforeUnmount(() => window.removeEventListener('keydown', onKey));
</script>

<template>
  <!-- Клик по подложке = отмена (но не во время удаления). Клик внутри — нет. -->
  <div class="backdrop" @click="!busy && emit('cancel')">
    <div class="card" role="dialog" aria-modal="true" @click.stop>
      <h2>{{ title }}</h2>
      <p class="message">{{ message }}</p>

      <div class="actions">
        <button type="button" :disabled="busy" @click="emit('cancel')">Отмена</button>
        <button type="button" class="danger" :disabled="busy" @click="emit('confirm')">
          {{ busy ? 'Удаление…' : confirmLabel }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.55);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  z-index: 10;
}

.card {
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 14px;
  width: min(440px, 100%);
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

h2 {
  margin: 0;
  font-size: 17px;
}

.message {
  margin: 0;
  color: var(--muted);
  font-size: 14px;
  line-height: 1.5;
}

.actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 4px;
}
</style>
