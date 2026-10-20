<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';

import type { IJunkSourcesResponse } from '../api';

import { fetchJunkSources } from '../api';
import { describeError, token } from '../auth';

/**
 * Сводка «Мусора» по источникам: кто сканирует и сколько. Лента ниже показывает
 * отдельные запросы, а вопрос «блокировать ли на краю» решается здесь — по
 * тому, повторяются ли адреса. Блокировки в приложении нет сознательно (см.
 * src/modules/errors/README.md): список адресов копируется в nginx `deny`.
 */
const DAYS = 7;

const data = ref<IJunkSourcesResponse | null>(null);
const loading = ref(false);
const loadError = ref('');
const copied = ref(false);

const formatter = new Intl.DateTimeFormat('ru-RU', {
  timeZone: 'Europe/Moscow',
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});

/** Строки `deny` — только адреса, у которых больше одного запроса: разовый зонд блокировать незачем. */
const denyList = computed(() =>
  (data.value?.sources ?? [])
    .filter((source) => source.ip && source.count > 1)
    .map((source) => `deny ${source.ip};`)
    .join('\n'),
);

onMounted(() => void load());

async function load(): Promise<void> {
  if (!token.value) return;
  loading.value = true;
  loadError.value = '';
  try {
    data.value = await fetchJunkSources(token.value, DAYS);
  } catch (error) {
    loadError.value = describeError(error);
  } finally {
    loading.value = false;
  }
}

async function copyDeny(): Promise<void> {
  try {
    await navigator.clipboard.writeText(denyList.value);
    copied.value = true;
    window.setTimeout(() => (copied.value = false), 2000);
  } catch {
    loadError.value = 'Не удалось скопировать — браузер не дал доступ к буферу обмена';
  }
}

defineExpose({ load });
</script>

<template>
  <section>
    <div class="head">
      <h2>Источники за {{ DAYS }} дней</h2>
      <span class="muted">
        {{ data ? `${data.total} запросов${data.capped ? ' (потолок выборки)' : ''}` : '' }}
      </span>
      <button type="button" :disabled="!denyList" @click="copyDeny">
        {{ copied ? 'Скопировано' : 'Скопировать для nginx deny' }}
      </button>
    </div>

    <p v-if="loadError" class="error">{{ loadError }}</p>

    <div class="wrap">
      <table>
        <thead>
          <tr>
            <th>IP</th>
            <th class="num">Запросов</th>
            <th>Последний (МСК)</th>
            <th>Что запрашивал</th>
            <th>User-Agent</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="source in data?.sources ?? []" :key="source.ip">
            <td class="nowrap">{{ source.ip || 'не записан' }}</td>
            <td class="num">{{ source.count }}</td>
            <td class="nowrap">{{ formatter.format(new Date(source.lastAt)) }}</td>
            <td>
              <div v-for="item in source.topRequests" :key="item.request">
                {{ item.request }} <span class="muted">× {{ item.count }}</span>
              </div>
            </td>
            <td class="ua muted">{{ source.userAgent || '—' }}</td>
          </tr>
          <tr v-if="!loading && !data?.sources.length">
            <td colspan="5" class="empty">Сканов за период нет</td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>

<style scoped>
section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.head {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

h2 {
  margin: 0;
  font-size: 16px;
}

.head button {
  margin-left: auto;
}

.wrap {
  overflow-x: auto;
  max-height: 360px;
  border: 1px solid var(--border);
  border-radius: 12px;
}

table {
  width: 100%;
  border-collapse: collapse;
  font-size: 14px;
}

th,
td {
  padding: 8px 12px;
  text-align: left;
  border-bottom: 1px solid var(--border);
  vertical-align: top;
}

th {
  background: var(--surface);
  font-size: 13px;
  color: var(--muted);
  position: sticky;
  top: 0;
}

tr:last-child td {
  border-bottom: none;
}

.muted {
  color: var(--muted);
  font-size: 12px;
}

.ua {
  max-width: 320px;
  word-break: break-word;
}

.nowrap {
  white-space: nowrap;
}

.num {
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.empty {
  text-align: center;
  color: var(--muted);
  padding: 24px;
}
</style>
