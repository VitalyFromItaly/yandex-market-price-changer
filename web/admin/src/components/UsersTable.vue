<script setup lang="ts">
import { computed, ref } from 'vue';

import type { IFeature, IUserRow } from '../api';

import { STATUS_LABEL, displayName, openFeatureCount } from '../users.domain';

const props = defineProps<{
  users: IUserRow[];
  features: IFeature[];
}>();

const emit = defineEmits<{ (event: 'open', user: IUserRow): void }>();

const search = ref('');
const status = ref('');

/**
 * Статусы берутся из выдачи, а не из константы в браузере: список статусов
 * живёт в схеме на бэкенде, и вторая копия здесь рано или поздно разойдётся
 * с ней.
 */
const statuses = computed(() => [...new Set(props.users.map((u) => u.status))].sort());

const visible = computed(() => {
  const needle = search.value.trim().toLowerCase();
  return props.users.filter((user) => {
    if (status.value && user.status !== status.value) return false;
    if (!needle) return true;
    return [user.telegramUserId, user.username, user.firstName, user.lastName, user.storeName]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(needle));
  });
});
</script>

<template>
  <div class="filters">
    <label>
      Поиск
      <input v-model="search" type="search" placeholder="имя, ник, id или магазин" />
    </label>
    <label>
      Статус
      <select v-model="status">
        <option value="">любой</option>
        <option v-for="value in statuses" :key="value" :value="value">
          {{ STATUS_LABEL[value] ?? value }}
        </option>
      </select>
    </label>
  </div>

  <div class="scroll">
    <table>
      <thead>
        <tr>
          <th>Пользователь</th>
          <th>Статус</th>
          <th>Магазин</th>
          <th>Возможности</th>
        </tr>
      </thead>
      <tbody>
        <!--
          Строка кликабельна целиком, и с клавиатуры тоже: tabindex + Enter.
          Обернуть <tr> в <a> нельзя — таблица такого вложения не допускает,
          поэтому доступность приходится добавлять руками.
        -->
        <tr
          v-for="user in visible"
          :key="`${user.botId}:${user.telegramUserId}`"
          class="row"
          tabindex="0"
          role="link"
          @click="emit('open', user)"
          @keydown.enter="emit('open', user)"
          @keydown.space.prevent="emit('open', user)"
        >
          <td>
            <span class="name">{{ displayName(user) }}</span>
            <span class="muted">
              <template v-if="user.username">@{{ user.username }} · </template>
              {{ user.telegramUserId }}
            </span>
          </td>
          <td>{{ STATUS_LABEL[user.status] ?? user.status }}</td>
          <td>
            <template v-if="user.storeName">{{ user.storeName }}</template>
            <span v-else class="muted">не подключён</span>
          </td>
          <td class="nowrap">{{ openFeatureCount(user, features) }} из {{ features.length }}</td>
        </tr>
        <tr v-if="!visible.length">
          <td colspan="4" class="empty">Никого не найдено</td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<style scoped>
.filters {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: end;
}

.scroll {
  overflow-x: auto;
  border: 1px solid var(--border);
  border-radius: 8px;
}

table {
  width: 100%;
  border-collapse: collapse;
  font-size: 14px;
}

th,
td {
  padding: 10px;
  border-bottom: 1px solid var(--border);
  text-align: left;
  vertical-align: top;
}

thead th {
  position: sticky;
  top: 0;
  background: var(--surface);
  font-weight: 600;
  font-size: 13px;
}

.row {
  cursor: pointer;
}

.row:hover,
.row:focus-visible {
  background: var(--surface);
  outline: none;
}

.name {
  display: block;
}

.muted {
  color: var(--muted);
  font-size: 12px;
}

.nowrap {
  white-space: nowrap;
}

.empty {
  color: var(--muted);
  padding: 20px;
  text-align: center;
}
</style>
