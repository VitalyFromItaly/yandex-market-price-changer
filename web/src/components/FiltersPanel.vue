<script setup lang="ts">
import type { ILogsQuery } from '../api';

/** Источник ошибки. Пусто — записи любого происхождения. */
const SOURCES = [
  { value: '', label: 'любой' },
  { value: 'yandex', label: 'Яндекс.Маркет' },
  { value: 'bot', label: 'бот' },
  { value: 'http', label: 'HTTP' },
  { value: 'queue', label: 'очередь' },
  { value: 'process', label: 'процесс' },
];

/** Направление: кто кому. */
const DIRECTIONS = [
  { value: '', label: 'всё' },
  { value: 'in', label: 'от пользователя' },
  { value: 'out', label: 'от бота' },
];

/**
 * Виды действий — те же строки, что пишет describeAction на бэкенде.
 *
 * Список только для входящих: у исходящих в этом поле лежит имя метода Bot API
 * (sendMessage и прочие), и перечислять их в том же выпадающем списке значило
 * бы предлагать заведомо пустые сочетания вроде «от пользователя + sendMessage».
 */
const KINDS = [
  { value: '', label: 'любой тип' },
  { value: 'command', label: 'команда' },
  { value: 'menu', label: 'кнопка меню' },
  { value: 'callback', label: 'inline-кнопка' },
  { value: 'document', label: 'файл' },
  { value: 'text', label: 'текст' },
  { value: 'other', label: 'прочее' },
];

const filters = defineModel<ILogsQuery>({ required: true });
const emit = defineEmits<{ apply: []; reset: [] }>();
</script>

<template>
  <form class="filters" @submit.prevent="emit('apply')">
    <label>
      Telegram id
      <input v-model="filters.telegramUserId" inputmode="numeric" placeholder="все" />
    </label>

    <!-- Главный вопрос разбора — «что сломалось», поэтому переключатель
         отдельной кнопкой, а не пунктом в выпадающем списке. -->
    <label class="only-errors">
      <input
        type="checkbox"
        :checked="filters.status === 'error'"
        @change="filters.status = ($event.target as HTMLInputElement).checked ? 'error' : ''"
      />
      только ошибки
    </label>

    <label>
      Источник
      <select v-model="filters.source">
        <option v-for="s in SOURCES" :key="s.value" :value="s.value">{{ s.label }}</option>
      </select>
    </label>

    <label>
      Направление
      <select v-model="filters.direction">
        <option v-for="d in DIRECTIONS" :key="d.value" :value="d.value">{{ d.label }}</option>
      </select>
    </label>

    <label>
      Тип
      <select v-model="filters.kind">
        <option v-for="kind in KINDS" :key="kind.value" :value="kind.value">{{ kind.label }}</option>
      </select>
    </label>

    <label>
      С
      <input v-model="filters.since" type="date" />
    </label>

    <label>
      По
      <input v-model="filters.until" type="date" />
    </label>

    <label>
      На странице
      <!-- Потолок 500 стоит и на бэкенде (MAX_PAGE_SIZE): больший limit там
           будет молча урезан, поэтому здесь тот же предел. -->
      <select v-model.number="filters.limit">
        <option :value="50">50</option>
        <option :value="100">100</option>
        <option :value="200">200</option>
        <option :value="500">500</option>
      </select>
    </label>

    <div class="actions">
      <button class="primary" type="submit">Показать</button>
      <button type="button" @click="emit('reset')">Сбросить</button>
    </div>
  </form>
</template>

<style scoped>
.filters {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: end;
  padding: 16px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 12px;
}

.filters label {
  flex: 1 1 140px;
}

.actions {
  display: flex;
  gap: 8px;
}

.only-errors {
  flex-direction: row;
  align-items: center;
  gap: 6px;
  flex: 0 0 auto;
  padding-bottom: 8px;
}
</style>
