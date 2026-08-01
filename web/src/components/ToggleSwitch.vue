<script setup lang="ts">
defineProps<{
  /** Состояние приходит СВЕРХУ и всегда отражает сервер — см. комментарий ниже. */
  modelValue: boolean;
  disabled?: boolean;
  /** Подпись для скринридера: сам тумблер текста не содержит. */
  label: string;
}>();

const emit = defineEmits<{ (event: 'change', value: boolean): void }>();

/**
 * Тумблер НЕ хранит своё состояние и не использует v-model.
 *
 * Он показывает то, что ответил сервер, а не то, что пользователь нажал:
 * запрос может не пройти, и тумблер, переключившийся сам по себе, уверенно
 * врал бы о том, что доступ закрыт, пока он открыт. Родитель заменяет строку
 * ответом PATCH и передаёт новое значение сюда.
 *
 * Внутри — обычный `<input type="checkbox">`, спрятанный визуально, а не
 * `<div>` с обработчиком: так работают фокус с клавиатуры, пробел, скринридер
 * и `:disabled` — бесплатно и правильно.
 */
</script>

<template>
  <label class="toggle" :class="{ disabled }">
    <input
      type="checkbox"
      :checked="modelValue"
      :disabled="disabled"
      :aria-label="label"
      @change="emit('change', ($event.target as HTMLInputElement).checked)"
    />
    <span class="track" aria-hidden="true"><span class="thumb"></span></span>
  </label>
</template>

<style scoped>
.toggle {
  display: inline-flex;
  align-items: center;
  cursor: pointer;
  /* Сброс общего label из styles.css: там он колонка с подписью сверху. */
  flex-direction: row;
  gap: 0;
}

.toggle.disabled {
  cursor: default;
  opacity: 0.5;
}

/* Спрятан визуально, но остаётся в потоке фокуса. display:none убрал бы его
   из табуляции и из скринридера. */
input {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  padding: 0;
  border: 0;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
  min-width: 0;
}

.track {
  position: relative;
  display: block;
  width: 42px;
  height: 24px;
  border-radius: 999px;
  background: var(--border);
  transition: background 0.15s ease;
}

.thumb {
  position: absolute;
  top: 3px;
  left: 3px;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: var(--bg);
  transition: transform 0.15s ease;
}

input:checked + .track {
  background: var(--ok);
}

input:checked + .track .thumb {
  transform: translateX(18px);
}

/* Кольцо фокуса — на видимой части: сам input невидим, и без этого переход по
   табуляции никак не отображается. */
input:focus-visible + .track {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
</style>
